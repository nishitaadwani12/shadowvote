import type { WebSocket } from 'ws';

export interface Connection {
  gameId: string;
  playerId: string;
  socket: WebSocket;
}

/**
 * Tracks live sockets per game so the server can fan out state updates. It
 * holds no game state — the authoritative state lives in the event-sourced
 * {@link GameEngine}; a reconnecting socket is simply re-attached and re-synced.
 */
export class ConnectionRegistry {
  private readonly byGame = new Map<string, Set<Connection>>();
  private readonly bySocket = new Map<WebSocket, Connection>();

  attach(gameId: string, playerId: string, socket: WebSocket): void {
    const conn: Connection = { gameId, playerId, socket };
    const set = this.byGame.get(gameId) ?? new Set<Connection>();
    set.add(conn);
    this.byGame.set(gameId, set);
    this.bySocket.set(socket, conn);
  }

  detach(socket: WebSocket): Connection | undefined {
    const conn = this.bySocket.get(socket);
    if (!conn) return undefined;
    this.bySocket.delete(socket);
    const set = this.byGame.get(conn.gameId);
    set?.delete(conn);
    if (set && set.size === 0) this.byGame.delete(conn.gameId);
    return conn;
  }

  meta(socket: WebSocket): Connection | undefined {
    return this.bySocket.get(socket);
  }

  each(gameId: string, fn: (conn: Connection) => void): void {
    this.byGame.get(gameId)?.forEach(fn);
  }
}
