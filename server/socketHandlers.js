import * as rooms from './rooms.js';

/** Sliding-window limiter: at most `max` calls per `windowMs`. */
function createLimiter(max, windowMs) {
    const hits = [];
    return () => {
        const now = Date.now();
        while (hits.length && now - hits[0] > windowMs) hits.shift();
        if (hits.length >= max) return false;
        hits.push(now);
        return true;
    };
}

/**
 * Wraps a handler so every client request gets a `{ ok, ... }` acknowledgement,
 * even if the client forgot the callback, the handler throws, or it is async.
 */
function withAck(handler, allow) {
    return (payload, ack) => {
        // Clients may emit without a payload, in which case the callback arrives first.
        if (typeof payload === 'function') [payload, ack] = [{}, payload];
        const reply = typeof ack === 'function' ? ack : () => {};
        if (!allow()) {
            reply({ ok: false, error: 'Too many requests. Slow down a little.' });
            return;
        }
        const data = payload && typeof payload === 'object' ? payload : {};
        Promise.resolve()
            .then(() => handler(data))
            .then((result) => reply(result ?? { ok: true }))
            .catch((err) => {
                console.error('Handler failed:', err);
                reply({ ok: false, error: 'Something went wrong on the server' });
            });
    };
}

/**
 * Transport layer: parse each socket request, rate-limit it, hand it to the
 * game service, and acknowledge. No game rules or room bookkeeping live here.
 */
export default function registerHandlers(io, socket, store, service) {
    const { windowMs, actions, chat } = store.rateLimit;
    const allowAction = createLimiter(actions, windowMs);
    const allowChat = createLimiter(chat, windowMs);
    const on = (event, handler, allow = allowAction) => socket.on(event, withAck(handler, allow));

    const ok = (extra = {}) => ({ ok: true, ...extra });
    const fail = (error) => ({ ok: false, error });
    const seat = () => rooms.lookup(store, socket.id);
    const session = ({ room, player }) => ok({ roomId: room.id, playerId: player.id, token: player.token });

    /** Run `fn(room, player)` for a seated socket and turn its result into an ack. */
    const seated = (fn) => {
        const found = seat();
        if (!found) return fail('You are not in a room');
        const result = fn(found.room, found.player);
        return result.error ? fail(result.error) : ok();
    };

    if (socket.recovered) service.recoverSeat(socket);
    else service.enterLobby(socket);

    on('list-rooms', () => ok({ rooms: rooms.listRooms(store) }));

    on('create-room', ({ name }) => {
        if (seat()) return fail('You are already in a room');
        const result = service.createRoom(socket, rooms.cleanName(name));
        return result.error ? fail(result.error) : session(result);
    });

    on('join-room', ({ roomId, name }) => {
        if (seat()) return fail('You are already in a room');
        const result = service.joinRoom(socket, rooms.normaliseRoomId(roomId), rooms.cleanName(name));
        return result.error ? fail(result.error) : session(result);
    });

    on('resume-session', ({ roomId, token }) => {
        if (seat()) return fail('You are already in a room');
        const result = service.reclaimSeat(socket, rooms.normaliseRoomId(roomId), token);
        return result.error ? fail(result.error) : session(result);
    });

    on('leave-room', () => {
        const result = service.leave(socket);
        return result.error ? fail(result.error) : ok();
    });

    on('start-game', () => seated((room, player) => service.startGame(room, player)));

    on('update-settings', ({ turnSeconds, private: isPrivate }) =>
        seated((room, player) => service.updateSettings(room, player, { turnSeconds, private: isPrivate })));

    on('kick-player', ({ playerId }) => seated((room, player) => service.kick(room, player, playerId)));

    on('play-card', ({ card }) => seated((room, player) => service.play(room, player, card)));

    on('play-face-down', ({ index }) => seated((room, player) => service.playFaceDown(room, player, index)));

    on('pick-up-pile', () => seated((room, player) => service.pickUp(room, player)));

    on('chat-message', ({ message }) => seated((room, player) => {
        const text = rooms.cleanMessage(message);
        if (!text) return { error: 'Message is empty' };
        service.chat(room, player, text);
        return { ok: true };
    }), allowChat);

    socket.on('disconnect', () => service.holdSeat(socket.id));
}

export { createLimiter };
