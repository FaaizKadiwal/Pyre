# 🔥 Pyre

Pyre is a real-time **Shithead card game** for 2 to 5 players, built with **Node.js, Express and Socket.IO**.  
Create a room, send the invite link or fill the seats with bots, and play from any phone or laptop. No accounts, no installs, no build step.

---

## ✨ Features

- 🎮 **Real-time rooms** – Invite links, a public room list, private rooms, in-room chat and emoji reactions that float over the sender's seat.
- 🃏 **Standard Shithead rules** – Beat the pile with equal or higher cards, play sets, swap cards before play, burn with a ten or four of a kind. Rules follow [pagat.com](https://www.pagat.com/beating/shithead.html).
- 🤖 **Tactical bots** – Fill empty seats or play alone. Bots swap sensibly, finish four of a kind, keep their magic cards for when it matters, and react to what happens to them.
- 👀 **Spectators** – Join a room mid-round to watch; you are dealt in at the next deal.
- ⏱️ **Turn timer** – The host picks 30 seconds to 2 minutes, or off. The game plays for anyone who runs out of time, in the swap phase too.
- 🔄 **Reconnection** – Reload the page or lose signal and your seat and cards are still waiting for you.
- 👑 **Host tools** – Deal, restart, change settings between rounds, start play early, remove a player or a bot.
- 🏆 **Scoreboards** – Wins and shithead counts per room, a global leaderboard, a recent-games feed, and a round summary with burns, biggest pick-up and length.
- 🎨 **Three themes** – Ember, Midnight and Felt, remembered per device, with card animations for deals, plays and burns, confetti, and synthesised sound cues.
- ⌨️ **Keyboard play** – Digits pick cards, Enter plays or readies, P picks up, Esc clears.
- 📱 **Responsive** – From 320px phones to large monitors, installable to a home screen.

---

## 🧰 Tech Stack

- **Runtime:** Node.js 18+ (22 recommended), ES modules throughout
- **Server:** Express 5, Socket.IO 4
- **Database:** PostgreSQL (optional, keeps the leaderboard across restarts) – works with the free tiers of Neon or Supabase
- **Frontend:** Vanilla JavaScript (ES modules), HTML, CSS custom properties, Web Audio, Google Fonts (Fraunces, Manrope)
- **Testing:** Node's built-in test runner (rules, bots, storage, and full games over real sockets), ESLint

---

## 📁 Project Structure

- **server/** – Game rules (`gameLogic.js`), bot tactics (`bots.js`), room and seat bookkeeping (`rooms.js`), game flow, timers and bots (`gameService.js`), Socket.IO handlers, results storage and the Express app
- **public/** – The browser client: `index.html`, `css/style.css` with the three themes, ES modules for state, rendering, cards and sound, the icon and web manifest
- **test/** – Unit tests for rules, bots and storage, plus end-to-end tests over real sockets

---

## 💡 Getting Started

1. Clone the repository
2. Install dependencies with `npm install`
3. Run the project with `npm start`
4. Open `http://localhost:3000`, create a room, and either add bots or open a second tab and join with the code

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
