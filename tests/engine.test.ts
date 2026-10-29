/** Behavioral coverage of durability, revision ordering, deadlines and public disclosure. */
import { describe, it, expect, afterEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '#est-server/database';
import { Contest } from '#est-server/contest';
import { Sessions } from '#est-server/sessions';
import { AnswerStore } from '#est-server/answers';
import type { Operation } from '#est-shared/protocol';
const databases: ReturnType<typeof openDatabase>[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) if (db.open) db.close();
});
function setup(path = ':memory:') {
  const db = openDatabase(path);
  databases.push(db);
  const contest = new Contest(db);
  if (!contest.data.questions.length)
    contest.configure(
      {
        durationSeconds: 180,
        revealDelaySeconds: 2,
        maxAnswer: '999999999999999999999',
      },
      [{ id: '', text: 'Ile?', correct: '100', seconds: 180 }],
    );
  const sessions = new Sessions(db);
  const session = sessions.create({ firstName: 'Jan', lastName: 'Test', nickname: 'J' });
  if (contest.state.phase === 'lobby') contest.command('start', 1000);
  const answers = new AnswerStore(db, contest);
  const operation = (revision: number, text = '42'): Operation => ({
    questionId: contest.question!.id,
    operationId: randomUUID(),
    revision,
    text,
  });
  return { db, contest, sessions, session, answers, operation, id: session.participant.id };
}
describe('answer ledger', () => {
  it('commits before acknowledgment and safely redelivers after deadline', () => {
    const f = setup();
    const op = f.operation(1);
    const receipt = f.answers.save(f.id, op, 2000);
    expect(f.answers.all(f.id)[0]?.text).toBe('42');
    expect(f.answers.save(f.id, op, 999999)).toEqual(receipt);
  });
  it('never lets delayed older revisions overwrite newer answers', () => {
    const f = setup();
    f.answers.save(f.id, f.operation(3, '300'), 2000);
    expect(f.answers.save(f.id, f.operation(2, '200'), 2001).status).toBe('stale');
    expect(f.answers.all(f.id)[0]?.text).toBe('300');
  });
  it('resolves simultaneous tabs by operation ID independently of delivery order', () => {
    const f = setup();
    const a = { ...f.operation(1, '10'), operationId: 'aaaaaaaaaaaaaaaa' };
    const b = { ...f.operation(1, '20'), operationId: 'bbbbbbbbbbbbbbbb' };
    f.answers.save(f.id, b, 2000);
    f.answers.save(f.id, a, 2001);
    expect(f.answers.all(f.id)[0]?.text).toBe('20');
    const second = f.sessions.create({ firstName: 'A', lastName: 'B', nickname: 'C' });
    f.answers.save(second.participant.id, a, 2000);
    f.answers.save(second.participant.id, b, 2001);
    expect(f.answers.all(second.participant.id)[0]?.text).toBe('20');
  });
  it('rejects operation ID reuse with a modified payload', () => {
    const f = setup();
    const op = f.operation(1);
    f.answers.save(f.id, op, 2000);
    expect(f.answers.save(f.id, { ...op, text: '999' }, 2001).status).toBe('invalid');
  });
  it.each(['', '0', '-2', '1.5', '1e3', ' ', '1000000000000000000000'])(
    'rejects invalid answer %j',
    (text) => {
      const f = setup();
      expect(f.answers.save(f.id, f.operation(1, text), 2000).status).toBe('invalid');
    },
  );
  it('preserves leading zeroes while validating the positive integer', () => {
    const f = setup();
    f.answers.save(f.id, f.operation(1, '00042'), 2000);
    expect(f.answers.all(f.id)[0]?.text).toBe('00042');
  });
  it('accepts late arrivals without revealing results before the transition finishes', () => {
    const f = setup();
    f.answers.save(f.id, f.operation(1), 2000);
    expect(f.answers.save(f.id, f.operation(2), 181000).status).toBe('accepted');
    expect(f.contest.snapshot(182000).correct).toBeNull();
    expect(f.contest.snapshot(182000).results).toEqual([]);
    expect(f.contest.snapshot(183000).correct).toBe('100');
    expect(f.answers.save(f.id, f.operation(3), 300000).status).toBe('accepted');
  });
  it('pauses, resumes and extends the authoritative deadline', () => {
    const f = setup();
    f.contest.command('pause', 11000);
    expect(f.answers.save(f.id, f.operation(1), 12000).status).toBe('paused');
    f.contest.command('extend', 13000);
    f.contest.command('resume', 21000);
    expect(f.contest.state.endsAt).toBe(221000);
  });
  it('recovers deadline, answers and session after a process restart', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'estymator-')), 'test.sqlite');
    const f = setup(path);
    const op = f.operation(1);
    f.answers.save(f.id, op, 2000);
    f.db.close();
    const db = openDatabase(path);
    databases.push(db);
    const restored = new Contest(db);
    expect(new Sessions(db).find(f.session.token)?.participant.id).toBe(f.id);
    expect(new AnswerStore(db, restored).all(f.id)[0]?.text).toBe('42');
    expect(restored.snapshot(183000).state.phase).toBe('results');
  });
  it('durably accepts a burst of 300 participants without lost acknowledgments', () => {
    const f = setup();
    for (let i = 0; i < 300; i++) {
      const session = f.sessions.create({ firstName: 'A', lastName: 'B', nickname: String(i) });
      expect(
        f.answers.save(session.participant.id, f.operation(1, String(i + 1)), 2000).status,
      ).toBe('accepted');
    }
    expect(f.contest.snapshot(3000).answerCount).toBe(300);
  });
});

describe('schedule and configuration', () => {
  it('waits for host advancement after each reveal and finishes manually', () => {
    const db = openDatabase(':memory:');
    databases.push(db);
    const contest = new Contest(db);
    contest.configure(
      {
        durationSeconds: 1,
        revealDelaySeconds: 2,
        maxAnswer: '1000',
      },
      [
        { id: '', text: 'First', correct: '10', seconds: 1 },
        { id: '', text: 'Second', correct: '20', seconds: 1 },
      ],
    );
    contest.command('start', 1000);
    expect(contest.snapshot(4000).state.phase).toBe('results');
    expect(contest.snapshot(19000).state.index).toBe(0);
    contest.command('next', 19000);
    expect(contest.snapshot(19000).state.index).toBe(1);
    expect(contest.snapshot(19000).state.phase).toBe('active');
    expect(contest.snapshot(22000).state.phase).toBe('results');
    expect(contest.snapshot(37000).state.phase).toBe('results');
    contest.command('next', 37000);
    expect(contest.state.phase).toBe('finished');
    expect(contest.state.resultsAt).toBe(37000);
  });
  it('persists median-normalized points and restores them on restart', () => {
    const f = setup();
    const scored = new Contest(f.db);
    const store = new AnswerStore(f.db, scored);
    store.save(f.id, f.operation(1, '100'), 2000);
    expect(scored.snapshot(183000).standings[0]?.score).toBe(1000);
    expect(new Contest(f.db).snapshot(184000).standings[0]?.score).toBe(1000);
  });
  it('rejects invalid configuration without changing the contest', () => {
    const f = setup();
    expect(() => f.contest.configure(f.contest.data.config, [])).toThrow('przed startem');
    const fresh = new Contest(openDatabase(':memory:'));
    databases.push(fresh.db);
    expect(() => fresh.configure({ ...f.contest.data.config, maxAnswer: '-1' }, [])).toThrow(
      'zakres',
    );
    expect(() => fresh.configure({ ...f.contest.data.config, revealDelaySeconds: 0 }, [])).toThrow(
      'czas',
    );
    expect(fresh.data.questions).toEqual([]);
  });
  it('rejects malformed revision and operation IDs without writing answers', () => {
    const f = setup();
    expect(f.answers.save(f.id, { ...f.operation(1), revision: -1 }, 2000).status).toBe('invalid');
    expect(f.answers.save(f.id, { ...f.operation(1), operationId: '' }, 2000).status).toBe(
      'invalid',
    );
    expect(f.answers.all(f.id)).toEqual([]);
  });
  it('does not disclose results when the host closes a paused question', () => {
    const f = setup(':memory:');
    f.contest.command('pause', 2000);
    f.contest.command('next', 3000);
    expect(f.contest.snapshot(4999).correct).toBeNull();
    expect(f.contest.snapshot(4999).correct).toBeNull();
    expect(f.contest.snapshot(5000).correct).toBe('100');
  });
});

describe('contest scoring', () => {
  it('scores each closed question independently from final accepted answers and sums totals', () => {
    const db = openDatabase(':memory:');
    databases.push(db);
    const contest = new Contest(db);
    contest.configure(
      {
        durationSeconds: 180,
        revealDelaySeconds: 2,
        maxAnswer: '1000000',
      },
      [
        { id: '', text: 'First question', correct: '100', seconds: 180 },
        { id: '', text: 'Second question', correct: '100', seconds: 180 },
      ],
    );
    const sessions = new Sessions(db);
    const participants = ['A', 'B', 'C', 'D'].map(
      (nickname) =>
        sessions.create({
          firstName: nickname,
          lastName: 'Test',
          nickname,
        }).participant.id,
    );
    const answers = new AnswerStore(db, contest);
    contest.command('start', 1000);
    const firstId = contest.question!.id;
    answers.save(
      participants[0]!,
      { questionId: firstId, operationId: randomUUID(), revision: 1, text: '400' },
      2000,
    );
    for (const [index, text] of ['100', '200', '400'].entries()) {
      answers.save(
        participants[index]!,
        { questionId: firstId, operationId: randomUUID(), revision: 2, text },
        3000,
      );
    }
    expect(db.prepare('SELECT * FROM scores').all()).toEqual([]);
    expect(contest.snapshot(181000).results).toEqual([]);
    const first = contest.snapshot(183000);
    expect(first.results.map((result) => result.score)).toEqual([1000, 500, 333, 0]);
    contest.command('next', 184000);
    const secondId = contest.question!.id;
    for (const id of participants.slice(0, 3)) {
      answers.save(
        id,
        { questionId: secondId, operationId: randomUUID(), revision: 1, text: '100' },
        185000,
      );
    }
    const restarted = new Contest(db);
    expect(db.prepare('SELECT count(*) AS n FROM scores WHERE questionId=?').get(secondId)).toEqual(
      { n: 0 },
    );
    const second = restarted.snapshot(366000);
    expect(second.results.map((result) => result.score)).toEqual([1000, 1000, 1000, 0]);
    expect(second.standings.map((result) => result.score)).toEqual([2000, 1500, 1333, 0]);
    restarted.command('next', 367000);
    expect(new Contest(db).snapshot(368000).standings.map((result) => result.score)).toEqual([
      2000, 1500, 1333, 0,
    ]);
  });
});

describe('shortening question time', () => {
  it('persists a shortened deadline and its audit window across restart', () => {
    const f = setup();
    f.contest.command('shorten', 2000);
    expect(f.contest.state.endsAt).toBe(151000);
    expect(f.contest.state.closesAt).toBe(153000);
    expect(f.db.prepare('SELECT endsAt FROM question_windows').get()).toEqual({ endsAt: 151000 });
    expect(new Contest(f.db).state.endsAt).toBe(151000);
  });
  it('clamps an active deadline to now and waits the full reveal delay', () => {
    const f = setup();
    f.contest.command('shorten', 170000);
    expect(f.contest.state.phase).toBe('closing');
    expect(f.contest.state.endsAt).toBe(170000);
    expect(f.contest.snapshot(171999).correct).toBeNull();
    expect(f.contest.snapshot(172000).correct).toBe('100');
    expect(() => f.contest.command('shorten', 172000)).toThrow();
  });
  it('clamps paused time to zero and closes only after resuming', () => {
    const f = setup();
    f.contest.command('pause', 170000);
    f.contest.command('shorten', 180000);
    f.contest.command('shorten', 190000);
    expect(f.contest.state.remainingMs).toBe(0);
    expect(new Contest(f.db).state.phase).toBe('paused');
    f.contest.command('resume', 200000);
    expect(f.contest.state.phase).toBe('closing');
    expect(f.contest.state.closesAt).toBe(202000);
  });
  it('subtracts from paused remaining time without creating a deadline', () => {
    const f = setup();
    f.contest.command('pause', 11000);
    f.contest.command('shorten', 12000);
    expect(f.contest.state.remainingMs).toBe(140000);
    expect(f.contest.state.endsAt).toBeNull();
    f.contest.command('resume', 21000);
    expect(f.contest.state.endsAt).toBe(161000);
  });
  it('rejects shortening before start or after the deadline', () => {
    const f = setup();
    expect(() => f.contest.command('shorten', 181000)).toThrow();
    const db = openDatabase(':memory:');
    databases.push(db);
    expect(() => new Contest(db).command('shorten', 1000)).toThrow();
  });
});
