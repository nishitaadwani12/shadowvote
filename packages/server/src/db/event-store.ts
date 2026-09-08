import { asc, eq } from 'drizzle-orm';
import type { GameEvent } from '@shadowvote/shared';
import { createDb, type Db } from './client';
import { events as eventsTable, games } from './schema';

export interface StoredGame {
  seed: string;
  events: GameEvent[];
}

/**
 * Persistence boundary for the event log. The engine writes through here and
 * hydrates from here on startup — the mechanism behind crash recovery. Two
 * implementations: in-memory (default, zero-config) and Postgres (durable).
 */
export interface EventStore {
  /** Append `events` for a game; `startSeq` is the log index of the first event. */
  append(gameId: string, seed: string, events: GameEvent[], startSeq: number): Promise<void>;
  /** Load every persisted game so the engine can rebuild its state. */
  loadAll(): Promise<Map<string, StoredGame>>;
}

export class InMemoryEventStore implements EventStore {
  private readonly store = new Map<string, StoredGame>();

  async append(gameId: string, seed: string, events: GameEvent[], _startSeq: number): Promise<void> {
    const game = this.store.get(gameId) ?? { seed, events: [] };
    game.events.push(...events);
    this.store.set(gameId, game);
  }

  async loadAll(): Promise<Map<string, StoredGame>> {
    return new Map([...this.store].map(([id, g]) => [id, { seed: g.seed, events: [...g.events] }]));
  }
}

/** Durable event store backed by the `games` + `events` tables. */
export class PostgresEventStore implements EventStore {
  private conn: Db | null = null;

  private db(): Db {
    return (this.conn ??= createDb());
  }

  async append(gameId: string, seed: string, events: GameEvent[], startSeq: number): Promise<void> {
    const db = this.db();
    await db.insert(games).values({ id: gameId, seed }).onConflictDoNothing();
    if (events.length === 0) return;
    await db.insert(eventsTable).values(
      events.map((event, i) => ({ gameId, seq: startSeq + i, type: event.type, payload: event })),
    );
  }

  async loadAll(): Promise<Map<string, StoredGame>> {
    const db = this.db();
    const map = new Map<string, StoredGame>();
    const gameRows = await db.select({ id: games.id, seed: games.seed }).from(games);
    for (const g of gameRows) {
      const rows = await db
        .select({ payload: eventsTable.payload })
        .from(eventsTable)
        .where(eq(eventsTable.gameId, g.id))
        .orderBy(asc(eventsTable.seq));
      map.set(g.id, { seed: g.seed, events: rows.map((r) => r.payload as GameEvent) });
    }
    return map;
  }
}
