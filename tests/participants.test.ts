/** Account moderation removes all persisted data and revokes live and recovered access. */
import { afterEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '#est-server/app';
import { Sessions } from '#est-server/sessions';
import { AnswerStore } from '#est-server/answers';
import type { Session } from '#est-shared/protocol';

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
async function setup(trustProxy = false, databasePath = ':memory:') {
  const server = await createApp({ databasePath, password, trustProxy });
  servers.push(server);
  await server.app.listen({ host: '127.0.0.1', port: 0 });
  const login = await server.app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { password },
  });
  const headers = { authorization: `Bearer ${login.json<{ token: string }>().token}` };
  return { ...server, headers };
}
async function participant(server: Awaited<ReturnType<typeof setup>>) {
  const response = await server.app.inject({
    method: 'POST',
    url: '/api/session',
    headers: { 'x-forwarded-for': '198.51.100.8, 192.0.2.1' },
    payload: { firstName: 'Jan', lastName: 'Test', nickname: 'Player' },
  });
  return response.json<Session>();
}
async function connect(
  server: Awaited<ReturnType<typeof setup>>,
  token: string,
  forwarded: string,
) {
  if (!server.app.server.listening) await server.app.listen({ host: '127.0.0.1', port: 0 });
  const address = server.app.server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP listener');
  const socket = io(`http://127.0.0.1:${address.port}`, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
    extraHeaders: { 'x-forwarded-for': forwarded },
  });
  sockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}
it('deletes history and credentials, recalculates scores and disconnects all user sockets', async () => {
  const server = await setup();
  const session = await participant(server);
  const sessions = new Sessions(server.db);
  const answers = new AnswerStore(server.db, server.contest);
  server.contest.configure({ durationSeconds: 180, revealDelaySeconds: 1, maxAnswer: '9999' }, [
    { id: '', text: 'How many?', correct: '100', seconds: 180 },
  ]);
  server.contest.command('start');
  const questionId = server.contest.question!.id;
  const other = sessions.create({ firstName: 'Other', lastName: 'Test', nickname: 'Other' });
  answers.save(session.participant.id, {
    questionId,
    revision: 1,
    operationId: 'operation-aaaaaaaa',
    text: '400',
  });
  answers.save(other.participant.id, {
    questionId,
    revision: 1,
    operationId: 'operation-bbbbbbbb',
    text: '200',
  });
  answers.review({
    participantId: session.participant.id,
    operationId: 'operation-aaaaaaaa',
    excluded: false,
    reason: 'OK',
  });
  server.contest.command('finish');
  server.contest.tick(Date.now() + 2000);
  expect(
    server.contest.standings().find((p) => p.participantId === other.participant.id)?.score,
  ).toBe(600);
  const version = server.contest.state.version;
  const players = await Promise.all([
    connect(server, session.token, '192.0.2.9'),
    connect(server, session.token, '192.0.2.9'),
  ]);
  const disconnected = players.map(
    (socket) => new Promise<void>((resolve) => socket.once('disconnect', () => resolve())),
  );
  const url = `/api/admin/participants/${session.participant.id}`;
  expect((await server.app.inject({ method: 'DELETE', url })).statusCode).toBe(401);
  expect(
    (await server.app.inject({ method: 'DELETE', url, headers: server.headers })).statusCode,
  ).toBe(200);
  await Promise.all(disconnected);
  for (const table of [
    'answers',
    'operations',
    'submissions',
    'submission_reviews',
    'scores',
    'revision_watermarks',
    'participant_ips',
  ]) {
    expect(
      server.db.prepare(`SELECT * FROM ${table} WHERE participantId=?`).all(session.participant.id),
    ).toEqual([]);
  }
  expect(sessions.find(session.token)).toBeNull();
  expect(sessions.recover(session.recoveryCode)).toBeNull();
  await expect(connect(server, session.token, '192.0.2.9')).rejects.toThrow('Sesja wygasła');
  expect(
    (
      await server.app.inject({
        method: 'POST',
        url: '/api/recover',
        payload: { code: session.recoveryCode },
      })
    ).statusCode,
  ).toBe(404);
  expect(
    (
      await server.app.inject({
        url: '/api/results',
        headers: { authorization: `Bearer ${session.token}` },
      })
    ).statusCode,
  ).toBe(401);
  expect(server.contest.snapshot().participantCount).toBe(1);
  expect(server.contest.state.version).toBeGreaterThan(version);
  expect(server.contest.standings()).toMatchObject([
    { participantId: other.participant.id, score: 500 },
  ]);
  expect(
    (await server.app.inject({ method: 'DELETE', url, headers: server.headers })).statusCode,
  ).toBe(404);
});
it.each([false, true])(
  'records distinct HTTP and socket addresses with trustProxy=%s',
  async (trusted) => {
    const server = await setup(trusted);
    const session = await participant(server);
    for (let i = 0; i < 2; i++) {
      await server.app.inject({
        method: 'POST',
        url: '/api/recover',
        payload: { code: session.recoveryCode },
        headers: { 'x-forwarded-for': '198.51.100.8, 192.0.2.2' },
      });
    }
    await connect(server, session.token, '198.51.100.8, 192.0.2.3');
    await server.app.inject({
      url: '/api/results',
      headers: { authorization: `Bearer ${session.token}`, 'x-forwarded-for': '192.0.2.4' },
    });
    const overview = await server.app.inject({
      url: '/api/admin/overview',
      headers: server.headers,
    });
    expect(overview.json().participants[0].ips).toEqual(
      trusted ? ['192.0.2.1', '192.0.2.2', '192.0.2.3', '192.0.2.4'] : ['127.0.0.1'],
    );
    const state = await server.app.inject({ url: '/api/state' });
    expect(state.body).not.toContain('ips');
    expect(JSON.stringify(session)).not.toContain('ips');
  },
);
it('retains IP history across reopening an existing database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'estymator-ips-'));
  directories.push(directory);
  const path = join(directory, 'contest.sqlite');
  const original = await setup(true, path);
  const session = await participant(original);
  await original.app.close();
  servers.splice(
    servers.findIndex((server) => server.app === original.app),
    1,
  );
  const reopened = await setup(true, path);
  expect(new Sessions(reopened.db).list()).toMatchObject([
    { id: session.participant.id, ips: ['192.0.2.1'] },
  ]);
});

it('accepts IPv6, ignores malformed addresses and never logs failed recovery addresses', async () => {
  const server = await setup(true);
  const session = await participant(server);
  await server.app.inject({
    method: 'POST',
    url: '/api/recover',
    payload: { code: session.recoveryCode },
    headers: { 'x-forwarded-for': '2001:db8::1' },
  });
  await connect(server, session.token, 'invalid-address');
  await server.app.inject({
    method: 'POST',
    url: '/api/recover',
    payload: { code: 'wrong-code' },
    headers: { 'x-forwarded-for': '192.0.2.99' },
  });
  expect(new Sessions(server.db).list()[0]?.ips).toEqual(['192.0.2.1', '2001:db8::1']);
});

it('upgrades an existing database without inventing past IP history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'estymator-legacy-ips-'));
  directories.push(directory);
  const path = join(directory, 'contest.sqlite');
  const original = await setup(true, path);
  const session = await participant(original);
  original.db.exec('DROP TABLE participant_ips');
  await original.app.close();
  servers.splice(
    servers.findIndex((server) => server.app === original.app),
    1,
  );
  const reopened = await setup(true, path);
  const sessions = new Sessions(reopened.db);
  expect(sessions.find(session.token)).toEqual(session);
  expect(sessions.list()[0]?.ips).toEqual([]);
  await reopened.app.inject({
    method: 'POST',
    url: '/api/recover',
    payload: { code: session.recoveryCode },
    headers: { 'x-forwarded-for': '192.0.2.2' },
  });
  expect(sessions.list()[0]?.ips).toEqual(['192.0.2.2']);
});
