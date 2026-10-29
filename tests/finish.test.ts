/** Host termination closes answering without skipping synchronization or losing restart intent. */
import { afterEach, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { openDatabase } from '#est-server/database';
import { Contest } from '#est-server/contest';
import { Sessions } from '#est-server/sessions';
import { AnswerStore } from '#est-server/answers';
const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});
function setup() {
  const db = openDatabase(':memory:');
  databases.push(db);
  const contest = new Contest(db);
  contest.configure({ durationSeconds: 180, revealDelaySeconds: 5, maxAnswer: '1000' }, [
    { id: '', text: 'First', correct: '100', seconds: 180 },
    { id: '', text: 'Second', correct: '100', seconds: 180 },
  ]);
  const sessions = new Sessions(db);
  const id = sessions.create({ firstName: 'Jan', lastName: 'Test', nickname: 'Jan' }).participant
    .id;
  const answers = new AnswerStore(db, contest);
  contest.command('start', 1000);
  const operation = {
    questionId: contest.question!.id,
    operationId: randomUUID(),
    revision: 1,
    text: '100',
  };
  return { db, contest, answers, id, operation };
}
describe('ending the contest', () => {
  it.each(['active', 'paused'] as const)(
    'ends from %s after the synchronization delay and includes a pending answer',
    (phase) => {
      const f = setup();
      if (phase === 'paused') f.contest.command('pause', 1500);
      f.contest.command('finish', 2000);
      expect(f.contest.state).toMatchObject({
        phase: 'finishing',
        index: 0,
        endsAt: 2000,
        closesAt: 7000,
        remainingMs: 0,
      });
      expect(f.contest.snapshot(6999)).toMatchObject({ correct: null, results: [], standings: [] });
      expect(f.answers.save(f.id, f.operation, 6999).status).toBe('accepted');
      expect(f.contest.snapshot(7000)).toMatchObject({
        state: { phase: 'finished', index: 0, resultsAt: 7000 },
        correct: '100',
        standings: [{ participantId: f.id, score: 1000, place: 1 }],
      });
      expect(f.contest.snapshot(999999).state.index).toBe(0);
    },
  );
  it('keeps the existing deadline and delay when ending during closing', () => {
    const f = setup();
    f.contest.command('next', 2000);
    f.contest.command('finish', 4000);
    expect(f.contest.state).toMatchObject({ phase: 'finishing', endsAt: 2000, closesAt: 7000 });
    expect(f.contest.snapshot(6999).correct).toBeNull();
    expect(f.contest.snapshot(7000).state.phase).toBe('finished');
  });
  it('keeps the natural expiration deadline when ending during automatic closing', () => {
    const f = setup();
    f.contest.command('finish', 182000);
    expect(f.contest.state).toMatchObject({ phase: 'finishing', endsAt: 181000, closesAt: 186000 });
    expect(f.contest.snapshot(186000).state.phase).toBe('finished');
  });
  it('restores the pending finish and its saved answer after restarting', () => {
    const f = setup();
    f.answers.save(f.id, f.operation, 1500);
    f.contest.command('finish', 2000);
    const restored = new Contest(f.db);
    expect(restored.snapshot(6999)).toMatchObject({
      state: { phase: 'finishing', endsAt: 2000, closesAt: 7000 },
      correct: null,
      standings: [],
    });
    expect(restored.snapshot(7000).standings[0]?.score).toBe(1000);
    expect(new Contest(f.db).snapshot(8000).state.phase).toBe('finished');
  });
  it('does not restart the delay or podium animation for repeated finish requests', () => {
    const f = setup();
    f.contest.command('finish', 2000);
    f.contest.command('finish', 3000);
    expect(f.contest.state.closesAt).toBe(7000);
    expect(() => f.contest.command('next', 3500)).toThrow();
    expect(() => f.contest.command('resume', 3500)).toThrow();
    f.contest.snapshot(7000);
    f.contest.command('finish', 8000);
    expect(f.contest.state).toMatchObject({ phase: 'finished', resultsAt: 7000 });
  });
  it('still finishes immediately when the question results have already been revealed', () => {
    const f = setup();
    f.contest.snapshot(186000);
    f.contest.command('finish', 187000);
    expect(f.contest.state).toMatchObject({ phase: 'finished', resultsAt: 187000 });
  });
  it('rejects finishing before the contest starts', () => {
    const db = openDatabase(':memory:');
    databases.push(db);
    const contest = new Contest(db);
    expect(() => contest.command('finish', 1000)).toThrow('nie został rozpoczęty');
    expect(contest.state.phase).toBe('lobby');
  });
  it('continues counting delayed answers after early termination', () => {
    const f = setup();
    f.contest.command('finish', 2000);
    expect(f.contest.snapshot(7000).standings[0]?.score).toBe(0);
    expect(f.answers.save(f.id, f.operation, 20000).status).toBe('accepted');
    expect(f.contest.snapshot(20000).standings[0]?.score).toBe(1000);
  });
});
