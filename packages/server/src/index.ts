import Fastify from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@shadowvote/shared';
import { env } from './env';
import { RoomRegistry } from './game/rooms';

const app = Fastify({ logger: true });
const rooms = new RoomRegistry();

app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

/** Tracks which room/player each socket belongs to so we can clean up on close. */
const sockets = new WeakMap<WebSocket, { gameId: string; playerId: string }>();

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

function handleMessage(socket: WebSocket, raw: string): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    send(socket, { t: 'ERROR', message: 'Malformed message (expected JSON).' });
    return;
  }

  switch (msg.t) {
    case 'JOIN': {
      const playerId = rooms.join(msg.gameId, msg.name, socket);
      sockets.set(socket, { gameId: msg.gameId, playerId });
      send(socket, { t: 'JOINED', playerId, gameId: msg.gameId });
      const view = rooms.viewFor(msg.gameId, playerId);
      if (view) rooms.broadcast(msg.gameId, { t: 'STATE', state: view });
      break;
    }
    case 'CHAT': {
      const line = rooms.addChat(msg.gameId, sockets.get(socket)?.playerId ?? '', msg.text);
      if (line) rooms.broadcast(msg.gameId, { t: 'CHAT_MSG', line });
      break;
    }
    case 'RESYNC': {
      const ctx = sockets.get(socket);
      const view = ctx ? rooms.viewFor(msg.gameId, ctx.playerId) : null;
      if (view) send(socket, { t: 'STATE', state: view });
      break;
    }
    // START / NIGHT_ACTION / VOTE arrive with the game engine in P1.
    default:
      send(socket, { t: 'ERROR', message: `"${msg.t}" is not handled yet (coming in P1).` });
  }
}

async function main() {
  await app.ready();

  const wss = new WebSocketServer({ noServer: true });
  app.server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url ?? '/', 'http://localhost').pathname !== '/ws') {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });

  wss.on('connection', (socket: WebSocket) => {
    socket.on('message', (data) => handleMessage(socket, data.toString()));
    socket.on('close', () => {
      const ctx = sockets.get(socket);
      if (ctx) {
        rooms.leave(ctx.gameId, ctx.playerId);
        const view = rooms.viewFor(ctx.gameId, ctx.playerId);
        if (view) rooms.broadcast(ctx.gameId, { t: 'STATE', state: view });
      }
    });
  });

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`WebSocket endpoint ready at ws://${env.HOST}:${env.PORT}/ws`);
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
