import * as logic from './gameLogic.js';

/**
 * Computer players. A bot is an ordinary seat with no socket; the game
 * service asks this module what it would do and plays it after a short pause.
 */

const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dax', 'Esme', 'Fitz', 'Gwen', 'Hugo'];

/** How good a card is to keep face-up for the endgame: magic cards first, then high cards. */
const KEEP_ORDER = ['10', '2', 'A', 'K', 'Q', 'J', '9', '8', '7', '6', '5', '4', '3'];
const strength = (card) => KEEP_ORDER.length - KEEP_ORDER.indexOf(card.value);

/**
 * Swaps that leave the strongest cards face-up, as pairs `[handCard, faceUpCard]`.
 * "Players usually take lower ranking face-up cards into their hands."
 */
function planSwaps({ hand, faceUp }) {
    const ranked = [...hand.map((c) => ({ c, from: 'hand' })), ...faceUp.map((c) => ({ c, from: 'faceUp' }))]
        .sort((a, b) => strength(b.c) - strength(a.c));
    const wantUp = new Set(ranked.slice(0, faceUp.length).map((r) => r.c));
    const fromHand = hand.filter((c) => wantUp.has(c));
    const fromTable = faceUp.filter((c) => !wantUp.has(c));
    return fromHand.map((handCard, i) => [handCard, fromTable[i]]).filter(([, faceUpCard]) => faceUpCard);
}

/**
 * The move the bot makes on its turn:
 *   { type: 'flip', index } | { type: 'pickUp' } | { type: 'play', cards }
 * Tactics, in order: finish four of a kind, shed the lowest plain cards,
 * and only spend magic cards when nothing else beats the pile.
 */
function chooseMove(game, id, random = Math.random) {
    const source = logic.getSource(game, id);
    if (source === 'faceDown') {
        return { type: 'flip', index: Math.floor(random() * game.cards[id].faceDown.length) };
    }
    const legal = logic.legalCards(game, id);
    if (!legal.length) return { type: 'pickUp' };

    const byValue = new Map();
    for (const card of legal) byValue.set(card.value, [...(byValue.get(card.value) ?? []), card]);

    const top = game.pile[game.pile.length - 1];
    if (top && byValue.has(top.value) && logic.topRun(game.pile) + byValue.get(top.value).length >= 4) {
        return { type: 'play', cards: byValue.get(top.value) };
    }

    const plain = [...byValue.keys()]
        .filter((value) => !logic.isMagic({ value }))
        .sort((a, b) => logic.SPEND_ORDER.indexOf(a) - logic.SPEND_ORDER.indexOf(b));
    if (plain.length) return { type: 'play', cards: byValue.get(plain[0]) };

    // Only magic cards can go: burn a fat pile with a ten, otherwise reset with a two.
    if (byValue.has('10') && (game.pile.length >= 4 || !byValue.has('2'))) {
        return { type: 'play', cards: [byValue.get('10')[0]] };
    }
    return { type: 'play', cards: [byValue.get('2')[0]] };
}

/** A little personality: what a bot says about what just happened to it. */
function reactionFor(result) {
    if (result.finished) return '🎉';
    if (result.burn) return '🔥';
    if (result.pickedUp >= 6 || result.count >= 6) return '😩';
    if (result.success === false) return '😱';
    return null;
}

export { BOT_NAMES, planSwaps, chooseMove, reactionFor };
