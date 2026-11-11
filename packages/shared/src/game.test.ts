import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEvent, initialState } from './engine';
import { assertTransition, canTransition, evaluateWinner } from './game';
import type { PlayerPrivate } from './types';

test('legal phase transitions are accepted', () => {
  assert.ok(canTransition('LOBBY', 'NIGHT'));
  assert.ok(canTransition('NIGHT', 'DAY_DISCUSSION'));
  assert.ok(canTransition('NIGHT', 'GAME_OVER'), 'a night kill can end the game');
  assert.ok(canTransition('DAY_DISCUSSION', 'DAY_VOTE'));
  assert.ok(canTransition('DAY_VOTE', 'NIGHT'));
  assert.ok(canTransition('DAY_VOTE', 'GAME_OVER'));
});

test('illegal phase transitions are rejected', () => {
  assert.equal(canTransition('LOBBY', 'DAY_VOTE'), false);
  assert.equal(canTransition('GAME_OVER', 'NIGHT'), false);
  assert.equal(canTransition('DAY_DISCUSSION', 'NIGHT'), false);
  assert.throws(() => assertTransition('LOBBY', 'GAME_OVER'), /Illegal phase transition/);
});

test('the reducer enforces the transition map', () => {
  const s = initialState('g', 'seed');
  assert.throws(() => applyEvent(s, { type: 'PHASE_CHANGED', phase: 'DAY_VOTE', round: 1 }), /Illegal phase transition/);
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
