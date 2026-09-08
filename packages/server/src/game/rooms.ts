import { randomUUID } from 'node:crypto';
import type { WebSocket } from 'ws';
import type { ChatLine, GameStateView, PlayerPublic, ServerMessage } from '@shadowvote/shared';

interface Member {
  playerId: string;
  name: string;
  socket: WebSocket;
}

interface Room {
  gameId: string;
  members: Map<string, Member>;
  transcript: ChatLine[];
}

/**
 * In-memory registry of active game rooms. P0 handles lobby membership and
 * chat fan-out; from P1 the authoritative game state is loaded from the event
 * store and this registry only tracks live sockets for broadcasting.
 */
export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();

  join(gameId: string, name: string, socket: WebSocket): string {
    const room = this.rooms.get(gameId) ?? { gameId, members: new Map(), transcript: [] };
    const playerId = randomUUID();
    room.members.set(playerId, { playerId, name, socket });
    this.rooms.set(gameId, room);
    return playerId;
  }

  leave(gameId: string, playerId: string): void {
    const room = this.rooms.get(gameId);
    if (!room) return;
    room.members.delete(playerId);
    if (room.members.size === 0) this.rooms.delete(gameId);
  }

  addChat(gameId: string, playerId: string, text: string): ChatLine | null {
    const room = this.rooms.get(gameId);
    const member = room?.members.get(playerId);
    if (!room || !member) return null;
    const line: ChatLine = { playerId, name: member.name, text, round: 0, at: Date.now() };
    room.transcript.push(line);
    return line;
  }

  /** Broadcast a message to every live socket in a room. */
  broadcast(gameId: string, message: ServerMessage): void {
    const room = this.rooms.get(gameId);
    if (!room) return;
    const payload = JSON.stringify(message);
    for (const member of room.members.values()) {
      if (member.socket.readyState === member.socket.OPEN) member.socket.send(payload);
    }
  }

  /** The lobby view a specific player is allowed to see. */
  viewFor(gameId: string, playerId: string): GameStateView | null {
    const room = this.rooms.get(gameId);
    if (!room) return null;
    const players: PlayerPublic[] = [...room.members.values()].map((m) => ({
      id: m.playerId,
      name: m.name,
      isAi: false,
      alive: true,
    }));
    return {
      gameId,
      phase: 'LOBBY',
      round: 0,
      players,
      you: null,
      transcript: room.transcript,
      winner: null,
    };
  }
}
