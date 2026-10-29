/** Reset backs up the finished event, preserves identities and isolates the next run. */
import { afterEach, expect, it, vi } from 'vitest';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '#est-server/database';
import { Contest } from '#est-server/contest';
import { Sessions } from '#est-server/sessions';
import { AnswerStore } from '#est-server/answers';
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return { ...fs, writeFileSync: vi.fn(fs.writeFileSync) };
});
const databases: ReturnType<typeof openDatabase>[] = [];
const directories: string[] = [];
afterEach(() => {
  vi.mocked(writeFileSync).mockReset();
  for (const db of databases.splice(0)) if (db.open) db.close();
  for (const directory of directories.splice(0)) {
    for (const file of readdirSync(directory)) unlinkSync(join(directory, file));
    rmdirSync(directory);
  }
});
function setup(finished = true) {
  const directory = mkdtempSync(join(tmpdir(), 'estymator-reset-'));
  directories.push(directory);
  const db = openDatabase(join(directory, 'contest.sqlite'));
  databases.push(db);
  const contest = new Contest(db);
  contest.configure({ durationSeconds: 180, revealDelaySeconds: 1, maxAnswer: '9999' }, [
    { id: '', text: 'First', correct: '100', seconds: 180 },
    { id: '', text: 'Second', correct: '100', seconds: 180 },
  ]);
  const sessions = new Sessions(db);
  const session = sessions.create({ firstName: 'Jan', lastName: 'K', nickname: 'JK' });
  const answers = new AnswerStore(db, contest);
  contest.command('start', 1000);
  const operation = {
    questionId: contest.question!.id,
    operationId: randomUUID(),
    revision: 1,
    text: '100',
  };
  answers.save(session.participant.id, operation, 1500);
  if (finished) {
    contest.command('finish', 2000);
    contest.snapshot(3000);
    answers.review(
      {
        participantId: session.participant.id,
        operationId: operation.operationId,
        excluded: false,
        reason: 'Verified',
      },
      3500,
    );
  }
  return { directory, db, contest, sessions, session, answers, operation };
}
it('returns to setup, preserves config/accounts and clears every contest ledger', () => {
  const f = setup();
  const previous = structuredClone(f.contest.data);
  const backup = f.contest.reset();
  expect(backup).toContain('contest.sqlite.backup-');
  expect(statSync(join(f.directory, backup)).mode & 0o777).toBe(0o600);
  expect(f.contest.state).toEqual({
    phase: 'lobby',
    index: -1,
    startedAt: null,
    endsAt: null,
    closesAt: null,
    remainingMs: 0,
    resultsAt: null,
    version: previous.state.version + 1,
  });
  expect(f.contest.data.config).toEqual(previous.config);
  expect(f.contest.data.questions.map(({ id: _id, ...q }) => q)).toEqual(
    previous.questions.map(({ id: _id, ...q }) => q),
  );
  expect(f.contest.data.questions.map((q) => q.id)).not.toEqual(
    previous.questions.map((q) => q.id),
  );
  expect(f.sessions.find(f.session.token)).toEqual(f.session);
  expect(f.sessions.recover(f.session.recoveryCode)).toEqual(f.session);
  for (const table of [
    'answers',
    'operations',
    'scores',
    'question_windows',
    'submissions',
    'submission_reviews',
  ])
    expect(f.db.prepare(`SELECT count(*) AS n FROM ${table}`).get()).toEqual({ n: 0 });
  expect(f.contest.snapshot(4000)).toMatchObject({
    question: null,
    correct: null,
    results: [],
    standings: [],
    participantCount: 1,
    answerCount: 0,
  });
  expect(f.contest.standings()[0]?.score).toBe(0);
});
it('creates a standalone backup containing results, audit, decisions and credentials', () => {
  const f = setup();
  const original = structuredClone(f.contest.data);
  const backup = f.contest.reset();
  const archivedDb = openDatabase(join(f.directory, backup));
  databases.push(archivedDb);
  expect(archivedDb.pragma('integrity_check', { simple: true })).toBe('ok');
  const archived = new Contest(archivedDb);
  const archivedAnswers = new AnswerStore(archivedDb, archived);
  expect(archived.data).toEqual(original);
  expect(archived.standings()[0]?.score).toBe(1000);
  expect(archivedAnswers.audit()[0]).toMatchObject({
    operationId: f.operation.operationId,
    text: '100',
    reviews: [{ reason: 'Verified', excluded: false, reviewedAt: 3500 }],
  });
  expect(new Sessions(archivedDb).find(f.session.token)).toEqual(f.session);
});
it('rejects old queued messages without polluting the new audit or scores', () => {
  const f = setup();
  f.contest.reset();
  expect(f.answers.save(f.session.participant.id, f.operation, 4000).status).toBe('invalid');
  expect(f.answers.audit()).toEqual([]);
  f.contest.command('start', 5000);
  expect(f.answers.save(f.session.participant.id, f.operation, 6000).status).toBe('invalid');
  expect(f.answers.audit()).toEqual([]);
  expect(f.answers.all(f.session.participant.id)).toEqual([]);
  const next = { ...f.operation, questionId: f.contest.question!.id, operationId: randomUUID() };
  expect(f.answers.save(f.session.participant.id, next, 7000).status).toBe('accepted');
  expect(f.contest.snapshot(7000).answerCount).toBe(1);
});
it('restores setup after restart and allows questions to be edited and relaunched', () => {
  const f = setup();
  f.contest.reset();
  const restored = new Contest(f.db);
  expect(restored.state.phase).toBe('lobby');
  restored.configure(restored.data.config, [
    { id: '', text: 'Replacement', correct: '200', seconds: 60 },
  ]);
  restored.command('start', 4000);
  expect(restored.snapshot(4000)).toMatchObject({
    state: { phase: 'active', index: 0, endsAt: 64000 },
    question: { text: 'Replacement' },
    answerCount: 0,
    participantCount: 1,
  });
});
it.each(['active', 'paused', 'closing', 'finishing', 'results', 'lobby'] as const)(
  'rejects reset during %s without creating a backup or changing data',
  (phase) => {
    const f = setup(false);
    if (phase === 'paused') f.contest.command('pause', 2000);
    if (phase === 'closing') f.contest.command('next', 2000);
    if (phase === 'finishing') f.contest.command('finish', 2000);
    if (phase === 'results') f.contest.snapshot(182000);
    if (phase === 'lobby') {
      f.contest.command('finish', 2000);
      f.contest.snapshot(3000);
      f.contest.reset();
    }
    const before = structuredClone(f.contest.data);
    const files = readdirSync(f.directory);
    expect(() => f.contest.reset()).toThrow('zakończeniu');
    expect(f.contest.data).toEqual(before);
    expect(readdirSync(f.directory)).toEqual(files);
  },
);
it('leaves the contest untouched when the backup cannot be written', () => {
  const f = setup();
  const before = structuredClone(f.contest.data);
  vi.mocked(writeFileSync).mockImplementationOnce(() => {
    throw new Error('disk full');
  });
  expect(() => f.contest.reset()).toThrow('kopii');
  expect(f.contest.data).toEqual(before);
  expect(f.answers.all(f.session.participant.id)[0]?.text).toBe('100');
  expect(new Contest(f.db).state.phase).toBe('finished');
});
it('rolls back all deletions if the database reset fails', () => {
  const f = setup();
  const before = structuredClone(f.contest.data);
  f.db.exec(`CREATE TRIGGER stop_reset BEFORE DELETE ON scores
      BEGIN SELECT RAISE(ABORT, 'Reset interrupted'); END`);
  expect(() => f.contest.reset()).toThrow('Reset interrupted');
  expect(f.contest.data).toEqual(before);
  expect(f.answers.all(f.session.participant.id)[0]?.text).toBe('100');
  expect(f.answers.audit()[0]?.reviews).toHaveLength(1);
  f.db.exec('DROP TRIGGER stop_reset');
  expect(new Contest(f.db).state.phase).toBe('finished');
});
