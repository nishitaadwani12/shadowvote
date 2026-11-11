import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameEngine } from '../game/engine';
import type { NightAction, Role } from '@shadowvote/shared';
import type { Agent, AgentContext } from './agent';
import { HeuristicAgent } from './heuristic';
import { InMemoryAgentMemory } from './memory';
import { InMemoryEventStore } from '../db/event-store';
import { AgentOrchestrator, REPLIES_PER_HUMAN_MESSAGE } from './orchestrator';

function setup() {
  const engine = new GameEngine();
  const memory = new InMemoryAgentMemory();
  const reasoning: { playerId: string; round: number }[] = [];
  const orchestrator = new AgentOrchestrator(
    engine,
    new HeuristicAgent(),
    {
      onReasoning: (_g, playerId, _name, _r, round) => reasoning.push({ playerId, round }),
      onProgress: () => {},
    },
    memory,
  );
  return { engine, memory, orchestrator, reasoning };
}

const seatAi = (engine: GameEngine, names: string[]) => names.map((n) => engine.addAi('g', n, `${n} persona`));

test('an all-AI game plays itself to a conclusion', async () => {
  const { engine, orchestrator, reasoning, memory } = setup();
  const ids = seatAi(engine, ['Ada', 'Bob', 'Cy', 'Dee']);
  engine.apply('g', ids[0]!, { t: 'START', gameId: 'g' });

  await orchestrator.tick('g');

  const state = engine.state('g')!;
  assert.equal(state.phase, 'GAME_OVER');
  assert.ok(state.winner === 'VILLAGE' || state.winner === 'WEREWOLF');
  assert.ok(reasoning.length > 0, 'agents streamed reasoning');
  assert.ok(
    ids.some((id) => memory.recall('g', id).length > 0),
    'at least one agent accumulated memory',
  );
});

test('tick is a no-op while still in the lobby', async () => {
  const { engine, orchestrator, reasoning } = setup();
  seatAi(engine, ['A', 'B', 'C', 'D']);
  await orchestrator.tick('g');
  assert.equal(reasoning.length, 0);
  assert.equal(engine.state('g')?.phase, 'LOBBY');
});

/** An agent that never commits to a target (what Gemini returns when it chooses to abstain). */
const abstainer: Agent = {
  decide: async () => ({ speech: 'hmm', reasoning: 'I abstain', targetId: null }),
};

/** Seat a human first (as in real play), then AIs, and start the game. */
function humanTable(agent: Agent, random?: () => number) {
  const store = new InMemoryEventStore();
  const engine = new GameEngine(store);
  const orchestrator = new AgentOrchestrator(engine, agent, { onReasoning() {}, onProgress() {} }, new InMemoryAgentMemory(), random);
  const human = engine.join('g', 'Nishita');
  seatAi(engine, ['Aarav', 'Meera', 'Kabir', 'Isha']);
  engine.apply('g', human, { t: 'START', gameId: 'g' });
  return { engine, orchestrator, human, store };
}

/** Submit the human's night action (if their role has one) so the night can resolve. */
function humanActsAtNight(engine: GameEngine, human: string) {
  const s = engine.state('g')!;
  const role = s.players.find((p) => p.id === human)!.role!;
  const actions: Partial<Record<Role, NightAction>> = { WEREWOLF: 'KILL', SEER: 'INSPECT', DOCTOR: 'PROTECT' };
  const action = actions[role];
  if (!action) return;
  const target = s.players.find((p) => p.id !== human && p.alive && p.role !== 'WEREWOLF')!;
  engine.apply('g', human, { t: 'NIGHT_ACTION', gameId: 'g', action, targetId: target.id });
}

test('an abstaining AI casts a real abstain vote instead of voting for the first joiner', async () => {
  // Fixed random keeps the human alive through night 1 so day-1 ballots can be inspected.
  const { engine, orchestrator, human, store } = humanTable(abstainer, () => 0.999);
  await orchestrator.tick('g');
  humanActsAtNight(engine, human);
  await orchestrator.tick('g');
  // The human's ballot opens the vote; then every AI casts its ballot.
  const aiId = engine.state('g')!.players.find((p) => p.isAi && p.alive)!.id;
  engine.apply('g', human, { t: 'VOTE', gameId: 'g', targetId: aiId });
  await orchestrator.tick('g');

  const events = (await store.loadAll()).get('g')!.events;
  const aiBallots = events.filter((e) => e.type === 'VOTE_CAST' && e.round === 1 && e.voterId !== human);
  assert.ok(aiBallots.length > 0, 'AIs voted');
  for (const b of aiBallots) assert.equal(b.type === 'VOTE_CAST' && b.targetId, null, 'abstain is null, not the human');
  assert.equal(engine.state('g')!.players.find((p) => p.id === aiId)!.alive, false, "the human's lone vote decides it");
});

test('while a human is alive, AIs reply to them and wait for their vote instead of voting first', async () => {
  // Deterministic agent: night actions hit the last candidate (never the first-seated human),
  // speech always says something, votes abstain.
  const talker: Agent = {
    decide: async (ctx) => ({
      speech: ctx.replyTo ? `Answering ${ctx.replyTo.name}` : `I'm ${ctx.self.name}`,
      reasoning: 'test',
      targetId: ctx.phase === 'NIGHT' ? ctx.candidates.at(-1)!.id : null,
    }),
  };
  const { engine, orchestrator, human } = humanTable(talker);
  await orchestrator.tick('g');
  humanActsAtNight(engine, human);
  await orchestrator.tick('g');

  let s = engine.state('g')!;
  assert.equal(s.phase, 'DAY_DISCUSSION');
  assert.deepEqual(s.votes, {}, 'no AI votes before the human has had their say');
  const openings = s.transcript.filter((l) => l.round === 1).length;
  assert.equal(openings, s.players.filter((p) => p.isAi && p.alive).length, 'each AI gave one opening statement');

  // Address the last-seated AI, but also mention another one later in the message: the
  // addressee (named first) must still answer first, not whoever sits earlier at the table.
  const aliveAi = s.players.filter((p) => p.isAi && p.alive);
  const addressed = aliveAi.at(-1)!;
  const bystander = aliveAi[0]!;
  engine.apply('g', human, { t: 'CHAT', gameId: 'g', text: `${addressed.name}, you just echoed ${bystander.name}. Why?` });
  await orchestrator.tick('g');

  s = engine.state('g')!;
  const replies = s.transcript.slice(openings + 1);
  assert.equal(replies.length, REPLIES_PER_HUMAN_MESSAGE, 'a set number of AIs answer the human');
  assert.equal(replies[0]!.playerId, addressed.id, 'the AI the human named answers first');
  assert.deepEqual(s.votes, {}, 'still waiting on the human to vote');

  engine.apply('g', human, { t: 'VOTE', gameId: 'g', targetId: null });
  await orchestrator.tick('g');
  assert.notEqual(engine.state('g')!.round, 1, 'once the human votes, the AIs vote and the day resolves');
});

test('a night action with no valid pick falls back to a random target, not the first joiner', async () => {
  // random() → 0.999 always picks the LAST candidate; the old code always took candidates[0] (the human).
  const { engine, orchestrator, human } = humanTable(abstainer, () => 0.999);
  await orchestrator.tick('g');
  humanActsAtNight(engine, human);
  await orchestrator.tick('g');

  const s = engine.state('g')!;
  assert.notEqual(s.night.killTarget, human);
  assert.equal(s.players.find((p) => p.id === human)!.alive, true, 'the human is not killed by default');
});

test('agents are told who they are, wolves never see their pack as night targets, and ballots are framed as votes', async () => {
  const seen: AgentContext[] = [];
  const recorder: Agent = { decide: (ctx) => (seen.push(structuredClone(ctx)), new HeuristicAgent().decide(ctx)) };
  const engine = new GameEngine();
  const orchestrator = new AgentOrchestrator(engine, recorder, { onReasoning() {}, onProgress() {} }, new InMemoryAgentMemory());
  const ids = seatAi(engine, ['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8']); // 8 players → 2 wolves
  engine.apply('g', ids[0]!, { t: 'START', gameId: 'g' });
  await orchestrator.tick('g');

  assert.ok(seen.length > 0);
  for (const ctx of seen) {
    assert.ok(ctx.self.name, 'context carries the agent name');
    assert.ok(!ctx.candidates.some((c) => c.id === ctx.self.id), 'an agent is never its own target');
  }
  const wolfNights = seen.filter((c) => c.role === 'WEREWOLF' && c.phase === 'NIGHT');
  assert.ok(wolfNights.length > 0, 'wolves acted at night');
  for (const ctx of wolfNights) {
    for (const ally of ctx.allies) assert.ok(!ctx.candidates.some((c) => c.id === ally.id), 'ally is not a kill target');
  }
  assert.ok(seen.some((c) => c.phase === 'DAY_VOTE'), 'vote turns are framed as DAY_VOTE');
});

test('tick makes no further changes once the game is over', async () => {
  const { engine, orchestrator } = setup();
  const ids = seatAi(engine, ['A', 'B', 'C', 'D']);
  engine.apply('g', ids[0]!, { t: 'START', gameId: 'g' });
  await orchestrator.tick('g');

  const transcriptLen = engine.state('g')!.transcript.length;
  await orchestrator.tick('g');
  assert.equal(engine.state('g')!.transcript.length, transcriptLen);
});
