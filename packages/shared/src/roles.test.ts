import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildRoleDeck, seededShuffle } from './roles';

test('role deck has one entry per player', () => {
  for (const n of [4, 6, 8, 12]) {
    assert.equal(buildRoleDeck(n).length, n);
  }
});

test('role deck scales werewolves and includes special roles', () => {
  const deck = buildRoleDeck(8);
  assert.equal(deck.filter((r) => r === 'WEREWOLF').length, 2);
  assert.equal(deck.filter((r) => r === 'SEER').length, 1);
  assert.equal(deck.filter((r) => r === 'DOCTOR').length, 1);
});

test('fewer than 4 players is rejected', () => {
  assert.throws(() => buildRoleDeck(3), /at least 4 players/);
});

test('seeded shuffle is deterministic and a permutation', () => {
  const input = [1, 2, 3, 4, 5, 6, 7, 8];
  const a = seededShuffle(input, 'shadowvote');
  const b = seededShuffle(input, 'shadowvote');
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((x, y) => x - y), input);
  assert.notDeepEqual(seededShuffle(input, 'other-seed'), a);
});
