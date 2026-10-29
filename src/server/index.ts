/** LAN entrypoint. Secrets come from the environment, never from bundled browser code. */
import { createApp } from '#est-server/app';
const { app } = await createApp({
  databasePath: process.env['DATABASE_PATH'] ?? 'data/estymator.sqlite',
  password: process.env['ADMIN_PASSWORD'] ?? '',
  trustProxy: process.env['TRUST_PROXY'] === '1',
});
await app.listen({
  host: process.env['HOST'] ?? '0.0.0.0',
  port: Number(process.env['PORT'] ?? 3000),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close();
  });
