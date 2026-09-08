import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebSocket } from 'ws';
import { ConnectionRegistry } from './connections';

const fakeSocket = () => ({}) as unknown as WebSocket;

test('attach then each iterates connections in a game', () => {
  const reg = new ConnectionRegistry();
  reg.attach('g', 'p1', fakeSocket());
  reg.attach('g', 'p2', fakeSocket());
  const seen: string[] = [];
  reg.each('g', (c) => seen.push(c.playerId));
  assert.deepEqual(seen.sort(), ['p1', 'p2']);
});

test('meta resolves the connection for a socket', () => {
  const reg = new ConnectionRegistry();
  const s = fakeSocket();
  reg.attach('g', 'p1', s);
  assert.equal(reg.meta(s)?.playerId, 'p1');
  assert.equal(reg.meta(s)?.gameId, 'g');
});

test('detach removes the socket and cleans up empty games', () => {
  const reg = new ConnectionRegistry();
  const s = fakeSocket();
  reg.attach('g', 'p1', s);
  const removed = reg.detach(s);
  assert.equal(removed?.playerId, 'p1');
  assert.equal(reg.meta(s), undefined);
  let count = 0;
  reg.each('g', () => count++);
  assert.equal(count, 0);
});
