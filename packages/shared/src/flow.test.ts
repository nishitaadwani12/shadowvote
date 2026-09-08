import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEvents, foldEvents, initialState, type GameState } from './engine';
import { startGame, submitNightAction, submitVote } from './flow';
import type { GameEvent, Role } from './types';

/** Build a started game with explicit roles (bypasses the random deal so tests are deterministic). */
function startedGame(roles: Record<string, Role>): GameState {
  const names = Object.keys(roles);
  const events: GameEvent[] = [{ type: 'GAME_CREATED', gameId: 'g', seed: 'seed' }];
  for (const name of names) events.push({ type: 'PLAYER_JOINED', playerId: name, name, isAi: false });
  events.push({ type: 'GAME_STARTED', roles });
  events.push({ type: 'PHASE_CHANGED', phase: 'NIGHT', round: 1 });
  return foldEvents(events, 'g', 'seed');
}

/** Apply a command's events to advance the state. */
const step = (s: GameState, events: GameEvent[]): GameState => applyEvents(s, events);

test('startGame deals a role per player and opens the first night', () => {
  let s = initialState('g', 'seed');
  s = applyEvents(s, [
    { type: 'GAME_CREATED', gameId: 'g', seed: 'seed' },
    { type: 'PLAYER_JOINED', playerId: 'a', name: 'A', isAi: false },
    { type: 'PLAYER_JOINED', playerId: 'b', name: 'B', isAi: false },
    { type: 'PLAYER_JOINED', playerId: 'c', name: 'C', isAi: false },
    { type: 'PLAYER_JOINED', playerId: 'd', name: 'D', isAi: false },
  ]);
  s = step(s, startGame(s));
  assert.equal(s.phase, 'NIGHT');
  assert.equal(s.round, 1);
  assert.ok(s.started);
  assert.ok(s.players.every((p) => p.role !== null));
  assert.equal(s.players.filter((p) => p.role === 'WEREWOLF').length, 1);
});

test('startGame rejects fewer than four players', () => {
  let s = initialState('g', 'seed');
  s = applyEvents(s, [
    { type: 'PLAYER_JOINED', playerId: 'a', name: 'A', isAi: false },
    { type: 'PLAYER_JOINED', playerId: 'b', name: 'B', isAi: false },
  ]);
  assert.throws(() => startGame(s), /at least 4 players/);
});

test('the doctor can save the werewolf target', () => {
  let s = startedGame({ w: 'WEREWOLF', doc: 'DOCTOR', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER', v3: 'VILLAGER' });
  s = step(s, submitNightAction(s, 'w', 'KILL', 'v1'));
  s = step(s, submitNightAction(s, 'doc', 'PROTECT', 'v1'));
  s = step(s, submitNightAction(s, 'seer', 'INSPECT', 'w'));
  assert.equal(s.players.find((p) => p.id === 'v1')?.alive, true, 'protected target survives');
  assert.equal(s.phase, 'DAY_DISCUSSION');
  assert.equal(s.inspections[0]?.faction, 'WEREWOLF', 'seer learns the wolf');
});

test('an unprotected night kill eliminates the target', () => {
  let s = startedGame({ w: 'WEREWOLF', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER' });
  s = step(s, submitNightAction(s, 'w', 'KILL', 'v1'));
  s = step(s, submitNightAction(s, 'seer', 'INSPECT', 'v2'));
  assert.equal(s.players.find((p) => p.id === 'v1')?.alive, false);
  assert.equal(s.phase, 'DAY_DISCUSSION');
});

test('role validation: a villager cannot kill', () => {
  const s = startedGame({ w: 'WEREWOLF', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER' });
  assert.throws(() => submitNightAction(s, 'v1', 'KILL', 'w'), /cannot perform KILL/);
});

test('village wins by voting out the last werewolf', () => {
  let s = startedGame({ w: 'WEREWOLF', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER' });
  // Night: wolf kills v1, seer inspects wolf.
  s = step(s, submitNightAction(s, 'w', 'KILL', 'v1'));
  s = step(s, submitNightAction(s, 'seer', 'INSPECT', 'w'));
  assert.equal(s.phase, 'DAY_DISCUSSION');
  // Day: living seer, v2, w. Village lynches the wolf.
  s = step(s, submitVote(s, 'seer', 'w')); // opens the vote
  s = step(s, submitVote(s, 'v2', 'w'));
  s = step(s, submitVote(s, 'w', 'seer'));
  assert.equal(s.winner, 'VILLAGE');
  assert.equal(s.phase, 'GAME_OVER');
});

test('werewolves win once they reach parity', () => {
  let s = startedGame({ w1: 'WEREWOLF', w2: 'WEREWOLF', v1: 'VILLAGER', v2: 'VILLAGER' });
  s = step(s, submitNightAction(s, 'w1', 'KILL', 'v1'));
  s = step(s, submitNightAction(s, 'w2', 'KILL', 'v1'));
  assert.equal(s.winner, 'WEREWOLF'); // 2 wolves vs 1 villager
  assert.equal(s.phase, 'GAME_OVER');
});

test('a finished game replays to identical state from its event log', () => {
  let s = startedGame({ w: 'WEREWOLF', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER' });
  const log: GameEvent[] = [
    { type: 'GAME_CREATED', gameId: 'g', seed: 'seed' },
    { type: 'PLAYER_JOINED', playerId: 'w', name: 'w', isAi: false },
    { type: 'PLAYER_JOINED', playerId: 'seer', name: 'seer', isAi: false },
    { type: 'PLAYER_JOINED', playerId: 'v1', name: 'v1', isAi: false },
    { type: 'PLAYER_JOINED', playerId: 'v2', name: 'v2', isAi: false },
    { type: 'GAME_STARTED', roles: { w: 'WEREWOLF', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER' } },
    { type: 'PHASE_CHANGED', phase: 'NIGHT', round: 1 },
  ];
  const collect = (events: GameEvent[]) => log.push(...events);

  collect(submitNightAction(s, 'w', 'KILL', 'v1'));
  s = step(s, submitNightAction(s, 'w', 'KILL', 'v1'));
  collect(submitNightAction(s, 'seer', 'INSPECT', 'w'));
  s = step(s, submitNightAction(s, 'seer', 'INSPECT', 'w'));

  const replayed = foldEvents(log, 'g', 'seed');
  assert.deepEqual(replayed, s);
});
