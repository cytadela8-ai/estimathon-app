/** Browser tests launch the compiled production backend in a separate Node process. */
import { createApp } from '#est-server/app';
const databasePath = process.argv[2];
if (!databasePath) throw new Error('Browser fixture requires an isolated database filename.');
const { app } = await createApp({ databasePath, password: 'browser-test-host-password' });
await app.listen({ host: '127.0.0.1', port: Number(process.argv[3] ?? 0) });
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('Browser server failed to bind TCP.');
process.send!({ url: `http://127.0.0.1:${address.port}` });
process.on('SIGTERM', () => void app.close().then(() => process.exit(0)));
