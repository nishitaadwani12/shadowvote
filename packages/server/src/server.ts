import Fastify, { type FastifyInstance } from 'fastify';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage, ServerMessage } from '@shadowvote/shared';
import { env } from './env';
import type { Agent } from './agents/agent';
import { GeminiAgent } from './agents/agent';
import { HeuristicAgent } from './agents/heuristic';
import { InMemoryAgentMemory } from './agents/memory';
import { AgentOrchestrator } from './agents/orchestrator';
import { InMemoryEventStore, PostgresEventStore, type EventStore } from './db/event-store';
import { ConnectionRegistry } from './game/connections';
import { GameEngine } from './game/engine';

export interface BuildOptions {
  logger?: boolean;
  /** Override the event store (tests inject an in-memory one). */
  store?: EventStore;
  /** Override the agent (tests inject a deterministic one). */
  agent?: Agent;
}

/**
 * Build the ShadowVote server without listening — the caller (or a test) opens
 * the port. WebSocket setup and event-log hydration run in an `onReady` hook so
 * the underlying HTTP server exists first.
 */
export async function buildServer(opts: BuildOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({ logger: opts.logger ?? true });

  const store = opts.store ?? (env.DATABASE_URL ? new PostgresEventStore() : new InMemoryEventStore());
  const engine = new GameEngine(store, (err) => app.log.error(err));
  const connections = new ConnectionRegistry();

  const agent: Agent = opts.agent ?? (env.GEMINI_API_KEY ? new GeminiAgent() : new HeuristicAgent());
  if (!opts.agent && !env.GEMINI_API_KEY) {
    app.log.warn('GEMINI_API_KEY not set — AI players will use the heuristic agent.');
  }

  const send = (socket: WebSocket, message: ServerMessage): void => {
    socket.send(JSON.stringify(message));
  };
  const broadcast = (gameId: string, message: ServerMessage): void => {
    connections.each(gameId, (conn) => send(conn.socket, message));
  };
  const broadcastState = (gameId: string): void => {
    connections.each(gameId, (conn) => {
      const view = engine.view(gameId, conn.playerId);
      if (view) send(conn.socket, { t: 'STATE', state: view });
    });
  };

  const orchestrator = new AgentOrchestrator(
    engine,
    agent,
    {
      onReasoning: (gameId, playerId, name, reasoning, round) =>
        broadcast(gameId, { t: 'AGENT_REASONING', playerId, name, reasoning, round }),
      onProgress: (gameId) => broadcastState(gameId),
    },
    new InMemoryAgentMemory(),
  );
  const runAi = (gameId: string): void => {
    orchestrator.tick(gameId).catch((err) => app.log.error(err));
  };

  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

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
        const playerId = engine.join(msg.gameId, msg.name);
        connections.attach(msg.gameId, playerId, socket);
        send(socket, { t: 'JOINED', playerId, gameId: msg.gameId });
        broadcastState(msg.gameId);
        return;
      }
      case 'REJOIN': {
        const exists = engine.state(msg.gameId)?.players.some((p) => p.id === msg.playerId);
        if (!exists) {
          send(socket, { t: 'ERROR', message: 'Session expired — please join again.' });
          return;
        }
        connections.attach(msg.gameId, msg.playerId, socket);
        send(socket, { t: 'JOINED', playerId: msg.playerId, gameId: msg.gameId });
        const view = engine.view(msg.gameId, msg.playerId);
        if (view) send(socket, { t: 'STATE', state: view });
        return;
      }
      case 'ADD_AI': {
        try {
          engine.addAi(msg.gameId, msg.name, msg.persona);
          broadcastState(msg.gameId);
        } catch (err) {
          send(socket, { t: 'ERROR', message: err instanceof Error ? err.message : 'Could not add AI player.' });
        }
        return;
      }
      case 'START': {
        // The host can start without occupying a seat (playerId is unused by startGame).
        try {
          engine.apply(msg.gameId, '', msg);
          broadcastState(msg.gameId);
          runAi(msg.gameId);
        } catch (err) {
          send(socket, { t: 'ERROR', message: err instanceof Error ? err.message : 'Could not start the game.' });
        }
        return;
      }
      case 'RESYNC': {
        const meta = connections.meta(socket);
        const view = meta ? engine.view(meta.gameId, meta.playerId) : null;
        if (view) send(socket, { t: 'STATE', state: view });
        return;
      }
      default: {
        const meta = connections.meta(socket);
        if (!meta) {
          send(socket, { t: 'ERROR', message: 'Join a game before sending commands.' });
          return;
        }
        try {
          engine.apply(meta.gameId, meta.playerId, msg);
          broadcastState(meta.gameId);
          runAi(meta.gameId);
        } catch (err) {
          send(socket, { t: 'ERROR', message: err instanceof Error ? err.message : 'Command failed.' });
        }
      }
    }
  }

  app.addHook('onReady', async () => {
    const restored = await engine.hydrate();
    if (restored > 0) app.log.info(`Restored ${restored} game(s) from the event log.`);

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
  });

  return app;
}
