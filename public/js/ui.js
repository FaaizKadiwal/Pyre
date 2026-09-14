// Everything that touches the DOM. Render functions take state in and build
// nodes with textContent/createElement, never innerHTML with user data.

import { cardBack, cardElement, cardKey, cardLabel, countBadge, slot, sortCards } from './cards.js';

const $ = (id) => document.getElementById(id);

export const els = {
    lobby: $('lobby'),
    room: $('room'),
    nameInput: $('name-input'),
    createButton: $('create-room'),
    joinForm: $('join-form'),
    roomIdInput: $('room-id-input'),
    roomList: $('room-list'),
    lobbyMessage: $('lobby-message'),
    leaderboardBody: $('leaderboard-body'),
    leaderboardNote: $('leaderboard-note'),
    recentGames: $('recent-games'),
    roomCode: $('room-code'),
    playerCount: $('player-count'),
    themeToggle: $('theme-toggle'),
    soundToggle: $('sound-toggle'),
    copyInviteButton: $('copy-invite'),
    leaveButton: $('leave-room'),
    table: $('table'),
    opponents: $('opponents'),
    deck: $('deck'),
    pile: $('pile'),
    pileInfo: $('pile-info'),
    settings: $('settings'),
    turnSecondsSelect: $('turn-seconds'),
    privateCheckbox: $('private-room'),
    settingsSummary: $('settings-summary'),
    me: $('me'),
    status: $('status'),
    startButton: $('start-game'),
    addBotButton: $('add-bot'),
    readyButton: $('ready'),
    beginButton: $('begin-play'),
    playButton: $('play-selected'),
    pickUpButton: $('pick-up'),
    countdown: $('countdown'),
    countdownFill: $('countdown').querySelector('.fill'),
    countdownTime: $('countdown').querySelector('.time'),
    log: $('log'),
    messages: $('messages'),
    reactions: $('reactions'),
    chatForm: $('chat-form'),
    messageInput: $('message-input'),
    overlay: $('overlay'),
    overlayClose: $('overlay-close'),
    overlayTitle: $('overlay-title'),
    overlayOrder: $('overlay-order'),
    overlayStats: $('overlay-stats'),
    overlayAgain: $('overlay-again'),
    overlayLeave: $('overlay-leave'),
    confetti: $('confetti'),
};

const LOG_LIMIT = 40;
const THEME_COLORS = { ember: '#120f0d', midnight: '#0b1020', felt: '#0f2e1d' };

export function showScreen(name) {
    els.lobby.hidden = name !== 'lobby';
    els.room.hidden = name !== 'room';
}

export function setLobbyMessage(text = '', isError = false) {
    els.lobbyMessage.textContent = text;
    els.lobbyMessage.classList.toggle('error', isError);
}

export function setStatus(text, isError = false) {
    els.status.textContent = text;
    els.status.classList.toggle('error', isError);
}

/** Temporarily relabel a button, e.g. "Copied!", then restore it. */
export function pulseButton(button, text, ms = 2000) {
    const original = button.textContent;
    button.textContent = text;
    button.disabled = true;
    setTimeout(() => {
        button.textContent = original;
        button.disabled = false;
    }, ms);
}

export function renderSoundToggle(enabled) {
    els.soundToggle.textContent = enabled ? '🔔' : '🔕';
    els.soundToggle.setAttribute('aria-pressed', String(enabled));
    els.soundToggle.title = enabled ? 'Sound on' : 'Sound off';
}

export function applyTheme(name) {
    document.documentElement.dataset.theme = name;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[name] ?? THEME_COLORS.ember);
    els.themeToggle.title = `Theme: ${name}. Click to switch.`;
}

export function addLog(text) {
    const item = document.createElement('li');
    item.textContent = text;
    els.log.prepend(item);
    while (els.log.children.length > LOG_LIMIT) els.log.lastChild.remove();
}

export function addChat({ name, color, message, mine }) {
    const el = document.createElement('div');
    el.className = mine ? 'msg mine' : 'msg';
    const who = document.createElement('span');
    who.className = `who c${color ?? 7}`;
    who.textContent = `${name}:`;
    el.append(who, document.createTextNode(message));
    els.messages.append(el);
    els.messages.scrollTop = els.messages.scrollHeight;
}

export function clearRoom() {
    els.log.replaceChildren();
    els.messages.replaceChildren();
    els.opponents.replaceChildren();
    els.me.replaceChildren();
    els.deck.replaceChildren();
    els.pile.replaceChildren();
    els.pileInfo.textContent = '';
    els.countdown.hidden = true;
    els.table.classList.remove('dealing');
    hideSummary();
}

function cell(tag, text, className = '') {
    const el = document.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    return el;
}

function timeAgo(iso) {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (seconds < 60) return 'just now';
    const minutes = Math.round(seconds / 60);
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours} h ago`;
    return `${Math.round(hours / 24)} d ago`;
}

function duration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m ? `${m} min ${s}s` : `${s}s`;
}

export function renderLeaderboard({ persistent, rows, recent = [] }) {
    els.leaderboardBody.replaceChildren();
    if (rows.length === 0) {
        const tr = document.createElement('tr');
        const td = cell('td', 'No finished games yet. Be the first!', 'empty');
        td.colSpan = 4;
        tr.append(td);
        els.leaderboardBody.append(tr);
    }
    for (const row of rows) {
        const tr = document.createElement('tr');
        tr.append(cell('td', row.name), cell('td', String(row.wins)), cell('td', String(row.losses)), cell('td', String(row.games)));
        els.leaderboardBody.append(tr);
    }
    els.leaderboardNote.textContent = persistent ? '' : 'Results are kept in memory and reset when the server restarts.';

    els.recentGames.replaceChildren();
    if (recent.length === 0) {
        els.recentGames.append(cell('li', 'Nothing yet. Finish a game to see it here.', 'empty'));
    }
    for (const game of recent) {
        const label = (p) => (p ? `${p.name}${p.bot ? ' (bot)' : ''}` : 'Someone');
        const first = label(game.players[0]);
        const last = label(game.players[game.players.length - 1]);
        const others = game.players.length > 2 ? ` (${game.players.length} players)` : '';
        const li = document.createElement('li');
        li.append(cell('span', `${first} went out first, ${last} was the shithead${others}`), cell('span', timeAgo(game.playedAt), 'when'));
        els.recentGames.append(li);
    }
}

export function renderRoomList(rooms, onJoin) {
    els.roomList.replaceChildren();
    if (rooms.length === 0) {
        els.roomList.append(cell('li', 'No open rooms. Create one!', 'empty'));
        return;
    }
    for (const room of rooms) {
        const running = room.status === 'swapping' || room.status === 'playing';
        const li = document.createElement('li');
        const info = document.createElement('span');
        info.append(cell('span', room.id, 'code'), cell('span', ` · ${room.host}'s room · ${room.playerCount}/${room.maxPlayers}`, 'meta'));
        if (running) info.append(cell('span', ' · in play', 'meta live'));
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = running ? 'Watch' : 'Join';
        button.addEventListener('click', () => onJoin(room.id));
        li.append(info, button);
        els.roomList.append(li);
    }
}

function badge(text, kind) {
    return cell('span', text, `badge ${kind}`);
}

function avatar(player) {
    const el = document.createElement('span');
    el.className = `avatar c${player.color}`;
    el.append(cell('span', player.isBot ? '🤖' : (player.name.trim()[0] ?? '?').toUpperCase()));
    return el;
}

function nameLine(player, { isMe, canKick, onKick, status, running }) {
    const line = document.createElement('div');
    line.className = 'name';
    line.append(avatar(player), cell('span', isMe ? `${player.name} (you)` : player.name));
    if (player.isHost) line.append(badge('Host', 'host'));
    if (player.isBot) line.append(badge('bot', 'bot'));
    if (player.wins > 0) line.append(badge(`🏆 ${player.wins}`, 'wins'));
    if (player.losses > 0) line.append(badge(`💩 ${player.losses}`, 'losses'));
    if (running && !player.inGame) line.append(badge('Watching', 'watching'));
    if (status === 'swapping' && player.inGame) line.append(badge(player.ready ? 'Ready' : 'Swapping…', player.ready ? 'ready' : 'waiting'));
    if (player.finished) line.append(badge('Out', 'out'));
    else if (status === 'playing' && player.inGame && player.cardsLeft === 1) line.append(badge('Last card!', 'last'));
    if (!player.connected) line.append(badge('Offline', 'offline'));
    if (canKick) {
        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'kick';
        kick.textContent = 'Remove';
        kick.title = `Remove ${player.name} from the room`;
        kick.addEventListener('click', () => onKick(player));
        line.append(kick);
    }
    return line;
}

function playerClasses(player) {
    return ['player', player.isCurrent && 'current', player.finished && 'finished', !player.connected && 'offline']
        .filter(Boolean)
        .join(' ');
}

/**
 * Face-down cards with the face-up cards laid over them. `faceUpOptions`
 * turns the face-up cards into buttons: { onSelect, isPlayable, isSelected, isEnabled }.
 */
function tableCards(player, { canFlip = false, onFlip, faceUpOptions = null } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'table-cards';
    const slots = Math.max(player.faceDownCount, player.faceUp.length);
    for (let i = 0; i < slots; i++) {
        const slotEl = document.createElement('div');
        slotEl.className = 'table-slot';
        if (i < player.faceDownCount) {
            slotEl.append(cardBack(canFlip ? { onSelect: () => onFlip(i), label: `Flip face-down card ${i + 1}`, index: i } : { index: i }));
        }
        const up = player.faceUp[i];
        if (up) {
            slotEl.append(faceUpOptions
                ? cardElement(up, {
                    onSelect: faceUpOptions.onSelect,
                    playable: faceUpOptions.isPlayable(up),
                    selected: faceUpOptions.isSelected(up),
                    enabled: faceUpOptions.isEnabled(up),
                    index: 3 + i,
                })
                : cardElement(up, { index: 3 + i }));
        }
        wrap.append(slotEl);
    }
    return wrap;
}

function opponentPanel(player, state, actions, canKick) {
    const running = state.status === 'swapping' || state.status === 'playing';
    const panel = document.createElement('div');
    panel.className = playerClasses(player);
    panel.dataset.playerId = player.id;
    panel.append(nameLine(player, { isMe: false, canKick, onKick: actions.kick, status: state.status, running }));
    if (!player.inGame) return panel;

    const row = document.createElement('div');
    row.className = 'row';
    const handStack = document.createElement('div');
    handStack.className = 'table-slot';
    handStack.append(player.handCount ? cardBack({ label: `${player.handCount} cards in hand` }) : slot('Empty hand'));
    if (player.handCount) handStack.append(countBadge(player.handCount));
    row.append(handStack, tableCards(player, {}));
    panel.append(row);
    if (state.status === 'playing' && player.isCurrent) {
        panel.setAttribute('aria-label', `${player.name}, current turn`);
    }
    return panel;
}

/**
 * The viewer's own panel. `choice` is the client's current selection:
 * { selected: Card[], swapPick: { from, card } | null, sacrifice: Card | null }.
 */
function myPanel(me, state, actions, choice) {
    const running = state.status === 'swapping' || state.status === 'playing';
    const panel = document.createElement('div');
    panel.className = `${playerClasses(me)} me`;
    panel.dataset.playerId = me.id;
    panel.append(nameLine(me, { isMe: true, canKick: false, status: state.status, running }));
    if (!me.inGame) return panel;

    const swapping = state.status === 'swapping' && !me.ready;
    const active = state.status === 'playing' && state.isMyTurn;
    const legalKeys = new Set(state.legalCards.map(cardKey));
    const selectedKeys = new Set(choice.selected.map(cardKey));
    const pickedKey = choice.swapPick ? cardKey(choice.swapPick.card) : null;
    const sacrificeKey = choice.sacrifice ? cardKey(choice.sacrifice) : null;

    let faceUpOptions = null;
    if (swapping) {
        faceUpOptions = {
            onSelect: (card) => actions.swapPick(card, 'faceUp'),
            isPlayable: () => false,
            isSelected: (card) => cardKey(card) === pickedKey,
            isEnabled: () => true,
        };
    } else if (active && state.source === 'faceUp') {
        faceUpOptions = {
            onSelect: (card) => actions.select(card),
            isPlayable: (card) => legalKeys.has(cardKey(card)),
            isSelected: (card) => selectedKeys.has(cardKey(card)) || cardKey(card) === sacrificeKey,
            // A non-playable face-up card can still be chosen as the one that goes with the pile.
            isEnabled: () => true,
        };
    }

    const table = document.createElement('div');
    table.className = 'row';
    table.append(tableCards(me, {
        canFlip: active && state.source === 'faceDown',
        onFlip: actions.playFaceDown,
        faceUpOptions,
    }));
    panel.append(table);

    const hand = document.createElement('div');
    hand.className = 'hand';
    hand.setAttribute('aria-label', 'Your hand');
    sortCards(state.hand).forEach((card, i) => {
        const index = 6 + i;
        if (swapping) {
            hand.append(cardElement(card, {
                onSelect: (c) => actions.swapPick(c, 'hand'),
                selected: cardKey(card) === pickedKey,
                enabled: true,
                index,
            }));
        } else if (active && state.source === 'hand') {
            hand.append(cardElement(card, {
                onSelect: actions.select,
                playable: legalKeys.has(cardKey(card)),
                selected: selectedKeys.has(cardKey(card)),
                index,
            }));
        } else {
            hand.append(cardElement(card, { index }));
        }
    });
    panel.append(hand);
    return panel;
}

function renderSettings(state, me) {
    const editable = Boolean(me?.isHost);
    els.settings.hidden = state.status !== 'waiting' && state.status !== 'finished';
    els.turnSecondsSelect.value = String(state.settings.turnSeconds);
    els.turnSecondsSelect.disabled = !editable;
    els.privateCheckbox.checked = state.settings.private;
    els.privateCheckbox.disabled = !editable;
    els.settingsSummary.textContent = editable ? 'Only you can change these.' : 'Only the host can change these.';
}

function renderButtons(state, me, choice) {
    const isHost = Boolean(me?.isHost);
    const between = state.status === 'waiting' || state.status === 'finished';
    els.startButton.hidden = !(isHost && between);
    els.startButton.disabled = state.players.length < state.minPlayers;
    els.startButton.textContent = state.status === 'finished' ? 'Play again' : 'Deal cards';
    els.addBotButton.hidden = !(isHost && between && state.players.length < state.maxPlayers);

    const swapping = state.status === 'swapping';
    els.readyButton.hidden = !(swapping && me?.inGame && !me.ready);
    els.beginButton.hidden = !(swapping && isHost);

    const n = choice.selected.length;
    els.playButton.hidden = !(state.status === 'playing' && state.isMyTurn && n > 0);
    els.playButton.textContent = n === 1 ? 'Play this card' : `Play ${n} cards`;

    els.pickUpButton.hidden = !state.canPickUp;
    els.pickUpButton.classList.toggle('warn', state.mustPickUp);
    els.pickUpButton.textContent = choice.sacrifice
        ? `Pick up pile with ${cardLabel(choice.sacrifice)}`
        : 'Pick up pile';
}

function renderReactions(emojis, onReact) {
    if (els.reactions.childElementCount) return;
    for (const emoji of emojis) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = emoji;
        button.title = `React with ${emoji}`;
        button.addEventListener('click', () => onReact(emoji));
        els.reactions.append(button);
    }
}

const RUN_WORDS = { 2: 'two', 3: 'three' };

export function renderRoom(state, actions, choice) {
    els.roomCode.textContent = state.roomId;
    els.playerCount.textContent = `${state.players.length}/${state.maxPlayers} players`;

    const me = state.players.find((p) => p.id === state.me);
    const canKick = Boolean(me?.isHost);
    els.opponents.replaceChildren(...state.players.filter((p) => p.id !== state.me).map((p) => opponentPanel(p, state, actions, canKick)));
    els.me.replaceChildren(...(me ? [myPanel(me, state, actions, choice)] : []));

    els.deck.replaceChildren(state.deckCount ? cardBack({ label: `${state.deckCount} cards in deck` }) : slot('Deck is empty'));
    if (state.deckCount) els.deck.append(countBadge(state.deckCount));

    const previousTop = els.pile.querySelector('.card')?.dataset.key ?? null;
    const topEl = state.pile.top ? cardElement(state.pile.top) : slot('Pile is empty');
    if (state.pile.top && cardKey(state.pile.top) !== previousTop) topEl.classList.add('fresh');
    els.pile.replaceChildren(topEl);
    if (state.pile.count) els.pile.append(countBadge(state.pile.count));
    els.pileInfo.textContent = state.pile.topRun >= 2
        ? `${RUN_WORDS[state.pile.topRun] ?? state.pile.topRun} ${state.pile.top.value}s on top`
        : '';

    renderSettings(state, me);
    renderButtons(state, me, choice);
    renderReactions(state.reactions ?? [], actions.react);
}

/** `info` is `{ remainingMs, totalMs, mine }`, or null to hide the bar. */
export function renderCountdown(info) {
    if (!info) {
        els.countdown.hidden = true;
        return;
    }
    const { remainingMs, totalMs, mine } = info;
    els.countdown.hidden = false;
    els.countdown.classList.toggle('mine', mine);
    els.countdown.classList.toggle('warn', remainingMs <= 10_000);
    els.countdownFill.style.width = `${Math.max(0, Math.min(100, (remainingMs / totalMs) * 100))}%`;
    els.countdownTime.textContent = `${Math.ceil(remainingMs / 1000)}s`;
}

// ----- Effects -----

/** Stagger the cards in after a deal. */
export function dealEffect() {
    els.table.classList.remove('dealing');
    void els.table.offsetWidth; // restart the animation
    els.table.classList.add('dealing');
    setTimeout(() => els.table.classList.remove('dealing'), 1200);
}

/** Flash the pile and scatter embers. */
export function burnEffect() {
    els.pile.classList.remove('burning');
    void els.pile.offsetWidth;
    els.pile.classList.add('burning');
    for (let i = 0; i < 14; i++) {
        const ember = document.createElement('span');
        ember.className = 'ember';
        const angle = Math.random() * Math.PI * 2;
        const distance = 40 + Math.random() * 70;
        ember.style.setProperty('--dx', `${Math.cos(angle) * distance}px`);
        ember.style.setProperty('--dy', `${Math.sin(angle) * distance - 30}px`);
        ember.style.setProperty('--delay', `${Math.random() * 120}ms`);
        els.pile.append(ember);
        setTimeout(() => ember.remove(), 1100);
    }
    setTimeout(() => els.pile.classList.remove('burning'), 800);
}

/** Float an emoji up from a player's seat. */
export function showReaction(playerId, emoji) {
    const panel = els.room.querySelector(`.player[data-player-id="${CSS.escape(playerId)}"]`);
    if (!panel) return;
    const el = document.createElement('span');
    el.className = 'reaction-float';
    el.textContent = emoji;
    panel.append(el);
    setTimeout(() => el.remove(), 1700);
}

// ----- Round summary -----

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣'];

/**
 * The end-of-round card: finishing order, the shithead, a few numbers, and
 * confetti for everyone but the loser.
 */
export function showSummary(state, { isHost, iLost }) {
    const nameOf = (id) => state.players.find((p) => p.id === id)?.name ?? 'Someone';
    const order = [...state.finished, state.loser].filter(Boolean);
    els.overlayTitle.textContent = state.endReason === 'completed'
        ? `${nameOf(state.loser)} is the shithead`
        : 'Round ended early';

    els.overlayOrder.replaceChildren();
    order.forEach((id, i) => {
        const li = document.createElement('li');
        const last = i === order.length - 1 && state.endReason === 'completed';
        li.append(
            cell('span', last ? '💩' : (MEDALS[i] ?? '·'), 'medal'),
            cell('span', nameOf(id), 'who'),
            cell('span', last ? 'last one holding cards' : i === 0 ? 'went out first' : 'safe', 'detail'),
        );
        els.overlayOrder.append(li);
    });

    els.overlayStats.replaceChildren();
    const stat = (label, value) => {
        const wrap = document.createElement('div');
        wrap.append(cell('dt', label), cell('dd', value));
        els.overlayStats.append(wrap);
    };
    const stats = state.stats ?? { burns: 0, biggestPickup: null };
    stat('Burns', String(stats.burns));
    stat('Biggest pick-up', stats.biggestPickup ? `${stats.biggestPickup.count} by ${nameOf(stats.biggestPickup.id)}` : 'none');
    stat('Length', duration(state.durationSeconds ?? 0));
    stat('Players', String(state.players.filter((p) => p.inGame).length || order.length));

    els.overlayAgain.hidden = !isHost;
    els.confetti.replaceChildren();
    if (state.endReason === 'completed' && !iLost) {
        for (let i = 0; i < 48; i++) {
            const piece = document.createElement('span');
            piece.style.setProperty('--x', `${Math.random() * 100}%`);
            piece.style.setProperty('--delay', `${Math.random() * 1.2}s`);
            piece.style.setProperty('--hue', String(Math.floor(Math.random() * 360)));
            els.confetti.append(piece);
        }
    }
    els.overlay.hidden = false;
    els.overlayClose.focus();
}

export function hideSummary() {
    els.overlay.hidden = true;
    els.confetti.replaceChildren();
}
