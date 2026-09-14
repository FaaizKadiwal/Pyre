import test from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../server/gameLogic.js';

const C = (value, suit = 'spades') => ({ value, suit });

/** Two-player game with a known layout so every test is deterministic. */
function fixture() {
    const game = logic.createGame(['a', 'b'], () => 0.5);
    game.deck = [C('K', 'hearts'), C('Q', 'hearts')]; // pop() draws Q first
    game.pile = [C('5', 'clubs')];
    game.cards.a = { hand: [C('5', 'hearts'), C('9', 'clubs'), C('J', 'diamonds')], faceUp: [C('A')], faceDown: [C('3')] };
    game.cards.b = { hand: [C('4'), C('6'), C('8')], faceUp: [C('2', 'hearts')], faceDown: [C('7', 'hearts')] };
    game.turn = 0;
    return game;
}

test('deck has 52 unique cards', () => {
    const deck = logic.createDeck();
    assert.equal(deck.length, 52);
    assert.equal(new Set(deck.map((c) => `${c.value}${c.suit}`)).size, 52);
});

test('createGame deals 3/3/3 to each player and rejects bad player counts', () => {
    const game = logic.createGame(['a', 'b', 'c']);
    for (const id of ['a', 'b', 'c']) {
        assert.equal(game.cards[id].hand.length, 3);
        assert.equal(game.cards[id].faceUp.length, 3);
        assert.equal(game.cards[id].faceDown.length, 3);
    }
    assert.equal(game.deck.length, 52 - 27);
    assert.equal(game.pile.length, 0);
    assert.throws(() => logic.createGame(['a']), RangeError);
    assert.throws(() => logic.createGame(['a', 'b', 'c', 'd', 'e', 'f']), RangeError);
});

test('isValidPlay follows suit/value matching and power-card rules', () => {
    assert.ok(logic.isValidPlay(C('K'), []), 'anything on an empty pile');
    assert.ok(logic.isValidPlay(C('5', 'hearts'), [C('5', 'clubs')]), 'same value');
    assert.ok(logic.isValidPlay(C('9', 'clubs'), [C('5', 'clubs')]), 'same suit');
    assert.ok(!logic.isValidPlay(C('9', 'hearts'), [C('5', 'clubs')]), 'no match');
    assert.ok(logic.isValidPlay(C('2', 'hearts'), [C('5', 'clubs')]), '2 always playable');
    assert.ok(logic.isValidPlay(C('10', 'hearts'), [C('5', 'clubs')]), '10 always playable');
    assert.ok(logic.isValidPlay(C('7', 'hearts'), [C('5', 'clubs')]), '7 always playable');
    assert.ok(logic.isValidPlay(C('K', 'hearts'), [C('2', 'clubs')]), 'anything on a 2');
    assert.ok(logic.isValidPlay(C('6', 'hearts'), [C('7', 'clubs')]), 'lower than 7 on a 7');
    assert.ok(!logic.isValidPlay(C('8', 'clubs'), [C('7', 'clubs')]), 'higher than 7 blocked even in suit');
    assert.ok(logic.isValidPlay(C('10', 'hearts'), [C('7', 'clubs')]), 'power card on a 7');
});

test('playCard enforces turn order and card ownership', () => {
    const game = fixture();
    assert.match(logic.playCard(game, 'b', C('4')).error, /not your turn/);
    assert.match(logic.playCard(game, 'a', C('4')).error, /do not hold/);
    assert.match(logic.playCard(game, 'a', C('J', 'diamonds')).error, /cannot be played/);
    assert.match(logic.playCard(game, 'a', 'nonsense').error, /Invalid card/);
});

test('a normal play moves the card, refills the hand and passes the turn', () => {
    const game = fixture();
    const result = logic.playCard(game, 'a', C('5', 'hearts'));
    assert.equal(result.ok, true);
    assert.deepEqual(game.pile.at(-1), C('5', 'hearts'));
    assert.equal(game.cards.a.hand.length, 3, 'refilled to three');
    assert.deepEqual(game.cards.a.hand.at(-1), C('Q', 'hearts'));
    assert.equal(game.deck.length, 1);
    assert.equal(logic.currentPlayerId(game), 'b');
});

test('a 10 burns the pile and gives the same player another turn', () => {
    const game = fixture();
    game.cards.a.hand.push(C('10', 'hearts'));
    const result = logic.playCard(game, 'a', C('10', 'hearts'));
    assert.equal(result.burned, true);
    assert.equal(result.playAgain, true);
    assert.equal(game.pile.length, 0);
    assert.equal(logic.currentPlayerId(game), 'a');
});

test('players play from face-up once hand and deck are empty, then face-down', () => {
    const game = fixture();
    game.deck = [];
    game.cards.a.hand = [];
    assert.equal(logic.getSource(game, 'a'), 'faceUp');
    assert.match(logic.playFaceDown(game, 'a', 0).error, /visible cards/);
    game.cards.a.faceUp = [C('5', 'diamonds')];
    assert.equal(logic.playCard(game, 'a', C('5', 'diamonds')).ok, true);
    assert.equal(game.cards.a.faceUp.length, 0);
    assert.equal(logic.getSource(game, 'a'), 'faceDown');
});

test('face-up play is validated like a hand play', () => {
    const game = fixture();
    game.deck = [];
    game.cards.a.hand = [];
    game.cards.a.faceUp = [C('A', 'hearts')];
    assert.match(logic.playCard(game, 'a', C('A', 'hearts')).error, /cannot be played/);
    assert.equal(logic.canPickUp(game, 'a'), true);
});

test('pickUpPile is only allowed with no legal move and moves the pile into the hand', () => {
    const game = fixture();
    assert.match(logic.pickUpPile(game, 'a').error, /playable card/);
    game.cards.a.hand = [C('9', 'hearts')];
    assert.equal(logic.canPickUp(game, 'a'), true);
    const result = logic.pickUpPile(game, 'a');
    assert.equal(result.count, 1);
    assert.equal(game.cards.a.hand.length, 2);
    assert.equal(game.pile.length, 0);
    assert.equal(logic.currentPlayerId(game), 'b');
});

test('a failed face-down flip picks up the pile plus the flipped card', () => {
    const game = fixture();
    game.deck = [];
    game.cards.a.hand = [];
    game.cards.a.faceUp = [];
    game.cards.a.faceDown = [C('9', 'hearts')];
    assert.equal(logic.getSource(game, 'a'), 'faceDown');
    assert.match(logic.playCard(game, 'a', C('9', 'hearts')).error, /face-down/);
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
    game.cards.a.faceDown = [C('5', 'hearts')];
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

test('finished players are skipped in a three-player game until one remains', () => {
    const game = logic.createGame(['a', 'b', 'c']);
    game.deck = [];
    game.pile = [];
    game.cards.a = { hand: [C('3')], faceUp: [], faceDown: [] };
    game.cards.b = { hand: [C('4'), C('5')], faceUp: [], faceDown: [] };
    game.cards.c = { hand: [C('6')], faceUp: [], faceDown: [] };

    assert.equal(logic.playCard(game, 'a', C('3')).finished, true);
    assert.equal(game.status, 'playing');
    assert.equal(logic.currentPlayerId(game), 'b');
    logic.playCard(game, 'b', C('4'));
    assert.equal(logic.currentPlayerId(game), 'c');
    const result = logic.playCard(game, 'c', C('6'));
    assert.equal(result.gameOver, true);
    assert.deepEqual(game.finished, ['a', 'c']);
    assert.equal(game.loser, 'b');
});

test('removePlayer keeps the turn pointer on the right player', () => {
    const game = logic.createGame(['a', 'b', 'c', 'd']);
    game.turn = 2; // c's turn
    logic.removePlayer(game, 'a');
    assert.equal(logic.currentPlayerId(game), 'c');
    logic.removePlayer(game, 'c');
    assert.equal(logic.currentPlayerId(game), 'd', 'current player left, next player is up');
    logic.removePlayer(game, 'd');
    assert.equal(game.status, 'finished');
    assert.equal(game.endReason, 'abandoned');
    assert.equal(game.loser, null);
});

test('removing the last active player when the current index is at the end wraps around', () => {
    const game = logic.createGame(['a', 'b', 'c']);
    game.turn = 2;
    logic.removePlayer(game, 'c');
    assert.equal(logic.currentPlayerId(game), 'a');
    assert.equal(game.status, 'playing');
});
