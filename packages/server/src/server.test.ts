import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocket } from 'ws';
import type { NightAction, Role } from '@shadowvote/shared';
import { HeuristicAgent } from './agents/heuristic';
import { InMemoryEventStore } from './db/event-store';
import { buildServer } from './server';

const ROLE_ACTION: Partial<Record<Role, NightAction>> = { WEREWOLF: 'KILL', SEER: 'INSPECT', DOCTOR: 'PROTECT' };

async function startServer() {
  const app = await buildServer({ logger: false, agent: new HeuristicAgent(), store: new InMemoryEventStore() });
  await app.listen({ port: 0, host: '127.0.0.1' });
  const { port } = app.server.address() as AddressInfo;
  return { app, url: `ws://127.0.0.1:${port}/ws` };
}

test('a full game runs to a winner over WebSocket (human + AI)', async () => {
  const { app, url } = await startServer();
  const gameId = 'itest';
  const ws = new WebSocket(url);
  await once(ws, 'open');

  const done = new Set<string>();
  const finished = new Promise<string>((resolve) => {
    ws.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      if (m.t !== 'STATE') return;
      const s = m.state;
      if (s.winner) return resolve(s.winner);
      const you = s.you;
      if (!you || !you.alive) return;
      const other = s.players.find((p: { id: string; alive: boolean }) => p.alive && p.id !== you.id)?.id;
      if (!other) return;

      if (s.phase === 'NIGHT' && ROLE_ACTION[you.role as Role]) {
        if (done.has(`n${s.round}`)) return;
        done.add(`n${s.round}`);
        ws.send(JSON.stringify({ t: 'NIGHT_ACTION', gameId, action: ROLE_ACTION[you.role as Role], targetId: other }));
      } else if (s.phase === 'DAY_DISCUSSION' || s.phase === 'DAY_VOTE') {
        if (done.has(`v${s.round}`)) return;
        done.add(`v${s.round}`);
        ws.send(JSON.stringify({ t: 'VOTE', gameId, targetId: other }));
      }
    });
  });

  ws.send(JSON.stringify({ t: 'JOIN', gameId, name: 'Human' }));
  for (const name of ['AI-1', 'AI-2', 'AI-3']) ws.send(JSON.stringify({ t: 'ADD_AI', gameId, name }));
  ws.send(JSON.stringify({ t: 'START', gameId }));

  let timer: NodeJS.Timeout;
  const guard = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('game did not finish in time')), 20_000);
  });
  try {
    const winner = await Promise.race([finished, guard]);
    assert.ok(winner === 'VILLAGE' || winner === 'WEREWOLF');
  } finally {
    clearTimeout(timer!);
    ws.close();
    await app.close();
  }
});

test('a player can reconnect to their seat via REJOIN', async () => {
  const { app, url } = await startServer();
  const gameId = 'reconnect';

  const first = new WebSocket(url);
  await once(first, 'open');
  first.send(JSON.stringify({ t: 'JOIN', gameId, name: 'Ada' }));
  const [joinRaw] = await once(first, 'message');
  const playerId = JSON.parse(joinRaw.toString()).playerId as string;
  first.close();
  await once(first, 'close');

  const second = new WebSocket(url);
  await once(second, 'open');

  // JOINED and STATE arrive back-to-back, so collect with one persistent listener.
  const seen: Record<string, any> = {};
  const gotBoth = new Promise<void>((resolve) => {
    second.on('message', (raw) => {
      const m = JSON.parse(raw.toString());
      seen[m.t] = m;
      if (seen.JOINED && seen.STATE) resolve();
    });
  });
  second.send(JSON.stringify({ t: 'REJOIN', gameId, playerId }));
  await gotBoth;

  assert.equal(seen.JOINED.playerId, playerId);
  assert.ok(seen.STATE.state.players.some((p: { id: string }) => p.id === playerId));

  second.close();
  await app.close();
});

test('REJOIN with an unknown player is rejected', async () => {
  const { app, url } = await startServer();
  const ws = new WebSocket(url);
  await once(ws, 'open');
  ws.send(JSON.stringify({ t: 'REJOIN', gameId: 'nope', playerId: 'ghost' }));
  const [raw] = await once(ws, 'message');
  const msg = JSON.parse(raw.toString());
  assert.equal(msg.t, 'ERROR');
  assert.match(msg.message, /Session expired/);
  ws.close();
  await app.close();
});
