/** Late delivery remains countable; immutable arrival telemetry and host reviews survive restart. */
import { afterEach, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '#est-server/database';
import { Contest } from '#est-server/contest';
import { Sessions } from '#est-server/sessions';
import { AnswerStore } from '#est-server/answers';
import type { Operation } from '#est-shared/protocol';
const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const contest = new Contest(db);
  contest.configure({ durationSeconds: 1, revealDelaySeconds: 5, maxAnswer: '999999' }, [
    { id: '', text: 'First', correct: '100', seconds: 1 },
    { id: '', text: 'Second', correct: '100', seconds: 1 },
  ]);
  const sessions = new Sessions(db);
  const ids = ['A', 'B', 'C'].map(
    (nickname) => sessions.create({ firstName: nickname, lastName: 'T', nickname }).participant.id,
  );
  const store = new AnswerStore(db, contest);
  contest.command('start', 1000);
  const op = (revision: number, text = '100'): Operation => ({
    questionId: contest.question!.id,
    operationId: randomUUID(),
    revision,
    text,
    timing: { inputAt: 1400, endsAt: 1900, offsetMs: 100 },
  });
  return { db, contest, store, ids, op };
}
it('counts a delayed answer after reveal and preserves its first arrival under retries', () => {
  const f = setup();
  const op = f.op(1);
  expect(f.contest.snapshot(7000).results.map((r) => r.score)).toEqual([0, 0, 0]);
  expect(f.store.save(f.ids[0]!, op, 62000).status).toBe('accepted');
  expect(f.contest.snapshot(62000).results[0]?.score).toBe(1000);
  expect(f.store.save(f.ids[0]!, op, 999999).status).toBe('accepted');
  const audit = f.store.audit()[0]!;
  expect(audit.receivedAt).toBe(62000);
  expect(audit.serverLateMs).toBe(60000);
  expect(audit.phoneLateMs).toBe(-500);
  expect(audit.timing?.inputAt).toBe(1400);
  expect(f.store.audit()).toHaveLength(1);
});
it('accepts an old question after advancing and after finishing, recomputing totals', () => {
  const f = setup();
  const old = f.op(1);
  f.contest.snapshot(7000);
  f.contest.command('next', 8000);
  expect(f.store.save(f.ids[0]!, old, 9000).status).toBe('accepted');
  f.contest.snapshot(14000);
  f.contest.command('finish', 15000);
  expect(f.store.save(f.ids[1]!, { ...old, operationId: randomUUID() }, 16000).status).toBe(
    'accepted',
  );
  expect(f.contest.snapshot(16000).standings.map((s) => s.score)).toEqual([1000, 1000, 0]);
  expect(f.contest.snapshot(16000).standings.map((s) => s.place)).toEqual([1, 1, 3]);
});
it('excludes a suspicious operation, falls back to the previous revision, and restores it', () => {
  const f = setup();
  const id = f.ids[0]!;
  const first = f.op(1, '200');
  const latest = f.op(2, '100');
  f.store.save(id, first, 1500);
  f.store.save(id, latest, 8000);
  f.store.review(
    { participantId: id, operationId: latest.operationId, excluded: true, reason: 'Late change' },
    9000,
  );
  expect(f.store.all(id)[0]?.text).toBe('200');
  expect(f.contest.snapshot(9000).results[0]?.score).toBe(500);
  f.store.review(
    { participantId: id, operationId: first.operationId, excluded: true, reason: 'Review' },
    10000,
  );
  expect(f.store.all(id)).toEqual([]);
  expect(f.contest.snapshot(10000).results[0]?.score).toBe(0);
  f.store.review(
    {
      participantId: id,
      operationId: latest.operationId,
      excluded: false,
      reason: 'Wi-Fi confirmed',
    },
    11000,
  );
  expect(f.contest.snapshot(11000).results[0]?.score).toBe(1000);
  expect(f.store.audit().find((a) => a.operationId === latest.operationId)?.reviews).toHaveLength(
    2,
  );
  const restart = new Contest(f.db);
  expect(restart.snapshot(11000).results[0]?.score).toBe(1000);
});
it('waits for the reveal delay and never automatically starts another question', () => {
  const f = setup();
  expect(f.contest.snapshot(6999).correct).toBeNull();
  expect(f.contest.snapshot(7000).correct).toBe('100');
  expect(f.contest.snapshot(999999).state.index).toBe(0);
  expect(f.contest.state.phase).toBe('results');
});
it('rejects unknown question IDs and invalid review requests', () => {
  const f = setup();
  expect(f.store.save(f.ids[0]!, { ...f.op(1), questionId: 'unknown' }, 3000).status).toBe(
    'invalid',
  );
  expect(() =>
    f.store.review({
      participantId: f.ids[0]!,
      operationId: 'unknown',
      excluded: true,
      reason: '',
    }),
  ).toThrow();
});
it('keeps pause arrival timing and rejects payload changes when the operation is retried', () => {
  const f = setup();
  const op = f.op(1);
  f.contest.command('pause', 1500);
  expect(f.store.save(f.ids[0]!, op, 1600).status).toBe('paused');
  f.contest.command('resume', 1700);
  expect(f.store.save(f.ids[0]!, { ...op, text: '999' }, 1800).status).toBe('invalid');
  expect(f.store.save(f.ids[0]!, op, 1900).status).toBe('accepted');
  expect(f.store.audit()[0]?.receivedAt).toBe(1600);
});
it('recalculates the entire median field and rejects malformed telemetry without losing answers', () => {
  const f = setup();
  f.store.save(f.ids[0]!, f.op(1, '200'), 1500);
  f.store.save(f.ids[1]!, f.op(1, '400'), 1500);
  expect(f.contest.snapshot(7000).results.map((r) => r.score)).toEqual([600, 429, 0]);
  f.store.save(f.ids[2]!, f.op(1, '100'), 9000);
  expect(f.contest.snapshot(9000).results.map((r) => r.score)).toEqual([500, 333, 1000]);
  expect(
    f.store.save(
      f.ids[0]!,
      { ...f.op(2), timing: { inputAt: NaN, endsAt: 2000, offsetMs: 0 } },
      10000,
    ).status,
  ).toBe('invalid');
  expect(f.store.all(f.ids[0]!)[0]?.text).toBe('200');
});
