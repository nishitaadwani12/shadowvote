import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyEvents, foldEvents, initialState, viewFor } from './engine';
import { submitNightAction } from './flow';
import type { GameEvent, Role } from './types';

test('initial state is an empty lobby', () => {
  const s = initialState('g', 'seed');
  assert.equal(s.phase, 'LOBBY');
  assert.equal(s.started, false);
  assert.equal(s.players.length, 0);
});

test('PLAYER_JOINED then GAME_STARTED assigns roles', () => {
  const s = applyEvents(initialState('g', 'seed'), [
    { type: 'PLAYER_JOINED', playerId: 'a', name: 'A', isAi: false },
    { type: 'PLAYER_JOINED', playerId: 'b', name: 'B', isAi: true },
    { type: 'GAME_STARTED', roles: { a: 'WEREWOLF', b: 'VILLAGER' } },
  ]);
  assert.equal(s.players.find((p) => p.id === 'a')?.role, 'WEREWOLF');
  assert.equal(s.players.find((p) => p.id === 'b')?.isAi, true);
});

function startedGame(roles: Record<string, Role>) {
  const events: GameEvent[] = [{ type: 'GAME_CREATED', gameId: 'g', seed: 'seed' }];
  for (const name of Object.keys(roles)) events.push({ type: 'PLAYER_JOINED', playerId: name, name, isAi: false });
  events.push({ type: 'GAME_STARTED', roles });
  events.push({ type: 'PHASE_CHANGED', phase: 'NIGHT', round: 1 });
  return foldEvents(events, 'g', 'seed');
}

test('viewFor hides other roles but reveals your own', () => {
  const s = startedGame({ w: 'WEREWOLF', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER' });
  const view = viewFor(s, 'seer');
  assert.equal(view.you?.role, 'SEER');
  // PlayerPublic entries carry no role field at all.
  assert.ok(view.players.every((p) => !('role' in p)));
});

test("viewFor surfaces the seer's inspection results as private notes", () => {
  let s = startedGame({ w: 'WEREWOLF', seer: 'SEER', v1: 'VILLAGER', v2: 'VILLAGER' });
  s = applyEvents(s, submitNightAction(s, 'seer', 'INSPECT', 'w'));

  const seerView = viewFor(s, 'seer');
  assert.equal(seerView.notes.length, 1);
  assert.match(seerView.notes[0]!, /WEREWOLF/);

  // A villager sees none of the seer's notes.
  assert.equal(viewFor(s, 'v1').notes.length, 0);
});

test('viewFor tells a werewolf who their allies are', () => {
  const s = startedGame({ w1: 'WEREWOLF', w2: 'WEREWOLF', v1: 'VILLAGER', v2: 'VILLAGER' });
  const note = viewFor(s, 'w1').notes.find((n) => n.includes('allies'));
  assert.ok(note?.includes('w2'), 'w1 sees w2 as an ally');
  // A villager gets no werewolf ally note.
  assert.equal(
    viewFor(s, 'v1').notes.some((n) => n.includes('allies')),
    false,
  );
});

test('viewFor returns no private identity before the game starts', () => {
  const s = applyEvents(initialState('g', 'seed'), [
    { type: 'PLAYER_JOINED', playerId: 'a', name: 'A', isAi: false },
  ]);
  assert.equal(viewFor(s, 'a').you, null);
});
