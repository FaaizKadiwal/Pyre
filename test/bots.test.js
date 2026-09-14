import test from 'node:test';
import assert from 'node:assert/strict';
import * as logic from '../server/gameLogic.js';
import { planSwaps, chooseMove, reactionFor } from '../server/bots.js';

const C = (value, suit = 'spades') => ({ value, suit });

function playingGame(pile, hand, faceUp = [], faceDown = []) {
    const game = logic.createGame(['bot', 'other'], () => 0.5);
    game.status = 'playing';
    game.ready = ['bot', 'other'];
    game.turn = 0;
    game.pile = pile;
    game.cards.bot = { hand, faceUp, faceDown };
    return game;
}

test('planSwaps leaves the strongest cards face-up and takes weak ones into the hand', () => {
    const swaps = planSwaps({
        hand: [C('10', 'hearts'), C('3'), C('A', 'clubs')],
        faceUp: [C('4'), C('K'), C('5', 'hearts')],
    });
    assert.deepEqual(swaps, [[C('10', 'hearts'), C('4')], [C('A', 'clubs'), C('5', 'hearts')]]);
    assert.deepEqual(planSwaps({ hand: [C('3'), C('4'), C('5')], faceUp: [C('A'), C('K'), C('10')] }), [], 'already ideal');
});

test('chooseMove completes four of a kind when it can', () => {
    const game = playingGame([C('7', 'hearts'), C('7', 'clubs'), C('7', 'diamonds')], [C('3'), C('7'), C('K')]);
    assert.deepEqual(chooseMove(game, 'bot'), { type: 'play', cards: [C('7')] });
});

test('chooseMove sheds the lowest plain cards as a set and keeps magic cards back', () => {
    const game = playingGame([C('4', 'hearts')], [C('5'), C('5', 'hearts'), C('10'), C('2'), C('9')]);
    assert.deepEqual(chooseMove(game, 'bot'), { type: 'play', cards: [C('5'), C('5', 'hearts')] });
});

test('chooseMove spends a ten on a big pile and a two on a small one when nothing else beats it', () => {
    const fat = playingGame([C('A'), C('A', 'hearts'), C('K'), C('K', 'hearts')], [C('10'), C('2'), C('3')]);
    assert.deepEqual(chooseMove(fat, 'bot'), { type: 'play', cards: [C('10')] });
    const thin = playingGame([C('A')], [C('10'), C('2'), C('3')]);
    assert.deepEqual(chooseMove(thin, 'bot'), { type: 'play', cards: [C('2')] });
    const tenOnly = playingGame([C('A')], [C('10'), C('3')]);
    assert.deepEqual(chooseMove(tenOnly, 'bot'), { type: 'play', cards: [C('10')] });
});

test('chooseMove picks up when stuck and flips blind when only face-down cards remain', () => {
    assert.deepEqual(chooseMove(playingGame([C('A')], [C('3'), C('4')]), 'bot'), { type: 'pickUp' });
    const blind = playingGame([C('A')], [], [], [C('3'), C('4')]);
    assert.deepEqual(chooseMove(blind, 'bot', () => 0.9), { type: 'flip', index: 1 });
});

test('reactionFor gives bots a little personality', () => {
    assert.equal(reactionFor({ burn: 'ten' }), '🔥');
    assert.equal(reactionFor({ finished: true }), '🎉');
    assert.equal(reactionFor({ count: 7 }), '😩');
    assert.equal(reactionFor({ success: false, pickedUp: 2 }), '😱');
    assert.equal(reactionFor({ ok: true }), null);
});
