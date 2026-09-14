'use strict';

const logic = require('./gameLogic');
const rooms = require('./rooms');

/** How long a disconnected player keeps their seat before being removed. */
const DISCONNECT_GRACE_MS = 45_000;

function cardLabel(card) {
    const symbols = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
    return `${card.value}${symbols[card.suit]}`;
}

/**
 * Wraps a handler so every client request gets a `{ ok, ... }` acknowledgement,
 * even if the client forgot to pass a callback or the handler throws.
 */
function withAck(handler) {
    return (payload, ack) => {
        // Clients may emit without a payload, in which case the callback arrives first.
        if (typeof payload === 'function') [payload, ack] = [{}, payload];
        const reply = typeof ack === 'function' ? ack : () => {};
        try {
            reply(handler(payload && typeof payload === 'object' ? payload : {}) ?? { ok: true });
        } catch (err) {
            console.error('Handler failed:', err);
            reply({ ok: false, error: 'Something went wrong on the server' });
        }
    };
}

module.exports = function registerHandlers(io, socket, store) {
    const broadcastRoomList = () => io.emit('room-list', rooms.listRooms(store));

    const broadcastRoom = (room) => {
        for (const player of room.players) {
            io.to(player.id).emit('room-state', rooms.buildView(room, player.id));
        }
    };

    const announce = (room, type, message, extra = {}) => {
        io.to(room.id).emit('game-event', { type, message, at: Date.now(), ...extra });
    };

    const announceGameOver = (room) => {
        const game = room.game;
        const nameOf = (id) => rooms.playerIn(room, id)?.name ?? 'A player';
        if (game.endReason === 'completed') {
            announce(room, 'game-over', `Game over: ${nameOf(game.loser)} lost. ${nameOf(game.finished[0])} finished first.`);
        } else {
            announce(room, 'game-over', 'Game over: not enough players left to continue.');
        }
    };

    /** Runs a game move and, on success, tells everyone what happened. */
    const applyMove = (mover) => {
        const room = rooms.roomFor(store, socket.id);
        if (!room || !room.game) return { ok: false, error: 'You are not in a game' };
        const player = rooms.playerIn(room, socket.id);
        const result = mover(room.game, player);
        if (result.error) return { ok: false, error: result.error };

        if (room.game.status === 'finished') announceGameOver(room);
        broadcastRoom(room);
        broadcastRoomList();
        return { ok: true };
    };

    const finaliseRemoval = (socketId, reason) => {
        store.pendingRemovals.delete(socketId);
        const change = rooms.removePlayer(store, socketId);
        if (!change) return;
        const { room, player, deleted, newHost, gameEnded } = change;
        if (!deleted) {
            announce(room, 'left', `${player?.name ?? 'A player'} ${reason}.`);
            if (newHost) announce(room, 'host', `${newHost.name} is now the host.`);
            if (gameEnded) announceGameOver(room);
            broadcastRoom(room);
        }
        broadcastRoomList();
    };

    // A socket that came back within the recovery window keeps its id and seat.
    if (socket.recovered) {
        const room = rooms.roomFor(store, socket.id);
        const pending = store.pendingRemovals.get(socket.id);
        if (pending) {
            clearTimeout(pending);
            store.pendingRemovals.delete(socket.id);
        }
        if (room) {
            const player = rooms.playerIn(room, socket.id);
            player.connected = true;
            announce(room, 'reconnected', `${player.name} reconnected.`);
            broadcastRoom(room);
        } else {
            socket.emit('left-room', { reason: 'Your seat expired while you were disconnected' });
        }
    }

    socket.emit('room-list', rooms.listRooms(store));

    socket.on('list-rooms', withAck(() => ({ ok: true, rooms: rooms.listRooms(store) })));

    socket.on('create-room', withAck(({ name }) => {
        if (rooms.roomFor(store, socket.id)) return { ok: false, error: 'You are already in a room' };
        const room = rooms.createRoom(store, socket.id, rooms.cleanName(name));
        socket.join(room.id);
        broadcastRoom(room);
        broadcastRoomList();
        return { ok: true, roomId: room.id };
    }));

    socket.on('join-room', withAck(({ roomId, name }) => {
        if (rooms.roomFor(store, socket.id)) return { ok: false, error: 'You are already in a room' };
        const result = rooms.joinRoom(store, socket.id, rooms.normaliseRoomId(roomId), rooms.cleanName(name));
        if (result.error) return { ok: false, error: result.error };
        const { room } = result;
        socket.join(room.id);
        announce(room, 'joined', `${rooms.playerIn(room, socket.id).name} joined.`);
        broadcastRoom(room);
        broadcastRoomList();
        return { ok: true, roomId: room.id };
    }));

    socket.on('leave-room', withAck(() => {
        const room = rooms.roomFor(store, socket.id);
        if (!room) return { ok: false, error: 'You are not in a room' };
        socket.leave(room.id);
        finaliseRemoval(socket.id, 'left the room');
        return { ok: true };
    }));

    socket.on('start-game', withAck(() => {
        const room = rooms.roomFor(store, socket.id);
        if (!room) return { ok: false, error: 'You are not in a room' };
        const result = rooms.startGame(room, socket.id);
        if (result.error) return { ok: false, error: result.error };
        const first = rooms.playerIn(room, logic.currentPlayerId(room.game));
        announce(room, 'started', `Game started. ${first.name} goes first.`);
        broadcastRoom(room);
        broadcastRoomList();
        return { ok: true };
    }));

    socket.on('play-card', withAck(({ card }) => applyMove((game, player) => {
        const result = logic.playCard(game, socket.id, card);
        if (result.error) return result;
        const room = rooms.roomFor(store, socket.id);
        const label = cardLabel(result.card);
        if (result.burned) {
            announce(room, 'burn', `${player.name} burned the pile with a ${label} and plays again.`, { card: result.card });
        } else {
            announce(room, 'play', `${player.name} played ${label}.`, { card: result.card });
        }
        if (result.finished) announce(room, 'finished', `${player.name} is out of cards!`);
        return result;
    })));

    socket.on('play-face-down', withAck(({ index }) => applyMove((game, player) => {
        const result = logic.playFaceDown(game, socket.id, index);
        if (result.error) return result;
        const room = rooms.roomFor(store, socket.id);
        const label = cardLabel(result.card);
        if (!result.success) {
            announce(room, 'pick-up', `${player.name} flipped ${label}, which cannot be played, and picked up ${result.pickedUp} cards.`, { card: result.card });
        } else if (result.burned) {
            announce(room, 'burn', `${player.name} flipped a ${label}, burned the pile and plays again.`, { card: result.card });
        } else {
            announce(room, 'play', `${player.name} flipped ${label}.`, { card: result.card });
        }
        if (result.finished) announce(room, 'finished', `${player.name} is out of cards!`);
        return result;
    })));

    socket.on('pick-up-pile', withAck(() => applyMove((game, player) => {
        const result = logic.pickUpPile(game, socket.id);
        if (result.error) return result;
        announce(rooms.roomFor(store, socket.id), 'pick-up', `${player.name} picked up ${result.count} cards.`);
        return result;
    })));

    socket.on('chat-message', withAck(({ message }) => {
        const room = rooms.roomFor(store, socket.id);
        if (!room) return { ok: false, error: 'You are not in a room' };
        const text = rooms.cleanMessage(message);
        if (!text) return { ok: false, error: 'Message is empty' };
        const player = rooms.playerIn(room, socket.id);
        io.to(room.id).emit('chat-message', { playerId: player.id, name: player.name, message: text, at: Date.now() });
        return { ok: true };
    }));

    socket.on('disconnect', () => {
        const room = rooms.roomFor(store, socket.id);
        if (!room) return;
        const player = rooms.playerIn(room, socket.id);
        player.connected = false;
        announce(room, 'disconnected', `${player.name} lost connection. Holding their seat for ${DISCONNECT_GRACE_MS / 1000}s.`);
        broadcastRoom(room);
        const handle = setTimeout(() => finaliseRemoval(socket.id, 'was removed after disconnecting'), DISCONNECT_GRACE_MS);
        handle.unref?.();
        store.pendingRemovals.set(socket.id, handle);
    });
};

module.exports.DISCONNECT_GRACE_MS = DISCONNECT_GRACE_MS;
