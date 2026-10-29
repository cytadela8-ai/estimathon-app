/** Real HTTP/SQLite regression tests for bounded host reads and filtering across pages. */
import { afterEach, beforeEach, expect, it } from 'vitest';
import { createApp } from '#est-server/app';
import type { AdminResults, AnswerPage, Page } from '#est-shared/admin';
import type { AuditEntry } from '#est-shared/protocol';

let server: Awaited<ReturnType<typeof createApp>>;
let headers: { authorization: string };
let questionId: string;

beforeEach(async () => {
  const password = 'pagination-test-password';
  server = await createApp({ databasePath: ':memory:', password });
  server.contest.configure({ durationSeconds: 180, revealDelaySeconds: 1, maxAnswer: '999999' }, [
    { id: '', text: 'First', correct: '100', seconds: 180 },
    { id: '', text: 'Second', correct: '100', seconds: 180 },
  ]);
  questionId = server.contest.data.questions[0]!.id;
  const login = await server.app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { password },
  });
  headers = { authorization: `Bearer ${login.json<{ token: string }>().token}` };
  seed();
});

afterEach(async () => {
  await server.app.close();
});

function seed(): void {
  const { db, contest } = server;
  const participant = db.prepare('INSERT INTO participants VALUES(?,?,?,?,?,?)');
  const answer = db.prepare('INSERT INTO answers VALUES(?,?,?,?,?,?)');
  const submission = db.prepare(`INSERT INTO submissions
    (participantId,operationId,questionId,revision,text,receivedAt,eligible,status)
    VALUES(?,?,?,?,?,?,1,'accepted')`);
  const score = db.prepare('INSERT INTO scores VALUES(?,?,?)');
  db.transaction(() => {
    for (let i = 0; i < 205; i++) {
      const id = `person-${String(i).padStart(3, '0')}`;
      const name = i === 204 ? 'Łukasz' : id;
      participant.run(id, name, 'Test', name, id, id);
      for (const question of contest.data.questions) {
        answer.run(id, question.id, 'version-3', 3, '00123', 8000);
        score.run(id, question.id, i === 204 ? 0 : 1000);
      }
      for (let revision = 1; revision <= 3; revision++) {
        submission.run(id, `version-${revision}`, questionId, revision, '00123', 8000);
      }
    }
    db.prepare('INSERT INTO question_windows VALUES(?,?,?)').run(questionId, 1000, 5000);
  })();
}

async function results(query = ''): Promise<AdminResults> {
  const response = await server.app.inject({ url: `/api/admin/results${query}`, headers });
  expect(response.statusCode).toBe(200);
  return response.json<AdminResults>();
}

it('keeps answer records out of the polling overview', async () => {
  const response = await server.app.inject({ url: '/api/admin/overview', headers });
  expect(response.statusCode).toBe(200);
  expect(response.json()).not.toHaveProperty('answers');
  expect(response.json()).not.toHaveProperty('snapshot');
});

it('pages counted answers in SQL with a fixed cap and stable ordering', async () => {
  const pages: AnswerPage[] = [];
  for (let page = 1; page <= 5; page++) {
    const response = await server.app.inject({
      url: `/api/admin/answers?page=${page}&limit=999999&pageSize=999999`,
      headers,
    });
    expect(response.statusCode).toBe(200);
    pages.push(response.json<AnswerPage>());
  }
  expect(pages.map((page) => page.items.length)).toEqual([100, 100, 100, 100, 10]);
  expect(pages[0]).toMatchObject({ total: 410, page: 1, pageSize: 100 });
  const keys = pages.flatMap((page) =>
    page.items.map((answer) => `${answer.participantId}/${answer.questionId}`),
  );
  expect(new Set(keys).size).toBe(410);
  const repeat = await server.app.inject({ url: '/api/admin/answers?page=2', headers });
  expect(repeat.json()).toEqual(pages[1]);
});

it('caps default monitoring and result requests', async () => {
  const data = await results();
  expect(data.audit).toHaveLength(100);
  expect(data.auditPagination).toMatchObject({ total: 615, page: 1, pageSize: 100 });
  expect(data.questions.flatMap((question) => question.results)).toHaveLength(100);
  expect(data.resultsPagination).toMatchObject({ total: 410, page: 1, pageSize: 100 });
  const all = [];
  for (let page = 1; page <= 7; page++) {
    const data = await results(`?auditPage=${page}`);
    all.push(...data.audit.map((entry) => `${entry.participantId}/${entry.operationId}`));
  }
  expect(all).toHaveLength(615);
  expect(new Set(all).size).toBe(615);
});

it('pages question results without skipping rows at question boundaries', async () => {
  const keys: string[] = [];
  for (let page = 1; page <= 5; page++) {
    const data = await results(`?resultsPage=${page}`);
    const rows = data.questions.flatMap((question) =>
      question.results.map((result) => `${question.question.id}/${result.participantId}`),
    );
    expect(rows).toHaveLength(page === 5 ? 10 : 100);
    keys.push(...rows);
  }
  expect(new Set(keys).size).toBe(410);
});

it('filters across the entire history before paging and retains global places', async () => {
  const query = new URLSearchParams({
    participant: ' łUKASZ TEST ',
    questionId,
    value: '012',
    lateOnly: 'true',
    minimumSeconds: '3',
    auditPage: '999',
    resultsPage: '999',
  });
  const data = await results(`?${query}`);
  expect(data.audit).toHaveLength(3);
  expect(data.auditPagination).toMatchObject({ total: 3, page: 1 });
  expect(data.questions[0]?.results).toEqual([
    { participantId: 'person-204', nickname: 'Łukasz', answer: '00123', score: 0, place: 205 },
  ]);
  expect(data.resultsPagination.total).toBe(1);
  query.set('minimumSeconds', '3.001');
  expect((await results(`?${query}`)).audit).toEqual([]);
});

it('handles literal text filters, empty matches and oversized page numbers', async () => {
  const data = await results('?value=%25&questionId=missing&auditPage=9007199254740991');
  expect(data.audit).toEqual([]);
  expect(data.auditPagination).toMatchObject({ total: 0, page: 1 });
  expect(data.questions.flatMap((question) => question.results)).toEqual([]);
  const last = await server.app.inject({ url: '/api/admin/answers?page=999999', headers });
  expect(last.json<AnswerPage>()).toMatchObject({ page: 5, total: 410 });
});

it('only reads a bounded decision preview for visible operations', async () => {
  const insert = server.db.prepare('INSERT INTO submission_reviews VALUES(?,?,?,?,?,?)');
  for (let i = 1; i <= 25; i++)
    insert.run(i, 'person-000', 'version-3', i % 2, `Reason ${i}`, 9000 + i);
  const data = await results('?participant=person-000');
  const entry = data.audit.find((entry) => entry.operationId === 'version-3')!;
  expect(entry.reviewCount).toBe(25);
  expect(entry.reviews).toHaveLength(20);
  expect(entry.reviews[0]?.reason).toBe('Reason 6');
  expect(entry.reviews.at(-1)?.reason).toBe('Reason 25');
  const response = await server.app.inject({
    url: '/api/admin/reviews/person-000/version-3?page=2',
    headers,
  });
  expect(response.statusCode).toBe(200);
  const history = response.json<Page<AuditEntry['reviews'][number]>>();
  expect(history).toMatchObject({ page: 2, pageSize: 20, total: 25 });
  expect(history.items).toHaveLength(5);
  expect(history.items[0]?.reason).toBe('Reason 1');
  expect(history.items.at(-1)?.reason).toBe('Reason 5');
  const other = await server.app.inject({
    url: '/api/admin/reviews/person-001/version-3?page=2',
    headers,
  });
  expect(other.json()).toMatchObject({ page: 1, total: 0, items: [] });
});

it.each(['0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992', ''])(
  'rejects invalid page numbers: %s',
  async (page) => {
    for (const path of [
      '/api/admin/answers?page=',
      '/api/admin/results?auditPage=',
      '/api/admin/results?resultsPage=',
      '/api/admin/reviews/person-000/version-3?page=',
    ]) {
      const response = await server.app.inject({ url: path + page, headers });
      expect(response.statusCode).toBe(400);
    }
  },
);

it('requires host authentication for paged answers', async () => {
  expect((await server.app.inject({ url: '/api/admin/answers' })).statusCode).toBe(401);
  expect(
    (await server.app.inject({ url: '/api/admin/reviews/person-000/version-3' })).statusCode,
  ).toBe(401);
});

it.each([
  'lateOnly=1',
  'minimumSeconds=-1',
  'minimumSeconds=Infinity',
  'minimumSeconds=NaN',
  `participant=${'x'.repeat(251)}`,
  'participant=a&participant=b',
])('rejects malformed filters: %s', async (query) => {
  const response = await server.app.inject({ url: `/api/admin/results?${query}`, headers });
  expect(response.statusCode).toBe(400);
});
