'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { io: connect } = require('socket.io-client');
const { httpServer, io, store } = require('../server/server');

let url;
const clients = [];

function client() {
    const socket = connect(url, { transports: ['websocket'], forceNew: true });
    clients.push(socket);
    return new Promise((resolve) => socket.on('connect', () => resolve(socket)));
}

function request(socket, event, payload = {}) {
    return new Promise((resolve) => socket.emit(event, payload, resolve));
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 2000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${event}`)), timeoutMs);
        const onEvent = (data) => {
            if (!predicate(data)) return;
            clearTimeout(timer);
            socket.off(event, onEvent);
            resolve(data);
        };
        socket.on(event, onEvent);
    });
}

test.before(async () => {
    await new Promise((resolve) => httpServer.listen(0, resolve));
    url = `http://localhost:${httpServer.address().port}`;
});

test.after(async () => {
    for (const socket of clients) socket.disconnect();
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
});

test('two players can create, join, start and play a full turn', async () => {
    const alice = await client();
    const bob = await client();

    const created = await request(alice, 'create-room', { name: '  Alice  ' });
    assert.equal(created.ok, true);
    assert.match(created.roomId, /^[A-Z2-9]{5}$/);

    assert.equal((await request(bob, 'join-room', { roomId: 'NOPE' })).error, 'Room not found');
    assert.equal((await request(bob, 'start-game')).error, 'You are not in a room');

    const joined = await request(bob, 'join-room', { roomId: created.roomId.toLowerCase(), name: 'Bob' });
    assert.equal(joined.ok, true, 'room codes are case-insensitive');

    assert.equal((await request(bob, 'start-game')).error, 'Only the host can start the game');

    const [aliceState, bobState] = await Promise.all([
        waitFor(alice, 'room-state', (s) => s.status === 'playing'),
        waitFor(bob, 'room-state', (s) => s.status === 'playing'),
        request(alice, 'start-game'),
    ]);

    assert.equal(aliceState.hand.length, 3);
    assert.equal(bobState.hand.length, 3);
    assert.equal(aliceState.players.find((p) => p.id === bob.id).handCount, 3);
    assert.equal(aliceState.players.find((p) => p.id === bob.id).hand, undefined, 'other hands are never sent');
    assert.equal(aliceState.deckCount, 52 - 18);
    assert.equal(aliceState.isMyTurn, true);
    assert.equal(aliceState.legalCards.length, 3, 'anything goes on an empty pile');

    assert.equal((await request(bob, 'play-card', { card: bobState.hand[0] })).error, 'It is not your turn');
    assert.equal((await request(alice, 'play-card', { card: bobState.hand[0] })).error, 'You do not hold that card');

    const card = aliceState.legalCards[0];
    const [afterPlay, event] = await Promise.all([
        waitFor(bob, 'room-state', (s) => s.pile.count === 1),
        waitFor(bob, 'game-event', (e) => e.type === 'play' || e.type === 'burn'),
        request(alice, 'play-card', { card }),
    ]);
    assert.deepEqual(afterPlay.pile.top, card);
    assert.match(event.message, /^Alice (played|burned)/);
    assert.equal(afterPlay.players.find((p) => p.id === alice.id).handCount, 3, 'hand refilled');

    // Chat is sanitised and only delivered inside the room.
    const [chat] = await Promise.all([
        waitFor(alice, 'chat-message'),
        request(bob, 'chat-message', { message: '  hi there  ' }),
    ]);
    assert.equal(chat.message, 'hi there');
    assert.equal(chat.name, 'Bob');

    // Leaving mid-game ends it for the other player.
    const [ended] = await Promise.all([
        waitFor(alice, 'room-state', (s) => s.status === 'finished'),
        request(bob, 'leave-room'),
    ]);
    assert.equal(ended.endReason, 'abandoned');
    assert.equal(ended.players.length, 1);
    assert.equal(ended.players[0].isHost, true);

    // The host can start again from a finished game.
    const carol = await client();
    assert.equal((await request(carol, 'join-room', { roomId: created.roomId, name: 'Carol' })).ok, true);
    const [restarted] = await Promise.all([
        waitFor(carol, 'room-state', (s) => s.status === 'playing'),
        request(alice, 'start-game'),
    ]);
    assert.equal(restarted.players.length, 2);
    assert.equal(restarted.hand.length, 3);

    alice.disconnect();
    bob.disconnect();
    carol.disconnect();
    await new Promise((resolve) => setTimeout(resolve, 50));
    // Seats are held for the grace period rather than dropped immediately.
    assert.equal(store.rooms.get(created.roomId).players.every((p) => !p.connected), true);
    for (const handle of store.pendingRemovals.values()) clearTimeout(handle);
});

test('room list only advertises joinable rooms', async () => {
    const host = await client();
    const listBefore = await request(host, 'list-rooms');
    const { roomId } = await request(host, 'create-room', { name: 'Host' });
    const listAfter = await request(host, 'list-rooms');
    assert.equal(listAfter.rooms.length, listBefore.rooms.length + 1);
    const entry = listAfter.rooms.find((r) => r.id === roomId);
    assert.deepEqual(entry, { id: roomId, playerCount: 1, maxPlayers: 5, status: 'waiting', host: 'Host' });
    assert.equal((await request(host, 'create-room', { name: 'Again' })).error, 'You are already in a room');
    await request(host, 'leave-room');
    assert.equal((await request(host, 'list-rooms')).rooms.some((r) => r.id === roomId), false, 'empty rooms are deleted');
});
