/** Cleanup retains bounded history without changing scoring, retries or revision recovery. */
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { createApp } from '#est-server/app';
import { AnswerStore } from '#est-server/answers';
import { Contest } from '#est-server/contest';
import { Sessions } from '#est-server/sessions';
import { cleanupHistory } from '#est-server/history-cleanup';
import type { Operation } from '#est-shared/protocol';

const directories: string[] = [];
const servers: Awaited<ReturnType<typeof createApp>>[] = [];
afterEach(async () => {
  for (const server of servers.splice(0)) await server.app.close();
  for (const directory of directories.splice(0)) {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
async function setup(databasePath = ':memory:') {
  const server = await createApp({ databasePath, password: 'test-password-12345678' });
  servers.push(server);
  const { contest, db } = server;
  contest.configure({ durationSeconds: 180, revealDelaySeconds: 1, maxAnswer: '9999' }, [
    { id: '', text: 'One', correct: '100', seconds: 180 },
    { id: '', text: 'Two', correct: '200', seconds: 180 },
  ]);
  const sessions = new Sessions(db);
  const id = sessions.create({ firstName: 'A', lastName: 'B', nickname: 'C' }).participant.id;
  contest.command('start', 1000);
  const store = new AnswerStore(db, contest);
  const op = (revision: number, text = '100'): Operation => ({
    questionId: contest.question!.id,
    operationId: randomUUID(),
    revision,
    text,
  });
  const login = await server.app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { password: 'test-password-12345678' },
  });
  const headers = { authorization: `Bearer ${login.json<{ token: string }>().token}` };
  return { ...server, store, sessions, id, op, headers };
}
it('keeps ten first arrivals per user/question with deterministic ties and is repeatable', async () => {
  const f = await setup();
  const other = f.sessions.create({ firstName: 'D', lastName: 'E', nickname: 'F' }).participant.id;
  const operations = Array.from({ length: 15 }, (_, i) => f.op(i + 1));
  for (const op of operations) f.store.save(f.id, op, 2000);
  f.store.save(other, f.op(1), 2100);
  f.contest.command('next', 2200);
  f.contest.tick(3200);
  f.contest.command('next', 3300);
  f.store.save(f.id, f.op(1), 3400);
  expect(cleanupHistory(f.db)).toEqual({ deletedSubmissions: 5, deletedReviews: 0 });
  const kept = f.db
    .prepare('SELECT revision FROM submissions WHERE questionId=? ORDER BY revision')
    .all(operations[0]!.questionId);
  expect(kept).toEqual([1, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((revision) => ({ revision })));
  expect(cleanupHistory(f.db)).toEqual({ deletedSubmissions: 0, deletedReviews: 0 });
  expect(f.store.save(f.id, operations[0]!, 3500).status).toBe('accepted');
  expect(f.store.audit().total).toBe(12);
});
it('protects older counted answers, scores, watermarks, receipts and retained decisions', async () => {
  const f = await setup();
  const counted = f.op(1);
  f.store.save(f.id, counted, 2000);
  const excluded = f.op(2);
  const receipt = f.store.save(f.id, excluded, 2100);
  f.store.review(
    { participantId: f.id, operationId: excluded.operationId, excluded: true, reason: 'Excluded' },
    2200,
  );
  f.store.review(
    { participantId: f.id, operationId: counted.operationId, excluded: false, reason: 'Keep' },
    2300,
  );
  for (let revision = 3; revision <= 14; revision++) {
    f.store.save(f.id, f.op(revision, '0'), 2400 + revision);
  }
  f.contest.command('finish', 3000);
  f.contest.tick(4000);
  const before = f.store.snapshot(f.id);
  const standings = f.contest.standings();
  expect(cleanupHistory(f.db)).toEqual({ deletedSubmissions: 3, deletedReviews: 1 });
  expect(f.store.snapshot(f.id)).toEqual(before);
  expect(f.contest.standings()).toEqual(standings);
  expect(f.store.save(f.id, excluded, 5000)).toEqual(receipt);
  expect(f.store.snapshot(f.id)).toEqual(before);
  expect(f.store.save(f.id, { ...excluded, text: '200' }, 5100).status).toBe('invalid');
  expect(f.db.prepare('SELECT reason FROM submission_reviews').all()).toEqual([{ reason: 'Keep' }]);
  const restored = new AnswerStore(f.db, new Contest(f.db));
  expect(restored.snapshot(f.id)).toEqual(before);
  const next = f.op(15, '200');
  f.store.save(f.id, next, 5200);
  f.store.review(
    { participantId: f.id, operationId: next.operationId, excluded: true, reason: 'Fallback' },
    5300,
  );
  expect(f.store.all(f.id)[0]?.operationId).toBe(counted.operationId);
});
it('rolls back every deletion if review cleanup fails', async () => {
  const f = await setup();
  for (let revision = 1; revision <= 12; revision++) {
    const op = f.op(revision);
    f.store.save(f.id, op, 2000 + revision);
    f.store.review(
      { participantId: f.id, operationId: op.operationId, excluded: false, reason: 'Reviewed' },
      2100 + revision,
    );
  }
  f.db.exec(`CREATE TRIGGER reject_cleanup BEFORE DELETE ON submission_reviews
    BEGIN SELECT RAISE(ABORT, 'Cleanup failure'); END`);
  expect(() => cleanupHistory(f.db)).toThrow('Cleanup failure');
  expect(f.store.audit().total).toBe(12);
  expect(f.db.prepare('SELECT COUNT(*) AS n FROM submission_reviews').get()).toEqual({ n: 12 });
  f.db.exec('DROP TRIGGER reject_cleanup');
  expect(cleanupHistory(f.db)).toEqual({ deletedSubmissions: 2, deletedReviews: 2 });
});
it('requires host authentication and explicit confirmation, including for an empty database', async () => {
  const f = await setup();
  const url = '/api/admin/cleanup';
  expect(
    (await f.app.inject({ method: 'POST', url, payload: { confirmed: true } })).statusCode,
  ).toBe(401);
  for (const payload of [{}, { confirmed: false }, { confirmed: 'true' }]) {
    expect(
      (await f.app.inject({ method: 'POST', url, headers: f.headers, payload })).statusCode,
    ).toBe(400);
  }
  const response = await f.app.inject({
    method: 'POST',
    url,
    headers: f.headers,
    payload: { confirmed: true },
  });
  expect(response.statusCode).toBe(200);
  expect(response.json()).toEqual({ deletedSubmissions: 0, deletedReviews: 0 });
});

it('orders by first arrival rather than revision and preserves excluded retained submissions', async () => {
  const f = await setup();
  const highest = f.op(100);
  f.store.save(f.id, highest, 2000);
  for (let revision = 1; revision <= 12; revision++) {
    f.store.save(f.id, f.op(revision), 2100 + revision);
  }
  const retained = f.op(101, '200');
  f.store.save(f.id, retained, 2200);
  f.store.review(
    { participantId: f.id, operationId: retained.operationId, excluded: true, reason: 'Check' },
    2300,
  );
  expect(cleanupHistory(f.db).deletedSubmissions).toBe(3);
  expect(f.db.prepare('SELECT revision FROM submissions ORDER BY revision').all()).toEqual(
    [4, 5, 6, 7, 8, 9, 10, 11, 12, 100, 101].map((revision) => ({ revision })),
  );
  expect(f.store.all(f.id)[0]?.operationId).toBe(highest.operationId);
  expect(
    f.store.audit().items.find((row) => row.operationId === retained.operationId),
  ).toMatchObject({ excluded: true, reviewCount: 1 });
  f.store.review(
    { participantId: f.id, operationId: retained.operationId, excluded: false, reason: 'Restore' },
    2400,
  );
  expect(f.store.all(f.id)[0]?.operationId).toBe(retained.operationId);
  expect(() =>
    f.store.review({
      participantId: f.id,
      operationId: 'deleted-operation-id',
      excluded: false,
      reason: 'Missing',
    }),
  ).toThrow('Nie znaleziono');
});

it('allows pending paused submissions to retry after pruning and resume', async () => {
  const f = await setup();
  f.contest.command('pause', 2000);
  const pending = f.op(1);
  expect(f.store.save(f.id, pending, 2100).status).toBe('paused');
  for (let revision = 2; revision <= 12; revision++) {
    f.store.save(f.id, f.op(revision), 2100 + revision);
  }
  expect(cleanupHistory(f.db).deletedSubmissions).toBe(2);
  expect(f.store.snapshot(f.id).revisions[pending.questionId]).toBe(12);
  f.contest.command('resume', 3000);
  expect(f.store.save(f.id, pending, 3100).status).toBe('accepted');
  expect(f.store.all(f.id)[0]?.operationId).toBe(pending.operationId);
});

it('keeps pruned history and revision recovery stable after reopening the database', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'history-cleanup-'));
  directories.push(directory);
  const databasePath = join(directory, 'contest.sqlite');
  const f = await setup(databasePath);
  const first = f.op(1);
  const receipt = f.store.save(f.id, first, 2000);
  for (let revision = 2; revision <= 20; revision++) {
    f.store.save(f.id, f.op(revision), 2000 + revision);
  }
  cleanupHistory(f.db);
  const snapshot = f.store.snapshot(f.id);
  await f.app.close();
  servers.splice(
    servers.findIndex((server) => server.app === f.app),
    1,
  );
  const reopened = await createApp({ databasePath, password: 'test-password-12345678' });
  servers.push(reopened);
  const store = new AnswerStore(reopened.db, reopened.contest);
  expect(store.audit().total).toBe(10);
  expect(store.snapshot(f.id)).toEqual(snapshot);
  expect(store.save(f.id, first)).toEqual(receipt);
  expect(store.audit().total).toBe(10);
});

it('preserves exclusions on paused submissions without permanent receipts', async () => {
  const f = await setup();
  f.contest.command('pause', 2000);
  const pending = f.op(1);
  f.store.save(f.id, pending, 2100);
  f.store.review(
    { participantId: f.id, operationId: pending.operationId, excluded: true, reason: 'Excluded' },
    2200,
  );
  for (let revision = 2; revision <= 12; revision++) {
    f.store.save(f.id, f.op(revision), 2200 + revision);
  }
  expect(cleanupHistory(f.db).deletedSubmissions).toBe(1);
  f.contest.command('resume', 3000);
  f.store.save(f.id, pending, 3100);
  expect(f.store.all(f.id)).toEqual([]);
  expect(
    f.store.audit().items.find((row) => row.operationId === pending.operationId),
  ).toMatchObject({ excluded: true, reviewCount: 1 });
  f.store.review(
    { participantId: f.id, operationId: pending.operationId, excluded: false, reason: 'Restore' },
    3200,
  );
  expect(f.store.all(f.id)[0]?.operationId).toBe(pending.operationId);
});
