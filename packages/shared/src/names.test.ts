import assert from 'node:assert/strict';
import { test } from 'node:test';
import { AI_NAMES, pickAiName } from './names';

test('AI names look like ordinary player names, not "AI-n"', () => {
  for (const n of AI_NAMES) assert.doesNotMatch(n, /^ai[-\s]?\d+$/i);
});

test('pickAiName never reuses a name already at the table (case-insensitive)', () => {
  const taken = AI_NAMES.slice(0, AI_NAMES.length - 1).map((n) => n.toUpperCase());
  assert.equal(pickAiName(taken), AI_NAMES[AI_NAMES.length - 1]);
});

test('pickAiName avoids the human player name', () => {
  for (let i = 0; i < 50; i++) assert.notEqual(pickAiName(['Meera'], Math.random).toLowerCase(), 'meera');
});

test('pickAiName falls back to a numbered name once the pool is exhausted', () => {
  assert.equal(pickAiName([...AI_NAMES]), 'Player 1');
  assert.equal(pickAiName([...AI_NAMES, 'Player 1']), 'Player 2');
});
