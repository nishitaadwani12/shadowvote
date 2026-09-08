import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { WebSocket } from 'ws';
import { RoomRegistry } from './rooms';

/** Minimal WebSocket stand-in that records what was sent to it. */
class FakeSocket {
  readonly OPEN = 1;
  readyState = 1;
  sent: string[] = [];
  send(data: string): void {
    this.sent.push(data);
  }
}

const asSocket = (s: FakeSocket) => s as unknown as WebSocket;

test('join adds a player visible in the room view', () => {
  const reg = new RoomRegistry();
  const a = new FakeSocket();
  const id = reg.join('room-1', 'Ada', asSocket(a));
  const view = reg.viewFor('room-1', id);
  assert.equal(view?.phase, 'LOBBY');
  assert.equal(view?.players.length, 1);
  assert.equal(view?.players[0]?.name, 'Ada');
  assert.equal(view?.players[0]?.id, id);
});

test('chat is recorded in the transcript', () => {
  const reg = new RoomRegistry();
  const id = reg.join('room-1', 'Ada', asSocket(new FakeSocket()));
  const line = reg.addChat('room-1', id, 'hello table');
  assert.equal(line?.text, 'hello table');
  assert.equal(line?.name, 'Ada');
  assert.equal(reg.viewFor('room-1', id)?.transcript.length, 1);
});

test('chat from an unknown player is rejected', () => {
  const reg = new RoomRegistry();
  reg.join('room-1', 'Ada', asSocket(new FakeSocket()));
  assert.equal(reg.addChat('room-1', 'ghost', 'boo'), null);
  assert.equal(reg.addChat('missing-room', 'ghost', 'boo'), null);
});

test('broadcast reaches open sockets and skips closed ones', () => {
  const reg = new RoomRegistry();
  const open = new FakeSocket();
  const closed = new FakeSocket();
  closed.readyState = 3; // CLOSED
  reg.join('room-1', 'Ada', asSocket(open));
  reg.join('room-1', 'Bob', asSocket(closed));

  reg.broadcast('room-1', { t: 'ERROR', message: 'ping' });
  assert.equal(open.sent.length, 1);
  assert.equal(closed.sent.length, 0);
  assert.match(open.sent[0]!, /ping/);
});

test('leaving removes the player and drops the empty room', () => {
  const reg = new RoomRegistry();
  const id = reg.join('room-1', 'Ada', asSocket(new FakeSocket()));
  reg.leave('room-1', id);
  assert.equal(reg.viewFor('room-1', id), null);
});
