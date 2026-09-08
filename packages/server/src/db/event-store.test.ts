import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { GameEvent } from '@shadowvote/shared';
import { InMemoryEventStore } from './event-store';

test('append accumulates events and loadAll returns them in order', async () => {
  const store = new InMemoryEventStore();
  const e1: GameEvent[] = [{ type: 'GAME_CREATED', gameId: 'g', seed: 's' }];
  const e2: GameEvent[] = [{ type: 'PLAYER_JOINED', playerId: 'p1', name: 'A', isAi: false }];
  await store.append('g', 's', e1, 0);
  await store.append('g', 's', e2, 1);

  const all = await store.loadAll();
  assert.equal(all.get('g')?.seed, 's');
  assert.deepEqual(all.get('g')?.events, [...e1, ...e2]);
});

test('loadAll returns an isolated copy', async () => {
  const store = new InMemoryEventStore();
  await store.append('g', 's', [{ type: 'GAME_CREATED', gameId: 'g', seed: 's' }], 0);
  const snapshot = await store.loadAll();
  snapshot.get('g')!.events.push({ type: 'GAME_OVER', winner: 'VILLAGE' });
  const fresh = await store.loadAll();
  assert.equal(fresh.get('g')?.events.length, 1, 'mutating a snapshot does not affect the store');
});
