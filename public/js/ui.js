// Everything that touches the DOM. Render functions take state in and build
// nodes with textContent/createElement, never innerHTML with user data.

import { cardBack, cardElement, cardKey, cardLabel, countBadge, slot, sortCards } from './cards.js';
import { avatarNode, flameMark } from './avatars.js';

const $ = (id) => document.getElementById(id);

export const els = {
    app: $('app'),
    lobby: $('lobby'),
    room: $('room'),
    heroMark: $('hero-mark'),
    headerMark: $('header-mark'),
    nameInput: $('name-input'),
    avatarPicker: $('avatar-picker'),
    modePicker: $('mode-picker'),
    createButton: $('create-room'),
    playBotsButton: $('play-bots'),
    joinForm: $('join-form'),
    roomIdInput: $('room-id-input'),
    roomList: $('room-list'),
    lobbyMessage: $('lobby-message'),
    record: $('record'),
    leaderboardBody: $('leaderboard-body'),
    leaderboardNote: $('leaderboard-note'),
    recentGames: $('recent-games'),
    roomCode: $('room-code'),
    roomMode: $('room-mode'),
    playerCount: $('player-count'),
    themeToggle: $('theme-toggle'),
    soundToggle: $('sound-toggle'),
    copyInviteButton: $('copy-invite'),
    leaveButton: $('leave-room'),
    table: $('table'),
    ticker: $('ticker'),
    ruleChips: $('rule-chips'),
    direction: $('direction'),
    orderRail: $('order-rail'),
    opponents: $('opponents'),
    deck: $('deck'),
    pile: $('pile'),
    pileInfo: $('pile-info'),
    settings: $('settings'),
    turnSecondsSelect: $('turn-seconds'),
    botLevelSelect: $('bot-level'),
    privateCheckbox: $('private-room'),
    ruleToggles: $('rule-toggles'),
    modeButtons: $('mode-buttons'),
    settingsSummary: $('settings-summary'),
    me: $('me'),
    turnBar: $('turn-bar'),
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
    overlayHistoryWrap: $('overlay-history-wrap'),
    overlayHistory: $('overlay-history'),
    overlayAgain: $('overlay-again'),
    overlayLeave: $('overlay-leave'),
    confetti: $('confetti'),
};

const LOG_LIMIT = 40;
const TOAST_MS = 2600;
const THEME_COLORS = { ember: '#120f0d', midnight: '#0b1020', felt: '#0f2e1d' };
export const RULE_INFO = {
    threes: { chip: '3 skips', label: 'Threes skip the next player' },
    sevens: { chip: '7 forces low', label: 'After a 7, play 7 or lower' },
    eights: { chip: '8 see-through', label: 'Eights are transparent' },
    nines: { chip: '9 reverses', label: 'Nines reverse direction' },
    jokers: { chip: '🃏 jokers', label: 'Two jokers: wild, see-through, reverse' },
    tensLow: { chip: '10 stays low', label: 'Tens only on 10 or lower' },
};
/** How each mode presents itself; the clock and rules themselves live on the server. */
export const MODE_INFO = {
    classic: { name: 'Classic', icon: 'cards', blurb: 'The pagat rules and nothing else. A minute a turn.', clock: '60 s turns', rules: 'Standard rules' },
    party: { name: 'Party', icon: 'star', blurb: 'Skips, sevens, see-through eights, reverses and two jokers.', clock: '60 s turns', rules: '5 house rules' },
    blitz: { name: 'Blitz', icon: 'bolt', blurb: 'Classic rules with fifteen seconds on the clock. Think fast.', clock: '15 s turns', rules: 'Standard rules' },
    inferno: { name: 'Inferno', icon: 'flame', blurb: 'Every house rule on and twenty seconds a turn. Chaos.', clock: '20 s turns', rules: 'All 6 house rules' },
    custom: { name: 'Custom', icon: 'dice', blurb: 'Tuned by the host.', clock: '', rules: '' },
};
const MODE_IDS = ['classic', 'party', 'blitz', 'inferno'];
const modeInfo = (id) => MODE_INFO[id] ?? MODE_INFO.custom;
const isEmoji = (text) => /^\p{Extended_Pictographic}/u.test(text);
const reduceMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

els.heroMark.append(flameMark('mark'));
els.headerMark.append(flameMark('mark'));

export function showScreen(name) {
    els.lobby.hidden = name !== 'lobby';
    els.room.hidden = name !== 'room';
    const shown = name === 'lobby' ? els.lobby : els.room;
    shown.classList.remove('enter-screen');
    void shown.offsetWidth; // restart the entrance animation
    shown.classList.add('enter-screen');
    // Drop the animation once it has played so no transform lingers on the screen.
    shown.addEventListener('animationend', () => shown.classList.remove('enter-screen'), { once: true });
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

export function applyTheme(name, { animate = false } = {}) {
    document.documentElement.dataset.theme = name;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[name] ?? THEME_COLORS.ember);
    els.themeToggle.title = `Theme: ${name}. Click to switch.`;
    if (animate && !reduceMotion()) {
        els.app.classList.remove('theme-fade');
        void els.app.offsetWidth;
        els.app.classList.add('theme-fade');
    }
}

function cell(tag, text, className = '') {
    const el = document.createElement(tag);
    el.textContent = text;
    if (className) el.className = className;
    return el;
}

// ----- Ticker: the latest table event, with toasts for the big moments -----

let lastLog = '';
let toastTimer = null;

export function addLog(text) {
    const item = document.createElement('li');
    item.textContent = text;
    els.log.prepend(item);
    while (els.log.children.length > LOG_LIMIT) els.log.lastChild.remove();
    lastLog = text;
    if (!toastTimer) els.ticker.replaceChildren(cell('span', text, 'tick'));
}

/** A short emphasised message in the ticker slot; the quiet commentary returns afterwards. */
export function toast(text, kind = '') {
    clearTimeout(toastTimer);
    els.ticker.replaceChildren(cell('span', text, `toast ${kind}`.trim()));
    toastTimer = setTimeout(() => {
        toastTimer = null;
        els.ticker.replaceChildren(lastLog ? cell('span', lastLog, 'tick') : '');
    }, TOAST_MS);
}

export function addChat({ name, color, avatar: avatarId, message, mine }) {
    const el = document.createElement('div');
    el.className = mine ? 'msg mine' : 'msg';
    const who = document.createElement('span');
    who.className = `who c${color ?? 7}`;
    if (avatarId) who.append(avatarNode(avatarId, 'chat-avatar'));
    who.append(document.createTextNode(`${name}:`));
    el.append(who, document.createTextNode(message));
    els.messages.append(el);
    els.messages.scrollTop = els.messages.scrollHeight;
}

// ----- Lobby -----

export function renderAvatarPicker(avatars, current, onPick) {
    els.avatarPicker.replaceChildren();
    for (const id of avatars) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'avatar-option';
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', String(id === current));
        button.setAttribute('aria-label', id);
        button.title = id;
        button.append(avatarNode(id));
        button.addEventListener('click', () => onPick(id));
        els.avatarPicker.append(button);
    }
}

export function renderModePicker(current, onPick) {
    els.modePicker.replaceChildren();
    for (const id of MODE_IDS) {
        const info = MODE_INFO[id];
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `mode-option ${id}`;
        button.dataset.mode = id;
        button.setAttribute('role', 'radio');
        button.setAttribute('aria-checked', String(id === current));
        const icon = document.createElement('span');
        icon.className = 'mode-icon';
        icon.append(avatarNode(info.icon));
        const meta = document.createElement('span');
        meta.className = 'mode-meta';
        meta.append(cell('span', info.clock), cell('span', info.rules));
        button.append(icon, cell('span', info.name, 'mode-name'), cell('span', info.blurb, 'mode-blurb'), meta);
        button.addEventListener('click', () => onPick(id));
        els.modePicker.append(button);
    }
}

export function renderRecord(record) {
    els.record.replaceChildren();
    if (!record.games) {
        els.record.append(cell('span', 'No rounds on this device yet.', 'label'));
        return;
    }
    const stat = (value, label) => {
        const wrap = document.createElement('span');
        wrap.className = 'record-stat';
        wrap.append(cell('strong', String(value)), cell('span', label));
        return wrap;
    };
    els.record.append(
        cell('span', 'Your record', 'label'),
        stat(record.games, 'rounds'),
        stat(record.firstOut, 'first out'),
        stat(record.shithead, 'shithead'),
        stat(`${record.streak} / ${record.bestStreak}`, 'safe streak / best'),
    );
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
    rows.forEach((row, i) => {
        const tr = document.createElement('tr');
        tr.append(cell('td', row.name), cell('td', String(row.wins)), cell('td', String(row.losses)), cell('td', String(row.games)));
        if (i === 0) tr.className = 'top';
        els.leaderboardBody.append(tr);
    });
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

const knownRooms = new Set();

export function renderRoomList(rooms, onJoin) {
    els.roomList.replaceChildren();
    if (rooms.length === 0) {
        els.roomList.append(cell('li', 'No open rooms. Create one!', 'empty'));
    }
    for (const room of rooms) {
        const running = room.status === 'swapping' || room.status === 'playing';
        const li = document.createElement('li');
        if (!knownRooms.has(room.id)) li.classList.add('fresh');
        const info = document.createElement('span');
        info.className = 'info';
        info.append(cell('span', room.id, 'code'), cell('span', `${room.host}'s room · ${room.playerCount}/${room.maxPlayers}`, 'meta'));
        const mode = room.mode ?? (room.houseRules ? 'custom' : 'classic');
        if (mode !== 'classic') info.append(cell('span', modeInfo(mode).name, `tag mode-${mode}`));
        if (running) info.append(cell('span', 'in play', 'tag live'));
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = running ? 'Watch' : 'Join';
        button.addEventListener('click', () => onJoin(room.id));
        li.append(info, button);
        els.roomList.append(li);
    }
    knownRooms.clear();
    for (const room of rooms) knownRooms.add(room.id);
}

// ----- Seats -----

function badge(text, kind) {
    return cell('span', text, `badge ${kind}`);
}

function avatar(player, { ring = false } = {}) {
    const wrap = document.createElement('span');
    wrap.className = `avatar-wrap c${player.color}`;
    if (ring) wrap.append(cell('span', '', 'avatar-ring'));
    const el = document.createElement('span');
    el.className = 'avatar';
    el.append(avatarNode(player.avatar));
    wrap.append(el);
    return wrap;
}

function nameLine(player, { isMe, canKick, onKick, status, running, loser }) {
    const line = document.createElement('div');
    line.className = 'name';
    const who = cell('span', isMe ? `${player.name} (you)` : player.name, 'who');
    who.title = player.name;
    line.append(avatar(player, { ring: player.isCurrent && status === 'playing' }), who);
    if (player.isHost) line.append(badge('Host', 'host'));
    if (player.isBot) line.append(badge('Bot', 'bot'));
    if (player.wins > 0) line.append(badge(`🏆 ${player.wins}`, 'wins'));
    if (player.losses > 0) line.append(badge(`💩 ${player.losses}`, 'losses'));
    if (running && !player.inGame) line.append(badge('Watching', 'watching'));
    if (status === 'swapping' && player.inGame) line.append(badge(player.ready ? 'Ready' : 'Swapping…', player.ready ? 'ready' : 'waiting'));
    if (player.finished) line.append(badge('Out', 'out'));
    else if (status === 'playing' && player.inGame && player.cardsLeft === 1) line.append(badge('Last card!', 'last'));
    if (player.away && player.connected && !player.isBot) line.append(badge('Away', 'away'));
    if (!player.connected) line.append(badge('Offline', 'offline'));
    if (loser) line.append(cell('span', 'Shithead', 'stamp'));
    if (canKick) {
        const kick = document.createElement('button');
        kick.type = 'button';
        kick.className = 'kick';
        kick.textContent = '×';
        kick.title = `Remove ${player.name} from the room`;
        kick.setAttribute('aria-label', `Remove ${player.name} from the room`);
        kick.addEventListener('click', () => onKick(player));
        line.append(kick);
    }
    return line;
}

let lastCurrent = null;

function playerClasses(player) {
    return ['player', player.isCurrent && 'current', player.isCurrent && player.id !== lastCurrent && 'just', player.finished && 'finished', !player.connected && 'offline']
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
    if (canKick) panel.classList.add('kickable');
    panel.dataset.playerId = player.id;
    const loser = state.status === 'finished' && state.endReason === 'completed' && state.loser === player.id;
    panel.append(nameLine(player, { isMe: false, canKick, onKick: actions.kick, status: state.status, running, loser }));
    if (!player.inGame) return panel;

    const row = document.createElement('div');
    row.className = 'row';
    const handStack = document.createElement('div');
    handStack.className = 'table-slot hand-stack';
    handStack.append(player.handCount ? cardBack({ label: `${player.handCount} cards in hand` }) : slot('Empty hand'));
    if (player.handCount) handStack.append(countBadge(player.handCount));
    row.append(handStack, tableCards(player, {}));
    panel.append(row);
    if (state.status === 'playing' && player.isCurrent) {
        panel.setAttribute('aria-label', `${player.name}, current turn`);
    }
    return panel;
}

let selectedBefore = new Set();

/**
 * The viewer's own panel. `choice` is the client's current selection:
 * { selected: Card[], swapPick: { from, card } | null, sacrifice: Card | null }.
 */
function myPanel(me, state, actions, choice) {
    const running = state.status === 'swapping' || state.status === 'playing';
    const panel = document.createElement('div');
    panel.className = `${playerClasses(me)} me`;
    panel.dataset.playerId = me.id;
    const loser = state.status === 'finished' && state.endReason === 'completed' && state.loser === me.id;
    panel.append(nameLine(me, { isMe: true, canKick: false, status: state.status, running, loser }));
    if (!me.inGame) {
        selectedBefore = new Set();
        return panel;
    }

    const swapping = state.status === 'swapping' && !me.ready;
    const active = state.status === 'playing' && state.isMyTurn;
    const legalKeys = new Set(state.legalCards.map(cardKey));
    const selectedKeys = new Set(choice.selected.map(cardKey));
    const pickedKey = choice.swapPick ? cardKey(choice.swapPick.card) : null;
    const sacrificeKey = choice.sacrifice ? cardKey(choice.sacrifice) : null;
    // Cards that just became part of the choice get a little bounce.
    const pop = (el) => {
        if (el.classList.contains('selected') && !selectedBefore.has(el.dataset.key)) el.classList.add('pop');
        return el;
    };

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
    for (const el of table.querySelectorAll('.card.selected')) pop(el);
    panel.append(table);

    const hand = document.createElement('div');
    hand.className = 'hand';
    hand.setAttribute('aria-label', 'Your hand');
    sortCards(state.hand).forEach((card, i) => {
        const index = 6 + i;
        if (swapping) {
            hand.append(pop(cardElement(card, {
                onSelect: (c) => actions.swapPick(c, 'hand'),
                selected: cardKey(card) === pickedKey,
                enabled: true,
                index,
            })));
        } else if (active && state.source === 'hand') {
            hand.append(pop(cardElement(card, {
                onSelect: actions.select,
                playable: legalKeys.has(cardKey(card)),
                selected: selectedKeys.has(cardKey(card)),
                index,
            })));
        } else {
            hand.append(cardElement(card, { index }));
        }
    });
    panel.append(hand);
    selectedBefore = new Set([...selectedKeys, pickedKey, sacrificeKey].filter(Boolean));
    return panel;
}

// ----- Settings, chips, direction, turn order -----

function renderRuleToggles(rules, editable, onChange) {
    if (!els.ruleToggles.childElementCount) {
        for (const [key, info] of Object.entries(RULE_INFO)) {
            const label = document.createElement('label');
            label.className = 'rule-toggle';
            const input = document.createElement('input');
            input.type = 'checkbox';
            input.dataset.rule = key;
            input.addEventListener('change', () => onChange({ [key]: input.checked }));
            label.append(input, cell('span', info.label));
            els.ruleToggles.append(label);
        }
    }
    for (const input of els.ruleToggles.querySelectorAll('input')) {
        input.checked = Boolean(rules[input.dataset.rule]);
        input.disabled = !editable;
    }
}

function renderModeButtons(mode, editable, onPick) {
    if (!els.modeButtons.childElementCount) {
        for (const id of MODE_IDS) {
            const button = document.createElement('button');
            button.type = 'button';
            button.id = `preset-${id}`;
            button.className = 'preset';
            button.dataset.mode = id;
            button.textContent = MODE_INFO[id].name;
            button.title = `${MODE_INFO[id].clock}, ${MODE_INFO[id].rules.toLowerCase()}`;
            button.addEventListener('click', () => onPick(id));
            els.modeButtons.append(button);
        }
    }
    for (const button of els.modeButtons.querySelectorAll('button')) {
        button.disabled = !editable;
        button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
    }
}

function renderSettings(state, me, actions) {
    const editable = Boolean(me?.isHost);
    const mode = state.settings.mode ?? 'custom';
    els.settings.hidden = state.status !== 'waiting' && state.status !== 'finished';
    els.turnSecondsSelect.value = String(state.settings.turnSeconds);
    els.turnSecondsSelect.disabled = !editable;
    els.botLevelSelect.value = state.settings.botLevel;
    els.botLevelSelect.disabled = !editable;
    els.privateCheckbox.checked = state.settings.private;
    els.privateCheckbox.disabled = !editable;
    renderModeButtons(mode, editable, actions.setMode);
    renderRuleToggles(state.settings.rules, editable, actions.setRules);
    const who = editable ? 'Only you can change these.' : 'Only the host can change these.';
    els.settingsSummary.textContent = mode === 'custom' ? `Custom table. ${who}` : `${modeInfo(mode).name} table. ${who}`;
}

function renderChips(state) {
    els.ruleChips.replaceChildren();
    for (const [key, on] of Object.entries(state.settings.rules)) {
        if (on) els.ruleChips.append(cell('span', RULE_INFO[key].chip, 'chip'));
    }
    const rules = state.settings.rules;
    const reversible = rules.nines || rules.jokers;
    els.direction.hidden = !(reversible && (state.status === 'playing' || state.status === 'swapping'));
    if (!els.direction.hidden) {
        els.direction.replaceChildren(
            cell('span', state.direction === 1 ? '↻' : '↺', 'arrow'),
            cell('span', state.direction === 1 ? 'clockwise' : 'reversed'),
        );
        els.direction.classList.toggle('reversed', state.direction === -1);
    }
}

/** Who plays next, in order, starting from the player on turn. Only worth showing with three or more still in. */
function renderOrderRail(state) {
    const active = state.players.filter((p) => p.inGame && !p.finished);
    const show = state.status === 'playing' && active.length >= 3 && state.currentPlayerId;
    els.orderRail.hidden = !show;
    if (!show) return;
    const seq = state.direction === 1 ? active : [...active].reverse();
    const start = Math.max(0, seq.findIndex((p) => p.id === state.currentPlayerId));
    const order = [...seq.slice(start), ...seq.slice(0, start)];
    els.orderRail.replaceChildren(cell('span', 'Order', 'rail-label'));
    order.forEach((player, i) => {
        if (i > 0) els.orderRail.append(cell('span', '›', 'rail-arrow'));
        const seat = document.createElement('span');
        seat.className = `rail-seat c${player.color}${i === 0 ? ' now' : ''}`;
        seat.title = i === 0 ? `${player.name} (now)` : player.name;
        seat.append(avatarNode(player.avatar));
        els.orderRail.append(seat);
    });
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
    els.turnBar.classList.toggle('mine', state.status === 'playing' && state.isMyTurn);
}

function renderReactions(emojis, onReact) {
    if (els.reactions.childElementCount) return;
    for (const emoji of emojis) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = emoji;
        button.title = `React with ${emoji}`;
        if (!isEmoji(emoji)) button.className = 'phrase';
        button.addEventListener('click', () => onReact(emoji));
        els.reactions.append(button);
    }
}

function renderDeck(count) {
    els.deck.replaceChildren();
    if (!count) {
        els.deck.append(slot('Deck is empty'));
        return;
    }
    // The stack looks thicker while the deck is full.
    const layers = Math.min(4, 1 + Math.floor(count / 12));
    for (let depth = layers - 1; depth >= 1; depth--) {
        const under = cardBack({ label: 'Deck' });
        under.classList.add('under');
        under.setAttribute('aria-hidden', 'true');
        under.style.setProperty('--d', String(depth));
        els.deck.append(under);
    }
    els.deck.append(cardBack({ label: `${count} cards in deck` }), countBadge(count));
}

const seatOf = (playerId) => (playerId ? els.room.querySelector(`.player[data-player-id="${CSS.escape(playerId)}"]`) : null);

function centerOf(el) {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

const clamp = (n, limit = 420) => Math.max(-limit, Math.min(limit, n));

function renderPile(state, origin) {
    const previousTop = els.pile.querySelector('.card.top')?.dataset.key ?? null;
    const topEl = state.pile.top ? cardElement(state.pile.top) : slot('Pile is empty');
    topEl.classList.add('top');
    if (state.pile.top && cardKey(state.pile.top) !== previousTop) {
        // The new top card lands from the direction of whoever played it.
        topEl.classList.add('fresh');
        const pile = centerOf(els.pile);
        if (origin && pile) {
            topEl.style.setProperty('--fx', `${Math.round(clamp(origin.x - pile.x))}px`);
            topEl.style.setProperty('--fy', `${Math.round(clamp(origin.y - pile.y))}px`);
        }
    }
    const reveal = els.pile.querySelector('.reveal');
    els.pile.replaceChildren(topEl);
    if (reveal) els.pile.append(reveal);
    const recent = state.pile.recent ?? [];
    recent.forEach((card, i) => {
        const under = cardElement(card);
        under.classList.add('under');
        under.setAttribute('aria-hidden', 'true');
        under.style.setProperty('--r', `${(i - recent.length) * 6}deg`);
        under.style.setProperty('--d', String(recent.length - i));
        els.pile.append(under);
    });
    if (state.pile.count) els.pile.append(countBadge(state.pile.count));
}

const RUN_WORDS = { 2: 'two', 3: 'three' };

/** `mover` is the player whose action produced this state, so the pile card can arrive from their seat. */
export function renderRoom(state, actions, choice, { mover = null } = {}) {
    const origin = centerOf(mover === state.me ? els.me.querySelector('.hand') ?? els.me : seatOf(mover));
    els.roomCode.textContent = state.roomId;
    els.playerCount.textContent = `${state.players.length}/${state.maxPlayers} players`;
    const mode = state.settings.mode ?? 'custom';
    els.roomMode.textContent = modeInfo(mode).name;
    els.roomMode.className = `badge mode mode-${mode}`;

    const me = state.players.find((p) => p.id === state.me);
    const canKick = Boolean(me?.isHost);
    els.opponents.replaceChildren(...state.players.filter((p) => p.id !== state.me).map((p) => opponentPanel(p, state, actions, canKick)));
    els.me.replaceChildren(...(me ? [myPanel(me, state, actions, choice)] : []));
    lastCurrent = state.currentPlayerId;

    renderDeck(state.deckCount);
    renderPile(state, origin);
    const info = [];
    if (state.pile.topRun >= 2) info.push(`${RUN_WORDS[state.pile.topRun] ?? state.pile.topRun} ${state.pile.top.value}s on top`);
    if (state.pile.top && state.pile.effectiveTop && cardKey(state.pile.effectiveTop) !== cardKey(state.pile.top)) {
        info.push(`beat ${cardLabel(state.pile.effectiveTop)} underneath`);
    } else if (state.pile.top && !state.pile.effectiveTop) {
        info.push('see-through: anything goes');
    }
    els.pileInfo.textContent = info.join(' · ');

    renderChips(state);
    renderOrderRail(state);
    renderSettings(state, me, actions);
    renderButtons(state, me, choice);
    renderReactions(state.reactions ?? [], actions.react);
}

/** `info` is `{ remainingMs, totalMs, mine }`, or null to hide the bar. */
export function renderCountdown(info) {
    if (!info) {
        els.countdown.hidden = true;
        document.documentElement.style.setProperty('--progress', '1');
        return;
    }
    const { remainingMs, totalMs, mine } = info;
    const fraction = Math.max(0, Math.min(1, remainingMs / totalMs));
    els.countdown.hidden = false;
    els.countdown.classList.toggle('mine', mine);
    els.countdown.classList.toggle('warn', remainingMs <= 10_000);
    els.countdownFill.style.width = `${fraction * 100}%`;
    els.countdownTime.textContent = `${Math.ceil(remainingMs / 1000)}s`;
    document.documentElement.style.setProperty('--progress', fraction.toFixed(3));
}

// ----- Effects -----

/** Stagger the cards in after a deal. */
export function dealEffect() {
    els.table.classList.remove('dealing');
    void els.table.offsetWidth; // restart the animation
    els.table.classList.add('dealing');
    setTimeout(() => els.table.classList.remove('dealing'), 1400);
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

/** A face-down card turning over on the pile. */
export function revealEffect(card) {
    const el = cardElement(card);
    el.classList.add('reveal');
    els.pile.append(el);
    setTimeout(() => el.remove(), 1000);
}

/**
 * Card backs glide from one spot on the table to another, using the Web
 * Animations API so only transforms change. Skipped under reduced motion.
 */
function fly(fromEl, toEl, count = 1) {
    if (reduceMotion() || !fromEl || !toEl) return;
    const table = els.table.getBoundingClientRect();
    const from = fromEl.getBoundingClientRect();
    const to = toEl.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    for (let i = 0; i < Math.min(count, 4); i++) {
        const ghost = cardBack({ label: 'card' });
        ghost.classList.add('ghost');
        ghost.setAttribute('aria-hidden', 'true');
        ghost.style.left = `${from.left - table.left - els.table.clientLeft}px`;
        ghost.style.top = `${from.top - table.top - els.table.clientTop}px`;
        ghost.style.width = `${from.width}px`;
        ghost.style.height = `${from.height}px`;
        els.table.append(ghost);
        const animation = ghost.animate([
            { transform: 'translate(0, 0) rotate(0deg)', opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) rotate(${(i - 1) * 8}deg)`, opacity: 0.9 },
        ], { duration: 460, delay: i * 70, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)', fill: 'forwards' });
        animation.onfinish = () => ghost.remove();
        setTimeout(() => ghost.remove(), 1200);
    }
}

/** The pile slides over to whoever picked it up. Call before the new state is rendered. */
export function pickUpEffect(playerId, count = 1, isMe = false) {
    const seat = seatOf(playerId);
    const target = isMe ? els.me.querySelector('.hand') ?? seat : seat?.querySelector('.hand-stack') ?? seat;
    fly(els.pile.querySelector('.card') ?? els.pile, target, Math.min(4, Math.max(1, Math.ceil(count / 3))));
}

/** Float an emoji or a phrase up from a player's seat. */
export function showReaction(playerId, text) {
    const panel = seatOf(playerId);
    if (!panel) return;
    const el = document.createElement('span');
    el.className = isEmoji(text) ? 'reaction-float' : 'reaction-float phrase';
    el.textContent = text;
    panel.append(el);
    setTimeout(() => el.remove(), 1700);
}

export function spinDirection() {
    els.direction.classList.remove('spin');
    void els.direction.offsetWidth;
    els.direction.classList.add('spin');
}

// ----- Round summary -----

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣'];

/**
 * The end-of-round card: finishing order, the shithead, a few numbers, the
 * session so far, and confetti for everyone but the loser.
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
        li.style.setProperty('--i', String(i));
        const last = i === order.length - 1 && state.endReason === 'completed';
        const pickups = state.stats?.pickups?.[id] ?? 0;
        li.append(
            cell('span', last ? '💩' : (MEDALS[i] ?? '·'), 'medal'),
            cell('span', nameOf(id), 'who'),
            cell('span', last ? `last one holding cards · picked up ${pickups}` : i === 0 ? `went out first · picked up ${pickups}` : `safe · picked up ${pickups}`, 'detail'),
        );
        els.overlayOrder.append(li);
    });

    els.overlayStats.replaceChildren();
    let statIndex = order.length;
    const stat = (label, value) => {
        const wrap = document.createElement('div');
        wrap.style.setProperty('--i', String(statIndex++));
        wrap.append(cell('dt', label), cell('dd', value));
        els.overlayStats.append(wrap);
    };
    const stats = state.stats ?? { burns: 0, biggestPickup: null };
    stat('Burns', String(stats.burns));
    stat('Biggest pick-up', stats.biggestPickup ? `${stats.biggestPickup.count} by ${nameOf(stats.biggestPickup.id)}` : 'none');
    stat('Length', duration(state.durationSeconds ?? 0));
    stat('Players', String(state.dealt || order.length));

    const history = state.history ?? [];
    els.overlayHistoryWrap.hidden = history.length < 2;
    els.overlayHistory.replaceChildren();
    history.slice(0, 5).forEach((round, i) => {
        const li = document.createElement('li');
        li.append(
            cell('span', `Round ${history.length - i}`, 'label'),
            cell('span', `${round.winner} out first · ${round.loser} shithead`),
            cell('span', `${round.burns} burns · ${duration(round.durationSeconds)}`, 'label'),
        );
        els.overlayHistory.append(li);
    });

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

export function clearRoom() {
    els.log.replaceChildren();
    els.messages.replaceChildren();
    els.opponents.replaceChildren();
    els.me.replaceChildren();
    els.deck.replaceChildren();
    els.pile.replaceChildren();
    els.pileInfo.textContent = '';
    els.ruleChips.replaceChildren();
    els.direction.hidden = true;
    els.orderRail.hidden = true;
    els.ticker.replaceChildren();
    clearTimeout(toastTimer);
    toastTimer = null;
    lastLog = '';
    lastCurrent = null;
    selectedBefore = new Set();
    els.countdown.hidden = true;
    els.turnBar.classList.remove('mine');
    els.table.classList.remove('dealing');
    for (const ghost of els.table.querySelectorAll('.card.ghost')) ghost.remove();
    hideSummary();
}
