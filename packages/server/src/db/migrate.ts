import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { env } from '../env';

/** Applies pending SQL migrations from ./drizzle. Run with `npm run db:migrate`. */
async function main() {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set — nothing to migrate.');
  }
  const sql = postgres(env.DATABASE_URL, { max: 1 });
  await migrate(drizzle(sql), { migrationsFolder: './drizzle' });
  await sql.end();
  console.log('Migrations applied.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
