// Client entry point: owns the state, wires socket events to the UI and
// user actions to the server. All rules are enforced server-side; the
// client only decides what to show.

import { socket, request } from './socket.js';
import * as ui from './ui.js';
import * as sound from './sound.js';

const NAME_KEY = 'cardgame:name';
const SESSION_KEY = 'cardgame:session';
const FLASH_MS = 3000;
const ROOM_CODE_LENGTH = 5;
const COUNTDOWN_TICK_MS = 250;

let state = null;
let inRoom = false;
let flashTimer = null;
let clockOffset = 0;   // serverNow - Date.now(), so the countdown ignores clock skew
let countdownTimer = null;
let warned = false;

// ---------- Local persistence ----------
// The name is remembered across visits. The session (room + secret token) is
// kept per tab so a reload or a dropped connection gets the same seat back,
// while two tabs in one browser can still be two different players.

function loadName() {
    try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}

function myName() {
    const name = ui.els.nameInput.value.trim();
    try { localStorage.setItem(NAME_KEY, name); } catch { /* storage unavailable */ }
    return name;
}

function loadSession() {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY)) ?? null; } catch { return null; }
}

function saveSession(session) {
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)); } catch { /* storage unavailable */ }
}

function clearSession() {
    try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ }
}

// ---------- Presentation helpers ----------

function nameOf(id) {
    return state?.players.find((p) => p.id === id)?.name ?? 'Someone';
}

function inviteLink(roomId) {
    const url = new URL(location.href);
    url.search = '';
    url.hash = '';
    url.searchParams.set('room', roomId);
    return url.toString();
}

function statusFor(s) {
    const me = s.players.find((p) => p.id === s.me);
    const host = s.players.find((p) => p.isHost);

    if (s.status === 'waiting') {
        if (s.players.length < s.minPlayers) return `Waiting for players. Share the code ${s.roomId} or copy the invite link.`;
        return me?.isHost ? 'Everyone is here. Press Start game when ready.' : `Waiting for ${host?.name ?? 'the host'} to start.`;
    }
    if (s.status === 'finished') {
        const again = me?.isHost ? ' Press Play again for another round.' : '';
        if (s.endReason === 'completed') {
            return `${nameOf(s.loser)} lost! ${nameOf(s.finished[0])} finished first.${again}`;
        }
        return `Game ended: not enough players.${again}`;
    }
    if (me?.finished) return 'You are out of cards. Waiting for the others to finish.';
    if (!s.isMyTurn) return `${nameOf(s.currentPlayerId)}'s turn.`;
    if (s.canPickUp) return 'No playable card. Pick up the pile.';
    if (s.source === 'hand') return 'Your turn: play a highlighted card from your hand.';
    if (s.source === 'faceUp') return 'Your turn: play one of your face-up cards.';
    return 'Your turn: flip one of your face-down cards and hope.';
}

function refreshStatus() {
    if (state) ui.setStatus(statusFor(state));
}

const BASE_TITLE = document.title;

/** The tab title tells a player who switched away that the table is waiting for them. */
function updateTitle() {
    document.title = state?.status === 'playing' && state.isMyTurn ? `Your turn · ${BASE_TITLE}` : BASE_TITLE;
}

/** Show a message briefly, then fall back to the normal status line. */
function flash(message, isError = true) {
    clearTimeout(flashTimer);
    ui.setStatus(message, isError);
    flashTimer = setTimeout(refreshStatus, FLASH_MS);
}

// ---------- Turn countdown ----------

function stopCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    ui.renderCountdown(null);
}

function startCountdown() {
    clearInterval(countdownTimer);
    countdownTimer = null;
    if (!state || state.status !== 'playing' || !state.turnEndsAt) {
        ui.renderCountdown(null);
        return;
    }
    const totalMs = state.settings.turnSeconds * 1000;
    warned = false;
    const tick = () => {
        const remainingMs = Math.max(0, state.turnEndsAt - (Date.now() + clockOffset));
        ui.renderCountdown({ remainingMs, totalMs, mine: state.isMyTurn });
        if (state.isMyTurn && !warned && remainingMs <= 10_000 && remainingMs > 0) {
            warned = true;
            sound.play('warning');
        }
        if (remainingMs <= 0) {
            clearInterval(countdownTimer);
            countdownTimer = null;
        }
    };
    tick();
    countdownTimer = setInterval(tick, COUNTDOWN_TICK_MS);
}

// ---------- Actions ----------

async function act(event, payload) {
    const res = await request(event, payload);
    if (!res.ok) flash(res.error);
}

const actions = {
    playCard: (card) => act('play-card', { card }),
    playFaceDown: (index) => act('play-face-down', { index }),
    kick: (player) => {
        if (window.confirm(`Remove ${player.name} from the room?`)) act('kick-player', { playerId: player.id });
    },
};

// ---------- Screen transitions ----------

function enterRoom() {
    inRoom = true;
    ui.clearRoom();
    ui.showScreen('room');
    ui.els.messageInput.value = '';
}

function exitRoom(message = '') {
    inRoom = false;
    state = null;
    clearSession();
    clearTimeout(flashTimer);
    stopCountdown();
    updateTitle();
    ui.clearRoom();
    ui.showScreen('lobby');
    ui.setLobbyMessage(message, Boolean(message));
}

/** Handle the acknowledgement of create/join/resume: remember the seat and show the table. */
function seated(res) {
    saveSession({ roomId: res.roomId, token: res.token });
    enterRoom();
}

async function joinRoom(roomId) {
    ui.setLobbyMessage('Joining…');
    const res = await request('join-room', { roomId, name: myName() });
    if (res.ok) {
        seated(res);
    } else {
        ui.setLobbyMessage(res.error, true);
    }
}

// ---------- Lobby ----------

ui.els.nameInput.value = loadName();
ui.renderSoundToggle(sound.isEnabled());
document.addEventListener('pointerdown', () => sound.unlock(), { once: true });

const invited = new URLSearchParams(location.search).get('room');
if (invited) {
    ui.els.roomIdInput.value = invited.trim().toUpperCase().slice(0, ROOM_CODE_LENGTH);
    ui.setLobbyMessage(`You were invited to room ${ui.els.roomIdInput.value}. Enter your name and press Join.`);
}

ui.els.createButton.addEventListener('click', async () => {
    ui.setLobbyMessage('Creating room…');
    const res = await request('create-room', { name: myName() });
    if (res.ok) {
        seated(res);
    } else {
        ui.setLobbyMessage(res.error, true);
    }
});

ui.els.joinForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const roomId = ui.els.roomIdInput.value.trim().toUpperCase();
    if (!roomId) {
        ui.setLobbyMessage('Enter a room code first.', true);
        return;
    }
    joinRoom(roomId);
});

// ---------- Room ----------

ui.els.soundToggle.addEventListener('click', () => {
    sound.setEnabled(!sound.isEnabled());
    ui.renderSoundToggle(sound.isEnabled());
    if (sound.isEnabled()) sound.play('yourTurn');
});

ui.els.copyInviteButton.addEventListener('click', async () => {
    if (!state) return;
    const link = inviteLink(state.roomId);
    try {
        await navigator.clipboard.writeText(link);
        ui.pulseButton(ui.els.copyInviteButton, 'Copied!');
    } catch {
        flash(`Invite link: ${link}`, false);
    }
});

ui.els.leaveButton.addEventListener('click', async () => {
    await request('leave-room');
    exitRoom();
});

ui.els.startButton.addEventListener('click', () => act('start-game'));
ui.els.pickUpButton.addEventListener('click', () => act('pick-up-pile'));

ui.els.turnSecondsSelect.addEventListener('change', () => {
    act('update-settings', { turnSeconds: Number(ui.els.turnSecondsSelect.value) });
});
ui.els.privateCheckbox.addEventListener('change', () => {
    act('update-settings', { private: ui.els.privateCheckbox.checked });
});

ui.els.chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = ui.els.messageInput.value.trim();
    if (!message) return;
    ui.els.messageInput.value = '';
    await act('chat-message', { message });
});

// ---------- Server events ----------

socket.on('room-list', (rooms) => ui.renderRoomList(rooms, joinRoom));

socket.on('leaderboard', (board) => ui.renderLeaderboard(board));

socket.on('room-state', (next) => {
    const previous = state;
    state = next;
    clockOffset = next.serverNow - Date.now();
    if (!inRoom) enterRoom();
    ui.renderRoom(state, actions);
    refreshStatus();
    updateTitle();
    startCountdown();

    const becameMyTurn = state.status === 'playing' && state.isMyTurn && !(previous?.status === 'playing' && previous.isMyTurn);
    if (becameMyTurn) sound.play('yourTurn');
    if (state.status === 'finished' && previous?.status === 'playing') sound.play('gameOver');
});

socket.on('game-event', (event) => ui.addLog(event.message));

socket.on('chat-message', (msg) => ui.addChat({ ...msg, mine: msg.playerId === state?.me }));

socket.on('left-room', ({ reason }) => exitRoom(reason));

socket.on('disconnect', () => {
    if (inRoom) ui.setStatus('Connection lost. Reconnecting…', true);
    else ui.setLobbyMessage('Connection lost. Reconnecting…', true);
});

socket.on('connect', async () => {
    if (socket.recovered) {
        // Socket.IO restored the same connection; the seat was never lost.
        if (inRoom) refreshStatus();
        return;
    }
    const session = loadSession();
    if (session) {
        // A reload, a new connection after a longer drop, or a tab restored by the browser.
        const res = await request('resume-session', session);
        if (res.ok) {
            saveSession({ roomId: res.roomId, token: res.token });
            return; // the accompanying room-state has already rebuilt the table
        }
        exitRoom(`Could not rejoin your previous room: ${res.error}`);
        return;
    }
    if (inRoom) {
        exitRoom('Your seat was released while you were disconnected. Please rejoin.');
    } else if (!invited) {
        ui.setLobbyMessage('');
    }
});

socket.on('connect_error', () => {
    ui.setLobbyMessage('Cannot reach the server. Retrying…', true);
});
