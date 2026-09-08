import assert from 'node:assert/strict';
import { test } from 'node:test';
import { assertTransition, canTransition, evaluateWinner } from './game';
import type { PlayerPrivate } from './types';

test('legal phase transitions are accepted', () => {
  assert.ok(canTransition('LOBBY', 'NIGHT'));
  assert.ok(canTransition('RESOLVE', 'NIGHT'));
  assert.ok(canTransition('RESOLVE', 'GAME_OVER'));
});

test('illegal phase transitions are rejected', () => {
  assert.equal(canTransition('LOBBY', 'DAY_VOTE'), false);
  assert.equal(canTransition('GAME_OVER', 'NIGHT'), false);
  assert.throws(() => assertTransition('NIGHT', 'GAME_OVER'), /Illegal phase transition/);
});

const p = (role: PlayerPrivate['role'], alive: boolean) => ({ role, alive });

test('village wins when no werewolves remain', () => {
  assert.equal(evaluateWinner([p('VILLAGER', true), p('WEREWOLF', false), p('SEER', true)]), 'VILLAGE');
});

test('werewolves win at parity', () => {
  assert.equal(evaluateWinner([p('WEREWOLF', true), p('VILLAGER', true)]), 'WEREWOLF');
});

test('game is live while village outnumbers wolves', () => {
  assert.equal(evaluateWinner([p('WEREWOLF', true), p('VILLAGER', true), p('SEER', true)]), null);
});
