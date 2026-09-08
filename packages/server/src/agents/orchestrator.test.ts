import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameEngine } from '../game/engine';
import { HeuristicAgent } from './heuristic';
import { InMemoryAgentMemory } from './memory';
import { AgentOrchestrator } from './orchestrator';

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

test('tick makes no further changes once the game is over', async () => {
  const { engine, orchestrator } = setup();
  const ids = seatAi(engine, ['A', 'B', 'C', 'D']);
  engine.apply('g', ids[0]!, { t: 'START', gameId: 'g' });
  await orchestrator.tick('g');

  const transcriptLen = engine.state('g')!.transcript.length;
  await orchestrator.tick('g');
  assert.equal(engine.state('g')!.transcript.length, transcriptLen);
});
