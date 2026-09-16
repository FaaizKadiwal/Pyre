// Card presentation helpers: pure functions that build DOM nodes.

const SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SUIT_ORDER = { clubs: 0, diamonds: 1, spades: 2, hearts: 3, joker: 4 };
// Shithead order: 3 is lowest, ace highest, the special cards shown last.
const RANK = Object.fromEntries(
    ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER'].map((v, i) => [v, i]),
);
const MAGIC = new Set(['2', '10']);
const COURT = new Set(['J', 'Q', 'K']);

export function isJoker(card) {
    return card.value === 'JOKER';
}

export function cardKey(card) {
    return `${card.value}-${card.suit}`;
}

export function cardLabel(card) {
    return isJoker(card) ? 'Joker' : `${card.value}${SYMBOLS[card.suit]}`;
}

export function sortCards(cards) {
    return [...cards].sort((a, b) => RANK[a.value] - RANK[b.value] || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]);
}

function base(tag, classes) {
    const el = document.createElement(tag);
    el.className = ['card', ...classes].filter(Boolean).join(' ');
    if (tag === 'button') el.type = 'button';
    return el;
}

function span(className, text) {
    const el = document.createElement('span');
    el.className = className;
    el.textContent = text;
    return el;
}

/** The rank over the suit, as printed in the corner of a real card. */
function corner(card, className) {
    const el = document.createElement('span');
    el.className = className;
    if (isJoker(card)) {
        el.append(span('rank', '★'));
    } else {
        el.append(span('rank', card.value), span('suit', SYMBOLS[card.suit]));
    }
    return el;
}

/**
 * A face-up card. Pass `onSelect` to make it a button. `playable` highlights
 * it, `selected` marks it as part of the current choice, and a button that is
 * neither playable nor selectable is rendered disabled so the reason is visible.
 */
export function cardElement(card, { onSelect = null, playable = false, selected = false, enabled = null, index = null } = {}) {
    const joker = isJoker(card);
    const red = card.suit === 'hearts' || card.suit === 'diamonds';
    const kind = joker ? 'joker' : COURT.has(card.value) ? 'court' : card.value === 'A' ? 'ace' : 'num';
    const el = base(onSelect ? 'button' : 'div', ['face-up', joker ? 'joker' : red ? 'red' : 'black', kind, MAGIC.has(card.value) ? 'magic' : '']);
    el.setAttribute('aria-label', joker ? 'Joker' : `${card.value} of ${card.suit}`);
    el.dataset.key = cardKey(card);
    if (index !== null) el.style.setProperty('--i', String(index));

    const pip = document.createElement('span');
    pip.className = 'pip';
    if (joker) {
        pip.textContent = '🃏';
    } else if (kind === 'court') {
        // Court cards carry their letter large, with the suit tucked underneath.
        pip.append(span('letter', card.value), span('small-suit', SYMBOLS[card.suit]));
    } else {
        pip.textContent = SYMBOLS[card.suit];
    }
    el.append(corner(card, 'corner'), pip, corner(card, 'corner bottom'));

    if (onSelect) {
        el.classList.toggle('playable', playable);
        el.classList.toggle('selected', selected);
        el.disabled = !(enabled ?? playable);
        el.setAttribute('aria-pressed', String(selected));
        el.addEventListener('click', () => onSelect(card));
    }
    return el;
}

/** A face-down card. Pass `onSelect` to make it clickable. */
export function cardBack({ onSelect = null, label = 'Face-down card', index = null } = {}) {
    const el = base(onSelect ? 'button' : 'div', ['back']);
    el.setAttribute('aria-label', label);
    if (index !== null) el.style.setProperty('--i', String(index));
    if (onSelect) {
        el.classList.add('playable');
        el.addEventListener('click', onSelect);
    }
    return el;
}

/** An empty outline where a card would go. */
export function slot(label = '') {
    const el = base('div', ['slot']);
    if (label) el.setAttribute('aria-label', label);
    return el;
}

/** A small numeric badge to overlay on a stack. */
export function countBadge(n) {
    const el = document.createElement('span');
    el.className = 'count';
    el.textContent = String(n);
    return el;
}
