import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GameEngine } from './engine';

function seat(engine: GameEngine, gameId: string, names: string[]): string[] {
  return names.map((n) => engine.join(gameId, n));
}

test('joining creates players and a per-game event log', () => {
  const engine = new GameEngine();
  const [p1, p2] = seat(engine, 'g', ['Ada', 'Bob']);
  assert.notEqual(p1, p2);
  assert.equal(engine.state('g')?.players.length, 2);
  assert.equal(engine.view('g', p1!)?.players.length, 2);
});

test('START deals roles and opens the first night', () => {
  const engine = new GameEngine();
  const [p1] = seat(engine, 'g', ['A', 'B', 'C', 'D']);
  engine.apply('g', p1!, { t: 'START', gameId: 'g' });
  const state = engine.state('g');
  assert.equal(state?.phase, 'NIGHT');
  assert.ok(state?.players.every((p) => p.role !== null));
  // Each player sees their own role, not others'.
  assert.ok(engine.view('g', p1!)?.you?.role);
});

test('chat is recorded in game state and visible in views', () => {
  const engine = new GameEngine();
  const [p1] = seat(engine, 'g', ['A', 'B', 'C', 'D']);
  engine.apply('g', p1!, { t: 'CHAT', gameId: 'g', text: 'hello' });
  assert.equal(engine.view('g', p1!)?.transcript.at(-1)?.text, 'hello');
});

test('invalid commands throw with a message', () => {
  const engine = new GameEngine();
  const [p1] = seat(engine, 'g', ['A', 'B']);
  assert.throws(() => engine.apply('g', p1!, { t: 'START', gameId: 'g' }), /at least 4 players/);
  assert.throws(() => engine.apply('missing', 'x', { t: 'START', gameId: 'missing' }), /No such game/);
});
