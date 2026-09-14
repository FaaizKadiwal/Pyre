// Everything that touches the DOM. Render functions take state in and build
// nodes with textContent/createElement, never innerHTML with user data.

import { cardBack, cardElement, cardKey, countBadge, slot, sortCards } from './cards.js';

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
    roomCode: $('room-code'),
    playerCount: $('player-count'),
    leaveButton: $('leave-room'),
    opponents: $('opponents'),
    deck: $('deck'),
    pile: $('pile'),
    me: $('me'),
    status: $('status'),
    startButton: $('start-game'),
    pickUpButton: $('pick-up'),
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

export function addLog(text) {
    const item = document.createElement('li');
    item.textContent = text;
    els.log.prepend(item);
    while (els.log.children.length > LOG_LIMIT) els.log.lastChild.remove();
}

export function addChat({ name, message, mine }) {
    const el = document.createElement('div');
    el.className = mine ? 'msg mine' : 'msg';
    const who = document.createElement('span');
    who.className = 'who';
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
}

export function renderRoomList(rooms, onJoin) {
    els.roomList.replaceChildren();
    if (rooms.length === 0) {
        const li = document.createElement('li');
        li.className = 'empty';
        li.textContent = 'No open rooms. Create one!';
        els.roomList.append(li);
        return;
    }
    for (const room of rooms) {
        const li = document.createElement('li');
        const info = document.createElement('span');
        const code = document.createElement('span');
        code.className = 'code';
        code.textContent = room.id;
        const meta = document.createElement('span');
        meta.className = 'meta';
        meta.textContent = ` · ${room.host}'s room · ${room.playerCount}/${room.maxPlayers}`;
        info.append(code, meta);
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = 'Join';
        button.addEventListener('click', () => onJoin(room.id));
        li.append(info, button);
        els.roomList.append(li);
    }
}

function badge(text, kind) {
    const el = document.createElement('span');
    el.className = `badge ${kind}`;
    el.textContent = text;
    return el;
}

function nameLine(player, isMe) {
    const line = document.createElement('div');
    line.className = 'name';
    const name = document.createElement('span');
    name.textContent = isMe ? `${player.name} (you)` : player.name;
    line.append(name);
    if (player.isHost) line.append(badge('Host', 'host'));
    if (player.finished) line.append(badge('Out', 'out'));
    if (!player.connected) line.append(badge('Offline', 'offline'));
    return line;
}

function playerClasses(player) {
    return ['player', player.isCurrent && 'current', player.finished && 'finished', !player.connected && 'offline']
        .filter(Boolean)
        .join(' ');
}

/** Face-down cards with the face-up cards laid over them. */
function tableCards(player, { canFlip = false, onFlip, playableKeys, onPlayFaceUp } = {}) {
    const wrap = document.createElement('div');
    wrap.className = 'table-cards';
    const slots = Math.max(player.faceDownCount, player.faceUp.length);
    for (let i = 0; i < slots; i++) {
        const cell = document.createElement('div');
        cell.className = 'table-slot';
        if (i < player.faceDownCount) {
            cell.append(cardBack(canFlip ? { onSelect: () => onFlip(i), label: `Flip face-down card ${i + 1}` } : {}));
        }
        const up = player.faceUp[i];
        if (up) {
            cell.append(onPlayFaceUp
                ? cardElement(up, { onSelect: onPlayFaceUp, playable: playableKeys.has(cardKey(up)) })
                : cardElement(up));
        }
        wrap.append(cell);
    }
    return wrap;
}

function opponentPanel(player, state) {
    const panel = document.createElement('div');
    panel.className = playerClasses(player);
    panel.append(nameLine(player, false));
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

function myPanel(me, state, actions) {
    const panel = document.createElement('div');
    panel.className = `${playerClasses(me)} me`;
    panel.append(nameLine(me, true));
    if (!me.inGame) return panel;

    const playableKeys = new Set(state.legalCards.map(cardKey));
    const active = state.isMyTurn && state.status === 'playing';

    const table = document.createElement('div');
    table.className = 'row';
    table.append(tableCards(me, {
        canFlip: active && state.source === 'faceDown',
        onFlip: actions.playFaceDown,
        playableKeys,
        onPlayFaceUp: active && state.source === 'faceUp' ? actions.playCard : null,
    }));
    panel.append(table);

    const hand = document.createElement('div');
    hand.className = 'hand';
    hand.setAttribute('aria-label', 'Your hand');
    for (const card of sortCards(state.hand)) {
        hand.append(active && state.source === 'hand'
            ? cardElement(card, { onSelect: actions.playCard, playable: playableKeys.has(cardKey(card)) })
            : cardElement(card));
    }
    panel.append(hand);
    return panel;
}

export function renderRoom(state, actions) {
    els.roomCode.textContent = state.roomId;
    els.playerCount.textContent = `${state.players.length}/${state.maxPlayers} players`;

    const me = state.players.find((p) => p.id === state.me);
    els.opponents.replaceChildren(...state.players.filter((p) => p.id !== state.me).map((p) => opponentPanel(p, state)));
    els.me.replaceChildren(...(me ? [myPanel(me, state, actions)] : []));

    els.deck.replaceChildren(state.deckCount ? cardBack({ label: `${state.deckCount} cards in deck` }) : slot('Deck is empty'));
    if (state.deckCount) els.deck.append(countBadge(state.deckCount));

    els.pile.replaceChildren(state.pile.top ? cardElement(state.pile.top) : slot('Pile is empty'));
    if (state.pile.count) els.pile.append(countBadge(state.pile.count));

    const canStart = Boolean(me?.isHost) && state.status !== 'playing';
    els.startButton.hidden = !canStart;
    els.startButton.disabled = state.players.length < state.minPlayers;
    els.startButton.textContent = state.status === 'finished' ? 'Play again' : 'Start game';
    els.pickUpButton.hidden = !state.canPickUp;
}
