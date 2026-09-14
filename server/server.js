import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import { Server } from 'socket.io';
import registerHandlers from './socketHandlers.js';
import { createGameService, DISCONNECT_GRACE_MS } from './gameService.js';
import * as rooms from './rooms.js';
import { createResultStore } from './results.js';

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
/** Largest message a client may send; ours are a few hundred bytes at most. */
const MAX_MESSAGE_BYTES = 10_000;
const log = (...args) => console.log(new Date().toISOString(), ...args);

const results = createResultStore(process.env);
const store = rooms.createStore({ results });

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // Hosted platforms terminate TLS in front of the app.
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            // Same origin only, plus our own WebSocket endpoint: older browsers do not treat ws: as 'self'.
            'connect-src': ["'self'", (req) => `ws://${req.headers.host} wss://${req.headers.host}`],
            // Styling is in style.css plus the two Google Fonts faces; the client only sets element.style through the CSSOM.
            'style-src': ["'self'", 'https://fonts.googleapis.com'],
            'font-src': ["'self'", 'https://fonts.gstatic.com', 'data:'],
            // Would break plain-HTTP play on a LAN; hosted deployments are HTTPS end to end anyway.
            'upgrade-insecure-requests': null,
        },
    },
}));
app.use(compression());
app.use(express.static(PUBLIC_DIR));

app.get('/health', (_req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, rooms: store.rooms.size, players: store.players.size, persistentResults: results.persistent });
});

app.get('/api/leaderboard', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ persistent: results.persistent, rows: await results.leaderboard(req.query.limit) });
});

app.get('/api/games/recent', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ games: await results.recentGames(req.query.limit) });
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Express 5 forwards rejected promises here automatically.
app.use((err, _req, res, _next) => {
    log('Request failed:', err.message);
    res.status(500).json({ error: 'Internal server error' });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    maxHttpBufferSize: MAX_MESSAGE_BYTES,
    // Lets a client that drops briefly come back with the same socket id, so
    // the disconnect grace period in gameService can restore their seat.
    connectionStateRecovery: { maxDisconnectionDuration: DISCONNECT_GRACE_MS - 5_000 },
});
const service = createGameService(io, store);
io.on('connection', (socket) => registerHandlers(io, socket, store, service));

let shuttingDown = false;
async function shutdown(signal) {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${signal} received, shutting down`);
    setTimeout(() => process.exit(1), 5_000).unref();
    io.close();
    await new Promise((resolve) => httpServer.close(resolve));
    await results.close().catch(() => {});
    process.exit(0);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isMain) {
    results.ready.catch((err) => log('Result storage unavailable, games will not be recorded:', err.message));
    httpServer.listen(PORT, () => {
        log(`Card game server listening on http://localhost:${PORT}`);
        log(results.persistent
            ? 'Game results are stored in Postgres'
            : 'Game results are kept in memory (set DATABASE_URL to persist them)');
    });
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    // A stray rejected promise should be logged, not take every room down with it.
    process.on('unhandledRejection', (reason) => log('Unhandled rejection:', reason instanceof Error ? reason.stack : reason));
    process.on('uncaughtException', (err) => {
        log('Uncaught exception, exiting:', err.stack);
        process.exit(1);
    });
}

export { app, httpServer, io, store, service, results };
