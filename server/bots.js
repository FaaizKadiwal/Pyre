import * as logic from './gameLogic.js';

/**
 * Computer players. A bot is an ordinary seat with no socket; the game
 * service asks this module what it would do and plays it after a short pause.
 * The same tactics stand in for a human who is disconnected or away.
 */

const BOT_NAMES = ['Ada', 'Bram', 'Cleo', 'Dax', 'Esme', 'Fitz', 'Gwen', 'Hugo'];
const LEVELS = ['easy', 'normal'];

/** How good a card is to keep face-up for the endgame: the special cards first, then high cards. */
const KEEP_ORDER = ['10', '2', 'JOKER', 'A', 'K', 'Q', 'J', '9', '8', '7', '6', '5', '4', '3'];
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
 * `easy` plays any legal card. `normal` finishes four of a kind, sheds the
 * lowest plain cards as a set, and spends the special cards only when nothing
 * else beats the pile.
 */
function chooseMove(game, id, random = Math.random, level = 'normal') {
    const source = logic.getSource(game, id);
    if (source === 'faceDown') {
        return { type: 'flip', index: Math.floor(random() * game.cards[id].faceDown.length) };
    }
    const legal = logic.legalCards(game, id);
    if (!legal.length) return { type: 'pickUp' };

    if (level === 'easy') {
        return { type: 'play', cards: [legal[Math.floor(random() * legal.length)]] };
    }

    const byValue = new Map();
    for (const card of legal) byValue.set(card.value, [...(byValue.get(card.value) ?? []), card]);

    const top = game.pile[game.pile.length - 1];
    if (top && byValue.has(top.value) && logic.topRun(game.pile) + byValue.get(top.value).length >= 4) {
        return { type: 'play', cards: byValue.get(top.value) };
    }

    const special = (value) => value === 'JOKER' || logic.isMagic({ value });
    const plain = [...byValue.keys()]
        .filter((value) => !special(value))
        .sort((a, b) => logic.SPEND_ORDER.indexOf(a) - logic.SPEND_ORDER.indexOf(b));
    if (plain.length) return { type: 'play', cards: byValue.get(plain[0]) };

    // Only special cards can go: burn a fat pile with a ten, reset with a two, otherwise a joker.
    if (byValue.has('10') && (game.pile.length >= 4 || !byValue.has('2'))) {
        return { type: 'play', cards: [byValue.get('10')[0]] };
    }
    if (byValue.has('2')) return { type: 'play', cards: [byValue.get('2')[0]] };
    return { type: 'play', cards: [byValue.get('JOKER')[0]] };
}

/** A little personality: what a bot says about what just happened to it. */
function reactionFor(result) {
    if (result.finished) return '🎉';
    if (result.burn) return '🔥';
    if (result.pickedUp >= 6 || result.count >= 6) return '😩';
    if (result.success === false) return '😱';
    return null;
}

export { BOT_NAMES, LEVELS, planSwaps, chooseMove, reactionFor };
