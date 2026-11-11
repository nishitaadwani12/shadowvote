import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().default(8080),
  HOST: z.string().default('0.0.0.0'),
  /** Optional in P0 — the health check and lobby run without a database. */
  DATABASE_URL: z.string().optional(),
  /** Optional until P2 — required once AI agents take turns. */
  GEMINI_API_KEY: z.string().optional(),
  /** Gemini model for AI players. Override when Google retires a model. */
  GEMINI_MODEL: z.string().default('gemini-flash-lite-latest'),
});

export const env = schema.parse(process.env);
