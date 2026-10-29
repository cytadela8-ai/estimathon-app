/** Private final summaries expose only played questions and authoritative personal answers. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createApp } from '#est-server/app';
import { Sessions } from '#est-server/sessions';
import { AnswerStore } from '#est-server/answers';
import { Contest } from '#est-server/contest';
import type { Session } from '#est-shared/protocol';
let server: Awaited<ReturnType<typeof createApp>>;
let player: Session;
let other: Session;
let answers: AnswerStore;
const startedAt = 1000;
beforeEach(async () => {
  vi.spyOn(Date, 'now').mockReturnValue(1000);
  server = await createApp({
    databasePath: ':memory:',
    password: 'personal-results-test-password',
  });
  server.contest.configure(
    { durationSeconds: 180, revealDelaySeconds: 1, maxAnswer: '999999' },
    ['Pierwsze pytanie', 'Drugie pytanie', 'Niegrane pytanie'].map((text) => ({
      id: '',
      text,
      correct: '100',
      seconds: 180,
    })),
  );
  const sessions = new Sessions(server.db);
  player = sessions.create({ firstName: 'Ania', lastName: 'Test', nickname: 'Ania' });
  other = sessions.create({ firstName: 'Bartek', lastName: 'Test', nickname: 'Bartek' });
  answers = new AnswerStore(server.db, server.contest);
});
afterEach(async () => {
  await server.app.close();
  vi.restoreAllMocks();
});
function fetchResults(token = player.token) {
  return server.app.inject({ url: '/api/results', headers: { authorization: `Bearer ${token}` } });
}
function save(session: Session, questionId: string, text: string, now = 1100) {
  return answers.save(
    session.participant.id,
    {
      questionId,
      operationId: randomUUID(),
      revision: 1,
      text,
    },
    now,
  );
}
function finish() {
  server.contest.command('finish', 3000);
  server.contest.tick(4001);
}
describe('participant final result endpoint', () => {
  it('requires participant credentials, including after the contest ends', async () => {
    server.contest.command('start', startedAt);
    finish();
    expect((await server.app.inject({ url: '/api/results' })).statusCode).toBe(401);
    expect((await fetchResults('wrong-token')).statusCode).toBe(401);
  });
  it('withholds summaries before the final phase', async () => {
    expect((await fetchResults()).statusCode).toBe(409);
    server.contest.command('start', startedAt);
    expect((await fetchResults()).statusCode).toBe(409);
    server.contest.command('pause', 1100);
    expect((await fetchResults()).statusCode).toBe(409);
    server.contest.command('finish', 2000);
    expect((await fetchResults()).statusCode).toBe(409);
  });
  it('withholds summaries during closing and per-question results', async () => {
    server.contest.command('start', startedAt);
    server.contest.command('next', 1100);
    expect((await fetchResults()).statusCode).toBe(409);
    server.contest.tick(2101);
    expect((await fetchResults()).statusCode).toBe(409);
    expect(server.contest.participantResults(player.participant.id)).toEqual([]);
  });
  it('returns personal answers in question order, zero for missing, and no unplayed questions', async () => {
    server.contest.command('start', startedAt);
    const first = server.contest.question!.id;
    save(player, first, '100');
    save(other, first, '500');
    server.contest.command('next', 1200);
    server.contest.tick(2201);
    server.contest.command('next', 2300);
    const second = server.contest.question!.id;
    finish();
    const response = await fetchResults();
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      version: server.contest.state.version,
      questions: [
        { questionId: first, number: 1, text: 'Pierwsze pytanie', answer: '100', score: 1000 },
        { questionId: second, number: 2, text: 'Drugie pytanie', answer: null, score: 0 },
      ],
    });
    const otherResponse = await fetchResults(other.token);
    expect(otherResponse.json().questions[0]).toMatchObject({ answer: '500' });
    const spoofed = await server.app.inject({
      url: `/api/results?participantId=${other.participant.id}`,
      headers: { authorization: `Bearer ${player.token}` },
    });
    expect(spoofed.json()).toEqual(response.json());
    expect(response.body).not.toContain('Bartek');
    expect(response.body).not.toContain('500');
    expect(response.body).not.toContain('correct');
    expect(response.body).not.toContain('Niegrane');
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('updates late answers and host reviews and restores summaries after engine restart', async () => {
    server.contest.command('start', startedAt);
    const questionId = server.contest.question!.id;
    finish();
    expect((await fetchResults()).json().questions[0]).toMatchObject({ answer: null, score: 0 });
    const receipt = save(player, questionId, '100', 5000);
    expect(receipt.status).toBe('accepted');
    const operationId = receipt.operationId;
    expect((await fetchResults()).json().questions[0]).toMatchObject({
      answer: '100',
      score: 1000,
    });
    answers.review({
      participantId: player.participant.id,
      operationId,
      excluded: true,
      reason: 'Sprawdzenie',
    });
    expect((await fetchResults()).json().questions[0]).toMatchObject({ answer: null, score: 0 });
    answers.review({
      participantId: player.participant.id,
      operationId,
      excluded: false,
      reason: 'Przywrócenie',
    });
    const restarted = new Contest(server.db);
    expect(restarted.participantResults(player.participant.id)[0]).toMatchObject({
      answer: '100',
      score: 1000,
    });
  });
});
