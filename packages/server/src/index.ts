import { env } from './env';
import { buildServer } from './server';

async function main() {
  const app = await buildServer();
  await app.listen({ port: env.PORT, host: env.HOST });
  app.log.info(`WebSocket endpoint ready at ws://${env.HOST}:${env.PORT}/ws`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
