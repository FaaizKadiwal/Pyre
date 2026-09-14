// Client entry point: owns the state, wires socket events to the UI and
// user actions to the server. All rules are enforced server-side; the
// client only decides what to show and gathers multi-card choices.

import { socket, request } from './socket.js';
import * as ui from './ui.js';
import * as sound from './sound.js';
import { cardKey, sortCards } from './cards.js';

const NAME_KEY = 'cardgame:name';
const SESSION_KEY = 'cardgame:session';
const THEME_KEY = 'cardgame:theme';
const THEMES = ['ember', 'midnight', 'felt'];
const FLASH_MS = 3000;
const ROOM_CODE_LENGTH = 5;
const COUNTDOWN_TICK_MS = 250;

let state = null;
let inRoom = false;
let flashTimer = null;
let clockOffset = 0;   // serverNow - Date.now(), so the countdown ignores clock skew
let countdownTimer = null;
let warned = false;

/** What the player is in the middle of choosing; cleared whenever fresh state arrives. */
const choice = { selected: [], swapPick: null, sacrifice: null };

function resetChoice() {
    choice.selected = [];
    choice.swapPick = null;
    choice.sacrifice = null;
}

// ---------- Local persistence ----------
// Name, theme and sound are remembered across visits. The session (room +
// secret token) is kept per tab so a reload or a dropped connection gets the
// same seat back, while two tabs in one browser can still be two players.

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

function loadTheme() {
    try {
        const saved = localStorage.getItem(THEME_KEY);
        return THEMES.includes(saved) ? saved : THEMES[0];
    } catch { return THEMES[0]; }
}

function setTheme(name) {
    ui.applyTheme(name);
    try { localStorage.setItem(THEME_KEY, name); } catch { /* storage unavailable */ }
}

// ---------- Presentation helpers ----------

function me() {
    return state?.players.find((p) => p.id === state.me) ?? null;
}

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
    const self = me();
    const host = s.players.find((p) => p.isHost);
    const inGame = s.players.filter((p) => p.inGame);
    const readyCount = inGame.filter((p) => p.ready).length;

    if (s.status === 'waiting') {
        if (s.players.length < s.minPlayers) return `Waiting for players. Share the code ${s.roomId}, copy the invite link, or add a bot.`;
        return self?.isHost ? 'Everyone is here. Press Deal cards when ready.' : `Waiting for ${host?.name ?? 'the host'} to deal.`;
    }
    if (!self?.inGame && (s.status === 'swapping' || s.status === 'playing')) {
        return 'A round is in progress. You are watching and will be dealt in next time.';
    }
    if (s.status === 'swapping') {
        if (self.ready) return `Waiting for the others to finish swapping (${readyCount}/${inGame.length} ready).`;
        return choice.swapPick
            ? `Now tap a ${choice.swapPick.from === 'hand' ? 'face-up' : 'hand'} card to swap with, or press Ready.`
            : `Swap cards: tap a hand card, then a face-up card. Press Ready when done (${readyCount}/${inGame.length} ready).`;
    }
    if (s.status === 'finished') {
        const again = self?.isHost ? ' Press Play again for another round.' : '';
        if (s.endReason === 'completed') {
            return `${nameOf(s.loser)} is the shithead! ${nameOf(s.finished[0])} went out first.${again}`;
        }
        return `Round ended: not enough players.${again}`;
    }
    if (self?.finished) return 'You are out. Waiting for the others to finish.';
    if (!s.isMyTurn) return `${nameOf(s.currentPlayerId)}'s turn.`;
    if (s.mustPickUp) return 'Nothing beats the pile. Pick it up.';
    if (s.pile.count === 0) return 'Your turn: start a new pile with any card or set of equal cards.';
    if (s.source === 'hand') return `Your turn: play a card equal to or higher than ${s.pile.top.value}, or a 2 or 10.`;
    if (s.source === 'faceUp') return 'Your turn: play from your face-up cards, or pick up the pile with one of them.';
    return 'Your turn: flip one of your face-down cards and hope it beats the pile.';
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
    const running = state && (state.status === 'playing' || state.status === 'swapping') && state.turnEndsAt;
    if (!running) {
        ui.renderCountdown(null);
        return;
    }
    const totalMs = Math.max(1, state.turnEndsAt - state.serverNow);
    warned = false;
    const tick = () => {
        const remainingMs = Math.max(0, state.turnEndsAt - (Date.now() + clockOffset));
        ui.renderCountdown({ remainingMs, totalMs, mine: state.status === 'playing' && state.isMyTurn });
        if (state.status === 'playing' && state.isMyTurn && !warned && remainingMs <= 10_000 && remainingMs > 0) {
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
    return res.ok;
}

function rerender() {
    if (state) {
        ui.renderRoom(state, actions, choice);
        refreshStatus();
    }
}

const actions = {
    playFaceDown: (index) => act('play-face-down', { index }),

    /** Tap a card during play: build a set of equal cards, or play a lone card straight away. */
    select(card) {
        if (!state?.isMyTurn) return;
        const legal = state.legalCards.some((c) => cardKey(c) === cardKey(card));
        if (!legal) {
            // In the face-up phase an unplayable card can be chosen as the one that goes with the pile.
            if (state.source === 'faceUp' && state.canPickUp) {
                choice.sacrifice = choice.sacrifice && cardKey(choice.sacrifice) === cardKey(card) ? null : card;
                choice.selected = [];
                rerender();
            }
            return;
        }
        choice.sacrifice = null;
        const key = cardKey(card);
        const already = choice.selected.some((c) => cardKey(c) === key);
        if (already) {
            choice.selected = choice.selected.filter((c) => cardKey(c) !== key);
        } else if (choice.selected.length && choice.selected[0].value !== card.value) {
            choice.selected = [card];
        } else {
            choice.selected = [...choice.selected, card];
        }
        const source = state.source === 'faceUp' ? me().faceUp : state.hand;
        const equals = source.filter((c) => c.value === card.value).length;
        if (choice.selected.length === 1 && equals === 1) {
            actions.playSelected(); // nothing else to add, so one tap plays it
        } else {
            rerender();
        }
    },

    async playSelected() {
        if (!choice.selected.length) return;
        const cards = choice.selected;
        choice.selected = [];
        if (!(await act('play-cards', { cards }))) rerender();
    },

    /** Tap a card during the swap phase: first pick one side, then the other, and the two are exchanged. */
    swapPick(card, from) {
        if (!choice.swapPick || choice.swapPick.from === from) {
            choice.swapPick = { from, card };
            rerender();
            return;
        }
        const handCard = from === 'hand' ? card : choice.swapPick.card;
        const faceUpCard = from === 'faceUp' ? card : choice.swapPick.card;
        choice.swapPick = null;
        act('swap-cards', { handCard, faceUpCard });
    },

    kick: (player) => {
        if (window.confirm(`Remove ${player.name} from the room?`)) act('kick-player', { playerId: player.id });
    },

    react: (emoji) => act('react', { emoji }),
};

// ---------- Screen transitions ----------

function enterRoom() {
    inRoom = true;
    resetChoice();
    ui.clearRoom();
    ui.showScreen('room');
    ui.els.messageInput.value = '';
}

function exitRoom(message = '') {
    inRoom = false;
    state = null;
    resetChoice();
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
ui.applyTheme(loadTheme());
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

ui.els.themeToggle.addEventListener('click', () => {
    const current = document.documentElement.dataset.theme;
    setTheme(THEMES[(THEMES.indexOf(current) + 1) % THEMES.length]);
});

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

async function leave() {
    await request('leave-room');
    exitRoom();
}

ui.els.leaveButton.addEventListener('click', leave);
ui.els.startButton.addEventListener('click', () => act('start-game'));
ui.els.addBotButton.addEventListener('click', () => act('add-bot'));
ui.els.readyButton.addEventListener('click', () => act('ready'));
ui.els.beginButton.addEventListener('click', () => act('begin-play'));
ui.els.playButton.addEventListener('click', () => actions.playSelected());
ui.els.pickUpButton.addEventListener('click', () => act('pick-up-pile', { card: choice.sacrifice }));
ui.els.overlayClose.addEventListener('click', () => ui.hideSummary());
ui.els.overlayAgain.addEventListener('click', () => { ui.hideSummary(); act('start-game'); });
ui.els.overlayLeave.addEventListener('click', leave);

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

/** Keyboard: digits pick cards, Enter plays or readies, P picks up, Escape clears. */
document.addEventListener('keydown', (e) => {
    if (!inRoom || !state || e.altKey || e.ctrlKey || e.metaKey) return;
    if (['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (e.key === 'Escape') {
        if (!ui.els.overlay.hidden) ui.hideSummary();
        resetChoice();
        rerender();
        return;
    }
    if (state.status === 'swapping') {
        if (e.key === 'Enter' && !ui.els.readyButton.hidden) act('ready');
        return;
    }
    if (state.status !== 'playing' || !state.isMyTurn) return;
    if (/^[1-9]$/.test(e.key)) {
        const cards = state.source === 'faceUp' ? me().faceUp : sortCards(state.hand);
        const card = cards[Number(e.key) - 1];
        if (card) actions.select(card);
    } else if (e.key === 'Enter') {
        actions.playSelected();
    } else if (e.key.toLowerCase() === 'p' && state.canPickUp) {
        act('pick-up-pile', { card: choice.sacrifice });
    }
});

// ---------- Server events ----------

socket.on('room-list', (rooms) => ui.renderRoomList(rooms, joinRoom));

socket.on('leaderboard', (board) => ui.renderLeaderboard(board));

socket.on('room-state', (next) => {
    const previous = state;
    state = next;
    clockOffset = next.serverNow - Date.now();
    if (!inRoom) enterRoom();
    // Any choice in progress refers to cards that may have moved.
    choice.selected = [];
    choice.sacrifice = null;
    if (state.status !== 'swapping') choice.swapPick = null;
    ui.renderRoom(state, actions, choice);
    refreshStatus();
    updateTitle();
    startCountdown();

    const wasRunning = previous?.status === 'swapping' || previous?.status === 'playing';
    if (state.status === 'swapping' && previous?.status !== 'swapping') {
        ui.hideSummary();
        if (me()?.inGame) {
            ui.dealEffect();
            sound.play('deal');
        }
    }
    const becameMyTurn = state.status === 'playing' && state.isMyTurn && !(previous?.status === 'playing' && previous.isMyTurn);
    if (becameMyTurn) sound.play('yourTurn');
    if (state.status === 'finished' && wasRunning) {
        const iLost = state.loser === state.me;
        sound.play(iLost ? 'lose' : 'win');
        ui.showSummary(state, { isHost: Boolean(me()?.isHost), iLost });
    }
});

socket.on('game-event', (event) => {
    ui.addLog(event.message);
    if (event.type === 'burn') {
        ui.burnEffect();
        sound.play('burn');
    } else if (event.type === 'play' && event.playerId !== state?.me) {
        sound.play('play');
    } else if (event.type === 'pick-up') {
        sound.play('pickUp');
    }
});

socket.on('reaction', ({ playerId, emoji }) => ui.showReaction(playerId, emoji));

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
