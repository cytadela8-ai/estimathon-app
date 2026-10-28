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
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const password = 'test-password-12345678';
const servers: Awaited<ReturnType<typeof createApp>>[] = [];
const sockets: Socket[] = [];
const directories: string[] = [];
afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  for (const server of servers.splice(0)) await server.app.close();
  for (const directory of directories.splice(0)) {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
async function setup(databasePath = ':memory:') {
  const server = await createApp({ databasePath, password });
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
      revealDelaySeconds: 2,
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
it('accepts a simultaneous network burst from 300 participants on durable SQLite', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'estymator-burst-'));
  directories.push(directory);
  const f = await setup(join(directory, 'contest.sqlite'));
  expect(f.db.pragma('journal_mode', { simple: true })).toBe('wal');
  expect(f.db.pragma('synchronous', { simple: true })).toBe(2);
  f.contest.configure(
    {
      durationSeconds: 180,
      revealDelaySeconds: 2,
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

it('protects audit/review APIs and keeps exclusions authoritative when accepted messages retry', async () => {
  const f = await setup();
  f.contest.configure({ durationSeconds: 180, revealDelaySeconds: 1, maxAnswer: '9999' }, [
    { id: '', text: 'Audit', correct: '100', seconds: 180 },
  ]);
  f.contest.command('start');
  const response = await f.app.inject({
    method: 'POST',
    url: '/api/session',
    payload: { firstName: 'A', lastName: 'B', nickname: 'Audit' },
  });
  const session = response.json<Session>();
  const player = await connect(f.url, session.token);
  const op: Operation = {
    questionId: f.contest.question!.id,
    revision: 10,
    operationId: randomUUID(),
    text: '100',
    timing: { inputAt: Date.now(), endsAt: f.contest.state.endsAt!, offsetMs: 0 },
  };
  const original = await new Promise<Receipt>((resolve) => player.emit('save', op, resolve));
  expect((await f.app.inject({ url: '/api/admin/results' })).statusCode).toBe(401);
  expect(
    (await f.app.inject({ method: 'POST', url: '/api/admin/review', payload: {} })).statusCode,
  ).toBe(401);
  const login = await f.app.inject({ method: 'POST', url: '/api/login', payload: { password } });
  const headers = { authorization: `Bearer ${login.json<{ token: string }>().token}` };
  const decision = {
    participantId: session.participant.id,
    operationId: op.operationId,
    excluded: true,
    reason: 'Checking anomaly',
  };
  const update = new Promise<import('#est-shared/protocol').AnswerState>((resolve) =>
    player.once('answers', resolve),
  );
  expect(
    (await f.app.inject({ method: 'POST', url: '/api/admin/review', headers, payload: decision }))
      .statusCode,
  ).toBe(200);
  expect((await update).answers).toEqual([]);
  const retryUpdate = new Promise<import('#est-shared/protocol').AnswerState>((resolve) =>
    player.once('answers', resolve),
  );
  const retry = await new Promise<Receipt>((resolve) => player.emit('save', op, resolve));
  expect(retry).toEqual(original);
  expect(await retryUpdate).toEqual({ answers: [], revisions: { [op.questionId]: 10 } });
  const host = await f.app.inject({ url: '/api/admin/results', headers });
  expect(host.json<{ audit: { excluded: boolean }[] }>().audit[0]?.excluded).toBe(true);
  expect(
    (
      await f.app.inject({
        method: 'POST',
        url: '/api/admin/review',
        headers,
        payload: { ...decision, reason: '' },
      })
    ).statusCode,
  ).toBe(400);
  expect(f.contest.snapshot().answerCount).toBe(0);
});
