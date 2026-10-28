/** Real Socket.IO integration tests include unauthenticated projectors and reconnect snapshots. */
import { it, expect, afterEach } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '#est-server/app';
import type {
  ClientEvents,
  ServerEvents,
  Session,
  Hello,
  Receipt,
  Operation,
} from '#est-shared/protocol';
import { randomUUID } from 'node:crypto';
const password = 'test-password-12345678';
const servers: Awaited<ReturnType<typeof createApp>>[] = [];
const sockets: Socket[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  for (const server of servers.splice(0)) await server.app.close();
});
async function setup() {
  const server = await createApp({ databasePath: ':memory:', password });
  servers.push(server);
  await server.app.listen({ host: '127.0.0.1', port: 0 });
  const address = server.app.server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP listener');
  const url = `http://127.0.0.1:${address.port}`;
  return { ...server, url };
}
async function connect(url: string, token?: string) {
  const socket = io(url, { auth: { token }, forceNew: true, reconnection: false }) as Socket<
    ServerEvents,
    ClientEvents
  >;
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });
  return socket;
}
it('protects admin routes and restores an account with its recovery code', async () => {
  const f = await setup();
  expect((await f.app.inject({ url: '/api/admin/overview' })).statusCode).toBe(401);
  expect(
    (await f.app.inject({ method: 'POST', url: '/api/login', payload: { password: 'wrong' } }))
      .statusCode,
  ).toBe(401);
  const login = await f.app.inject({ method: 'POST', url: '/api/login', payload: { password } });
  const token = login.json<{ token: string }>().token;
  expect(
    (
      await f.app.inject({
        url: '/api/admin/overview',
        headers: { authorization: `Bearer ${token}` },
      })
    ).statusCode,
  ).toBe(200);
  const created = await f.app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { firstName: 'Jan', lastName: 'K', nickname: 'JK' },
  });
  const session = created.json<Session>();
  const recovered = await f.app.inject({
    method: 'POST',
    url: '/api/recover',
    payload: { code: session.recoveryCode },
  });
  expect(recovered.json<Session>().token).toBe(session.token);
});
it('acknowledges durable saves and gives a reconnected projector a redacted snapshot', async () => {
  const f = await setup();
  f.contest.configure(
    {
      durationSeconds: 180,
      graceSeconds: 5,
      latePolicy: 'strict',
      resultsSeconds: null,
      maxAnswer: '9999',
    },
    [{ id: '', text: 'Ile?', correct: '100', seconds: 180 }],
  );
  f.contest.command('start');
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { firstName: 'A', lastName: 'B', nickname: 'AB' },
  });
  const session = response.json<Session>();
  const player = await connect(f.url, session.token);
  const op: Operation = {
    questionId: f.contest.question!.id,
    revision: 1,
    operationId: randomUUID(),
    text: '99',
  };
  const receipt = await new Promise<Receipt>((resolve) => player.emit('save', op, resolve));
  expect(receipt.status).toBe('accepted');
  expect(f.db.prepare('SELECT text FROM answers').get()).toEqual({ text: '99' });
  player.disconnect();
  const reopened = await connect(f.url, session.token);
  const hello = await new Promise<Hello>((resolve) => reopened.emit('snapshot', resolve));
  expect(hello.answers[0]?.text).toBe('99');
  const projector = await connect(f.url);
  const state = await new Promise<Hello>((resolve) => projector.emit('snapshot', resolve));
  expect(state.answers).toEqual([]);
  expect(state.snapshot.results).toEqual([]);
  expect(state.snapshot.correct).toBeNull();
  expect(state.snapshot.answerCount).toBe(1);
});
it('accepts a simultaneous network burst from 300 participants', async () => {
  const f = await setup();
  f.contest.configure(
    {
      durationSeconds: 180,
      graceSeconds: 5,
      latePolicy: 'strict',
      resultsSeconds: null,
      maxAnswer: '9999',
    },
    [{ id: '', text: 'Ile?', correct: '100', seconds: 180 }],
  );
  f.contest.command('start');
  const sessions = await Promise.all(
    Array.from({ length: 300 }, async (_, i) => {
      const response = await f.app.inject({
        method: 'POST',
        url: '/api/session',
        payload: { firstName: 'A', lastName: 'B', nickname: String(i) },
      });
      return response.json<Session>();
    }),
  );
  const players = await Promise.all(sessions.map((s) => connect(f.url, s.token)));
  const receipts = await Promise.all(
    players.map(
      (p, i) =>
        new Promise<Receipt>((resolve) =>
          p.emit(
            'save',
            {
              questionId: f.contest.question!.id,
              revision: 1,
              operationId: randomUUID(),
              text: String(i + 1),
            },
            resolve,
          ),
        ),
    ),
  );
  expect(receipts.filter((r) => r.status === 'accepted')).toHaveLength(300);
  expect(f.contest.snapshot().answerCount).toBe(300);
}, 20000);
