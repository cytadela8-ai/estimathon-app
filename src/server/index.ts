/** LAN entrypoint. Secrets come from the environment, never from bundled browser code. */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from '#est-server/app';
import type { Scorer } from '#est-server/scoring';
const modulePath = process.env['SCORE_MODULE'];
const score = modulePath
  ? ((await import(pathToFileURL(resolve(modulePath)).href)).score as Scorer)
  : undefined;
if (modulePath && typeof score !== 'function')
  throw new Error('SCORE_MODULE must export a score function.');
const { app } = await createApp({
  databasePath: process.env['DATABASE_PATH'] ?? 'data/estymator.sqlite',
  password: process.env['ADMIN_PASSWORD'] ?? '',
  ...(score ? { score } : {}),
});
await app.listen({
  host: process.env['HOST'] ?? '0.0.0.0',
  port: Number(process.env['PORT'] ?? 3000),
});
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void app.close();
  });
