/**
 * Pure game rules. Nothing in this module knows about sockets or rooms.
 *
 * A game is a plain object so it can be serialised, inspected and tested:
 *   {
 *     status:   'playing' | 'finished',
 *     deck:     Card[]                       draw pile, last element is the top
 *     pile:     Card[]                       discard pile, last element is the top
 *     order:    string[]                     player ids in turn order
 *     turn:     number                       index into `order`
 *     cards:    { [id]: { hand, faceUp, faceDown } }
 *     finished: string[]                     ids in the order they emptied their cards
 *     loser:    string | null                set when the game completes normally
 *     endReason:'completed' | 'abandoned' | null
 *   }
 *
 * Every mutating function validates the move and returns either
 * `{ error: string }` or `{ ok: true, ...details }`.
 */

const SUITS = ['hearts', 'diamonds', 'clubs', 'spades'];
const VALUES = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
const RANK = Object.fromEntries(VALUES.map((value, i) => [value, i + 2]));
const POWER_CARDS = new Set(['2', '7', '10']);
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

function isPowerCard(card) {
    return POWER_CARDS.has(card.value);
}

/**
 * Can `card` be placed on the current pile?
 *  - Empty pile: anything goes.
 *  - Power cards (2, 7, 10) can always be played.
 *  - On a 2 (reset): anything goes.
 *  - On a 7: the card must be lower than 7.
 *  - Otherwise: match suit or value.
 */
function isValidPlay(card, pile) {
    if (pile.length === 0) return true;
    const top = pile[pile.length - 1];
    if (isPowerCard(card)) return true;
    if (top.value === '2') return true;
    if (top.value === '7') return RANK[card.value] < RANK['7'];
    return card.suit === top.suit || card.value === top.value;
}

function createGame(playerIds, random = Math.random) {
    if (playerIds.length < MIN_PLAYERS || playerIds.length > MAX_PLAYERS) {
        throw new RangeError(`Need between ${MIN_PLAYERS} and ${MAX_PLAYERS} players`);
    }
    const deck = shuffle(createDeck(), random);
    const cards = {};
    for (const id of playerIds) {
        cards[id] = {
            faceDown: deck.splice(0, TABLE_CARDS),
            faceUp: deck.splice(0, TABLE_CARDS),
            hand: deck.splice(0, HAND_SIZE),
        };
    }
    return {
        status: 'playing',
        deck,
        pile: [],
        order: [...playerIds],
        turn: 0,
        cards,
        finished: [],
        loser: null,
        endReason: null,
    };
}

function currentPlayerId(game) {
    return game.status === 'playing' ? game.order[game.turn] : null;
}

function hasFinished(game, id) {
    const c = game.cards[id];
    return Boolean(c) && c.hand.length === 0 && c.faceUp.length === 0 && c.faceDown.length === 0;
}

/** Where the player must play from right now: hand, then face-up, then face-down. */
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

/** A player may (and must) pick up only when they hold visible cards and none is playable. */
function canPickUp(game, id) {
    if (currentPlayerId(game) !== id || game.pile.length === 0) return false;
    const source = getSource(game, id);
    return (source === 'hand' || source === 'faceUp') && legalCards(game, id).length === 0;
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

function refillHand(game, id) {
    const c = game.cards[id];
    while (c.hand.length < HAND_SIZE && game.deck.length) {
        c.hand.push(game.deck.pop());
    }
}

/** Apply the consequences of a successful play and decide whose turn is next. */
function settleAfterPlay(game, id, card) {
    const burned = card.value === '10';
    if (burned) game.pile = [];

    refillHand(game, id);

    const finished = hasFinished(game, id);
    if (finished) game.finished.push(id);

    if (endIfOver(game, 'completed')) {
        return { burned, finished, gameOver: true };
    }
    if (burned && !finished) {
        // A burn earns another turn.
        return { burned, finished, gameOver: false, playAgain: true };
    }
    advanceTurn(game);
    return { burned, finished, gameOver: false, playAgain: false };
}

function checkTurn(game, id) {
    if (game.status !== 'playing') return 'The game is not in progress';
    if (currentPlayerId(game) !== id) return 'It is not your turn';
    return null;
}

function playCard(game, id, card) {
    const turnError = checkTurn(game, id);
    if (turnError) return { error: turnError };
    if (!isCard(card)) return { error: 'Invalid card' };

    const source = getSource(game, id);
    if (source !== 'hand' && source !== 'faceUp') {
        return { error: 'You must flip one of your face-down cards' };
    }
    const from = game.cards[id][source];
    const index = from.findIndex((c) => sameCard(c, card));
    if (index === -1) return { error: 'You do not hold that card' };
    if (!isValidPlay(from[index], game.pile)) return { error: 'That card cannot be played now' };

    const [played] = from.splice(index, 1);
    game.pile.push(played);
    return { ok: true, card: played, source, ...settleAfterPlay(game, id, played) };
}

/** Blind play: the card is revealed, and if it is illegal the player takes the pile plus that card. */
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
        return { ok: true, card, source: 'faceDown', success: true, ...settleAfterPlay(game, id, card) };
    }

    const pickedUp = game.pile.length + 1;
    game.cards[id].hand.push(...game.pile, card);
    game.pile = [];
    advanceTurn(game);
    return { ok: true, card, source: 'faceDown', success: false, pickedUp, gameOver: false };
}

function pickUpPile(game, id) {
    const turnError = checkTurn(game, id);
    if (turnError) return { error: turnError };
    if (!canPickUp(game, id)) return { error: 'You still have a playable card' };

    const count = game.pile.length;
    game.cards[id].hand.push(...game.pile);
    game.pile = [];
    advanceTurn(game);
    return { ok: true, count };
}

/** Remove a player who left mid-game, keeping the turn pointer on the right player. */
function removePlayer(game, id) {
    const index = game.order.indexOf(id);
    if (index === -1) return;

    const wasCurrent = index === game.turn;
    game.order.splice(index, 1);
    delete game.cards[id];
    game.finished = game.finished.filter((f) => f !== id);

    if (game.order.length === 0) {
        game.status = 'finished';
        game.endReason = 'abandoned';
        return;
    }
    if (index < game.turn) {
        game.turn -= 1;
    } else if (wasCurrent) {
        game.turn %= game.order.length;
    }
    if (game.status === 'playing' && !endIfOver(game, 'abandoned')) {
        skipFinished(game);
    }
}

export {
    SUITS,
    VALUES,
    RANK,
    HAND_SIZE,
    TABLE_CARDS,
    MIN_PLAYERS,
    MAX_PLAYERS,
    createDeck,
    shuffle,
    isCard,
    sameCard,
    isPowerCard,
    isValidPlay,
    createGame,
    currentPlayerId,
    hasFinished,
    getSource,
    legalCards,
    canPickUp,
    playCard,
    playFaceDown,
    pickUpPile,
    removePlayer,
};
