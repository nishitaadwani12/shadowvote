import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { env } from '../env';
import * as schema from './schema';

/**
 * Lazily create a Drizzle client. Kept out of module scope so the server can
 * boot (and serve /health + the lobby) even when DATABASE_URL is unset in P0.
 */
export function createDb() {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — configure a Postgres connection to enable persistence.');
  }
  const sql = postgres(env.DATABASE_URL, { max: 5 });
  return drizzle(sql, { schema });
}

export type Db = ReturnType<typeof createDb>;
