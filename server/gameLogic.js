/**
 * Pure rules of Shithead, following the basic game as described at
 * https://www.pagat.com/beating/shithead.html, plus the optional house rules
 * that page and Wikipedia list. Nothing here knows about sockets or rooms.
 *
 * A game is a plain object so it can be serialised, inspected and tested:
 *   {
 *     status:    'swapping' | 'playing' | 'finished'
 *     rules:     { threes, sevens, eights, nines, jokers, tensLow }  all booleans
 *     deck:      Card[]      stock, last element is drawn next
 *     pile:      Card[]      discard pile, last element is the top
 *     order:     string[]    player ids in seating order (dealer's left first)
 *     turn:      number      index into `order`
 *     direction: 1 | -1      clockwise or reversed (nines, jokers)
 *     cards:     { [id]: { hand, faceUp, faceDown } }
 *     ready:     string[]    players who finished swapping
 *     finished:  string[]    ids in the order they got rid of all their cards
 *     loser:     string|null the shithead, set when the game completes
 *     endReason: 'completed' | 'abandoned' | null
 *     stats:     { burns, pickups: { [id]: cards }, biggestPickup: { id, count } | null }
 *   }
 *
 * Every mutating function validates the move and returns either
 * `{ error: string }` or `{ ok: true, ...details }`.
 */

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const JOKER = Object.freeze({ suit: 'joker', value: 'JOKER' });

/** Beating order: 3 is lowest, ace highest. Twos and jokers are never compared. */
const RANK = { 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14, 2: 15, JOKER: 16 };
/** "The first 3 dealt ... if need be the first 4, and so on": the order used to find the lowest card. */
const NATURAL_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2', 'JOKER'];
/** What to give up first when a choice is forced: low cards before the special ones. */
const SPEND_ORDER = ['3', '4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A', '10', '2', 'JOKER'];
const MAGIC = new Set(['2', '10']);
const HAND_SIZE = 3;
const TABLE_CARDS = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;

/**
 * House rules, all off in the basic game:
 *  - threes:  a 3 skips the next player (one skip per 3 played)
 *  - sevens:  after a 7 the next card must be 7 or lower (2 and 10 still go)
 *  - eights:  an 8 is transparent: playable on anything, and the card under it must be beaten
 *  - nines:   a 9 reverses the direction of play
 *  - jokers:  two jokers join the deck; playable on anything, transparent, and they reverse direction
 *  - tensLow: a 10 may not be played on a jack, queen, king or ace
 */
const DEFAULT_RULES = Object.freeze({ threes: false, sevens: false, eights: false, nines: false, jokers: false, tensLow: false });
const RULE_KEYS = Object.keys(DEFAULT_RULES);

/** Merge a rules patch onto the defaults, rejecting unknown keys or non-boolean values. */
function normaliseRules(patch, base = DEFAULT_RULES) {
    if (patch === undefined || patch === null) return { ok: true, rules: { ...base } };
    if (typeof patch !== 'object' || Array.isArray(patch)) return { error: 'Rules must be an object of true/false flags' };
    const rules = { ...base };
    for (const [key, value] of Object.entries(patch)) {
        if (!RULE_KEYS.includes(key)) return { error: `Unknown rule: ${key}` };
        if (typeof value !== 'boolean') return { error: `Rule ${key} must be true or false` };
        rules[key] = value;
    }
    return { ok: true, rules };
}

function createDeck(rules = DEFAULT_RULES) {
    const deck = [];
    for (const suit of SUITS) {
        for (const value of VALUES) {
            deck.push({ suit, value });
        }
    }
    if (rules.jokers) deck.push({ ...JOKER }, { ...JOKER });
    return deck;
}

/** Fisher-Yates shuffle, in place. `random` is injectable for deterministic tests. */
function shuffle(deck, random = Math.random) {
    for (let i = deck.length - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [deck[i], deck[j]] = [deck[j], deck[i]];
    }
    return deck;
}

function isJoker(card) {
    return Boolean(card) && card.suit === 'joker' && card.value === 'JOKER';
}

function isCard(value) {
    return Boolean(value)
        && typeof value === 'object'
        && ((SUITS.includes(value.suit) && VALUES.includes(value.value)) || isJoker(value));
}

function sameCard(a, b) {
    return a.suit === b.suit && a.value === b.value;
}

function isMagic(card) {
    return MAGIC.has(card.value);
}

/** One card, or several cards of the same rank. */
function isSet(cards) {
    return Array.isArray(cards)
        && cards.length > 0
        && cards.every(isCard)
        && cards.every((c) => c.value === cards[0].value);
}

/** Transparent cards are looked through: jokers always, eights under that house rule. */
function isTransparent(card, rules = DEFAULT_RULES) {
    return isJoker(card) || (Boolean(rules.eights) && card.value === '8');
}

/** The card that actually has to be beaten, or null when the pile is empty or all transparent. */
function effectiveTop(pile, rules = DEFAULT_RULES) {
    for (let i = pile.length - 1; i >= 0; i--) {
        if (!isTransparent(pile[i], rules)) return pile[i];
    }
    return null;
}

/**
 * May `card` go on the pile?
 *  - An empty pile takes anything.
 *  - Twos, jokers and (under the house rule) eights may be played on anything.
 *  - Tens may be played on anything, unless `tensLow` keeps them off J, Q, K and A.
 *  - Anything may be played on a two.
 *  - After a 7 with `sevens` on, the card must be 7 or lower.
 *  - Otherwise the card must be of equal or higher rank than the effective top. Suits never matter.
 */
function canPlayOn(card, pile, rules = DEFAULT_RULES) {
    if (isJoker(card) || card.value === '2') return true;
    if (rules.eights && card.value === '8') return true;
    const top = effectiveTop(pile, rules);
    if (card.value === '10') return !rules.tensLow || !top || top.value === '2' || RANK[top.value] <= 10;
    if (!top || top.value === '2') return true;
    if (rules.sevens && top.value === '7') return RANK[card.value] <= 7;
    return RANK[card.value] >= RANK[top.value];
}

function isValidPlay(card, pile, rules = DEFAULT_RULES) {
    return canPlayOn(card, pile, rules);
}

/** The lowest card in `cards` by the given order, or null. */
function lowestValue(cards, order = SPEND_ORDER) {
    let best = -1;
    for (const card of cards) {
        const i = order.indexOf(card.value);
        if (best === -1 || i < best) best = i;
    }
    return best === -1 ? null : order[best];
}

/**
 * "The first player is the person who receives the first 3 dealt face-up. If
 * no 3 is face-up, the first person to call a three in a hand is the first
 * player ... then the same procedure is followed for the first 4, and so on."
 * Face-up cards were dealt one at a time around the table, so round-major order
 * reproduces "the first 3 dealt".
 */
function firstPlayerIndex(order, cards) {
    for (const value of NATURAL_ORDER) {
        for (let round = 0; round < TABLE_CARDS; round++) {
            for (let i = 0; i < order.length; i++) {
                if (cards[order[i]].faceUp[round].value === value) return i;
            }
        }
        for (let i = 0; i < order.length; i++) {
            if (cards[order[i]].hand.some((c) => c.value === value)) return i;
        }
    }
    return 0;
}

/** Deal one card at a time around the table: three face-down, three face-up, three in hand. */
function createGame(playerIds, random = Math.random, rules = DEFAULT_RULES) {
    if (playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
        throw new RangeError(`Need between ${MIN_PLAYERS} and ${MAX_PLAYERS} players`);
    }
    const deck = shuffle(createDeck(rules), random);
    const cards = Object.fromEntries(playerIds.map((id) => [id, { faceDown: [], faceUp: [], hand: [] }]));
    for (const pileName of ['faceDown', 'faceUp', 'hand']) {
        for (let round = 0; round < TABLE_CARDS; round++) {
            for (const id of playerIds) cards[id][pileName].push(deck.pop());
        }
    }
    const order = [...playerIds];
    return {
        status: 'swapping',
        rules: { ...DEFAULT_RULES, ...rules },
        deck,
        pile: [],
        order,
        dealt: order.length,
        turn: firstPlayerIndex(order, cards),
        direction: 1,
        cards,
        ready: [],
        finished: [],
        loser: null,
        endReason: null,
        stats: { burns: 0, pickups: {}, biggestPickup: null },
    };
}

function recordPickup(game, id, count) {
    game.stats.pickups[id] = (game.stats.pickups[id] ?? 0) + count;
    if (!game.stats.biggestPickup || count > game.stats.biggestPickup.count) {
        game.stats.biggestPickup = { id, count };
    }
}

// ----- Before play: swapping -----

/** "Before play each player may exchange any number of cards from the hand with her face-up cards." */
function swapCards(game, id, handCard, faceUpCard) {
    if (game.status !== 'swapping') return { error: 'Cards can only be swapped before play starts' };
    const c = game.cards[id];
    if (!c) return { error: 'You are not in this game' };
    if (game.ready.includes(id)) return { error: 'You have already pressed Ready' };
    if (!isCard(handCard) || !isCard(faceUpCard)) return { error: 'Invalid card' };
    const h = c.hand.findIndex((x) => sameCard(x, handCard));
    const f = c.faceUp.findIndex((x) => sameCard(x, faceUpCard));
    if (h === -1 || f === -1) return { error: 'You do not hold those cards' };
    [c.hand[h], c.faceUp[f]] = [c.faceUp[f], c.hand[h]];
    return { ok: true };
}

function beginPlay(game) {
    if (game.status !== 'swapping') return { error: 'Play has already begun' };
    game.status = 'playing';
    return { ok: true };
}

function allReady(game) {
    return game.order.every((id) => game.ready.includes(id));
}

/** Mark a player ready; play begins once everyone is. */
function setReady(game, id) {
    if (game.status !== 'swapping') return { error: 'Play has already begun' };
    if (!game.cards[id]) return { error: 'You are not in this game' };
    if (!game.ready.includes(id)) game.ready.push(id);
    const started = allReady(game);
    if (started) beginPlay(game);
    return { ok: true, started };
}

// ----- During play -----

function currentPlayerId(game) {
    return game.status === 'playing' ? game.order[game.turn] : null;
}

function hasFinished(game, id) {
    const c = game.cards[id];
    return Boolean(c) && c.hand.length === 0 && c.faceUp.length === 0 && c.faceDown.length === 0;
}

/**
 * Where the player must play from right now. "As long as you begin your turn
 * with cards in your hand ... you can only play from the cards in your hand."
 */
function getSource(game, id) {
    const c = game.cards[id];
    if (!c) return null;
    if (c.hand.length) return 'hand';
    if (c.faceUp.length) return 'faceUp';
    if (c.faceDown.length) return 'faceDown';
    return null;
}

function legalCards(game, id) {
    const source = getSource(game, id);
    if (source !== 'hand' && source !== 'faceUp') return [];
    return game.cards[id][source].filter((card) => isValidPlay(card, game.pile, game.rules));
}

/** Picking up is always allowed while holding visible cards and the pile is not empty. */
function canPickUp(game, id) {
    if (currentPlayerId(game) !== id || game.pile.length === 0) return false;
    const source = getSource(game, id);
    return source === 'hand' || source === 'faceUp';
}

/** Picking up is compulsory when nothing can be played. */
function mustPickUp(game, id) {
    return canPickUp(game, id) && legalCards(game, id).length === 0;
}

/** How many equal cards sit on top of the pile. */
function topRun(pile) {
    if (pile.length === 0) return 0;
    const value = pile[pile.length - 1].value;
    let run = 0;
    for (let i = pile.length - 1; i >= 0 && pile[i].value === value; i--) run++;
    return run;
}

function activePlayers(game) {
    return game.order.filter((id) => !game.finished.includes(id));
}

function endIfOver(game, reason) {
    const active = activePlayers(game);
    if (active.length > 1) return false;
    game.status = 'finished';
    game.endReason = reason;
    game.loser = reason === 'completed' ? (active[0] ?? null) : null;
    return true;
}

/**
 * Hand the turn to the next active player in the current direction, passing
 * over `skip` further players. Returns the ids that were skipped.
 */
function advanceTurn(game, skip = 0) {
    if (endIfOver(game, 'completed')) return [];
    const skipped = [];
    let toSkip = skip;
    for (;;) {
        game.turn = (game.turn + game.direction + game.order.length) % game.order.length;
        const id = game.order[game.turn];
        if (game.finished.includes(id)) continue;
        if (toSkip > 0) {
            skipped.push(id);
            toSkip -= 1;
            continue;
        }
        return skipped;
    }
}

/** If the current seat is finished (after a removal), move on to someone who is not. */
function settleTurnPointer(game) {
    if (game.finished.includes(game.order[game.turn])) advanceTurn(game);
}

/** "If after playing you have fewer than three cards in your hand, you must immediately replenish." */
function refillHand(game, id) {
    const c = game.cards[id];
    while (c.hand.length < HAND_SIZE && game.deck.length) {
        c.hand.push(game.deck.pop());
    }
}

/**
 * The consequences of cards landing on the pile: a ten or a completed four of
 * a kind burns the pile and the same player goes again; nines and jokers may
 * reverse direction; threes may skip; otherwise the turn passes.
 */
function settleAfterPlay(game, id, played) {
    const value = played[0].value;
    let burn = null;
    if (value === '10') burn = 'ten';
    else if (topRun(game.pile) >= 4) burn = 'four';

    const effects = { reversed: false, skipped: [] };
    if ((game.rules.nines && value === '9') || isJoker(played[0])) {
        if (played.length % 2 === 1) {
            game.direction *= -1;
            effects.reversed = true;
        }
    }
    const skips = game.rules.threes && value === '3' ? played.length : 0;

    if (burn) {
        game.pile = [];
        game.stats.burns += 1;
    }

    refillHand(game, id);

    const finished = hasFinished(game, id);
    if (finished) game.finished.push(id);

    if (endIfOver(game, 'completed')) {
        return { burn, finished, gameOver: true, playAgain: false, effects };
    }
    if (burn && !finished) {
        return { burn, finished, gameOver: false, playAgain: true, effects };
    }
    effects.skipped = advanceTurn(game, skips);
    return { burn, finished, gameOver: false, playAgain: false, effects };
}

function checkTurn(game, id) {
    if (game.status !== 'playing') return 'The game is not in progress';
    if (currentPlayerId(game) !== id) return 'It is not your turn';
    return null;
}

/** Play one card or a set of equal cards from the hand, or from the face-up cards once the hand is empty. */
function playCards(game, id, cards) {
    const turnError = checkTurn(game, id);
    if (turnError) return { error: turnError };
    if (!isSet(cards)) return { error: 'Play one card, or several cards of the same rank' };

    const source = getSource(game, id);
    if (source !== 'hand' && source !== 'faceUp') {
        return { error: 'You must flip one of your face-down cards' };
    }
    const from = game.cards[id][source];
    const indexes = [];
    for (const card of cards) {
        const i = from.findIndex((c, index) => !indexes.includes(index) && sameCard(c, card));
        if (i === -1) return { error: 'You do not hold those cards' };
        indexes.push(i);
    }
    if (!isValidPlay(cards[0], game.pile, game.rules)) return { error: 'Those cards cannot be played on the pile' };

    const played = indexes.sort((a, b) => b - a).map((i) => from.splice(i, 1)[0]).reverse();
    game.pile.push(...played);
    return { ok: true, cards: played, source, ...settleAfterPlay(game, id, played) };
}

/** Blind play: flip a face-down card. If it is unplayable, the pile and that card go into the hand. */
function playFaceDown(game, id, index) {
    const turnError = checkTurn(game, id);
    if (turnError) return { error: turnError };
    if (getSource(game, id) !== 'faceDown') return { error: 'You still have visible cards to play' };

    const faceDown = game.cards[id].faceDown;
    if (!Number.isInteger(index) || index < 0 || index >= faceDown.length) {
        return { error: 'Invalid face-down card' };
    }
    const [card] = faceDown.splice(index, 1);

    if (isValidPlay(card, game.pile, game.rules)) {
        game.pile.push(card);
        return { ok: true, card, source: 'faceDown', success: true, ...settleAfterPlay(game, id, [card]) };
    }

    const pickedUp = game.pile.length + 1;
    game.cards[id].hand.push(...game.pile, card);
    game.pile = [];
    recordPickup(game, id, pickedUp);
    advanceTurn(game);
    return { ok: true, card, source: 'faceDown', success: false, pickedUp, gameOver: false };
}

/**
 * Take the whole pile into the hand. While playing face-up cards, one face-up
 * card (the player's choice, else the lowest) is added to the pile first and
 * comes along.
 */
function pickUpPile(game, id, faceUpCard = null) {
    const turnError = checkTurn(game, id);
    if (turnError) return { error: turnError };
    if (!canPickUp(game, id)) {
        return { error: game.pile.length ? 'You must flip one of your face-down cards' : 'The pile is empty' };
    }
    const c = game.cards[id];
    let added = null;
    if (getSource(game, id) === 'faceUp') {
        const index = faceUpCard
            ? c.faceUp.findIndex((x) => isCard(faceUpCard) && sameCard(x, faceUpCard))
            : c.faceUp.findIndex((x) => x.value === lowestValue(c.faceUp));
        if (index === -1) return { error: 'Choose one of your face-up cards to pick up with' };
        [added] = c.faceUp.splice(index, 1);
    }
    const count = game.pile.length + (added ? 1 : 0);
    c.hand.push(...game.pile);
    if (added) c.hand.push(added);
    game.pile = [];
    recordPickup(game, id, count);
    advanceTurn(game);
    return { ok: true, count, added };
}

/** Remove a player who left, keeping the turn pointer on the right player and the swap phase consistent. */
function removePlayer(game, id) {
    const index = game.order.indexOf(id);
    if (index === -1) return;

    const wasCurrent = index === game.turn;
    game.order.splice(index, 1);
    delete game.cards[id];
    game.finished = game.finished.filter((f) => f !== id);
    game.ready = game.ready.filter((r) => r !== id);

    if (game.order.length < MIN_PLAYERS) {
        game.status = 'finished';
        game.endReason = 'abandoned';
        game.loser = null;
        return;
    }
    if (index < game.turn) {
        game.turn -= 1;
    } else if (wasCurrent) {
        // The seat after the departed player, in the current direction, is up.
        game.turn = game.direction === 1 ? game.turn % game.order.length : (game.turn - 1 + game.order.length) % game.order.length;
    }
    if (game.status === 'swapping' && allReady(game)) {
        beginPlay(game);
    } else if (game.status === 'playing' && !endIfOver(game, 'abandoned')) {
        settleTurnPointer(game);
    }
}

export {
    SUITS,
    VALUES,
    JOKER,
    RANK,
    NATURAL_ORDER,
    SPEND_ORDER,
    HAND_SIZE,
    TABLE_CARDS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    DEFAULT_RULES,
    RULE_KEYS,
    normaliseRules,
    createDeck,
    shuffle,
    isJoker,
    isCard,
    sameCard,
    isMagic,
    isSet,
    isTransparent,
    effectiveTop,
    canPlayOn,
    isValidPlay,
    lowestValue,
    createGame,
    swapCards,
    beginPlay,
    allReady,
    setReady,
    currentPlayerId,
    hasFinished,
    getSource,
    legalCards,
    canPickUp,
    mustPickUp,
    topRun,
    playCards,
    playFaceDown,
    pickUpPile,
    removePlayer,
};
