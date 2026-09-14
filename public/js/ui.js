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
    soundToggle: $('sound-toggle'),
    copyInviteButton: $('copy-invite'),
    leaveButton: $('leave-room'),
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
    readyButton: $('ready'),
    beginButton: $('begin-play'),
    playButton: $('play-selected'),
    pickUpButton: $('pick-up'),
    countdown: $('countdown'),
    countdownFill: $('countdown').querySelector('.fill'),
    countdownTime: $('countdown').querySelector('.time'),
    log: $('log'),
    messages: $('messages'),
    chatForm: $('chat-form'),
    messageInput: $('message-input'),
};

const LOG_LIMIT = 40;

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
        const first = game.players[0]?.name ?? 'Someone';
        const last = game.players[game.players.length - 1]?.name ?? 'someone';
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
        const li = document.createElement('li');
        const info = document.createElement('span');
        info.append(cell('span', room.id, 'code'), cell('span', ` · ${room.host}'s room · ${room.playerCount}/${room.maxPlayers}`, 'meta'));
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Join';
        button.addEventListener('click', () => onJoin(room.id));
        li.append(info, button);
        els.roomList.append(li);
    }
}

function badge(text, kind) {
    return cell('span', text, `badge ${kind}`);
}

function nameLine(player, { isMe, canKick, onKick, status }) {
    const line = document.createElement('div');
    line.className = 'name';
    const dot = document.createElement('span');
    dot.className = `dot c${player.color}`;
    line.append(dot, cell('span', isMe ? `${player.name} (you)` : player.name));
    if (player.isHost) line.append(badge('Host', 'host'));
    if (player.wins > 0) line.append(badge(`🏆 ${player.wins}`, 'wins'));
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
            slotEl.append(cardBack(canFlip ? { onSelect: () => onFlip(i), label: `Flip face-down card ${i + 1}` } : {}));
        }
        const up = player.faceUp[i];
        if (up) {
            slotEl.append(faceUpOptions
                ? cardElement(up, {
                    onSelect: faceUpOptions.onSelect,
                    playable: faceUpOptions.isPlayable(up),
                    selected: faceUpOptions.isSelected(up),
                    enabled: faceUpOptions.isEnabled(up),
                })
                : cardElement(up));
        }
        wrap.append(slotEl);
    }
    return wrap;
}

function opponentPanel(player, state, actions, canKick) {
    const panel = document.createElement('div');
    panel.className = playerClasses(player);
    panel.append(nameLine(player, { isMe: false, canKick, onKick: actions.kick, status: state.status }));
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
    const panel = document.createElement('div');
    panel.className = `${playerClasses(me)} me`;
    panel.append(nameLine(me, { isMe: true, canKick: false, status: state.status }));
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
    for (const card of sortCards(state.hand)) {
        if (swapping) {
            hand.append(cardElement(card, {
                onSelect: (c) => actions.swapPick(c, 'hand'),
                selected: cardKey(card) === pickedKey,
                enabled: true,
            }));
        } else if (active && state.source === 'hand') {
            hand.append(cardElement(card, {
                onSelect: actions.select,
                playable: legalKeys.has(cardKey(card)),
                selected: selectedKeys.has(cardKey(card)),
            }));
        } else {
            hand.append(cardElement(card));
        }
    }
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

    els.pile.replaceChildren(state.pile.top ? cardElement(state.pile.top) : slot('Pile is empty'));
    if (state.pile.count) els.pile.append(countBadge(state.pile.count));
    els.pileInfo.textContent = state.pile.topRun >= 2
        ? `${RUN_WORDS[state.pile.topRun] ?? state.pile.topRun} ${state.pile.top.value}s on top`
        : '';

    renderSettings(state, me);
    renderButtons(state, me, choice);
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
