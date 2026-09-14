// Card presentation helpers: pure functions that build DOM nodes.

const SYMBOLS = { hearts: '♥', diamonds: '♦', clubs: '♣', spades: '♠' };
const SUIT_ORDER = { clubs: 0, diamonds: 1, spades: 2, hearts: 3 };
const RANK = Object.fromEntries(
    ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'].map((v, i) => [v, i]),
);

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
 * A face-up card. Pass `onSelect` to make it a button; `playable` highlights it
 * and a non-playable button is rendered disabled so the reason is visible.
 */
export function cardElement(card, { onSelect = null, playable = false, extraClass = '' } = {}) {
    const red = card.suit === 'hearts' || card.suit === 'diamonds';
    const el = base(onSelect ? 'button' : 'div', ['face-up', red ? 'red' : 'black', extraClass].filter(Boolean));
    const label = cardLabel(card);
    el.setAttribute('aria-label', `${card.value} of ${card.suit}`);
    el.dataset.key = cardKey(card);

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
        el.disabled = !playable;
        el.addEventListener('click', () => onSelect(card));
    }
    return el;
}

/** A face-down card. Pass `onSelect` to make it clickable. */
export function cardBack({ onSelect = null, label = 'Face-down card' } = {}) {
    const el = base(onSelect ? 'button' : 'div', ['back']);
    el.setAttribute('aria-label', label);
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
