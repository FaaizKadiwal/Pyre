# 🔥 Pyre

Pyre is a real-time **Shithead card game** for 2 to 5 players, built with **Node.js, Express and Socket.IO**.  
Pick a mode and an avatar, create a room, send the invite link or play against bots, all from any phone or laptop. No accounts, no installs, no build step.

---

## ✨ Features

- 🎯 **Four modes** – Classic, Party, Blitz and Inferno set the clock and the house rules with one click, on the main page or in the room. The host can still fine-tune every rule, and the table's mode badge shows what is being played.
- 🎮 **Real-time rooms** – Invite links, a public room list with mode tags, private rooms, in-room chat, and table talk: emoji and quick phrases that float over the sender's seat.
- 🃏 **Standard Shithead rules** – Beat the pile with equal or higher cards, play sets, swap cards before play, burn with a ten or four of a kind. Rules follow [pagat.com](https://www.pagat.com/beating/shithead.html).
- 🏠 **House rules** – 3 skips, 7 forces low, see-through 8, 9 reverses, wild jokers, low tens. Switch them on one by one or through a mode.
- 🤖 **Bots with two levels** – One click seats three bots and deals, and every open seat at the table can be filled with a bot by clicking it. Bots swap sensibly, finish four of a kind, keep their magic cards for when it matters, react to what happens to them, and hold the seat of anyone who drops out until they are back.
- 👀 **Spectators** – Join a room mid-round to watch; you are dealt in at the next deal.
- ⏱️ **Turn timer** – From 15 seconds to 2 minutes, or off. The game plays for anyone who runs out of time, in the swap phase too, and after two missed turns the table takes over until that player acts again.
- 🔄 **Reconnection** – Reload the page or lose signal and your seat and cards are still waiting for you.
- 👑 **Host tools** – Deal, restart, change settings between rounds, start play early, remove a player or a bot.
- 🏆 **Scoreboards** – Wins and shithead counts per room, a global leaderboard, a recent-games feed, a round summary with burns, biggest pick-up and length, the session's round history, and a personal record kept on your device.
- 🎨 **Card-table look** – Twelve avatars, a steadily burning flame mark, three themes (Ember, Midnight and Felt) and a sound switch on the main page and at the table, suit marks drifting behind the table, a clock ring around whoever is on turn, a turn-order rail, a live ticker of table events, a deck that thins as it is dealt, a pile that fans out its last cards, cards that land from the seat that played them and fly to whoever picks up, blind-flip reveals, confetti and synthesised sound cues. All of it respects reduced-motion settings.
- ⌨️ **Keyboard play** – Digits pick cards, Enter plays or readies, P picks up, Esc clears.
- 📱 **Responsive** – From 320px phones to large monitors, installable to a home screen.

---

## 🧰 Tech Stack

- **Runtime:** Node.js 18+ (22 recommended), ES modules throughout
- **Server:** Express 5, Socket.IO 4
- **Database:** PostgreSQL (optional, keeps the leaderboard across restarts) – works with the free tiers of Neon or Supabase
- **Frontend:** Vanilla JavaScript (ES modules), HTML, CSS custom properties, inline SVG, Web Animations API, Web Audio, Google Fonts (Fraunces, Manrope)
- **Testing:** Node's built-in test runner (rules, bots, storage, and full games over real sockets), ESLint

---

## 📁 Project Structure

- **server/** – Game and house rules (`gameLogic.js`), bot tactics (`bots.js`), rooms, modes, seats and avatars (`rooms.js`), game flow, timers, seat-holding and bots (`gameService.js`), Socket.IO handlers, results storage and the Express app
- **public/** – The browser client: `index.html`, `css/style.css` with the three themes, `css/effects.css` for the flame, ambient marks, avatars, chips and toasts, ES modules for state, rendering, cards, avatars, sound and the personal record, the icon and web manifest
- **test/** – Unit tests for rules, bots and storage, plus end-to-end tests over real sockets

---

## 💡 Getting Started

1. Clone the repository
2. Install dependencies with `npm install`
3. Run the project with `npm start`
4. Open `http://localhost:3000`, pick a mode, and either press **Play vs bots** or create a room and join it from a second tab with the code

To play with friends on the same Wi-Fi, share `http://<your-ip>:3000`.

Useful commands: `npm run dev` (restart on changes), `npm test`, `npm run lint`.

### Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (default `3000`) |
| `DATABASE_URL` | Optional PostgreSQL connection string. When set, results and the leaderboard survive restarts. |

---

## 🎲 How to Play

- Everyone gets 3 face-down cards, 3 face-up cards on top of them and 3 cards in hand. Before play you may swap any hand cards with your face-up cards, then press **Ready**.
- The player who was dealt the lowest face-up card starts. On your turn play a card, or several cards of the same rank, **equal to or higher** than the top of the pile. Suits do not matter: 3 is lowest, ace is highest. Your hand refills to 3 while the deck lasts.
- **2** can be played on anything, and anything can be played on a 2. **10** can be played on anything and burns the pile; you play again. **Four of a kind** on top of the pile burns it too.
- Cannot or do not want to play? Pick up the whole pile; the next player starts a new one.
- Once your hand and the deck are empty, play your face-up cards. If you must pick up then, one face-up card goes with the pile. After that, flip your face-down cards blind; an unplayable flip means you pick up the pile.
- Whoever gets rid of everything first is safe. The last player left holding cards is the shithead.

### Modes

| Mode | Clock | Rules |
| --- | --- | --- |
| **Classic** | 60 s | The pagat rules and nothing else |
| **Party** | 60 s | 3 skips, 7 forces low, see-through 8, 9 reverses, two jokers |
| **Blitz** | 15 s | Classic rules at speed |
| **Inferno** | 20 s | Every house rule, tens low included |

A table that the host tunes by hand shows as **Custom**.

### House rules

- **3 skips** – The next player misses a turn.
- **7 forces low** – The next player must play a 7 or lower, or a magic card.
- **8 see-through** – An 8 goes on anything; the next card must beat whatever is under it.
- **9 reverses** – The direction of play turns around.
- **Jokers** – Two jokers join the deck. They go on anything and reverse the direction.
- **Tens low** – A 10 cannot be played on a jack or higher.

---

## 🚀 Deployment

The game needs a host that keeps a Node process and its WebSockets running, so serverless platforms such as Vercel will not work.

1. Push the repository to GitHub.
2. On [Render](https://render.com) choose **New → Blueprint** and select the repository. `render.yaml` sets up a free web service.
3. Optionally create a free PostgreSQL database on [Neon](https://neon.tech) and add its connection string as `DATABASE_URL` in the Render dashboard.

The free instance sleeps after 15 minutes without visitors and takes about a minute to wake up.

---

## 📌 Note

This project was built as a part of learning **real-time web development** with Node.js and Socket.IO.

---

## 📬 Contact

For queries, please reach out to:  
📧 [faaiz12rahim@gmail.com](mailto:faaiz12rahim@gmail.com)  
🔗 [LinkedIn: faaiz-kadiwal](https://www.linkedin.com/in/faaiz-kadiwal-a872942b9/)

---
