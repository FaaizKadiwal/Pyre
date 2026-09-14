# Multiplayer Card Game

A real-time, browser-based shedding card game for 2 to 5 players. Each player starts with three face-down cards, three face-up cards on top of them, and a hand of three. Match the suit or value of the pile to play; power cards (2, 7, 10) bend the rules. First to shed everything wins, last one holding cards loses.

Built with Express 5, Socket.IO 4 and plain ES-module JavaScript in the browser. No build step.

## Run it

```bash
npm install
npm start            # http://localhost:3000
npm run dev          # restarts on file changes (node --watch)
PORT=8080 npm start  # different port
```

Open the URL in two browser tabs (or send the room code to a friend on the same network), create a room in one, join from the other, and press **Start game** as the host.

## Develop

```bash
npm test             # unit tests for the rules + a Socket.IO end-to-end test
npm run lint         # eslint over server, client and tests
```

Tests use Node's built-in `node:test` runner. Run a single file with `node --test test/gameLogic.test.js`.

## How it is put together

| Path | Role |
| --- | --- |
| `server/gameLogic.js` | Pure rules. Deals, validates plays, applies power cards, advances turns. No I/O. |
| `server/rooms.js` | Room store, player join/leave, input sanitising, and the per-player view of a room. |
| `server/socketHandlers.js` | Socket.IO event handlers. Every request is acknowledged with `{ ok, ... }`. |
| `server/server.js` | Express static hosting, `/health`, Socket.IO setup, graceful shutdown. |
| `public/js/game.js` | Client entry: state, socket events, user actions. |
| `public/js/ui.js` | All DOM rendering. |
| `public/js/cards.js` | Card sorting and card DOM builders. |
| `public/js/socket.js` | Shared socket and a promise-based `request()` helper. |

The server is authoritative. Clients only send intents; the server validates, mutates, and pushes each player a view that contains their own hand but only counts for everyone else's.

## Rules

- Deal: 3 face-down, 3 face-up, 3 in hand. The remaining deck is the draw pile. The discard pile starts empty.
- On your turn play one card from your hand that matches the top of the pile by **suit or value**. Your hand refills to three from the deck.
- **2** can be played on anything and resets the pile, so anything can follow it.
- **7** can be played on anything. The next card must be lower than 7, or another power card.
- **10** can be played on anything and burns the pile. You play again.
- If you hold no playable card you must pick up the pile.
- When your hand and the deck are both empty, play from your face-up cards. When those are gone, flip your face-down cards blind: a legal flip is played, an illegal one means you pick up the pile plus that card.
- A player with no cards left is out. When one player remains, they lose.
- A player who disconnects keeps their seat for 45 seconds and can reconnect without losing their place.
