/**
 * Persistent-ish memory for AI players. P2 keeps memories in process; the
 * `agent_memories` table is the drop-in backing store (same shape: keyed by
 * game + player, ordered, with a round). Each agent recalls its own notes to
 * reason across rounds.
 */
export interface AgentMemory {
  remember(gameId: string, playerId: string, round: number, content: string): void;
  recall(gameId: string, playerId: string): string[];
}

export class InMemoryAgentMemory implements AgentMemory {
  private readonly store = new Map<string, string[]>();

  private key(gameId: string, playerId: string): string {
    return `${gameId}:${playerId}`;
  }

  remember(gameId: string, playerId: string, round: number, content: string): void {
    const key = this.key(gameId, playerId);
    const notes = this.store.get(key) ?? [];
    notes.push(`r${round}: ${content}`);
    this.store.set(key, notes);
  }

  recall(gameId: string, playerId: string): string[] {
    return this.store.get(this.key(gameId, playerId)) ?? [];
  }
}
