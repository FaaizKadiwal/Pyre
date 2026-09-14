import test from 'node:test';
import assert from 'node:assert/strict';
import { io as connect } from 'socket.io-client';
import { httpServer, io, store } from '../server/server.js';

let url;
let port;
const clients = [];

/** Deterministic PRNG so the full-game test deals the same cards every run. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

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

/** Poll a server-side condition instead of sleeping for a guessed number of milliseconds. */
async function until(condition, timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs;
    while (!condition()) {
        if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
        await new Promise((resolve) => setTimeout(resolve, 10));
    }
}

/** Every client plays its first legal card (or picks up / flips) until the game ends. */
function playToCompletion(sockets, maxMoves = 5000) {
    return new Promise((resolve, reject) => {
        let moves = 0;
        const handlers = new Map();
        const stop = () => { for (const [s, h] of handlers) s.off('room-state', h); };
        const fail = (err) => { stop(); reject(err); };
        for (const s of sockets) {
            const handler = async (view) => {
                if (view.status === 'finished') { stop(); resolve(view); return; }
                if (view.status !== 'playing' || !view.isMyTurn) return;
                if (++moves > maxMoves) { fail(new Error(`Game did not finish within ${maxMoves} moves`)); return; }
                let res;
                if (view.legalCards.length) res = await request(s, 'play-card', { card: view.legalCards[0] });
                else if (view.canPickUp) res = await request(s, 'pick-up-pile');
                else if (view.source === 'faceDown') res = await request(s, 'play-face-down', { index: 0 });
                else { fail(new Error('No move available on my turn')); return; }
                if (!res.ok) fail(new Error(`Move rejected: ${res.error}`));
            };
            handlers.set(s, handler);
            s.on('room-state', handler);
        }
    });
}

test.before(async () => {
    // Bots move far faster than people; lift the per-socket budget for the suite.
    store.rateLimit = { windowMs: 5_000, actions: 100_000, chat: 100_000 };
    await new Promise((resolve) => httpServer.listen(0, resolve));
    port = httpServer.address().port;
    url = `http://localhost:${port}`;
});

test.after(async () => {
    for (const socket of clients) socket.disconnect();
    for (const handle of store.pendingRemovals.values()) clearTimeout(handle);
    for (const room of store.rooms.values()) if (room.turn.handle) clearTimeout(room.turn.handle);
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
});

test('HTTP responses carry security headers and the API rejects unknown routes', async () => {
    const page = await fetch(`${url}/`);
    assert.equal(page.status, 200);
    const csp = page.headers.get('content-security-policy');
    assert.match(csp, /script-src 'self'/);
    assert.ok(csp.includes(`connect-src 'self' ws://localhost:${port} wss://localhost:${port}`), csp);
    assert.ok(!csp.includes('upgrade-insecure-requests'));
    assert.equal(page.headers.get('x-powered-by'), null);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');

    const health = await (await fetch(`${url}/health`)).json();
    assert.equal(health.ok, true);
    assert.equal(health.persistentResults, false);

    const missing = await fetch(`${url}/api/nothing`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { error: 'Not found' });
});

test('two players can create, join, start and play a full turn', async () => {
    const alice = await client();
    const bob = await client();

    const created = await request(alice, 'create-room', { name: '  Alice  ' });
    assert.equal(created.ok, true);
    assert.match(created.roomId, /^[A-Z2-9]{5}$/);
    assert.equal(typeof created.playerId, 'string');
    assert.equal(typeof created.token, 'string');

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

    assert.equal(aliceState.me, created.playerId);
    assert.equal(bobState.me, joined.playerId);
    assert.equal(aliceState.hand.length, 3);
    assert.equal(bobState.hand.length, 3);
    const bobSeenByAlice = aliceState.players.find((p) => p.id === joined.playerId);
    assert.equal(bobSeenByAlice.handCount, 3);
    assert.equal(bobSeenByAlice.cardsLeft, 9);
    assert.equal(bobSeenByAlice.hand, undefined, 'other hands are never sent');
    assert.equal(bobSeenByAlice.token, undefined, 'tokens never leave the server');
    assert.equal(bobSeenByAlice.socketId, undefined, 'socket ids never leave the server');
    assert.notEqual(aliceState.players[0].color, aliceState.players[1].color, 'players get distinct colours');
    assert.equal(aliceState.deckCount, 52 - 18);
    assert.equal(aliceState.isMyTurn, true);
    assert.equal(aliceState.legalCards.length, 3, 'anything goes on an empty pile');
    assert.deepEqual(aliceState.settings, { turnSeconds: 60, private: false });
    const remaining = aliceState.turnEndsAt - aliceState.serverNow;
    assert.ok(remaining > 59_000 && remaining <= 60_000, `turn clock is running: ${remaining}`);

    assert.equal((await request(bob, 'play-card', { card: bobState.hand[0] })).error, 'It is not your turn');
    assert.equal((await request(alice, 'play-card', { card: bobState.hand[0] })).error, 'You do not hold that card');

    const card = aliceState.legalCards[0];
    const [afterPlay, event] = await Promise.all([
        waitFor(bob, 'room-state', (s) => s.pile.count === 1 || s.currentPlayerId === joined.playerId),
        waitFor(bob, 'game-event', (e) => e.type === 'play' || e.type === 'burn'),
        request(alice, 'play-card', { card }),
    ]);
    assert.match(event.message, /^Alice (played|burned)/);
    assert.equal(event.auto, false);
    assert.equal(afterPlay.players.find((p) => p.id === created.playerId).handCount, 3, 'hand refilled');

    // Chat is sanitised and only delivered inside the room.
    const [chat] = await Promise.all([
        waitFor(alice, 'chat-message'),
        request(bob, 'chat-message', { message: '  hi there  ' }),
    ]);
    assert.equal(chat.message, 'hi there');
    assert.equal(chat.name, 'Bob');
    assert.equal(chat.playerId, joined.playerId);
    assert.equal(typeof chat.color, 'number');

    // Leaving mid-game ends it for the other player.
    const [ended] = await Promise.all([
        waitFor(alice, 'room-state', (s) => s.status === 'finished'),
        request(bob, 'leave-room'),
    ]);
    assert.equal(ended.endReason, 'abandoned');
    assert.equal(ended.players.length, 1);
    assert.equal(ended.players[0].isHost, true);
    assert.equal(ended.turnEndsAt, null, 'the turn clock stops with the game');

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
    // Seats are held for the grace period rather than dropped immediately.
    await until(() => store.rooms.get(created.roomId).players.every((p) => !p.connected));
    assert.equal(store.rooms.get(created.roomId).players.length, 2);
    for (const handle of store.pendingRemovals.values()) clearTimeout(handle);
    clearTimeout(store.rooms.get(created.roomId).turn.handle);
});

test('a player can reclaim their seat from a new connection with their session token', async () => {
    const host = await client();
    const guest = await client();
    const created = await request(host, 'create-room', { name: 'Hana' });
    const joined = await request(guest, 'join-room', { roomId: created.roomId, name: 'Gus' });
    await Promise.all([
        waitFor(host, 'room-state', (s) => s.status === 'playing'),
        request(host, 'start-game'),
    ]);

    // The guest's connection dies; everyone sees the seat being held.
    const guestSocketId = guest.id;
    const held = waitFor(host, 'room-state', (s) => s.players.some((p) => p.id === joined.playerId && !p.connected));
    guest.disconnect();
    await held;
    assert.equal(store.pendingRemovals.has(guestSocketId), true);

    // A brand-new socket presents the token and gets the same seat and hand back.
    const again = await client();
    assert.equal((await request(again, 'resume-session', { roomId: created.roomId, token: 'wrong' })).error, 'No seat matches that session');
    assert.equal((await request(again, 'resume-session', { roomId: 'ZZZZZ', token: joined.token })).error, 'That room no longer exists');
    const [restored, resumed] = await Promise.all([
        waitFor(again, 'room-state', (s) => s.status === 'playing'),
        request(again, 'resume-session', { roomId: created.roomId.toLowerCase(), token: joined.token }),
    ]);
    assert.equal(resumed.ok, true);
    assert.equal(resumed.playerId, joined.playerId);
    assert.equal(resumed.token, joined.token);
    assert.equal(restored.me, joined.playerId);
    assert.equal(restored.hand.length, 3);
    assert.equal(restored.players.find((p) => p.id === joined.playerId).connected, true);
    assert.equal(store.pendingRemovals.has(guestSocketId), false, 'the removal timer was cancelled');
    assert.equal((await request(again, 'chat-message', { message: 'back!' })).ok, true, 'the new socket acts as the player');

    // A second tab with the same token takes the seat over; the first is told to leave.
    const unseated = waitFor(again, 'left-room');
    const third = await client();
    assert.equal((await request(third, 'resume-session', { roomId: created.roomId, token: joined.token })).ok, true);
    assert.match((await unseated).reason, /another tab/);
    assert.equal((await request(again, 'leave-room')).error, 'You are not in a room');
    assert.equal((await request(third, 'chat-message', { message: 'still Gus' })).ok, true);

    await request(host, 'leave-room');
    await request(third, 'leave-room');
});

test('the host controls settings, private rooms stay off the list, and the turn timer plays for slow players', async () => {
    const host = await client();
    const guest = await client();
    const created = await request(host, 'create-room', { name: 'Hana' });
    assert.equal((await request(guest, 'update-settings', { turnSeconds: 30 })).error, 'You are not in a room');
    const joined = await request(guest, 'join-room', { roomId: created.roomId, name: 'Gus' });
    assert.equal((await request(guest, 'update-settings', { turnSeconds: 30 })).error, 'Only the host can change settings');
    assert.match((await request(host, 'update-settings', { turnSeconds: 999 })).error, /Turn timer must be/);
    assert.match((await request(host, 'update-settings', { turnSeconds: 'soon' })).error, /Turn timer must be/);
    assert.match((await request(host, 'update-settings', { private: 'yes' })).error, /true or false/);

    const [view] = await Promise.all([
        waitFor(guest, 'room-state', (s) => s.settings.private === true),
        request(host, 'update-settings', { turnSeconds: 1, private: true }),
    ]);
    assert.deepEqual(view.settings, { turnSeconds: 1, private: true });
    assert.equal((await request(guest, 'list-rooms')).rooms.some((r) => r.id === created.roomId), false, 'private rooms are not advertised');
    const walkIn = await client();
    assert.equal((await request(walkIn, 'join-room', { roomId: created.roomId, name: 'Ivy' })).ok, true, 'but the code still works');
    await request(walkIn, 'leave-room');

    // Nobody moves after the start, so after one second the server plays for the host.
    const timedOut = waitFor(host, 'game-event', (e) => e.auto === true, 4000);
    const moved = waitFor(host, 'room-state', (s) => s.pile.count > 0 || s.currentPlayerId === joined.playerId, 4000);
    const [started] = await Promise.all([
        waitFor(host, 'room-state', (s) => s.status === 'playing'),
        request(host, 'start-game'),
    ]);
    assert.ok(started.turnEndsAt - started.serverNow > 500 && started.turnEndsAt - started.serverNow <= 1000);
    assert.equal((await request(host, 'update-settings', { turnSeconds: 0 })).error, 'Settings cannot change during a game');

    assert.match((await timedOut).message, /^Hana ran out of time and (played|burned|picked up|flipped)/);
    const after = await moved;
    assert.ok(after.pile.count > 0 || after.currentPlayerId === joined.playerId);

    await request(host, 'leave-room');
    await request(guest, 'leave-room');
    assert.equal(store.rooms.has(created.roomId), false, 'an empty room is deleted and its timer with it');
});

test('the host can remove a player', async () => {
    const host = await client();
    const guest = await client();
    const created = await request(host, 'create-room', { name: 'Hana' });
    const joined = await request(guest, 'join-room', { roomId: created.roomId, name: 'Gus' });

    assert.equal((await request(guest, 'kick-player', { playerId: created.playerId })).error, 'Only the host can remove players');
    assert.match((await request(host, 'kick-player', { playerId: created.playerId })).error, /Use Leave/);
    assert.match((await request(host, 'kick-player', { playerId: 'nobody' })).error, /not in this room/);

    const [gone, view] = await Promise.all([
        waitFor(guest, 'left-room'),
        waitFor(host, 'room-state', (s) => s.players.length === 1),
        request(host, 'kick-player', { playerId: joined.playerId }),
    ]);
    assert.match(gone.reason, /Hana removed you/);
    assert.equal(view.players[0].id, created.playerId);
    assert.equal((await request(guest, 'leave-room')).error, 'You are not in a room');
    assert.equal((await request(guest, 'resume-session', { roomId: created.roomId, token: joined.token })).error, 'No seat matches that session');
    await request(host, 'leave-room');
});

test('duplicate names in a room are made unique', async () => {
    const first = await client();
    const second = await client();
    const { roomId } = await request(first, 'create-room', { name: 'Sam' });
    const [view] = await Promise.all([
        waitFor(second, 'room-state'),
        request(second, 'join-room', { roomId, name: 'sam' }),
    ]);
    assert.deepEqual(view.players.map((p) => p.name), ['Sam', 'sam 2']);
    await request(first, 'leave-room');
    await request(second, 'leave-room');
});

test('room list only advertises joinable rooms and the room cap is enforced', async () => {
    const host = await client();
    const listBefore = await request(host, 'list-rooms');
    const { roomId } = await request(host, 'create-room', { name: 'Host' });
    const listAfter = await request(host, 'list-rooms');
    assert.equal(listAfter.rooms.length, listBefore.rooms.length + 1);
    const entry = listAfter.rooms.find((r) => r.id === roomId);
    assert.deepEqual(entry, { id: roomId, playerCount: 1, maxPlayers: 5, status: 'waiting', host: 'Host' });
    assert.equal((await request(host, 'create-room', { name: 'Again' })).error, 'You are already in a room');

    const savedMax = store.maxRooms;
    store.maxRooms = store.rooms.size;
    const late = await client();
    assert.match((await request(late, 'create-room', { name: 'Late' })).error, /server is full/);
    store.maxRooms = savedMax;

    await request(host, 'leave-room');
    assert.equal((await request(host, 'list-rooms')).rooms.some((r) => r.id === roomId), false, 'empty rooms are deleted');
});

test('a socket that floods requests is throttled', async () => {
    const saved = store.rateLimit;
    store.rateLimit = { ...saved, actions: 10 };
    const flooder = await client();
    store.rateLimit = saved;

    const results = await Promise.all(Array.from({ length: 15 }, () => request(flooder, 'list-rooms')));
    assert.equal(results.filter((r) => r.ok).length, 10);
    assert.equal(results.filter((r) => r.error === 'Too many requests. Slow down a little.').length, 5);
});

test('a full game runs to completion, is recorded, scored and published to the leaderboard', async () => {
    const ann = await client();
    const ben = await client();
    store.random = mulberry32(2026);
    const { roomId } = await request(ann, 'create-room', { name: 'Ann' });
    assert.equal((await request(ben, 'join-room', { roomId, name: 'Ben' })).ok, true);

    const watcher = await client(); // stays in the lobby, which is where leaderboard updates go
    const gameOver = waitFor(ann, 'game-event', (e) => e.type === 'game-over', 60_000);
    const published = waitFor(watcher, 'leaderboard', (l) => l.rows.some((r) => r.name === 'Ann'), 60_000);
    const finished = playToCompletion([ann, ben]);
    assert.equal((await request(ann, 'start-game')).ok, true);

    const finalView = await finished;
    store.random = Math.random;
    assert.equal(finalView.endReason, 'completed');
    assert.equal(finalView.finished.length, 1);
    const winnerPlayer = finalView.players.find((p) => p.id === finalView.finished[0]);
    const loserPlayer = finalView.players.find((p) => p.id === finalView.loser);
    const winner = winnerPlayer.name;
    const loser = loserPlayer.name;
    assert.notEqual(winner, loser);
    assert.equal(winnerPlayer.wins, 1, 'the room scoreboard counts the win');
    assert.equal(loserPlayer.wins, 0);
    assert.equal((await gameOver).message, `Game over: ${loser} lost. ${winner} finished first.`);

    const board = await published;
    assert.equal(board.persistent, false);
    assert.deepEqual(board.rows.find((r) => r.name === winner), { name: winner, games: 1, wins: 1, losses: 0 });
    assert.deepEqual(board.rows.find((r) => r.name === loser), { name: loser, games: 1, wins: 0, losses: 1 });
    assert.equal(board.recent[0].roomId, roomId);
    assert.deepEqual(board.recent[0].players.map((p) => p.name), [winner, loser]);

    const api = await (await fetch(`${url}/api/leaderboard`)).json();
    assert.deepEqual(api, { persistent: false, rows: board.rows });

    const recent = await (await fetch(`${url}/api/games/recent?limit=5`)).json();
    assert.equal(recent.games[0].roomId, roomId);
    assert.deepEqual(recent.games[0].players, [{ name: winner, place: 1 }, { name: loser, place: 2 }]);
    assert.ok(recent.games[0].durationSeconds >= 0);
});

test('lobby updates reach only sockets that are in the lobby', async () => {
    const seated = await client();
    await request(seated, 'create-room', { name: 'Seated' });
    let seatedUpdates = 0;
    seated.on('room-list', () => { seatedUpdates += 1; });
    seated.on('leaderboard', () => { seatedUpdates += 1; });

    const watcher = await client();
    const host = await client();
    const [list] = await Promise.all([
        waitFor(watcher, 'room-list', (rooms) => rooms.some((r) => r.host === 'Hosty')),
        request(host, 'create-room', { name: 'Hosty' }),
    ]);
    assert.ok(list.some((r) => r.host === 'Hosty'));

    // Messages on one socket arrive in order, so once this ack is back any stray update would be here too.
    await request(seated, 'list-rooms');
    assert.equal(seatedUpdates, 0, 'a seated player is not sent lobby updates');

    // Leaving puts a player back in the lobby with a fresh list and leaderboard.
    const [rooms, board] = await Promise.all([
        waitFor(host, 'room-list'),
        waitFor(host, 'leaderboard'),
        request(host, 'leave-room'),
    ]);
    assert.equal(rooms.some((r) => r.host === 'Hosty'), false);
    assert.ok(Array.isArray(board.rows) && Array.isArray(board.recent));
    await request(seated, 'leave-room');
});

test('a four-player game finishes with a full ranking', async () => {
    const players = await Promise.all([client(), client(), client(), client()]);
    const watcher = await client();
    store.random = mulberry32(7);
    const { roomId } = await request(players[0], 'create-room', { name: 'Pia' });
    for (const [i, name] of ['Quin', 'Rae', 'Sol'].entries()) {
        assert.equal((await request(players[i + 1], 'join-room', { roomId, name })).ok, true);
    }
    const published = waitFor(watcher, 'leaderboard', (l) => l.recent.some((g) => g.roomId === roomId), 60_000);
    const finished = playToCompletion(players);
    assert.equal((await request(players[0], 'start-game')).ok, true);

    const finalView = await finished;
    store.random = Math.random;
    assert.equal(finalView.endReason, 'completed');
    assert.equal(finalView.finished.length, 3);
    assert.equal(new Set([...finalView.finished, finalView.loser]).size, 4, 'everyone is ranked exactly once');
    const winner = finalView.players.find((p) => p.id === finalView.finished[0]);
    assert.equal(winner.wins, 1);

    const game = (await published).recent.find((g) => g.roomId === roomId);
    assert.deepEqual(game.players.map((p) => p.place), [1, 2, 3, 4]);
    assert.equal(game.players[0].name, winner.name);

    const { rows } = await (await fetch(`${url}/api/leaderboard?limit=50`)).json();
    for (const { name } of game.players.slice(1, 3)) {
        assert.deepEqual(rows.find((r) => r.name === name), { name, games: 1, wins: 0, losses: 0 }, 'middle finishers neither win nor lose');
    }
    const loserName = game.players[3].name;
    assert.deepEqual(rows.find((r) => r.name === loserName), { name: loserName, games: 1, wins: 0, losses: 1 });
    for (const p of players) await request(p, 'leave-room');
});
