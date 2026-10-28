/** A disposable real server killed by the restart test after it acknowledges a committed answer. */
import { createApp } from '#est-server/app';
const databasePath = process.argv[2];
if (!databasePath) throw new Error('Restart fixture requires a temporary database path.');
const { app, contest } = await createApp({ databasePath, password: 'restart-test-password' });
contest.configure(
  {
    durationSeconds: 180,
    graceSeconds: 5,
    latePolicy: 'strict',
    resultsSeconds: null,
    maxAnswer: '1000000',
  },
  [{ id: '', text: 'Restart test', correct: '123', seconds: 180 }],
);
contest.command('start');
await app.listen({ host: '127.0.0.1', port: 0 });
const address = app.server.address();
if (!address || typeof address === 'string') throw new Error('Restart fixture failed to bind TCP.');
process.send!({ url: `http://127.0.0.1:${address.port}` });
