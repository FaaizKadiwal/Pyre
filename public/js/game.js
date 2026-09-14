// Client entry point: owns the state, wires socket events to the UI and
// user actions to the server. All rules are enforced server-side; the
// client only decides what to show.

import { socket, request } from './socket.js';
import * as ui from './ui.js';

const NAME_KEY = 'cardgame:name';
const FLASH_MS = 3000;

let state = null;
let inRoom = false;
let flashTimer = null;

function loadName() {
    try { return localStorage.getItem(NAME_KEY) ?? ''; } catch { return ''; }
}

function myName() {
    const name = ui.els.nameInput.value.trim();
    try { localStorage.setItem(NAME_KEY, name); } catch { /* storage unavailable */ }
    return name;
}

function nameOf(id) {
    return state?.players.find((p) => p.id === id)?.name ?? 'Someone';
}

function statusFor(s) {
    const me = s.players.find((p) => p.id === s.me);
    const host = s.players.find((p) => p.isHost);

    if (s.status === 'waiting') {
        if (s.players.length < s.minPlayers) return `Waiting for players. Share the code ${s.roomId}.`;
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

/** Show an error briefly, then fall back to the normal status line. */
function flash(message) {
    clearTimeout(flashTimer);
    ui.setStatus(message, true);
    flashTimer = setTimeout(refreshStatus, FLASH_MS);
}

async function act(event, payload) {
    const res = await request(event, payload);
    if (!res.ok) flash(res.error);
}

const actions = {
    playCard: (card) => act('play-card', { card }),
    playFaceDown: (index) => act('play-face-down', { index }),
};

function enterRoom() {
    inRoom = true;
    ui.clearRoom();
    ui.showScreen('room');
    ui.els.messageInput.value = '';
}

function exitRoom(message = '') {
    inRoom = false;
    state = null;
    clearTimeout(flashTimer);
    ui.clearRoom();
    ui.showScreen('lobby');
    ui.setLobbyMessage(message, Boolean(message));
}

async function joinRoom(roomId) {
    ui.setLobbyMessage('Joining…');
    const res = await request('join-room', { roomId, name: myName() });
    if (res.ok) {
        enterRoom();
    } else {
        ui.setLobbyMessage(res.error, true);
    }
}

// ---------- Lobby ----------

ui.els.nameInput.value = loadName();

ui.els.createButton.addEventListener('click', async () => {
    ui.setLobbyMessage('Creating room…');
    const res = await request('create-room', { name: myName() });
    if (res.ok) {
        enterRoom();
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

ui.els.leaveButton.addEventListener('click', async () => {
    await request('leave-room');
    exitRoom();
});

ui.els.startButton.addEventListener('click', () => act('start-game'));
ui.els.pickUpButton.addEventListener('click', () => act('pick-up-pile'));

ui.els.chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const message = ui.els.messageInput.value.trim();
    if (!message) return;
    ui.els.messageInput.value = '';
    await act('chat-message', { message });
});

// ---------- Server events ----------

socket.on('room-list', (rooms) => ui.renderRoomList(rooms, joinRoom));

socket.on('room-state', (next) => {
    state = next;
    if (!inRoom) enterRoom();
    ui.renderRoom(state, actions);
    refreshStatus();
});

socket.on('game-event', (event) => ui.addLog(event.message));

socket.on('chat-message', (msg) => ui.addChat({ ...msg, mine: msg.playerId === socket.id }));

socket.on('left-room', ({ reason }) => exitRoom(reason));

socket.on('disconnect', () => {
    if (inRoom) ui.setStatus('Connection lost. Reconnecting…', true);
    else ui.setLobbyMessage('Connection lost. Reconnecting…', true);
});

socket.on('connect', () => {
    if (inRoom && !socket.recovered) {
        exitRoom('Your connection was down too long and your seat was released. Please rejoin.');
    } else if (inRoom) {
        refreshStatus();
    } else {
        ui.setLobbyMessage('');
    }
});

socket.on('connect_error', () => {
    ui.setLobbyMessage('Cannot reach the server. Retrying…', true);
});
