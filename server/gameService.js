import * as logic from './gameLogic.js';
import * as rooms from './rooms.js';
import * as bots from './bots.js';

/** How long a disconnected player keeps their seat before being removed. */
const DISCONNECT_GRACE_MS = 60_000;
/** Socket.IO room holding everyone who is looking at the lobby rather than a table. */
const LOBBY = 'lobby';
/** The leaderboard is recomputed at most this often; a finished game clears it at once. */
const LEADERBOARD_TTL_MS = 5_000;
/** How long the swap phase may last when the room has no turn timer. */
const SWAP_FALLBACK_SECONDS = 120;
/** After this many turns lost to the clock in a row, the table plays for the player until they act. */
const AWAY_AFTER_TIMEOUTS = 2;

const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const cardLabel = (card) => (logic.isJoker(card) ? 'Joker' : `${card.value}${SUIT_SYMBOLS[card.suit]}`);
const cardLabels = (cards) => cards.map(cardLabel).join(' ');
const describeTimer = (seconds) => (seconds ? `${seconds} seconds per turn` : 'no turn timer');
const RULE_NAMES = {
    threes: 'threes skip',
    sevens: 'sevens force low',
    eights: 'eights are transparent',
    nines: 'nines reverse',
    jokers: 'jokers reverse',
    tensLow: 'tens stay low',
};

/**
 * Everything that changes a room and tells its players about it.
 *
 * Socket handlers only parse requests and call in here. The turn timer, the
 * disconnect grace timer and the bots call in here too, which is why this
 * lives outside any single socket. Every method returns `{ ok: true, ... }`
 * or `{ error }`.
 *
 * Fan-out is deliberate: `room-state` goes to the human players of one room,
 * while `room-list` and `leaderboard` go only to sockets in the lobby.
 */
function createGameService(io, store) {
    let leaderboardCache = null;

    // ----- Lobby -----

    const getLeaderboard = async () => {
        if (leaderboardCache && Date.now() - leaderboardCache.at < LEADERBOARD_TTL_MS) {
            return leaderboardCache.payload;
        }
        const [rows, recent] = await Promise.all([store.results.leaderboard(), store.results.recentGames(5)]);
        const payload = { persistent: store.results.persistent, rows, recent };
        leaderboardCache = { payload, at: Date.now() };
        return payload;
    };

    const sendLeaderboard = (target) => getLeaderboard()
        .then((payload) => target.emit('leaderboard', payload))
        .catch((err) => console.error('Leaderboard unavailable:', err.message));

    const broadcastRoomList = () => io.to(LOBBY).emit('room-list', rooms.listRooms(store));

    /** A socket with no seat: subscribe it to lobby updates and send the current picture. */
    const enterLobby = (socket) => {
        socket.join(LOBBY);
        socket.emit('room-list', rooms.listRooms(store));
        sendLeaderboard(socket);
    };

    // ----- Room broadcasts -----

    const broadcastRoom = (room) => {
        for (const player of room.players) {
            if (player.socketId) io.to(player.socketId).emit('room-state', rooms.buildView(room, player));
        }
    };

    const announce = (room, type, message, extra = {}) => {
        io.to(room.id).emit('game-event', { type, message, at: Date.now(), ...extra });
    };

    const react = (room, player, emoji) => {
        const clean = rooms.cleanReaction(emoji);
        if (!clean) return { error: 'That reaction is not available' };
        io.to(room.id).emit('reaction', { playerId: player.id, emoji: clean, at: Date.now() });
        return { ok: true };
    };

    const recordResult = (room) => {
        store.results.recordGame(rooms.buildResult(room))
            .then(() => {
                leaderboardCache = null;
                return sendLeaderboard(io.to(LOBBY));
            })
            .catch((err) => console.error('Failed to record game result:', err.message));
    };

    const nameOf = (room, id) => rooms.playerById(room, id)?.name ?? 'A player';
    const firstPlayerName = (room) => nameOf(room, logic.currentPlayerId(room.game));

    /** A human acted for themselves: they are neither away nor timing out any more. */
    const markActive = (room, player) => {
        player.timeouts = 0;
        if (player.away) {
            player.away = false;
            announce(room, 'back', `${player.name} is back at the table.`, { playerId: player.id });
        }
    };

    /** Is this seat one the table has to play for right now? */
    const needsProxy = (player) => player.isBot || !player.connected || player.away;

    /** Bots think faster at a fast table. */
    const pace = (room) => (room.settings.turnSeconds && room.settings.turnSeconds <= 20 ? 0.5 : 1);

    // ----- Timers: the swap phase, each turn, and the bots -----

    const clearTurnTimer = (room) => {
        if (room.turn.handle) clearTimeout(room.turn.handle);
        room.turn = { endsAt: null, handle: null };
    };

    const clearBotTimer = (room) => {
        if (room.bot.handle) clearTimeout(room.bot.handle);
        room.bot.handle = null;
    };

    const arm = (room, seconds, fn) => {
        const handle = setTimeout(() => fn(room), seconds * 1000);
        handle.unref?.();
        room.turn = { endsAt: Date.now() + seconds * 1000, handle };
    };

    /**
     * Arm the clock for the current phase. The swap deadline is set once and
     * not restarted by each Ready press; every play restarts the turn clock.
     */
    const scheduleTurn = (room) => {
        const game = room.game;
        if (!game || game.status === 'finished') {
            clearTurnTimer(room);
            return;
        }
        if (game.status === 'swapping') {
            if (room.turn.handle) return;
            arm(room, room.settings.turnSeconds > 0 ? room.settings.turnSeconds : SWAP_FALLBACK_SECONDS, autoBegin);
            return;
        }
        clearTurnTimer(room);
        if (room.settings.turnSeconds > 0) arm(room, room.settings.turnSeconds, autoMove);
    };

    /** Give bots, and the table standing in for absent players, a moment to "think". */
    const scheduleBots = (room) => {
        clearBotTimer(room);
        const game = room.game;
        if (!game || game.status === 'finished') return;
        let delay = null;
        if (game.status === 'swapping' && room.players.some((p) => needsProxy(p) && game.cards[p.id] && !game.ready.includes(p.id))) {
            delay = store.botDelay.swapMs;
        } else if (game.status === 'playing') {
            const current = rooms.playerById(room, logic.currentPlayerId(game));
            if (current?.isBot) delay = Math.round(store.botDelay.moveMs * pace(room));
            else if (current && needsProxy(current)) delay = store.botDelay.awayMs;
        }
        if (delay === null) return;
        room.bot.handle = setTimeout(() => botAct(room), delay);
        room.bot.handle.unref?.();
    };

    function botAct(room) {
        room.bot.handle = null;
        const game = room.game;
        if (!game) return;
        if (game.status === 'swapping') {
            for (const seat of room.players.filter((p) => needsProxy(p) && game.cards[p.id] && !game.ready.includes(p.id))) {
                if (seat.isBot) {
                    for (const [handCard, faceUpCard] of bots.planSwaps(game.cards[seat.id])) {
                        logic.swapCards(game, seat.id, handCard, faceUpCard);
                    }
                }
                const result = logic.setReady(game, seat.id);
                announce(room, 'ready', seat.isBot ? `${seat.name} is ready.` : `${seat.name} is not here, so the table pressed Ready for them.`);
                if (result.started) announce(room, 'started', `Everyone is ready. ${firstPlayerName(room)} goes first.`);
            }
            settle(room);
            return;
        }
        if (game.status !== 'playing') return;
        const seat = rooms.playerById(room, logic.currentPlayerId(game));
        if (!seat || !needsProxy(seat)) return;
        const level = seat.isBot ? room.settings.botLevel : 'normal';
        const move = bots.chooseMove(game, seat.id, store.random, level);
        const auto = seat.isBot ? false : 'away';
        let result;
        if (move.type === 'play') result = play(room, seat, move.cards, { auto });
        else if (move.type === 'pickUp') result = pickUp(room, seat, null, { auto });
        else result = playFaceDown(room, seat, move.index, { auto });
        const emoji = seat.isBot && !result.error ? bots.reactionFor(result) : null;
        if (emoji) react(room, seat, emoji);
    }

    /** Swap time is up: play begins with whatever everyone has. */
    function autoBegin(room) {
        const game = room.game;
        if (!game || game.status !== 'swapping') return;
        logic.beginPlay(game);
        announce(room, 'started', `Time is up for swapping. ${firstPlayerName(room)} goes first.`, { auto: true });
        settle(room);
    }

    /** When the clock runs out, the server makes a sensible move for the current player. */
    function autoMove(room) {
        const game = room.game;
        if (!game || game.status !== 'playing') return;
        const id = logic.currentPlayerId(game);
        const player = rooms.playerById(room, id);
        if (!player) return;
        player.timeouts += 1;
        if (!player.away && !player.isBot && player.timeouts >= AWAY_AFTER_TIMEOUTS) {
            player.away = true;
            announce(room, 'away', `${player.name} seems to be away. The table will play for them until they act.`, { playerId: player.id });
        }
        const move = bots.chooseMove(game, id, store.random, 'normal');
        if (move.type === 'play') play(room, player, move.cards, { auto: 'timeout' });
        else if (move.type === 'pickUp') pickUp(room, player, null, { auto: 'timeout' });
        else playFaceDown(room, player, move.index, { auto: 'timeout' });
    }

    // ----- Game over, and the common tail of every move -----

    /** Returns true when this call is the one that wrapped the game up. */
    const finishIfOver = (room) => {
        const game = room.game;
        if (!game || game.status !== 'finished' || game.settled) return false;
        game.settled = true;
        clearTurnTimer(room);
        clearBotTimer(room);
        if (game.endReason === 'completed') {
            const winner = game.finished[0];
            room.scores[winner] = (room.scores[winner] ?? 0) + 1;
            room.losses[game.loser] = (room.losses[game.loser] ?? 0) + 1;
            rooms.recordHistory(room);
            announce(room, 'game-over', `Game over: ${nameOf(room, game.loser)} is the shithead. ${nameOf(room, winner)} went out first.`, { loserId: game.loser });
            recordResult(room);
        } else {
            announce(room, 'game-over', 'Game over: not enough players left to continue.');
        }
        return true;
    };

    const settle = (room) => {
        const ended = finishIfOver(room);
        scheduleTurn(room);
        scheduleBots(room);
        broadcastRoom(room);
        if (ended) broadcastRoomList(); // the room is joinable again
    };

    // ----- Moves -----

    const actor = (player, auto) => {
        if (auto === 'timeout') return `${player.name} ran out of time and`;
        if (auto === 'away') return `${player.name} (away)`;
        return player.name;
    };

    const burnMessage = (burn) => (burn === 'ten' ? 'burned the pile with a ten' : 'completed four of a kind and burned the pile');

    /** Turn a rules effect into words, e.g. ", Bob is skipped" or ", direction reversed". */
    const effectWords = (room, effects) => {
        if (!effects) return '';
        const parts = [];
        if (effects.reversed) parts.push('direction reversed');
        if (effects.skipped?.length) parts.push(`${effects.skipped.map((id) => nameOf(room, id)).join(' and ')} skipped`);
        return parts.length ? `, ${parts.join(', ')}` : '';
    };

    /** Bookkeeping shared by every move: reset away-ness for humans acting themselves. */
    const acting = (room, player, auto) => {
        if (!auto && !player.isBot) markActive(room, player);
    };

    const play = (room, player, cards, { auto = false } = {}) => {
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.playCards(room.game, player.id, cards);
        if (result.error) return result;
        acting(room, player, auto);
        const labels = cardLabels(result.cards);
        const extra = { cards: result.cards, auto, playerId: player.id, effects: result.effects };
        if (result.burn) {
            announce(room, 'burn', `${actor(player, auto)} played ${labels}, ${burnMessage(result.burn)} and plays again.`, extra);
        } else {
            announce(room, 'play', `${actor(player, auto)} played ${labels}${effectWords(room, result.effects)}.`, extra);
        }
        if (result.finished) announce(room, 'finished', `${player.name} is out of cards!`, { playerId: player.id });
        settle(room);
        return { ok: true, ...result };
    };

    const playFaceDown = (room, player, index, { auto = false } = {}) => {
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.playFaceDown(room.game, player.id, index);
        if (result.error) return result;
        acting(room, player, auto);
        const label = cardLabel(result.card);
        const extra = { card: result.card, auto, playerId: player.id, flipped: true, effects: result.effects };
        if (!result.success) {
            announce(room, 'pick-up', `${actor(player, auto)} flipped ${label}, which does not beat the pile, and picked up ${result.pickedUp} cards.`, extra);
        } else if (result.burn) {
            announce(room, 'burn', `${actor(player, auto)} flipped ${label}, ${burnMessage(result.burn)} and plays again.`, extra);
        } else {
            announce(room, 'play', `${actor(player, auto)} flipped ${label}${effectWords(room, result.effects)}.`, extra);
        }
        if (result.finished) announce(room, 'finished', `${player.name} is out of cards!`, { playerId: player.id });
        settle(room);
        return { ok: true, ...result };
    };

    const pickUp = (room, player, faceUpCard, { auto = false } = {}) => {
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.pickUpPile(room.game, player.id, faceUpCard);
        if (result.error) return result;
        acting(room, player, auto);
        const extra = result.added ? ` (adding ${cardLabel(result.added)} from the table)` : '';
        announce(room, 'pick-up', `${actor(player, auto)} picked up ${result.count} cards${extra}.`, { auto, playerId: player.id, count: result.count });
        settle(room);
        return { ok: true, ...result };
    };

    // ----- Before play: swapping -----

    const swap = (room, player, handCard, faceUpCard) => {
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.swapCards(room.game, player.id, handCard, faceUpCard);
        if (result.error) return result;
        markActive(room, player);
        broadcastRoom(room);
        return { ok: true };
    };

    const ready = (room, player) => {
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.setReady(room.game, player.id);
        if (result.error) return result;
        markActive(room, player);
        announce(room, 'ready', `${player.name} is ready.`, { playerId: player.id });
        if (result.started) announce(room, 'started', `Everyone is ready. ${firstPlayerName(room)} goes first.`);
        settle(room);
        return { ok: true };
    };

    const beginPlay = (room, player) => {
        if (!player.isHost) return { error: 'Only the host can start play early' };
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.beginPlay(room.game);
        if (result.error) return result;
        announce(room, 'started', `${player.name} started play. ${firstPlayerName(room)} goes first.`);
        settle(room);
        return { ok: true };
    };

    // ----- Room lifecycle -----

    const createRoom = (socket, name, avatar, mode, botCount = 0) => {
        const result = rooms.createRoom(store, socket.id, name, avatar, mode);
        if (result.error) return result;
        socket.leave(LOBBY);
        socket.join(result.room.id);
        // "Play vs bots": the requested bots are seated before the host even sees the table.
        const seats = Math.min(Math.max(0, Math.trunc(Number(botCount) || 0)), logic.MAX_PLAYERS - 1);
        for (let i = 0; i < seats; i++) {
            const bot = rooms.addBot(result.room, result.player);
            if (bot.ok) announce(result.room, 'joined', `${bot.player.name} (bot) took a seat.`);
        }
        broadcastRoom(result.room);
        broadcastRoomList();
        return result;
    };

    const joinRoom = (socket, roomId, name, avatar) => {
        const result = rooms.joinRoom(store, socket.id, roomId, name, avatar);
        if (result.error) return result;
        socket.leave(LOBBY);
        socket.join(result.room.id);
        announce(result.room, 'joined', result.spectating
            ? `${result.player.name} is watching and will play the next round.`
            : `${result.player.name} joined.`, { playerId: result.player.id });
        broadcastRoom(result.room);
        broadcastRoomList();
        return result;
    };

    const addBot = (room, host) => {
        const result = rooms.addBot(room, host);
        if (result.error) return result;
        announce(room, 'joined', `${result.player.name} (bot) took a seat.`);
        broadcastRoom(room);
        broadcastRoomList();
        return { ok: true };
    };

    const startGame = (room, player) => {
        const result = rooms.startGame(store, room, player);
        if (result.error) return result;
        clearTurnTimer(room);
        const active = Object.entries(room.settings.rules).filter(([, on]) => on).map(([key]) => RULE_NAMES[key]);
        announce(room, 'dealt', active.length
            ? `Cards dealt with house rules: ${active.join(', ')}. Swap, then press Ready.`
            : 'Cards dealt. Swap any hand cards with your face-up cards, then press Ready.');
        scheduleTurn(room);
        scheduleBots(room);
        broadcastRoom(room);
        broadcastRoomList(); // the seat count and status changed
        return { ok: true };
    };

    const updateSettings = (room, player, patch) => {
        const result = rooms.updateSettings(room, player, patch);
        if (result.error) return result;
        const { turnSeconds, private: isPrivate, botLevel, rules } = room.settings;
        const active = Object.entries(rules).filter(([, on]) => on).map(([key]) => RULE_NAMES[key]);
        announce(room, 'settings', `${player.name} set ${describeTimer(turnSeconds)}, ${botLevel} bots, ${isPrivate ? 'private' : 'public'} room${active.length ? `, house rules: ${active.join(', ')}` : ', standard rules'}.`);
        broadcastRoom(room);
        broadcastRoomList();
        return { ok: true };
    };

    const chat = (room, player, text) => {
        io.to(room.id).emit('chat-message', {
            playerId: player.id,
            name: player.name,
            color: player.color,
            avatar: player.avatar,
            message: text,
            at: Date.now(),
        });
    };

    // ----- Seats: leaving, disconnecting, reclaiming, removing -----

    const cancelRemoval = (socketId) => {
        const pending = store.pendingRemovals.get(socketId);
        if (!pending) return;
        clearTimeout(pending);
        store.pendingRemovals.delete(socketId);
    };

    /** Announce and follow up on a removal computed by rooms.removeById/removePlayer. */
    const applyRemoval = (change, reason) => {
        if (!change) return null;
        const { room, player, deleted, newHost, gameEnded } = change;
        if (deleted) {
            clearTurnTimer(room);
            clearBotTimer(room);
        } else {
            announce(room, 'left', `${player.name} ${reason}.`);
            if (newHost) announce(room, 'host', `${newHost.name} is now the host.`);
            if (gameEnded) finishIfOver(room);
            else if (room.game && room.game.status !== 'finished') {
                scheduleTurn(room);
                scheduleBots(room);
            }
            broadcastRoom(room);
        }
        broadcastRoomList();
        return change;
    };

    /** Remove whoever holds `socketId`: they left, timed out, or were removed by the host. */
    const removeSeat = (socketId, reason) => {
        cancelRemoval(socketId);
        return applyRemoval(rooms.removePlayer(store, socketId), reason);
    };

    const leave = (socket) => {
        const found = rooms.lookup(store, socket.id);
        if (!found) return { error: 'You are not in a room' };
        socket.leave(found.room.id);
        removeSeat(socket.id, 'left the room');
        enterLobby(socket);
        return { ok: true };
    };

    const kick = (room, host, targetId) => {
        if (!host.isHost) return { error: 'Only the host can remove players' };
        const target = rooms.playerById(room, targetId);
        if (!target) return { error: 'That player is not in this room' };
        if (target.id === host.id) return { error: 'Use Leave to leave the room yourself' };
        if (target.isBot) {
            applyRemoval(rooms.removeById(store, room, target.id), `was removed by ${host.name}`);
            return { ok: true };
        }
        const targetSocket = io.sockets.sockets.get(target.socketId);
        const notice = { reason: `${host.name} removed you from the room` };
        if (targetSocket) {
            targetSocket.leave(room.id);
            targetSocket.emit('left-room', notice);
        } else {
            io.to(target.socketId).emit('left-room', notice); // buffered until they recover
        }
        removeSeat(target.socketId, `was removed by ${host.name}`);
        if (targetSocket) enterLobby(targetSocket);
        return { ok: true };
    };

    /** A socket dropped: keep the seat, and let the table play for them meanwhile. */
    const holdSeat = (socketId) => {
        const found = rooms.lookup(store, socketId);
        if (!found) return; // never seated, or the seat has since moved to a newer connection
        const { room, player } = found;
        player.connected = false;
        announce(room, 'disconnected', `${player.name} lost connection. The table plays for them until they are back; the seat is held for ${DISCONNECT_GRACE_MS / 1000}s.`, { playerId: player.id });
        scheduleBots(room);
        broadcastRoom(room);
        const handle = setTimeout(() => removeSeat(socketId, 'was removed after disconnecting'), DISCONNECT_GRACE_MS);
        handle.unref?.();
        store.pendingRemovals.set(socketId, handle);
    };

    const welcomeBack = (room, player) => {
        player.connected = true;
        markActive(room, player);
        announce(room, 'reconnected', `${player.name} reconnected.`, { playerId: player.id });
        scheduleBots(room);
        broadcastRoom(room);
    };

    /**
     * Socket.IO restored the same connection id within its recovery window.
     * A seat is still held (the grace period outlasts the window) unless the
     * host removed the player meanwhile, and that `left-room` was buffered.
     */
    const recoverSeat = (socket) => {
        cancelRemoval(socket.id);
        const found = rooms.lookup(store, socket.id);
        if (!found) {
            enterLobby(socket);
            return;
        }
        welcomeBack(found.room, found.player);
    };

    /** A new socket presents a session token: a reload, a new tab, or a long drop. */
    const reclaimSeat = (socket, roomId, token) => {
        const result = rooms.resumeSession(store, socket.id, roomId, token);
        if (result.error) return result;
        const { room, player, previousSocketId, wasConnected } = result;
        cancelRemoval(previousSocketId);
        const previous = wasConnected && previousSocketId !== socket.id ? io.sockets.sockets.get(previousSocketId) : null;
        if (previous) {
            // The old tab is still open: unseat it politely rather than fighting over the seat.
            previous.leave(room.id);
            previous.emit('left-room', { reason: 'You rejoined this room from another tab' });
            enterLobby(previous);
        }
        socket.leave(LOBBY);
        socket.join(room.id);
        if (wasConnected) {
            broadcastRoom(room);
        } else {
            welcomeBack(room, player);
        }
        return result;
    };

    return {
        enterLobby,
        createRoom,
        joinRoom,
        addBot,
        reclaimSeat,
        recoverSeat,
        leave,
        kick,
        holdSeat,
        startGame,
        updateSettings,
        swap,
        ready,
        beginPlay,
        play,
        playFaceDown,
        pickUp,
        chat,
        react,
        autoMove,
    };
}

export { createGameService, DISCONNECT_GRACE_MS, LOBBY, SWAP_FALLBACK_SECONDS, AWAY_AFTER_TIMEOUTS };
