import assert from 'node:assert/strict';
import { test } from 'node:test';
import { HeuristicAgent } from './heuristic';
import type { AgentContext } from './agent';

const ctx = (over: Partial<AgentContext>): AgentContext => ({
  role: 'VILLAGER',
  persona: 'x',
  round: 1,
  phase: 'DAY_VOTE',
  transcript: '',
  memories: [],
  candidates: [],
  allies: [],
  ...over,
});

test('targets one of the available candidates', async () => {
  const candidates = [{ id: 't1', name: 'T1' }, { id: 't2', name: 'T2' }];
  const decision = await new HeuristicAgent().decide(ctx({ role: 'WEREWOLF', phase: 'NIGHT', candidates }));
  assert.ok(candidates.some((c) => c.id === decision.targetId));
  assert.ok(decision.reasoning.length > 0);
});

test('speaks during discussion, stays quiet otherwise', async () => {
  const day = await new HeuristicAgent().decide(ctx({ phase: 'DAY_DISCUSSION', candidates: [{ id: 't1', name: 'T1' }] }));
  assert.ok(day.speech.length > 0);
  const night = await new HeuristicAgent().decide(ctx({ phase: 'NIGHT', role: 'SEER', candidates: [{ id: 't1', name: 'T1' }] }));
  assert.equal(night.speech, '');
});

test('abstains when there are no candidates', async () => {
  const decision = await new HeuristicAgent().decide(ctx({ candidates: [] }));
  assert.equal(decision.targetId, null);
});

test('a werewolf never targets a known ally', async () => {
  const decision = await new HeuristicAgent().decide(
    ctx({
      role: 'WEREWOLF',
      phase: 'NIGHT',
      candidates: [{ id: 'ally', name: 'Ally' }, { id: 'victim', name: 'Victim' }],
      allies: [{ id: 'ally', name: 'Ally' }],
    }),
  );
  assert.equal(decision.targetId, 'victim');
});
