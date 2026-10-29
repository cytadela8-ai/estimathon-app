/** Durable revision recovery covers legacy files, rejected numbers, pause, moderation and rollback. */
import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '#est-server/database';
import { Contest } from '#est-server/contest';
import { Sessions } from '#est-server/sessions';
import { AnswerStore } from '#est-server/answers';
const databases: ReturnType<typeof openDatabase>[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
function setup() {
  const directory = mkdtempSync(join(tmpdir(), 'revision-watermarks-'));
  directories.push(directory);
  const path = join(directory, 'contest.sqlite');
  const db = openDatabase(path);
  databases.push(db);
  const contest = new Contest(db);
  contest.configure({ durationSeconds: 180, revealDelaySeconds: 1, maxAnswer: '9999' }, [
    { id: '', text: 'Question', correct: '100', seconds: 180 },
  ]);
  const id = new Sessions(db).create({ firstName: 'A', lastName: 'B', nickname: 'C' }).participant
    .id;
  contest.command('start', 1000);
  const store = new AnswerStore(db, contest);
  const questionId = contest.question!.id;
  const op = (revision: number, text = '100') => ({
    questionId,
    operationId: randomUUID(),
    revision,
    text,
  });
  return { db, path, contest, store, id, questionId, op };
}
it('retains observed maxima across invalid numbers, pauses, exclusions and stale edits', () => {
  const f = setup();
  const first = f.op(2);
  f.store.save(f.id, first, 1100);
  expect(f.store.save(f.id, f.op(10, '0'), 1200).status).toBe('invalid');
  f.contest.command('pause', 1300);
  const paused = f.op(20);
  expect(f.store.save(f.id, paused, 1400).status).toBe('paused');
  expect(f.store.snapshot(f.id).revisions).toEqual({ [f.questionId]: 20 });
  f.contest.command('resume', 1500);
  f.store.save(f.id, paused, 1600);
  f.store.review(
    {
      participantId: f.id,
      operationId: paused.operationId,
      excluded: true,
      reason: 'Exclude latest',
    },
    1700,
  );
  f.store.save(f.id, f.op(1), 1800);
  f.store.save(f.id, { ...f.op(99), questionId: 'unknown' }, 1900);
  f.store.save(f.id, { ...paused, revision: 100 }, 1950);
  expect(f.store.snapshot(f.id)).toMatchObject({
    revisions: { [f.questionId]: 20 },
    answers: [{ revision: 2 }],
  });
  f.db.close();
  const db = openDatabase(f.path);
  databases.push(db);
  expect(new AnswerStore(db, new Contest(db)).snapshot(f.id).revisions).toEqual({
    [f.questionId]: 20,
  });
});
it('initializes watermarks from an existing file including excluded and invalid history', () => {
  const f = setup();
  const op = f.op(7);
  f.store.save(f.id, op, 1100);
  f.store.review(
    { participantId: f.id, operationId: op.operationId, excluded: true, reason: 'Review' },
    1200,
  );
  f.store.save(f.id, f.op(9, '0'), 1300);
  f.db.exec('DROP TABLE IF EXISTS revision_watermarks');
  f.db.close();
  const db = openDatabase(f.path);
  databases.push(db);
  expect(
    db
      .prepare('SELECT revision FROM revision_watermarks WHERE participantId=? AND questionId=?')
      .get(f.id, f.questionId),
  ).toEqual({ revision: 9 });
  expect(new AnswerStore(db, new Contest(db)).snapshot(f.id)).toEqual({
    answers: [],
    revisions: { [f.questionId]: 9 },
  });
});
it('rolls back the watermark together with a failed answer transaction', () => {
  const f = setup();
  f.store.save(f.id, f.op(1), 1100);
  f.db.exec(`CREATE TRIGGER reject_receipt BEFORE INSERT ON operations
    BEGIN SELECT RAISE(ABORT, 'Simulated receipt failure'); END`);
  const op = f.op(100);
  expect(() => f.store.save(f.id, op, 1200)).toThrow('Simulated receipt failure');
  expect(f.store.snapshot(f.id)).toMatchObject({
    answers: [{ revision: 1 }],
    revisions: { [f.questionId]: 1 },
  });
  expect(f.store.audit().total).toBe(1);
  f.db.exec('DROP TRIGGER reject_receipt');
  f.store.save(f.id, op, 1300);
  expect(f.store.snapshot(f.id).revisions).toEqual({ [f.questionId]: 100 });
});
