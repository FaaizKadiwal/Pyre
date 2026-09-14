# 🃏 Card Game

Card Game is a real-time **multiplayer card game** for 2 to 5 players, built with **Node.js, Express and Socket.IO**.  
Create a room, share the invite link, and play with friends from any phone or laptop. No accounts, no installs, no build step.

---

## ✨ Features

- 🎮 **Real-time multiplayer** – Rooms with invite links, a public room list, private rooms and in-room chat.
- 🃏 **Classic Shithead rules** – Beat the pile with equal or higher cards, play sets, swap before the deal is locked in, burn with a 10 or four of a kind.
- ⏱️ **Turn timer** – The host picks 30 seconds to 2 minutes; the game plays for anyone who runs out of time.
- 🔄 **Reconnection** – Reload the page or lose signal and your seat and cards are still waiting for you.
- 👑 **Host tools** – Start and restart games, change settings between rounds, remove a player.
- 🏆 **Scoreboards** – Wins per room, a global leaderboard and a recent-games feed.
- 📱 **Responsive UI** – Works from small phones to large monitors, with sound cues and a last-card alert.

---

## 🧰 Tech Stack

- **Runtime:** Node.js 18+ (22 recommended)
- **Server:** Express 5, Socket.IO 4
- **Database:** PostgreSQL (optional, keeps the leaderboard across restarts) – works with the free tiers of Neon or Supabase
- **Frontend:** Vanilla JavaScript (ES modules), HTML, CSS
- **Testing:** Node's built-in test runner, ESLint

---

## 📁 Project Structure

- **server/** – Game rules (`gameLogic.js`), room bookkeeping (`rooms.js`), game flow and timers (`gameService.js`), Socket.IO handlers, results storage and the Express app
- **public/** – The browser client: `index.html`, styles and ES modules
- **test/** – Unit tests for the rules and storage, plus end-to-end tests over real sockets
- **docs/** – Screenshot

---

## 💡 Getting Started

1. Clone the repository
2. Install dependencies with `npm install`
3. Run the project with `npm start`
4. Open `http://localhost:3000` in two browser tabs, create a room in one and join from the other

To play with friends on the same Wi-Fi, share `http://<your-ip>:3000`.

Useful commands: `npm run dev` (restart on changes), `npm test`, `npm run lint`.

### Configuration

| Variable | Purpose |
| --- | --- |
| `PORT` | Port to listen on (default `3000`) |
| `DATABASE_URL` | Optional PostgreSQL connection string. When set, results and the leaderboard survive restarts. |

---

## 🎲 How to Play

Standard Shithead rules, as described on [pagat.com](https://www.pagat.com/beating/shithead.html).

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
