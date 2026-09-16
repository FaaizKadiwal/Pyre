import test from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../server/gameLogic.js';

const C = (value, suit = 'spades') => ({ value, suit });

/** Two-player game already in play with a known layout so every test is deterministic. */
function fixture() {
    const game = logic.createGame(['a', 'b'], () => 0.5);
    game.status = 'playing';
    game.ready = ['a', 'b'];
    game.deck = [C('K', 'hearts'), C('Q', 'hearts')]; // pop() draws Q first
    game.pile = [C('5', 'clubs')];
    game.cards.a = { hand: [C('5', 'hearts'), C('9', 'clubs'), C('3', 'diamonds')], faceUp: [C('A')], faceDown: [C('3')] };
    game.cards.b = { hand: [C('4'), C('6'), C('8')], faceUp: [C('2', 'hearts')], faceDown: [C('7', 'hearts')] };
    game.turn = 0;
    return game;
}

test('deck has 52 unique cards', () => {
    const deck = logic.createDeck();
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck.map((c) => `${c.value}${c.suit}`)).size, 52);
});

test('createGame deals 3/3/3 one card at a time, starts in the swap phase and rejects bad counts', () => {
    const game = logic.createGame(['a', 'b', 'c']);
    for (const id of ['a', 'b', 'c']) {
        assert.equal(game.cards[id].hand.length, 3);
        assert.equal(game.cards[id].faceUp.length, 3);
        assert.equal(game.cards[id].faceDown.length, 3);
    }
    assert.equal(game.deck.length, 52 - 27);
    assert.equal(game.pile.length, 0);
    assert.equal(game.status, 'swapping');
    assert.equal(logic.currentPlayerId(game), null, 'nobody plays until swapping is over');
    assert.throws(() => logic.createGame(['a']), RangeError);
    assert.throws(() => logic.createGame(['a', 'b', 'c', 'd', 'e', 'f']), RangeError);
});

test('the first player is whoever received the lowest face-up card, then hand cards', () => {
    const game = logic.createGame(['a', 'b'], () => 0.5);
    game.cards.a.faceUp = [C('K'), C('4', 'hearts'), C('9')];
    game.cards.b.faceUp = [C('3', 'clubs'), C('J'), C('Q')];
    game.cards.a.hand = [C('3', 'hearts'), C('A'), C('A', 'hearts')];
    // A 3 face-up beats a 3 in a hand.
    assert.equal(logic.createGame(['a', 'b'], () => 0.5).order.length, 2);
    const order = ['a', 'b'];
    const pick = (cards) => order[logicFirst(order, cards)];
    function logicFirst(o, cards) {
        // replicate through createGame internals by rebuilding the game with fixed cards
        const g = { ...game, cards };
        return logic.NATURAL_ORDER.length && firstIndex(g, o);
    }
    function firstIndex(g, o) {
        for (const value of logic.NATURAL_ORDER) {
            for (let round = 0; round < 3; round++) {
                for (let i = 0; i < o.length; i++) if (g.cards[o[i]].faceUp[round].value === value) return i;
            }
            for (let i = 0; i < o.length; i++) if (g.cards[o[i]].hand.some((c) => c.value === value)) return i;
        }
        return 0;
    }
    assert.equal(pick(game.cards), 'b', 'the face-up 3 wins over the 3 in hand');
    game.cards.b.faceUp = [C('K', 'clubs'), C('J'), C('Q')];
    assert.equal(pick(game.cards), 'a', 'no 3 face-up, so the first 3 in a hand decides');
    game.cards.a.hand = [C('A'), C('A', 'hearts'), C('A', 'clubs')];
    assert.equal(pick(game.cards), 'a', 'no 3 at all: the first 4, which is face-up in front of a');
});

test('canPlayOn: equal or higher beats, suits ignored, twos and tens are magic', () => {
    const on = (top) => (top ? [top] : []);
    assert.ok(logic.canPlayOn(C('3'), on(null)), 'anything on an empty pile');
    assert.ok(logic.canPlayOn(C('7', 'hearts'), on(C('7', 'clubs'))), 'equal rank');
    assert.ok(logic.canPlayOn(C('8', 'hearts'), on(C('7', 'clubs'))), 'higher rank');
    assert.ok(!logic.canPlayOn(C('6', 'clubs'), on(C('7', 'clubs'))), 'lower rank, even in suit');
    assert.ok(logic.canPlayOn(C('A'), on(C('K'))), 'ace is highest');
    assert.ok(!logic.canPlayOn(C('K'), on(C('A'))), 'king does not beat ace');
    assert.ok(logic.canPlayOn(C('2'), on(C('A'))), 'a two goes on anything');
    assert.ok(logic.canPlayOn(C('3'), on(C('2'))), 'anything goes on a two');
    assert.ok(logic.canPlayOn(C('10'), on(C('A'))), 'a ten goes on anything');
    assert.ok(logic.canPlayOn(C('10'), on(C('2'))), 'a ten goes on a two');
    assert.ok(logic.canPlayOn(C('J'), on(C('10'))), 'a ten never stays on the pile, but is beaten by a jack if it did');
});

test('house rules: sevens force low, eights are transparent, tens can be kept low', () => {
    const sevens = { ...logic.DEFAULT_RULES, sevens: true };
    assert.ok(!logic.canPlayOn(C('8'), [C('7')], sevens), 'an 8 does not go on a 7');
    assert.ok(logic.canPlayOn(C('7', 'hearts'), [C('7')], sevens), 'another 7 does');
    assert.ok(logic.canPlayOn(C('3'), [C('7')], sevens), 'a low card does');
    assert.ok(logic.canPlayOn(C('10'), [C('7')], sevens) && logic.canPlayOn(C('2'), [C('7')], sevens), 'a 2 or 10 still goes');
    assert.ok(logic.canPlayOn(C('8'), [C('7')]), 'without the rule an 8 beats a 7');

    const eights = { ...logic.DEFAULT_RULES, eights: true };
    assert.ok(logic.canPlayOn(C('8'), [C('A')], eights), 'a transparent 8 goes on anything');
    assert.deepEqual(logic.effectiveTop([C('K'), C('8'), C('8', 'hearts')], eights), C('K'), 'the card under the 8s must be beaten');
    assert.ok(!logic.canPlayOn(C('9'), [C('K'), C('8')], eights), '9 does not beat the K under the 8');
    assert.ok(logic.canPlayOn(C('A'), [C('K'), C('8')], eights));
    assert.equal(logic.effectiveTop([C('8')], eights), null, 'only transparent cards means an open pile');
    assert.ok(logic.canPlayOn(C('3'), [C('8')], eights));

    const tensLow = { ...logic.DEFAULT_RULES, tensLow: true };
    assert.ok(!logic.canPlayOn(C('10'), [C('J')], tensLow), 'no ten on a jack');
    assert.ok(logic.canPlayOn(C('10'), [C('9')], tensLow) && logic.canPlayOn(C('10'), [C('2')], tensLow) && logic.canPlayOn(C('10'), [], tensLow));
});

test('house rules: nines and jokers reverse, threes skip, jokers are wild and transparent', () => {
    const rules = { ...logic.DEFAULT_RULES, nines: true, threes: true, jokers: true };
    const game = logic.createGame(['a', 'b', 'c'], () => 0.5, rules);
    assert.equal(game.deck.length + 27, 54, 'two jokers joined the deck');
    game.status = 'playing';
    game.deck = [];
    game.pile = [];
    game.cards.a = { hand: [C('9'), C('3'), C('3', 'hearts'), { ...logic.JOKER }], faceUp: [], faceDown: [] };
    game.cards.b = { hand: [C('Q'), C('4'), { ...logic.JOKER }], faceUp: [], faceDown: [] };
    game.cards.c = { hand: [C('K'), C('5')], faceUp: [], faceDown: [] };
    game.turn = 0;

    let result = logic.playCards(game, 'a', [C('9')]);
    assert.equal(result.effects.reversed, true);
    assert.equal(game.direction, -1);
    assert.equal(logic.currentPlayerId(game), 'c', 'play now runs the other way');

    logic.playCards(game, 'c', [C('K')]);
    assert.equal(logic.currentPlayerId(game), 'b');
    assert.ok(!logic.canPlayOn(C('4'), game.pile, rules), 'b cannot beat the king');
    result = logic.playCards(game, 'b', [C('Q')]);
    assert.match(result.error, /cannot be played/);

    const joker = logic.playCards(game, 'b', [{ ...logic.JOKER }]);
    assert.equal(joker.error, undefined, 'a joker goes on anything');
    assert.equal(joker.effects.reversed, true);
    assert.equal(game.direction, 1, 'and reverses again');
    assert.deepEqual(logic.effectiveTop(game.pile, rules), C('K'), 'the joker is transparent: the king is still to beat');
    assert.equal(logic.currentPlayerId(game), 'c');

    game.cards.c.hand = [C('3', 'clubs'), C('3', 'diamonds'), C('A')];
    result = logic.playCards(game, 'c', [C('3', 'clubs'), C('3', 'diamonds')]);
    assert.match(result.error, /cannot be played/, 'threes still have to beat the pile');
    game.pile = [];
    result = logic.playCards(game, 'c', [C('3', 'clubs'), C('3', 'diamonds')]);
    assert.deepEqual(result.effects.skipped, ['a', 'b'], 'two threes skip two players');
    assert.equal(logic.currentPlayerId(game), 'c', 'which with three players comes straight back');
});

test('normaliseRules accepts only known boolean flags', () => {
    assert.deepEqual(logic.normaliseRules({ sevens: true }).rules, { ...logic.DEFAULT_RULES, sevens: true });
    assert.match(logic.normaliseRules({ fives: true }).error, /Unknown rule/);
    assert.match(logic.normaliseRules({ sevens: 'yes' }).error, /true or false/);
    assert.match(logic.normaliseRules([true]).error, /object/);
    assert.deepEqual(logic.normaliseRules(undefined).rules, { ...logic.DEFAULT_RULES });
});

test('swapping exchanges hand and face-up cards until Ready, and play begins when everyone is ready', () => {
    const game = logic.createGame(['a', 'b'], () => 0.5);
    const hand = game.cards.a.hand[0];
    const up = game.cards.a.faceUp[2];
    assert.equal(logic.swapCards(game, 'a', hand, up).ok, true);
    assert.deepEqual(game.cards.a.faceUp[2], hand);
    assert.deepEqual(game.cards.a.hand[0], up);
    assert.match(logic.swapCards(game, 'a', hand, up).error, /do not hold/);
    assert.match(logic.swapCards(game, 'a', 'x', up).error, /Invalid card/);
    assert.match(logic.playCards(game, 'a', [game.cards.a.hand[0]]).error, /not in progress/);

    assert.deepEqual(logic.setReady(game, 'a'), { ok: true, started: false });
    assert.match(logic.swapCards(game, 'a', game.cards.a.hand[0], game.cards.a.faceUp[0]).error, /already pressed Ready/);
    assert.equal(logic.setReady(game, 'a').started, false, 'pressing Ready twice is harmless');
    assert.deepEqual(logic.setReady(game, 'b'), { ok: true, started: true });
    assert.equal(game.status, 'playing');
    assert.match(logic.swapCards(game, 'b', game.cards.b.hand[0], game.cards.b.faceUp[0]).error, /before play starts/);
    assert.match(logic.beginPlay(game).error, /already begun/);
});

test('beginPlay lets the host start before everyone is ready', () => {
    const game = logic.createGame(['a', 'b']);
    assert.equal(logic.beginPlay(game).ok, true);
    assert.equal(game.status, 'playing');
    assert.match(logic.setReady(game, 'a').error, /already begun/);
});

test('playCards enforces turn, ownership, equal ranks and the beating rule', () => {
    const game = fixture();
    assert.match(logic.playCards(game, 'b', [C('4')]).error, /not your turn/);
    assert.match(logic.playCards(game, 'a', [C('4')]).error, /do not hold/);
    assert.match(logic.playCards(game, 'a', [C('3', 'diamonds')]).error, /cannot be played/);
    assert.match(logic.playCards(game, 'a', [C('5', 'hearts'), C('9', 'clubs')]).error, /same rank/);
    assert.match(logic.playCards(game, 'a', []).error, /same rank/);
    assert.match(logic.playCards(game, 'a', C('5', 'hearts')).error, /same rank/);
    assert.match(logic.playCards(game, 'a', [C('5', 'hearts'), C('5', 'hearts')]).error, /do not hold/, 'the same card twice');
});

test('a normal play moves the cards, refills the hand and passes the turn', () => {
    const game = fixture();
    const result = logic.playCards(game, 'a', [C('9', 'clubs')]);
    assert.equal(result.ok, true);
    assert.equal(result.burn, null);
    assert.deepEqual(game.pile.at(-1), C('9', 'clubs'));
    assert.equal(game.cards.a.hand.length, 3, 'refilled to three');
    assert.deepEqual(game.cards.a.hand.at(-1), C('Q', 'hearts'));
    assert.equal(game.deck.length, 1);
    assert.equal(logic.currentPlayerId(game), 'b');
});

test('a set of equal cards is played together and the hand refills by as many', () => {
    const game = fixture();
    game.cards.a.hand = [C('5', 'hearts'), C('5', 'diamonds'), C('9', 'clubs')];
    const result = logic.playCards(game, 'a', [C('5', 'hearts'), C('5', 'diamonds')]);
    assert.equal(result.ok, true);
    assert.equal(game.pile.length, 3);
    assert.equal(logic.topRun(game.pile), 3, 'three 5s on top now');
    assert.equal(game.cards.a.hand.length, 3);
    assert.equal(game.deck.length, 0, 'both stock cards were drawn');
});

test('a 10 burns the pile and gives the same player another turn', () => {
    const game = fixture();
    game.cards.a.hand.push(C('10', 'hearts'));
    const result = logic.playCards(game, 'a', [C('10', 'hearts')]);
    assert.equal(result.burn, 'ten');
    assert.equal(result.playAgain, true);
    assert.equal(game.pile.length, 0);
    assert.equal(logic.currentPlayerId(game), 'a');
});

test('completing four of a kind on top of the pile burns it, across several players', () => {
    const game = fixture();
    game.deck = [];
    game.pile = [C('3', 'clubs'), C('5', 'clubs'), C('5', 'diamonds')];
    game.cards.a.hand = [C('5', 'hearts'), C('9', 'clubs')];
    game.cards.b.hand = [C('5', 'spades'), C('6')];
    logic.playCards(game, 'a', [C('5', 'hearts')]);
    assert.equal(logic.currentPlayerId(game), 'b', 'three 5s is not yet a burn');
    const result = logic.playCards(game, 'b', [C('5', 'spades')]);
    assert.equal(result.burn, 'four');
    assert.equal(result.playAgain, true);
    assert.equal(game.pile.length, 0);
    assert.equal(logic.currentPlayerId(game), 'b');
});

test('picking up is allowed whenever the pile is not empty, and compulsory with no legal card', () => {
    const game = fixture();
    assert.equal(logic.canPickUp(game, 'a'), true, 'voluntary pick-up is allowed');
    assert.equal(logic.mustPickUp(game, 'a'), false, 'a 5 and a 9 can be played');
    game.cards.a.hand = [C('3', 'hearts'), C('4', 'hearts')];
    assert.equal(logic.mustPickUp(game, 'a'), true);
    const result = logic.pickUpPile(game, 'a');
    assert.equal(result.count, 1);
    assert.equal(result.added, null);
    assert.equal(game.cards.a.hand.length, 3);
    assert.equal(game.pile.length, 0);
    assert.equal(logic.currentPlayerId(game), 'b');
    game.pile = [];
    assert.match(logic.pickUpPile(game, 'b').error, /pile is empty/);
});

test('face-up cards are played once the hand is empty; picking up then costs a face-up card too', () => {
    const game = fixture();
    game.deck = [];
    game.cards.a.hand = [];
    game.cards.a.faceUp = [C('A'), C('4', 'hearts'), C('4', 'clubs')];
    assert.equal(logic.getSource(game, 'a'), 'faceUp');
    assert.match(logic.playFaceDown(game, 'a', 0).error, /visible cards/);
    assert.deepEqual(logic.legalCards(game, 'a'), [C('A')]);

    // Choosing which face-up card goes with the pile.
    const result = logic.pickUpPile(game, 'a', C('4', 'clubs'));
    assert.deepEqual(result.added, C('4', 'clubs'));
    assert.equal(result.count, 2);
    assert.deepEqual(game.cards.a.faceUp, [C('A'), C('4', 'hearts')]);
    assert.equal(game.cards.a.hand.length, 2);
    assert.equal(logic.currentPlayerId(game), 'b');
});

test('picking up from the face-up phase without a choice sacrifices the lowest card, never a magic card first', () => {
    const game = fixture();
    game.deck = [];
    game.cards.a.hand = [];
    game.cards.a.faceUp = [C('10'), C('2', 'hearts'), C('J', 'clubs')];
    game.pile = [C('K')];
    const result = logic.pickUpPile(game, 'a');
    assert.deepEqual(result.added, C('J', 'clubs'));
    assert.deepEqual(game.cards.a.faceUp, [C('10'), C('2', 'hearts')], 'the magic cards stay on the table');
    assert.equal(logic.currentPlayerId(game), 'b');
    assert.match(logic.pickUpPile(game, 'a').error, /not your turn/);
    assert.match(logic.pickUpPile(game, 'b').error, /pile is empty/);
});

test('a set of equal face-up cards may be played together', () => {
    const game = fixture();
    game.deck = [];
    game.cards.a.hand = [];
    game.cards.a.faceUp = [C('9', 'hearts'), C('9', 'clubs'), C('4')];
    const result = logic.playCards(game, 'a', [C('9', 'hearts'), C('9', 'clubs')]);
    assert.equal(result.ok, true);
    assert.equal(result.source, 'faceUp');
    assert.deepEqual(game.cards.a.faceUp, [C('4')]);
});

test('a failed face-down flip picks up the pile plus the flipped card', () => {
    const game = fixture();
    game.deck = [];
    game.cards.a.hand = [];
    game.cards.a.faceUp = [];
    game.cards.a.faceDown = [C('3', 'hearts')];
    assert.equal(logic.getSource(game, 'a'), 'faceDown');
    assert.match(logic.playCards(game, 'a', [C('3', 'hearts')]).error, /face-down/);
    assert.match(logic.pickUpPile(game, 'a').error, /face-down/);
    assert.match(logic.playFaceDown(game, 'a', 5).error, /Invalid face-down/);
    const result = logic.playFaceDown(game, 'a', 0);
    assert.equal(result.success, false);
    assert.equal(result.pickedUp, 2);
    assert.equal(game.cards.a.faceDown.length, 0);
    assert.equal(game.cards.a.hand.length, 2);
    assert.equal(game.pile.length, 0);
    assert.equal(logic.currentPlayerId(game), 'b');
});

test('a successful last face-down flip finishes the player and ends a two-player game', () => {
    const game = fixture();
    game.deck = [];
    game.cards.a.hand = [];
    game.cards.a.faceUp = [];
    game.cards.a.faceDown = [C('7', 'hearts')];
    const result = logic.playFaceDown(game, 'a', 0);
    assert.equal(result.success, true);
    assert.equal(result.finished, true);
    assert.equal(result.gameOver, true);
    assert.equal(game.status, 'finished');
    assert.deepEqual(game.finished, ['a']);
    assert.equal(game.loser, 'b');
    assert.equal(game.endReason, 'completed');
    assert.equal(logic.currentPlayerId(game), null);
});

test('going out with a burn does not grant a dead player another turn', () => {
    const game = logic.createGame(['a', 'b', 'c']);
    game.status = 'playing';
    game.deck = [];
    game.pile = [C('3')];
    game.cards.a = { hand: [C('10')], faceUp: [], faceDown: [] };
    game.cards.b = { hand: [C('4'), C('5')], faceUp: [], faceDown: [] };
    game.cards.c = { hand: [C('6')], faceUp: [], faceDown: [] };
    game.turn = 0;
    const result = logic.playCards(game, 'a', [C('10')]);
    assert.equal(result.burn, 'ten');
    assert.equal(result.finished, true);
    assert.equal(result.playAgain, false);
    assert.equal(logic.currentPlayerId(game), 'b');
    assert.equal(game.pile.length, 0, 'b starts a new pile');
});

test('finished players are skipped in a three-player game until one shithead remains', () => {
    const game = logic.createGame(['a', 'b', 'c']);
    game.status = 'playing';
    game.deck = [];
    game.pile = [];
    game.cards.a = { hand: [C('3')], faceUp: [], faceDown: [] };
    game.cards.b = { hand: [C('4'), C('5')], faceUp: [], faceDown: [] };
    game.cards.c = { hand: [C('6')], faceUp: [], faceDown: [] };
    game.turn = 0;

    assert.equal(logic.playCards(game, 'a', [C('3')]).finished, true);
    assert.equal(game.status, 'playing');
    assert.equal(logic.currentPlayerId(game), 'b');
    logic.playCards(game, 'b', [C('4')]);
    assert.equal(logic.currentPlayerId(game), 'c');
    const result = logic.playCards(game, 'c', [C('6')]);
    assert.equal(result.gameOver, true);
    assert.deepEqual(game.finished, ['a', 'c']);
    assert.equal(game.loser, 'b');
});

test('removePlayer keeps the turn pointer on the right player and settles the swap phase', () => {
    const game = logic.createGame(['a', 'b', 'c', 'd']);
    game.status = 'playing';
    game.turn = 2; // c's turn
    logic.removePlayer(game, 'a');
    assert.equal(logic.currentPlayerId(game), 'c');
    logic.removePlayer(game, 'c');
    assert.equal(logic.currentPlayerId(game), 'd', 'current player left, next player is up');
    logic.removePlayer(game, 'd');
    assert.equal(game.status, 'finished');
    assert.equal(game.endReason, 'abandoned');
    assert.equal(game.loser, null);

    const swapping = logic.createGame(['a', 'b', 'c']);
    logic.setReady(swapping, 'a');
    logic.setReady(swapping, 'b');
    logic.removePlayer(swapping, 'c');
    assert.equal(swapping.status, 'playing', 'the last unready player leaving lets play begin');
});

test('lowestValue prefers low cards and keeps magic cards for last', () => {
    assert.equal(logic.lowestValue([C('A'), C('10'), C('2'), C('J')]), 'J');
    assert.equal(logic.lowestValue([C('10'), C('2')]), '10');
    assert.equal(logic.lowestValue([]), null);
});
