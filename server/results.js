import pg from 'pg';

/**
 * Persisted game results: who played, who finished first, who lost.
 *
 * Live game state never touches storage; it lives in memory (see rooms.js).
 * Results feed the leaderboard and the /api endpoints. Two implementations
 * share one interface:
 *   - memory:   zero configuration, bounded, lost on restart
 *   - postgres: set DATABASE_URL; tables are created on first use
 *
 * A result:
 *   { roomId, playedAt (ISO string), durationSeconds, players: [{ name, place }] }
 * Place 1 finished first; the highest place is the loser.
 */

const LEADERBOARD_LIMIT = 10;
const RECENT_LIMIT = 20;
const MAX_LIMIT = 100;
const MEMORY_LIMIT = 1000;

function clampLimit(limit, fallback) {
    const n = Number(limit);
    return Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : fallback;
}

/** Most wins first, then fewest losses, then fewest games, then name. */
function rank(rows) {
    return rows.sort((a, b) =>
        b.wins - a.wins || a.losses - b.losses || a.games - b.games || a.name.localeCompare(b.name));
}

function createMemoryResultStore() {
    const games = [];
    return {
        persistent: false,
        ready: Promise.resolve(),

        async recordGame(result) {
            games.unshift(result);
            if (games.length > MEMORY_LIMIT) games.length = MEMORY_LIMIT;
        },

        async leaderboard(limit) {
            const stats = new Map();
            for (const game of games) {
                const last = game.players.length;
                for (const { name, place } of game.players) {
                    const row = stats.get(name) ?? { name, games: 0, wins: 0, losses: 0 };
                    row.games += 1;
                    if (place === 1) row.wins += 1;
                    if (place === last) row.losses += 1;
                    stats.set(name, row);
                }
            }
            return rank([...stats.values()]).slice(0, clampLimit(limit, LEADERBOARD_LIMIT));
        },

        async recentGames(limit) {
            return games.slice(0, clampLimit(limit, RECENT_LIMIT));
        },

        async close() {},
    };
}

const SCHEMA = [
    `CREATE TABLE IF NOT EXISTS games (
        id SERIAL PRIMARY KEY,
        room_code TEXT NOT NULL,
        played_at TIMESTAMPTZ NOT NULL,
        duration_seconds INTEGER NOT NULL,
        player_count INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS game_players (
        game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        place INTEGER NOT NULL,
        PRIMARY KEY (game_id, name)
    )`,
    'CREATE INDEX IF NOT EXISTS game_players_name_idx ON game_players (name)',
    'CREATE INDEX IF NOT EXISTS games_played_at_idx ON games (played_at)',
];

/**
 * Postgres-backed store. Pass `connectionString` (any Postgres, including
 * Neon/Supabase with `?sslmode=require`) or an existing `pool` for tests.
 */
function createPostgresResultStore({ connectionString, pool } = {}) {
    const db = pool ?? new pg.Pool({ connectionString, max: 5 });
    const ready = (async () => {
        for (const statement of SCHEMA) await db.query(statement);
    })();

    return {
        persistent: true,
        ready,

        async recordGame(result) {
            await ready;
            const client = await db.connect();
            try {
                await client.query('BEGIN');
                const { rows } = await client.query(
                    `INSERT INTO games (room_code, played_at, duration_seconds, player_count)
                     VALUES ($1, $2, $3, $4) RETURNING id`,
                    [result.roomId, new Date(result.playedAt), result.durationSeconds, result.players.length],
                );
                for (const player of result.players) {
                    await client.query(
                        'INSERT INTO game_players (game_id, name, place) VALUES ($1, $2, $3)',
                        [rows[0].id, player.name, player.place],
                    );
                }
                await client.query('COMMIT');
            } catch (err) {
                await client.query('ROLLBACK');
                throw err;
            } finally {
                client.release();
            }
        },

        async leaderboard(limit) {
            await ready;
            const { rows } = await db.query(
                `SELECT gp.name,
                        COUNT(*)::int AS games,
                        SUM(CASE WHEN gp.place = 1 THEN 1 ELSE 0 END)::int AS wins,
                        SUM(CASE WHEN gp.place = g.player_count THEN 1 ELSE 0 END)::int AS losses
                 FROM game_players gp
                 JOIN games g ON g.id = gp.game_id
                 GROUP BY gp.name
                 ORDER BY wins DESC, losses ASC, games ASC, gp.name ASC
                 LIMIT $1`,
                [clampLimit(limit, LEADERBOARD_LIMIT)],
            );
            return rows.map(({ name, games, wins, losses }) => ({ name, games, wins, losses }));
        },

        async recentGames(limit) {
            await ready;
            const { rows: games } = await db.query(
                `SELECT id, room_code, played_at, duration_seconds
                 FROM games ORDER BY played_at DESC, id DESC LIMIT $1`,
                [clampLimit(limit, RECENT_LIMIT)],
            );
            if (games.length === 0) return [];
            const placeholders = games.map((_, i) => `$${i + 1}`).join(', ');
            const { rows: players } = await db.query(
                `SELECT game_id, name, place FROM game_players
                 WHERE game_id IN (${placeholders}) ORDER BY place ASC`,
                games.map((g) => g.id),
            );
            return games.map((g) => ({
                roomId: g.room_code,
                playedAt: new Date(g.played_at).toISOString(),
                durationSeconds: g.duration_seconds,
                players: players
                    .filter((p) => p.game_id === g.id)
                    .map(({ name, place }) => ({ name, place })),
            }));
        },

        async close() {
            if (typeof db.end === 'function') await db.end();
        },
    };
}

/** Pick an implementation from the environment. */
function createResultStore(env = process.env) {
    return env.DATABASE_URL
        ? createPostgresResultStore({ connectionString: env.DATABASE_URL })
        : createMemoryResultStore();
}

export { createMemoryResultStore, createPostgresResultStore, createResultStore };
