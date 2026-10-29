/** Real HTTP/Socket.IO checks for the live-load client's automatic participant traffic. */
import { afterEach, expect, it, vi } from 'vitest';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createApp } from '#est-server/app';
import { AnswerStore } from '#est-server/answers';
import type { Operation, Session } from '#est-shared/protocol';
const { ParticipantBot, participantMetrics } = await import(
  pathToFileURL(resolve('scripts/performance/participant-bot.mjs')).href
);
const { loadPlayResources } = await import(
  pathToFileURL(resolve('scripts/performance/player-resources.mjs')).href
);
const servers: Awaited<ReturnType<typeof createApp>>[] = [];
const bots: InstanceType<typeof ParticipantBot>[] = [];
afterEach(async () => {
  for (const bot of bots.splice(0)) bot.close();
  vi.useRealTimers();
  for (const server of servers.splice(0)) await server.app.close();
});
async function setup(failResults = false) {
  const f = await createApp({ databasePath: ':memory:', password: 'load-bot-test-password' });
  servers.push(f);
  let failures = Number(failResults);
  f.app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/api/results' && failures > 0) {
      failures--;
      return reply.code(503).send({ error: 'Temporary test outage' });
    }
  });
  f.contest.configure({ durationSeconds: 60, revealDelaySeconds: 1, maxAnswer: '999999999' }, [
    { id: '', text: 'Question', correct: '1000', seconds: 60 },
  ]);
  f.contest.command('start');
  await f.app.listen({ host: '127.0.0.1', port: 0 });
  const address = f.app.server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP listener');
  const session = (
    await f.app.inject({
      method: 'POST',
      url: '/api/session',
      payload: { firstName: 'Load', lastName: 'Test', nickname: 'Bot' },
    })
  ).json<Session>();
  const metrics = participantMetrics();
  const origin = `http://127.0.0.1:${address.port}`;
  const bot = new ParticipantBot({ origin, token: session.token, metrics });
  bots.push(bot);
  return { ...f, origin, session, bot, metrics };
}
it('loads play assets and receives per-participant snapshots, state and own answers', async () => {
  const f = await setup();
  await loadPlayResources(f.origin, f.metrics);
  expect(f.metrics.resourceRequests).toBeGreaterThanOrEqual(4);
  expect(f.metrics.resourceBytes).toBeGreaterThan(1000);
  await f.bot.connect();
  expect(f.metrics.snapshots).toBe(1);
  await expect.poll(() => f.bot.socket.io.engine.transport.name).toBe('websocket');
  expect(f.bot.edit('')).toBeNull();
  expect(f.bot.edit('0')).toBeNull();
  expect(f.bot.edit('invalid')).toBeNull();
  const op = f.bot.edit('1234');
  expect(op.timing).toMatchObject({
    inputAt: expect.any(Number),
    endsAt: expect.any(Number),
    offsetMs: expect.any(Number),
  });
  await expect.poll(() => f.metrics.accepted).toBe(1);
  await expect.poll(() => f.metrics.answerEvents).toBeGreaterThan(0);
  await expect.poll(() => f.metrics.stateEvents).toBeGreaterThan(0);
  expect(f.bot.answers.get(op.questionId)?.text).toBe('1234');
  expect(f.bot.pending.size).toBe(0);
});
it('refreshes each participant clock/snapshot every fifteen seconds', async () => {
  const f = await setup();
  f.bot.close();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const other = new ParticipantBot({
    origin: f.origin,
    token: f.session.token,
    metrics: f.metrics,
  });
  bots.push(other);
  await other.connect();
  const before = f.metrics.snapshots;
  await vi.advanceTimersByTimeAsync(15000);
  await expect.poll(() => f.metrics.snapshots).toBe(before + 1);
});
it('retries a lost save with its original ID and commits only one history row', async () => {
  const f = await setup();
  const delivered: Operation[] = [];
  f.io.on('connection', (socket) => {
    const save = socket.listeners('save')[0]!;
    socket.removeAllListeners('save');
    socket.on('save', (operation, ack) => {
      delivered.push(operation);
      if (delivered.length > 1) save(operation, ack);
    });
  });
  await f.bot.connect();
  const op = f.bot.edit('4321');
  await expect.poll(() => f.metrics.accepted, { timeout: 6000 }).toBe(1);
  expect(f.metrics.saveTimeouts).toBe(1);
  expect(f.metrics.retries).toBe(1);
  expect(delivered.map((op) => op.operationId)).toEqual([op.operationId, op.operationId]);
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM submissions').get()).toEqual({ n: 1 });
}, 10000);
it('reconciles excluded revision watermarks and resends paused edits on resume', async () => {
  const f = await setup();
  const store = new AnswerStore(f.db, f.contest);
  const op = {
    questionId: f.contest.question!.id,
    operationId: randomUUID(),
    revision: 20,
    text: '1000',
  };
  store.save(f.session.participant.id, op);
  store.review({
    participantId: f.session.participant.id,
    operationId: op.operationId,
    excluded: true,
    reason: 'Review',
  });
  await f.bot.connect();
  const next = f.bot.edit('2000');
  f.contest.command('pause');
  expect(next.revision).toBe(21);
  await expect.poll(() => f.metrics.paused).toBeGreaterThan(0);
  expect(f.bot.pending.size).toBe(1);
  f.contest.command('resume');
  await expect.poll(() => f.metrics.accepted).toBe(1);
  expect(f.bot.pending.size).toBe(0);
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM submissions').get()).toEqual({ n: 2 });
});
it('reconnects after transport loss and synchronizes before sending its offline draft', async () => {
  const f = await setup();
  await f.bot.connect();
  const socket = f.io.sockets.sockets.get(f.bot.socket.id)!;
  socket.conn.close();
  await expect.poll(() => f.bot.socket.connected).toBe(false);
  f.bot.edit('3333');
  await expect.poll(() => f.metrics.accepted, { timeout: 6000 }).toBe(1);
  expect(f.metrics.connections).toBe(2);
  expect(f.metrics.snapshots).toBe(2);
  expect(f.bot.answers.get(f.contest.question!.id)?.text).toBe('3333');
}, 10000);
it('fetches final results on mount/version changes and retries a temporary results failure', async () => {
  const f = await setup(true);
  f.bot.close();
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const bot = new ParticipantBot({ origin: f.origin, token: f.session.token, metrics: f.metrics });
  bots.push(bot);
  await bot.connect();
  expect(f.metrics.resultRequests).toBe(0);
  f.contest.command('finish');
  f.contest.tick(Date.now() + 2000);
  await expect.poll(() => f.metrics.resultErrors).toBe(1);
  await vi.advanceTimersByTimeAsync(3000);
  await expect.poll(() => f.metrics.resultLatencies.length).toBe(1);
  const before = f.metrics.resultRequests;
  await bot.synchronize();
  expect(f.metrics.resultRequests).toBe(before);
  const store = new AnswerStore(f.db, f.contest);
  store.save(f.session.participant.id, {
    questionId: f.contest.question!.id,
    operationId: randomUUID(),
    revision: 1,
    text: '1000',
  });
  await expect.poll(() => f.metrics.resultRequests).toBe(before + 1);
  await expect.poll(() => f.metrics.resultLatencies.length).toBe(2);
});
it('accepts private answer confirmation when the acknowledgment itself is lost', async () => {
  const f = await setup();
  f.io.on('connection', (socket) => {
    const save = socket.listeners('save')[0]!;
    socket.removeAllListeners('save');
    socket.on('save', (operation) => save(operation, () => {}));
  });
  await f.bot.connect();
  const op = f.bot.edit('1234');
  await expect.poll(() => f.metrics.answerEvents).toBeGreaterThan(0);
  expect(f.bot.answers.get(op.questionId)?.text).toBe('1234');
  expect(f.bot.pending.size).toBe(0);
  await expect.poll(() => f.metrics.saveTimeouts, { timeout: 4000 }).toBe(1);
  expect(f.metrics.retries).toBe(0);
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM submissions').get()).toEqual({ n: 1 });
});
