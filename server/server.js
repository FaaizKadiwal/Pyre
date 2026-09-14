'use strict';

const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { Server } = require('socket.io');
const registerHandlers = require('./socketHandlers');
const rooms = require('./rooms');

const PORT = Number(process.env.PORT) || 3000;
const store = rooms.createStore();

const app = express();
app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('/health', (_req, res) => {
    res.json({ ok: true, rooms: store.rooms.size, players: store.players.size });
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
    // Lets a client that drops briefly come back with the same socket id, so
    // the disconnect grace period in socketHandlers can restore their seat.
    connectionStateRecovery: { maxDisconnectionDuration: registerHandlers.DISCONNECT_GRACE_MS - 5_000 },
});

io.on('connection', (socket) => registerHandlers(io, socket, store));

function shutdown(signal) {
    console.log(`${signal} received, shutting down`);
    io.close();
    httpServer.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5_000).unref();
}

if (require.main === module) {
    httpServer.listen(PORT, () => {
        console.log(`Card game server listening on http://localhost:${PORT}`);
    });
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
}

module.exports = { app, httpServer, io, store };
