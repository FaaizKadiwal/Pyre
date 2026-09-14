'use strict';

const crypto = require('node:crypto');
const logic = require('./gameLogic');

// Unambiguous alphabet: no 0/O or 1/I.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const NAME_MAX = 20;
const MESSAGE_MAX = 300;

function createStore() {
    return {
        rooms: new Map(),          // roomId -> room
        players: new Map(),        // socketId -> roomId
        pendingRemovals: new Map(), // socketId -> timeout handle
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

function roomStatus(room) {
    return room.game ? room.game.status : 'waiting';
}

function isJoinable(room) {
    return room.players.length < logic.MAX_PLAYERS && roomStatus(room) !== 'playing';
}

function createRoom(store, socketId, name) {
    const room = {
        id: generateRoomId(store.rooms),
        players: [{ id: socketId, name, isHost: true, connected: true }],
        game: null,
        createdAt: Date.now(),
    };
    store.rooms.set(room.id, room);
    store.players.set(socketId, room.id);
    return room;
}

function joinRoom(store, socketId, roomId, name) {
    const room = store.rooms.get(roomId);
    if (!room) return { error: 'Room not found' };
    if (room.players.length >= logic.MAX_PLAYERS) return { error: 'Room is full' };
    if (roomStatus(room) === 'playing') return { error: 'Game already in progress' };

    room.players.push({ id: socketId, name, isHost: false, connected: true });
    store.players.set(socketId, room.id);
    return { ok: true, room };
}

function roomFor(store, socketId) {
    const roomId = store.players.get(socketId);
    return roomId ? store.rooms.get(roomId) ?? null : null;
}

function playerIn(room, socketId) {
    return room.players.find((p) => p.id === socketId) ?? null;
}

/**
 * Remove a player from their room. Returns what changed so the caller can
 * announce it: `{ room, player, newHost, gameEnded }` or null if unknown.
 */
function removePlayer(store, socketId) {
    const room = roomFor(store, socketId);
    store.players.delete(socketId);
    if (!room) return null;

    const player = playerIn(room, socketId);
    room.players = room.players.filter((p) => p.id !== socketId);

    if (room.players.length === 0) {
        store.rooms.delete(room.id);
        return { room, player, deleted: true, newHost: null, gameEnded: false };
    }

    let newHost = null;
    if (!room.players.some((p) => p.isHost)) {
        room.players[0].isHost = true;
        newHost = room.players[0];
    }

    let gameEnded = false;
    if (room.game && room.game.status === 'playing') {
        logic.removePlayer(room.game, socketId);
        gameEnded = room.game.status === 'finished';
    }
    return { room, player, deleted: false, newHost, gameEnded };
}

function startGame(room, socketId) {
    const player = playerIn(room, socketId);
    if (!player || !player.isHost) return { error: 'Only the host can start the game' };
    if (roomStatus(room) === 'playing') return { error: 'The game is already running' };
    if (room.players.length < logic.MIN_PLAYERS) {
        return { error: `Need at least ${logic.MIN_PLAYERS} players to start` };
    }
    room.game = logic.createGame(room.players.map((p) => p.id));
    return { ok: true };
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

function listRooms(store) {
    return [...store.rooms.values()].filter(isJoinable).map(summary);
}

/**
 * Build the state one particular player is allowed to see. Only the
 * viewer's own hand is included; everyone else's hand is a count.
 */
function buildView(room, viewerId) {
    const game = room.game;
    const status = roomStatus(room);
    const current = game ? logic.currentPlayerId(game) : null;
    const mine = game?.cards[viewerId] ?? null;
    const isMyTurn = current !== null && current === viewerId;

    return {
        roomId: room.id,
        status,
        maxPlayers: logic.MAX_PLAYERS,
        minPlayers: logic.MIN_PLAYERS,
        me: viewerId,
        players: room.players.map((p) => {
            const c = game?.cards[p.id];
            return {
                id: p.id,
                name: p.name,
                isHost: p.isHost,
                connected: p.connected,
                inGame: Boolean(c),
                handCount: c ? c.hand.length : 0,
                faceUp: c ? c.faceUp : [],
                faceDownCount: c ? c.faceDown.length : 0,
                finished: game ? game.finished.includes(p.id) : false,
                isCurrent: p.id === current,
            };
        }),
        hand: mine ? mine.hand : [],
        pile: {
            top: game && game.pile.length ? game.pile[game.pile.length - 1] : null,
            count: game ? game.pile.length : 0,
        },
        deckCount: game ? game.deck.length : 0,
        currentPlayerId: current,
        isMyTurn,
        source: game ? logic.getSource(game, viewerId) : null,
        legalCards: isMyTurn ? logic.legalCards(game, viewerId) : [],
        canPickUp: game ? logic.canPickUp(game, viewerId) : false,
        finished: game ? game.finished : [],
        loser: game ? game.loser : null,
        endReason: game ? game.endReason : null,
    };
}

module.exports = {
    NAME_MAX,
    MESSAGE_MAX,
    createStore,
    normaliseRoomId,
    cleanName,
    cleanMessage,
    createRoom,
    joinRoom,
    roomFor,
    playerIn,
    removePlayer,
    startGame,
    listRooms,
    buildView,
};
