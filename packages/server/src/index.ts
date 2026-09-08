import Fastify from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@shadowvote/shared';
import { env } from './env';
import { ConnectionRegistry } from './game/connections';
import { GameEngine } from './game/engine';

const app = Fastify({ logger: true });
const engine = new GameEngine();
const connections = new ConnectionRegistry();

app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

/** Push each connected player their own (role-hiding) view of the game. */
function broadcastState(gameId: string): void {
  connections.each(gameId, (conn) => {
    const view = engine.view(gameId, conn.playerId);
    if (view) send(conn.socket, { t: 'STATE', state: view });
  });
}

function handleMessage(socket: WebSocket, raw: string): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(raw) as ClientMessage;
  } catch {
    send(socket, { t: 'ERROR', message: 'Malformed message (expected JSON).' });
    return;
  }

  if (msg.t === 'JOIN') {
    const playerId = engine.join(msg.gameId, msg.name);
    connections.attach(msg.gameId, playerId, socket);
    send(socket, { t: 'JOINED', playerId, gameId: msg.gameId });
    broadcastState(msg.gameId);
    return;
  }

  if (msg.t === 'RESYNC') {
    const meta = connections.meta(socket);
    const view = meta ? engine.view(meta.gameId, meta.playerId) : null;
    if (view) send(socket, { t: 'STATE', state: view });
    return;
  }

  const meta = connections.meta(socket);
  if (!meta) {
    send(socket, { t: 'ERROR', message: 'Join a game before sending commands.' });
    return;
  }

  try {
    engine.apply(meta.gameId, meta.playerId, msg);
    broadcastState(meta.gameId);
  } catch (err) {
    send(socket, { t: 'ERROR', message: err instanceof Error ? err.message : 'Command failed.' });
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
    socket.on('close', () => connections.detach(socket));
  });

  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`WebSocket endpoint ready at ws://${env.HOST}:${env.PORT}/ws`);
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
