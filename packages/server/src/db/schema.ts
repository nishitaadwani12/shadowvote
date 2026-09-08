import { relations } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/**
 * ShadowVote persists an event-sourced game: `events` is the append-only log
 * and every other table is a materialized projection that can be rebuilt from
 * it. This lets a crashed game resume by replaying its events in `seq` order.
 */

export const games = pgTable('games', {
  // The room id (a human-friendly string like "table-1"), not a UUID.
  id: text('id').primaryKey(),
  phase: text('phase').notNull().default('LOBBY'),
  round: integer('round').notNull().default(0),
  seed: text('seed').notNull(),
  config: jsonb('config').notNull().default({}),
  winner: text('winner'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const players = pgTable(
  'players',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    role: text('role'),
    isAi: boolean('is_ai').notNull().default(false),
    persona: text('persona'),
    alive: boolean('alive').notNull().default(true),
  },
  (t) => ({ byGame: index('players_game_idx').on(t.gameId) }),
);

export const events = pgTable(
  'events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    seq: integer('seq').notNull(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // Guarantees a total order per game and makes replay deterministic.
    bySeq: uniqueIndex('events_game_seq_idx').on(t.gameId, t.seq),
  }),
);

export const agentMemories = pgTable(
  'agent_memories',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playerId: uuid('player_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    content: text('content').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ byPlayer: index('agent_memories_player_idx').on(t.playerId) }),
);

export const votes = pgTable(
  'votes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    round: integer('round').notNull(),
    voterId: uuid('voter_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
    targetId: uuid('target_id')
      .notNull()
      .references(() => players.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    // One vote per player per round.
    oneVote: uniqueIndex('votes_round_voter_idx').on(t.gameId, t.round, t.voterId),
  }),
);

export const gamesRelations = relations(games, ({ many }) => ({
  players: many(players),
  events: many(events),
}));

export const playersRelations = relations(players, ({ one }) => ({
  game: one(games, { fields: [players.gameId], references: [games.id] }),
}));
