import * as logic from './gameLogic.js';
import * as rooms from './rooms.js';

/** How long a disconnected player keeps their seat before being removed. */
const DISCONNECT_GRACE_MS = 60_000;
/** Socket.IO room holding everyone who is looking at the lobby rather than a table. */
const LOBBY = 'lobby';
/** The leaderboard is recomputed at most this often; a finished game clears it at once. */
const LEADERBOARD_TTL_MS = 5_000;
/** How long the swap phase may last when the room has no turn timer. */
const SWAP_FALLBACK_SECONDS = 120;

const SUIT_SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const cardLabel = (card) => `${card.value}${SUIT_SYMBOLS[card.suit]}`;
const cardLabels = (cards) => cards.map(cardLabel).join(' ');
const describeTimer = (seconds) => (seconds ? `${seconds} seconds per turn` : 'no turn timer');

/**
 * Everything that changes a room and tells its players about it.
 *
 * Socket handlers only parse requests and call in here. The turn timer and
 * the disconnect grace timer call in here too, which is why this lives
 * outside any single socket. Every method returns `{ ok: true }` or `{ error }`.
 *
 * Fan-out is deliberate: `room-state` goes to the players of one room, while
 * `room-list` and `leaderboard` go only to sockets in the lobby.
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
            io.to(player.socketId).emit('room-state', rooms.buildView(room, player));
        }
    };

    const announce = (room, type, message, extra = {}) => {
        io.to(room.id).emit('game-event', { type, message, at: Date.now(), ...extra });
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

    // ----- Timers: the swap phase and each turn -----

    const clearTurnTimer = (room) => {
        if (room.turn.handle) clearTimeout(room.turn.handle);
        room.turn = { endsAt: null, handle: null };
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
        const legal = logic.legalCards(game, id);
        if (legal.length) {
            const value = logic.lowestValue(legal);
            play(room, player, legal.filter((c) => c.value === value), { auto: true });
        } else if (logic.canPickUp(game, id)) {
            pickUp(room, player, null, { auto: true });
        } else if (logic.getSource(game, id) === 'faceDown') {
            const index = Math.floor(store.random() * game.cards[id].faceDown.length);
            playFaceDown(room, player, index, { auto: true });
        }
    }

    // ----- Game over, and the common tail of every move -----

    /** Returns true when this call is the one that wrapped the game up. */
    const finishIfOver = (room) => {
        const game = room.game;
        if (!game || game.status !== 'finished' || game.settled) return false;
        game.settled = true;
        clearTurnTimer(room);
        if (game.endReason === 'completed') {
            const winner = game.finished[0];
            room.scores[winner] = (room.scores[winner] ?? 0) + 1;
            announce(room, 'game-over', `Game over: ${nameOf(room, game.loser)} is the shithead. ${nameOf(room, winner)} went out first.`);
            recordResult(room);
        } else {
            announce(room, 'game-over', 'Game over: not enough players left to continue.');
        }
        return true;
    };

    const settle = (room) => {
        const ended = finishIfOver(room);
        scheduleTurn(room);
        broadcastRoom(room);
        if (ended) broadcastRoomList(); // the room is joinable again
    };

    // ----- Moves -----

    const actor = (player, auto) => (auto ? `${player.name} ran out of time and` : player.name);

    const burnMessage = (burn) => (burn === 'ten' ? 'burned the pile with a ten' : 'completed four of a kind and burned the pile');

    const play = (room, player, cards, { auto = false } = {}) => {
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.playCards(room.game, player.id, cards);
        if (result.error) return result;
        const labels = cardLabels(result.cards);
        if (result.burn) {
            announce(room, 'burn', `${actor(player, auto)} played ${labels}, ${burnMessage(result.burn)} and plays again.`, { cards: result.cards, auto });
        } else {
            announce(room, 'play', `${actor(player, auto)} played ${labels}.`, { cards: result.cards, auto });
        }
        if (result.finished) announce(room, 'finished', `${player.name} is out of cards!`);
        settle(room);
        return { ok: true };
    };

    const playFaceDown = (room, player, index, { auto = false } = {}) => {
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.playFaceDown(room.game, player.id, index);
        if (result.error) return result;
        const label = cardLabel(result.card);
        if (!result.success) {
            announce(room, 'pick-up', `${actor(player, auto)} flipped ${label}, which does not beat the pile, and picked up ${result.pickedUp} cards.`, { card: result.card, auto });
        } else if (result.burn) {
            announce(room, 'burn', `${actor(player, auto)} flipped ${label}, ${burnMessage(result.burn)} and plays again.`, { card: result.card, auto });
        } else {
            announce(room, 'play', `${actor(player, auto)} flipped ${label}.`, { card: result.card, auto });
        }
        if (result.finished) announce(room, 'finished', `${player.name} is out of cards!`);
        settle(room);
        return { ok: true };
    };

    const pickUp = (room, player, faceUpCard, { auto = false } = {}) => {
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.pickUpPile(room.game, player.id, faceUpCard);
        if (result.error) return result;
        const extra = result.added ? ` (adding ${cardLabel(result.added)} from the table)` : '';
        announce(room, 'pick-up', `${actor(player, auto)} picked up ${result.count} cards${extra}.`, { auto });
        settle(room);
        return { ok: true };
    };

    // ----- Before play: swapping -----

    const swap = (room, player, handCard, faceUpCard) => {
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.swapCards(room.game, player.id, handCard, faceUpCard);
        if (result.error) return result;
        broadcastRoom(room);
        return { ok: true };
    };

    const ready = (room, player) => {
        if (!room.game) return { error: 'The game has not started' };
        const result = logic.setReady(room.game, player.id);
        if (result.error) return result;
        announce(room, 'ready', `${player.name} is ready.`);
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

    const createRoom = (socket, name) => {
        const result = rooms.createRoom(store, socket.id, name);
        if (result.error) return result;
        socket.leave(LOBBY);
        socket.join(result.room.id);
        broadcastRoom(result.room);
        broadcastRoomList();
        return result;
    };

    const joinRoom = (socket, roomId, name) => {
        const result = rooms.joinRoom(store, socket.id, roomId, name);
        if (result.error) return result;
        socket.leave(LOBBY);
        socket.join(result.room.id);
        announce(result.room, 'joined', `${result.player.name} joined.`);
        broadcastRoom(result.room);
        broadcastRoomList();
        return result;
    };

    const startGame = (room, player) => {
        const result = rooms.startGame(store, room, player);
        if (result.error) return result;
        clearTurnTimer(room);
        announce(room, 'dealt', 'Cards dealt. Swap any hand cards with your face-up cards, then press Ready.');
        scheduleTurn(room);
        broadcastRoom(room);
        broadcastRoomList(); // no longer joinable
        return { ok: true };
    };

    const updateSettings = (room, player, patch) => {
        const result = rooms.updateSettings(room, player, patch);
        if (result.error) return result;
        const { turnSeconds, private: isPrivate } = room.settings;
        announce(room, 'settings', `${player.name} set ${describeTimer(turnSeconds)}. The room is ${isPrivate ? 'private' : 'public'}.`);
        broadcastRoom(room);
        broadcastRoomList();
        return { ok: true };
    };

    const chat = (room, player, text) => {
        io.to(room.id).emit('chat-message', {
            playerId: player.id,
            name: player.name,
            color: player.color,
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

    /** Remove whoever holds `socketId`: they left, timed out, or were removed by the host. */
    const removeSeat = (socketId, reason) => {
        cancelRemoval(socketId);
        const change = rooms.removePlayer(store, socketId);
        if (!change) return null;
        const { room, player, deleted, newHost, gameEnded } = change;
        if (deleted) {
            clearTurnTimer(room);
        } else {
            announce(room, 'left', `${player.name} ${reason}.`);
            if (newHost) announce(room, 'host', `${newHost.name} is now the host.`);
            if (gameEnded) finishIfOver(room);
            else if (room.game && room.game.status !== 'finished') scheduleTurn(room);
            broadcastRoom(room);
        }
        broadcastRoomList();
        return change;
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

    /** A socket dropped: keep the seat for a while so the player can come back. */
    const holdSeat = (socketId) => {
        const found = rooms.lookup(store, socketId);
        if (!found) return; // never seated, or the seat has since moved to a newer connection
        const { room, player } = found;
        player.connected = false;
        announce(room, 'disconnected', `${player.name} lost connection. Holding their seat for ${DISCONNECT_GRACE_MS / 1000}s.`);
        broadcastRoom(room);
        const handle = setTimeout(() => removeSeat(socketId, 'was removed after disconnecting'), DISCONNECT_GRACE_MS);
        handle.unref?.();
        store.pendingRemovals.set(socketId, handle);
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
        found.player.connected = true;
        announce(found.room, 'reconnected', `${found.player.name} reconnected.`);
        broadcastRoom(found.room);
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
        if (!wasConnected) announce(room, 'reconnected', `${player.name} reconnected.`);
        broadcastRoom(room);
        return result;
    };

    return {
        enterLobby,
        createRoom,
        joinRoom,
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
        autoMove,
    };
}

export { createGameService, DISCONNECT_GRACE_MS, LOBBY, SWAP_FALLBACK_SECONDS };
