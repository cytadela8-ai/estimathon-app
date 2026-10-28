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
function setup(path = ':memory:', grace = false) {
  const db = openDatabase(path);
  databases.push(db);
  const contest = new Contest(db);
  if (!contest.data.questions.length)
    contest.configure(
      {
        durationSeconds: 180,
        graceSeconds: 5,
        latePolicy: grace ? 'grace' : 'strict',
        resultsSeconds: null,
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
  it('strictly rejects at the deadline and discloses nothing during reveal delay', () => {
    const f = setup();
    f.answers.save(f.id, f.operation(1), 2000);
    expect(f.answers.save(f.id, f.operation(2), 181000).status).toBe('closed');
    expect(f.contest.snapshot(182000).correct).toBeNull();
    expect(f.contest.snapshot(182000).results).toEqual([]);
    expect(f.contest.snapshot(183000).correct).toBe('100');
  });
  it('accepts late delivery only within the configured grace window', () => {
    const f = setup(':memory:', true);
    expect(f.answers.save(f.id, f.operation(1), 185999).status).toBe('accepted');
    expect(f.answers.save(f.id, f.operation(2), 186000).status).toBe('closed');
    expect(f.contest.snapshot(187000).results).toEqual([]);
    expect(f.contest.snapshot(188000).results).toHaveLength(1);
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
