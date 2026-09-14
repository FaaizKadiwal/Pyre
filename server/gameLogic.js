/**
 * Pure rules of Shithead, following the basic game as described at
 * https://www.pagat.com/beating/shithead.html. Nothing here knows about
 * sockets or rooms.
 *
 * A game is a plain object so it can be serialised, inspected and tested:
 *   {
 *     status:   'swapping' | 'playing' | 'finished'
 *     deck:     Card[]      stock, last element is drawn next
 *     pile:     Card[]      discard pile, last element is the top
 *     order:    string[]    player ids in turn order (dealer's left first)
 *     turn:     number      index into `order`
 *     cards:    { [id]: { hand, faceUp, faceDown } }
 *     ready:    string[]    players who finished swapping
 *     finished: string[]    ids in the order they got rid of all their cards
 *     loser:    string|null the shithead, set when the game completes
 *     endReason:'completed' | 'abandoned' | null
 *   }
 *
 * Every mutating function validates the move and returns either
 * `{ error: string }` or `{ ok: true, ...details }`.
 */

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

/** Beating order: 3 is lowest, ace highest. Twos are never compared, they are magic. */
const RANK = { 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, 10: 10, J: 11, Q: 12, K: 13, A: 14, 2: 15 };
/** "The first 3 dealt ... if need be the first 4, and so on": the order used to find the lowest card. */
const NATURAL_ORDER = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
/** What to give up first when a choice is forced: low cards before magic cards. */
const SPEND_ORDER = ['3', '4', '5', '6', '7', '8', '9', 'J', 'Q', 'K', 'A', '10', '2'];
const MAGIC = new Set(['2', '10']);
const HAND_SIZE = 3;
const TABLE_CARDS = 3;
const MIN_PLAYERS = 2;
const MAX_PLAYERS = 5;

function createDeck() {
    const deck = [];
    for (const suit of SUITS) {
        for (const value of VALUES) {
            deck.push({ suit, value });
        }
    }
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

function isCard(value) {
    return Boolean(value)
        && typeof value === 'object'
        && SUITS.includes(value.suit)
        && VALUES.includes(value.value);
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

/**
 * May `card` go on top of `top`?
 *  - An empty pile takes anything.
 *  - Twos and tens may be played on anything.
 *  - Anything may be played on a two.
 *  - Otherwise the card must be of equal or higher rank. Suits never matter.
 */
function canPlayOn(card, top) {
    if (!top) return true;
    if (isMagic(card)) return true;
    if (top.value === '2') return true;
    return RANK[card.value] >= RANK[top.value];
}

function isValidPlay(card, pile) {
    return canPlayOn(card, pile[pile.length - 1]);
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
function createGame(playerIds, random = Math.random) {
    if (playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
        throw new RangeError(`Need between ${MIN_PLAYERS} and ${MAX_PLAYERS} players`);
    }
    const deck = shuffle(createDeck(), random);
    const cards = Object.fromEntries(playerIds.map((id) => [id, { faceDown: [], faceUp: [], hand: [] }]));
    for (const pileName of ['faceDown', 'faceUp', 'hand']) {
        for (let round = 0; round < TABLE_CARDS; round++) {
            for (const id of playerIds) cards[id][pileName].push(deck.pop());
        }
    }
    const order = [...playerIds];
    return {
        status: 'swapping',
        deck,
        pile: [],
        order,
        turn: firstPlayerIndex(order, cards),
        cards,
        ready: [],
        finished: [],
        loser: null,
        endReason: null,
    };
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
    return game.cards[id][source].filter((card) => isValidPlay(card, game.pile));
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

function skipFinished(game) {
    while (game.finished.includes(game.order[game.turn])) {
        game.turn = (game.turn + 1) % game.order.length;
    }
}

function endIfOver(game, reason) {
    const active = activePlayers(game);
    if (active.length > 1) return false;
    game.status = 'finished';
    game.endReason = reason;
    game.loser = reason === 'completed' ? (active[0] ?? null) : null;
    return true;
}

function advanceTurn(game) {
    if (endIfOver(game, 'completed')) return;
    game.turn = (game.turn + 1) % game.order.length;
    skipFinished(game);
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
 * a kind burns the pile and the same player goes again; otherwise the turn passes.
 */
function settleAfterPlay(game, id, played) {
    let burn = null;
    if (played[0].value === '10') burn = 'ten';
    else if (topRun(game.pile) >= 4) burn = 'four';
    if (burn) game.pile = [];

    refillHand(game, id);

    const finished = hasFinished(game, id);
    if (finished) game.finished.push(id);

    if (endIfOver(game, 'completed')) {
        return { burn, finished, gameOver: true, playAgain: false };
    }
    if (burn && !finished) {
        return { burn, finished, gameOver: false, playAgain: true };
    }
    advanceTurn(game);
    return { burn, finished, gameOver: false, playAgain: false };
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
    if (!isValidPlay(cards[0], game.pile)) return { error: 'Those cards cannot be played on the pile' };

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

    if (isValidPlay(card, game.pile)) {
        game.pile.push(card);
        return { ok: true, card, source: 'faceDown', success: true, ...settleAfterPlay(game, id, [card]) };
    }

    const pickedUp = game.pile.length + 1;
    game.cards[id].hand.push(...game.pile, card);
    game.pile = [];
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
        game.turn %= game.order.length;
    }
    if (game.status === 'swapping' && allReady(game)) {
        beginPlay(game);
    } else if (game.status === 'playing' && !endIfOver(game, 'abandoned')) {
        skipFinished(game);
    }
}

export {
    SUITS,
    VALUES,
    RANK,
    NATURAL_ORDER,
    SPEND_ORDER,
    HAND_SIZE,
    TABLE_CARDS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    createDeck,
    shuffle,
    isCard,
    sameCard,
    isMagic,
    isSet,
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
