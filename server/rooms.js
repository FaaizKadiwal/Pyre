import crypto from 'node:crypto';
import * as logic from './gameLogic.js';
import { BOT_NAMES } from './bots.js';
import { createMemoryResultStore } from './results.js';

// Unambiguous alphabet: no 0/O or 1/I.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const NAME_MAX = 20;
const MESSAGE_MAX = 300;
const MAX_ROOMS = 500;
const TURN_SECONDS_MAX = 300;
const COLOR_COUNT = 8;
const DEFAULT_SETTINGS = { turnSeconds: 60, private: false };
/** The emoji a player may send as a reaction. */
const REACTIONS = ['👏', '😂', '😱', '🔥', '😈', '💩', '👋', '🤔'];

/**
 * All server state lives here. `results` persists finished games (memory or
 * Postgres), `random` is injectable so tests can deal deterministically, the
 * rate limits are read once per connection, and the bot delays are shortened
 * by the tests.
 *
 * Players have a stable `id` (sockets change on reconnect) and a secret
 * `token` that lets a new connection reclaim the same seat. Bots are seats
 * with no socket and no token.
 */
function createStore({ results = createMemoryResultStore(), random = Math.random, maxRooms = MAX_ROOMS } = {}) {
    return {
        rooms: new Map(),           // roomId -> room
        players: new Map(),         // socketId -> { roomId, playerId }
        pendingRemovals: new Map(), // socketId -> timeout handle
        results,
        random,
        maxRooms,
        rateLimit: { windowMs: 5_000, actions: 30, chat: 5 },
        botDelay: { swapMs: 700, moveMs: 900 },
    };
}

function generateRoomId(rooms) {
    let id;
    do {
        id = '';
        for (let i = 0; i < CODE_LENGTH; i++) {
            id += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
        }
    } while (rooms.has(id));
    return id;
}

function normaliseRoomId(raw) {
    return typeof raw === 'string' ? raw.trim().toUpperCase() : '';
}

function cleanName(raw) {
    const name = typeof raw === 'string'
        ? raw.replace(/[\p{C}]/gu, '').trim().slice(0, NAME_MAX)
        : '';
    return name || `Player-${crypto.randomInt(1000, 9999)}`;
}

function cleanMessage(raw) {
    return typeof raw === 'string'
        ? raw.replace(/[\p{C}]/gu, '').trim().slice(0, MESSAGE_MAX)
        : '';
}

function cleanReaction(raw) {
    return REACTIONS.includes(raw) ? raw : null;
}

/** Two "Sam"s in one room become "Sam" and "Sam 2" so results and chat stay unambiguous. */
function uniqueName(room, name) {
    const taken = new Set(room.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
        const candidate = `${name.slice(0, NAME_MAX - 3)} ${n}`;
        if (!taken.has(candidate.toLowerCase())) return candidate;
    }
}

/** The lowest colour index nobody in the room is using. */
function nextColor(room) {
    const used = new Set(room.players.map((p) => p.color));
    for (let color = 0; color < COLOR_COUNT; color++) {
        if (!used.has(color)) return color;
    }
    return room.players.length % COLOR_COUNT;
}

function newPlayer(socketId, name, isHost, color) {
    return {
        id: crypto.randomUUID(),
        socketId,
        token: crypto.randomBytes(24).toString('base64url'),
        name,
        isHost,
        connected: true,
        color,
        isBot: false,
    };
}

function newBot(name, color) {
    return { id: crypto.randomUUID(), socketId: null, token: null, name, isHost: false, connected: true, color, isBot: true };
}

function safeEqual(a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function bind(store, socketId, room, player) {
    store.players.set(socketId, { roomId: room.id, playerId: player.id });
}

function roomStatus(room) {
    return room.game ? room.game.status : 'waiting';
}

function isRunning(room) {
    const status = roomStatus(room);
    return status === 'swapping' || status === 'playing';
}

/** Anyone may take a free seat; during a game they watch and play the next round. */
function isJoinable(room) {
    return room.players.length < logic.MAX_PLAYERS;
}

/** Resolve a socket to its room and player, or null when the socket holds no seat. */
function lookup(store, socketId) {
    const ref = store.players.get(socketId);
    if (!ref) return null;
    const room = store.rooms.get(ref.roomId);
    const player = room?.players.find((p) => p.id === ref.playerId);
    return room && player ? { room, player } : null;
}

function playerById(room, playerId) {
    return room.players.find((p) => p.id === playerId) ?? null;
}

function createRoom(store, socketId, name) {
    if (store.rooms.size >= store.maxRooms) {
        return { error: 'The server is full right now, please try again in a minute' };
    }
    const player = newPlayer(socketId, name, true, 0);
    const room = {
        id: generateRoomId(store.rooms),
        players: [player],
        game: null,
        createdAt: Date.now(),
        startedAt: null,
        settings: { ...DEFAULT_SETTINGS },
        scores: {},                          // playerId -> games won in this room
        losses: {},                          // playerId -> times the shithead in this room
        dealer: null,                         // seat index of the last dealer
        turn: { endsAt: null, handle: null }, // turn timer, managed by gameService
        bot: { handle: null },                // bot think timer, managed by gameService
    };
    store.rooms.set(room.id, room);
    bind(store, socketId, room, player);
    return { ok: true, room, player };
}

function joinRoom(store, socketId, roomId, name) {
    const room = store.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (!isJoinable(room)) return { error: 'Room is full' };

    const player = newPlayer(socketId, uniqueName(room, name), false, nextColor(room));
    room.players.push(player);
    bind(store, socketId, room, player);
    return { ok: true, room, player, spectating: isRunning(room) };
}

function addBot(room, host) {
    if (!host.isHost) return { error: 'Only the host can add bots' };
    if (isRunning(room)) return { error: 'Bots can only be added between games' };
    if (!isJoinable(room)) return { error: 'Room is full' };
    const name = BOT_NAMES.find((n) => !room.players.some((p) => p.name === n)) ?? uniqueName(room, 'Bot');
    const bot = newBot(name, nextColor(room));
    room.players.push(bot);
    return { ok: true, player: bot };
}

/**
 * Reclaim a seat from a new socket with the token handed out on create/join.
 * The newest connection wins, so a reload or a second tab takes over cleanly.
 */
function resumeSession(store, socketId, roomId, token) {
    const room = store.rooms.get(roomId);
    if (!room) return { error: 'That room no longer exists' };
    const player = room.players.find((p) => !p.isBot && safeEqual(p.token, token));
    if (!player) return { error: 'No seat matches that session' };

    const previousSocketId = player.socketId;
    const wasConnected = player.connected;
    store.players.delete(previousSocketId);
    player.socketId = socketId;
    player.connected = true;
    bind(store, socketId, room, player);
    return { ok: true, room, player, previousSocketId, wasConnected };
}

/**
 * Remove a player (human or bot) from a room. Returns what changed so the
 * caller can announce it: `{ room, player, deleted, newHost, gameEnded }`.
 * A room with no humans left is deleted, bots and all.
 */
function removeById(store, room, playerId) {
    const player = playerById(room, playerId);
    if (!player) return null;
    if (player.socketId) store.players.delete(player.socketId);
    room.players = room.players.filter((p) => p.id !== player.id);
    delete room.scores[player.id];
    delete room.losses[player.id];

    if (!room.players.some((p) => !p.isBot)) {
        store.rooms.delete(room.id);
        return { room, player, deleted: true, newHost: null, gameEnded: false };
    }

    let newHost = null;
    if (!room.players.some((p) => p.isHost)) {
        newHost = room.players.find((p) => !p.isBot);
        newHost.isHost = true;
    }

    let gameEnded = false;
    if (room.game && isRunning(room)) {
        logic.removePlayer(room.game, player.id);
        gameEnded = room.game.status === 'finished';
    }
    return { room, player, deleted: false, newHost, gameEnded };
}

/** Remove the player seated at a socket. */
function removePlayer(store, socketId) {
    const found = lookup(store, socketId);
    store.players.delete(socketId);
    return found ? removeById(store, found.room, found.player.id) : null;
}

function updateSettings(room, player, patch) {
    if (!player.isHost) return { error: 'Only the host can change settings' };
    if (isRunning(room)) return { error: 'Settings cannot change during a game' };

    const next = { ...room.settings };
    if (patch.turnSeconds != null) {
        const seconds = Number(patch.turnSeconds);
        if (!Number.isInteger(seconds) || seconds < 0 || seconds > TURN_SECONDS_MAX) {
            return { error: `Turn timer must be between 0 (off) and ${TURN_SECONDS_MAX} seconds` };
        }
        next.turnSeconds = seconds;
    }
    if (patch.private != null) {
        if (typeof patch.private !== 'boolean') return { error: 'Private must be true or false' };
        next.private = patch.private;
    }
    room.settings = next;
    return { ok: true, settings: next };
}

function startGame(store, room, player) {
    if (!player.isHost) return { error: 'Only the host can start the game' };
    if (isRunning(room)) return { error: 'The game is already running' };
    if (room.players.length < logic.MIN_PLAYERS) {
        return { error: `Need at least ${logic.MIN_PLAYERS} players to start` };
    }
    // "The dealer is randomly selected for the first hand. The deal rotates clockwise after each hand."
    // The deal, and so the turn order, starts with the player to the dealer's left.
    const ids = room.players.map((p) => p.id);
    room.dealer = room.dealer === null ? Math.floor(store.random() * ids.length) : (room.dealer + 1) % ids.length;
    room.game = logic.createGame([...ids.slice(room.dealer + 1), ...ids.slice(0, room.dealer + 1)], store.random);
    room.startedAt = Date.now();
    return { ok: true };
}

/** The record of a game that ran to completion, in finishing order. */
function buildResult(room, now = Date.now()) {
    const game = room.game;
    const order = [...game.finished, game.loser].filter(Boolean);
    return {
        roomId: room.id,
        playedAt: new Date(now).toISOString(),
        durationSeconds: Math.max(0, Math.round((now - (room.startedAt ?? now)) / 1000)),
        playerCount: order.length,
        players: order.map((id, i) => {
            const p = playerById(room, id);
            return { name: p?.name ?? 'Unknown', place: i + 1, bot: Boolean(p?.isBot) };
        }),
    };
}

function summary(room) {
    return {
        id: room.id,
        playerCount: room.players.length,
        maxPlayers: logic.MAX_PLAYERS,
        status: roomStatus(room),
        host: room.players.find((p) => p.isHost)?.name ?? '',
    };
}

/** Public rooms with a free seat. Private rooms are reachable by code only. */
function listRooms(store) {
    return [...store.rooms.values()]
        .filter((room) => isJoinable(room) && !room.settings.private)
        .map(summary);
}

/**
 * Build the state one particular player is allowed to see. Only the viewer's
 * own hand is included; everyone else's hand is a count. Socket ids and
 * session tokens never leave the server.
 */
function buildView(room, viewer) {
    const game = room.game;
    const status = roomStatus(room);
    const current = game ? logic.currentPlayerId(game) : null;
    const mine = game?.cards[viewer.id] ?? null;
    const isMyTurn = current !== null && current === viewer.id;

    return {
        roomId: room.id,
        status,
        maxPlayers: logic.MAX_PLAYERS,
        minPlayers: logic.MIN_PLAYERS,
        settings: room.settings,
        reactions: REACTIONS,
        me: viewer.id,
        players: room.players.map((p) => {
            const c = game?.cards[p.id];
            return {
                id: p.id,
                name: p.name,
                color: p.color,
                isHost: p.isHost,
                isBot: p.isBot,
                connected: p.connected,
                wins: room.scores[p.id] ?? 0,
                losses: room.losses[p.id] ?? 0,
                inGame: Boolean(c),
                handCount: c ? c.hand.length : 0,
                faceUp: c ? c.faceUp : [],
                faceDownCount: c ? c.faceDown.length : 0,
                cardsLeft: c ? c.hand.length + c.faceUp.length + c.faceDown.length : 0,
                ready: game ? game.ready.includes(p.id) : false,
                finished: game ? game.finished.includes(p.id) : false,
                isCurrent: p.id === current,
            };
        }),
        hand: mine ? mine.hand : [],
        pile: {
            top: game && game.pile.length ? game.pile[game.pile.length - 1] : null,
            count: game ? game.pile.length : 0,
            topRun: game ? logic.topRun(game.pile) : 0,
        },
        deckCount: game ? game.deck.length : 0,
        currentPlayerId: current,
        isMyTurn,
        turnEndsAt: room.turn.endsAt,
        serverNow: Date.now(),
        source: game ? logic.getSource(game, viewer.id) : null,
        legalCards: isMyTurn ? logic.legalCards(game, viewer.id) : [],
        canPickUp: game ? logic.canPickUp(game, viewer.id) : false,
        mustPickUp: game ? logic.mustPickUp(game, viewer.id) : false,
        finished: game ? game.finished : [],
        loser: game ? game.loser : null,
        endReason: game ? game.endReason : null,
        stats: game ? game.stats : null,
        durationSeconds: game && room.startedAt ? Math.round((Date.now() - room.startedAt) / 1000) : 0,
    };
}

export {
    NAME_MAX,
    MESSAGE_MAX,
    MAX_ROOMS,
    TURN_SECONDS_MAX,
    REACTIONS,
    createStore,
    normaliseRoomId,
    cleanName,
    cleanMessage,
    cleanReaction,
    uniqueName,
    lookup,
    playerById,
    isRunning,
    createRoom,
    joinRoom,
    addBot,
    resumeSession,
    removeById,
    removePlayer,
    updateSettings,
    startGame,
    buildResult,
    listRooms,
    buildView,
};
