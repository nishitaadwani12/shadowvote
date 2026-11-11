import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEvents, foldEvents, initialState, viewFor, type GameState } from './engine';
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

/** Play night 1 with no kill landing (doctor saves the target) so day 1 starts with everyone alive. */
function dayOneEveryoneAlive(): GameState {
  let s = startedGame({ host: 'VILLAGER', w: 'WEREWOLF', doc: 'DOCTOR', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER', v3: 'VILLAGER', v4: 'VILLAGER' });
  s = step(s, submitNightAction(s, 'w', 'KILL', 'v1'));
  s = step(s, submitNightAction(s, 'doc', 'PROTECT', 'v1'));
  s = step(s, submitNightAction(s, 'seer', 'INSPECT', 'v2'));
  assert.equal(s.phase, 'DAY_DISCUSSION');
  return s;
}

test('a tied vote eliminates no one (it used to fall on the earliest joiner, i.e. the human host)', () => {
  let s = dayOneEveryoneAlive();
  // host vs w: 4 votes each.
  for (const [voter, target] of [['w', 'host'], ['doc', 'host'], ['seer', 'host'], ['v1', 'host'], ['v2', 'w'], ['v3', 'w'], ['v4', 'w'], ['host', 'w']] as const) {
    s = step(s, submitVote(s, voter, target));
  }
  assert.ok(s.players.every((p) => p.alive), 'nobody is lynched on a tie');
  assert.equal(s.phase, 'NIGHT');
  assert.equal(s.round, 2);
});

test('abstaining counts as voting but eliminates no one', () => {
  let s = dayOneEveryoneAlive();
  for (const voter of ['host', 'w', 'doc', 'seer', 'v1', 'v2', 'v3', 'v4']) s = step(s, submitVote(s, voter, null));
  assert.ok(s.players.every((p) => p.alive));
  assert.equal(s.phase, 'NIGHT', 'all-abstain still closes the vote');
});

test('a clear plurality is eliminated even when some players abstain', () => {
  let s = dayOneEveryoneAlive();
  for (const [voter, target] of [['host', 'w'], ['doc', 'w'], ['seer', null], ['v1', null], ['v2', 'host'], ['v3', null], ['v4', null], ['w', null]] as const) {
    s = step(s, submitVote(s, voter, target));
  }
  assert.equal(s.players.find((p) => p.id === 'w')?.alive, false);
  assert.equal(s.winner, 'VILLAGE');
});

test('no role can target itself at night', () => {
  const s = startedGame({ w: 'WEREWOLF', doc: 'DOCTOR', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER', v3: 'VILLAGER' });
  assert.throws(() => submitNightAction(s, 'doc', 'PROTECT', 'doc'), /yourself/);
  assert.throws(() => submitNightAction(s, 'seer', 'INSPECT', 'seer'), /yourself/);
  assert.throws(() => submitNightAction(s, 'w', 'KILL', 'w'), /yourself/);
});

test('the pack kills its most-picked target; a split goes to the first pick (not the last wolf to act)', () => {
  const roles = { w1: 'WEREWOLF', w2: 'WEREWOLF', w3: 'WEREWOLF', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER', v3: 'VILLAGER', v4: 'VILLAGER', v5: 'VILLAGER', v6: 'VILLAGER', v7: 'VILLAGER', v8: 'VILLAGER' } as const;
  // Majority: v2 has two picks.
  let s = startedGame({ ...roles });
  s = step(s, submitNightAction(s, 'w1', 'KILL', 'v1'));
  s = step(s, submitNightAction(s, 'w2', 'KILL', 'v2'));
  s = step(s, submitNightAction(s, 'w3', 'KILL', 'v2'));
  s = step(s, submitNightAction(s, 'seer', 'INSPECT', 'v3'));
  assert.equal(s.players.find((p) => p.id === 'v2')?.alive, false);
  assert.equal(s.players.find((p) => p.id === 'v1')?.alive, true);

  // Split 1-1-1: the first pick (v1) stands, even though w3 acted last.
  s = startedGame({ ...roles });
  s = step(s, submitNightAction(s, 'w1', 'KILL', 'v1'));
  s = step(s, submitNightAction(s, 'w2', 'KILL', 'v2'));
  s = step(s, submitNightAction(s, 'w3', 'KILL', 'v3'));
  s = step(s, submitNightAction(s, 'seer', 'INSPECT', 'v4'));
  assert.equal(s.players.find((p) => p.id === 'v1')?.alive, false);
  assert.ok(['v2', 'v3'].every((id) => s.players.find((p) => p.id === id)?.alive));
});

test("a werewolf's private notes show the pack's current kill pick", () => {
  let s = startedGame({ w1: 'WEREWOLF', w2: 'WEREWOLF', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER', v3: 'VILLAGER', v4: 'VILLAGER', v5: 'VILLAGER' });
  s = step(s, submitNightAction(s, 'w1', 'KILL', 'v3'));
  assert.ok(viewFor(s, 'w2').notes.some((n) => /kill tonight so far: v3/.test(n)));
  assert.ok(!viewFor(s, 'v1').notes.some((n) => /kill tonight/.test(n)), 'villagers never see it');
});

test('werewolves cannot kill a member of their own pack', () => {
  const s = startedGame({ w1: 'WEREWOLF', w2: 'WEREWOLF', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER', v3: 'VILLAGER', v4: 'VILLAGER', v5: 'VILLAGER' });
  assert.throws(() => submitNightAction(s, 'w1', 'KILL', 'w2'), /own pack/);
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
