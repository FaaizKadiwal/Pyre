'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { newDb } = require('pg-mem');
const { createMemoryResultStore, createPostgresResultStore } = require('../server/results');

const game = (roomId, names, playedAt) => ({
    roomId,
    playedAt,
    durationSeconds: 90,
    players: names.map((name, i) => ({ name, place: i + 1 })),
});

// Both implementations must behave identically. The Postgres one runs
// against pg-mem, an in-memory Postgres emulator, so no database is needed.
const implementations = {
    memory: () => createMemoryResultStore(),
    'postgres (pg-mem)': () => {
        const { Pool } = newDb().adapters.createPg();
        return createPostgresResultStore({ pool: new Pool() });
    },
};

for (const [label, make] of Object.entries(implementations)) {
    test(`${label}: a fresh store is empty`, async () => {
        const store = make();
        await store.ready;
        assert.deepEqual(await store.leaderboard(), []);
        assert.deepEqual(await store.recentGames(), []);
        await store.close();
    });

    test(`${label}: leaderboard ranks by wins, then fewest losses, then fewest games`, async () => {
        const store = make();
        await store.recordGame(game('AAAAA', ['Ann', 'Ben'], '2026-01-01T10:00:00.000Z'));
        await store.recordGame(game('BBBBB', ['Ben', 'Ann'], '2026-01-01T11:00:00.000Z'));
        await store.recordGame(game('CCCCC', ['Cat', 'Ann', 'Ben'], '2026-01-01T12:00:00.000Z'));
        await store.recordGame(game('DDDDD', ['Ann', 'Cat'], '2026-01-01T13:00:00.000Z'));

        assert.deepEqual(await store.leaderboard(), [
            { name: 'Ann', games: 4, wins: 2, losses: 1 },
            { name: 'Cat', games: 2, wins: 1, losses: 1 },
            { name: 'Ben', games: 3, wins: 1, losses: 2 },
        ]);
        assert.equal((await store.leaderboard(1)).length, 1);
        assert.equal((await store.leaderboard('nonsense')).length, 3, 'bad limits fall back to the default');
        assert.equal((await store.leaderboard(10_000)).length, 3, 'huge limits are clamped, not rejected');
        await store.close();
    });

    test(`${label}: recent games come newest first and honour the limit`, async () => {
        const store = make();
        await store.recordGame(game('AAAAA', ['Ann', 'Ben'], '2026-01-01T10:00:00.000Z'));
        await store.recordGame(game('BBBBB', ['Cat', 'Ann'], '2026-01-01T11:00:00.000Z'));

        const recent = await store.recentGames();
        assert.equal(recent.length, 2);
        assert.deepEqual(recent[0], {
            roomId: 'BBBBB',
            playedAt: '2026-01-01T11:00:00.000Z',
            durationSeconds: 90,
            players: [{ name: 'Cat', place: 1 }, { name: 'Ann', place: 2 }],
        });
        assert.equal(recent[1].roomId, 'AAAAA');
        assert.equal((await store.recentGames(1)).length, 1);
        await store.close();
    });
}
