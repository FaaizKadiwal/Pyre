// Card presentation helpers: pure functions that build DOM nodes.

const SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SUIT_ORDER = { clubs: 0, diamonds: 1, spades: 2, hearts: 3 };
// Shithead order: 3 is lowest, ace highest, twos are magic and shown last.
const RANK = Object.fromEntries(
    ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'].map((v, i) => [v, i]),
);
const MAGIC = new Set(['2', '10']);

export function cardKey(card) {
    return `${card.value}-${card.suit}`;
}

export function cardLabel(card) {
    return `${card.value}${SYMBOLS[card.suit]}`;
}

export function sortCards(cards) {
    return [...cards].sort((a, b) => RANK[a.value] - RANK[b.value] || SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit]);
}

function base(tag, classes) {
    const el = document.createElement(tag);
    el.className = ['card', ...classes].join(' ');
    if (tag === 'button') el.type = 'button';
    return el;
}

/**
 * A face-up card. Pass `onSelect` to make it a button. `playable` highlights
 * it, `selected` marks it as part of the current choice, and a button that is
 * neither playable nor selectable is rendered disabled so the reason is visible.
 */
export function cardElement(card, { onSelect = null, playable = false, selected = false, enabled = null, index = null } = {}) {
    const red = card.suit === 'hearts' || card.suit === 'diamonds';
    const el = base(onSelect ? 'button' : 'div', ['face-up', red ? 'red' : 'black', MAGIC.has(card.value) ? 'magic' : '']);
    const label = cardLabel(card);
    el.setAttribute('aria-label', `${card.value} of ${card.suit}`);
    el.dataset.key = cardKey(card);
    if (index !== null) el.style.setProperty('--i', String(index));

    const top = document.createElement('span');
    top.className = 'corner';
    top.textContent = label;
    const pip = document.createElement('span');
    pip.className = 'pip';
    pip.textContent = SYMBOLS[card.suit];
    const bottom = document.createElement('span');
    bottom.className = 'corner bottom';
    bottom.textContent = label;
    el.append(top, pip, bottom);

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
