/** Validated HTTP operations for host control, registration and recovery. */
import type { FastifyInstance } from 'fastify';
import type { Contest } from '#est-server/contest';
import type { AnswerStore } from '#est-server/answers';
import type { Sessions } from '#est-server/sessions';
import type { Config, Question, Command, Participant, Review } from '#est-shared/protocol';
import { adminQuery } from '#est-server/pagination';
import { countedAnswers, questionResults } from '#est-server/admin-data';
import { reviewHistory } from '#est-server/audit';
interface Context {
  contest: Contest;
  sessions: Sessions;
  answers: AnswerStore;
  reconcile: (participantId: string) => void;
  connections: Map<string, number>;
  changed: () => void;
}
export function registerRoutes(app: FastifyInstance, context: Context): void {
  const { contest, sessions, answers, connections, changed, reconcile } = context;
  app.post<{ Body: Omit<Participant, 'id'> }>('/api/session', async (request) => {
    const session = sessions.create(request.body);
    changed();
    return session;
  });
  app.post<{ Body: { code: string } }>('/api/recover', async (request, reply) => {
    const session = sessions.recover(request.body?.code);
    return session ?? reply.code(404).send({ error: 'Nie znaleziono kodu odzyskiwania.' });
  });
  app.get('/api/state', async () => contest.snapshot());
  app.get('/api/results', async (request, reply) => {
    const token = request.headers.authorization?.replace(/^Bearer /, '');
    const session = sessions.find(token);
    if (!session) return reply.code(401).send({ error: 'Zaloguj się jako uczestnik.' });
    if (contest.state.phase !== 'finished')
      return reply.code(409).send({ error: 'Wyniki będą dostępne po zakończeniu konkursu.' });
    return {
      version: contest.state.version,
      questions: contest.participantResults(session.participant.id),
    };
  });
  app.get('/api/admin/overview', async () => ({
    ...contest.data,
    participants: sessions.list().map((p) => ({ ...p, connections: connections.get(p.id) ?? 0 })),
  }));
  app.get<{ Querystring: Record<string, unknown> }>('/api/admin/answers', async (request) =>
    countedAnswers(contest, adminQuery(request.query)),
  );
  app.get<{
    Params: { participantId: string; operationId: string };
    Querystring: Record<string, unknown>;
  }>('/api/admin/reviews/:participantId/:operationId', async (request) => {
    const { participantId, operationId } = request.params;
    return reviewHistory(contest.db, participantId, operationId, adminQuery(request.query).page);
  });
  app.get<{ Querystring: Record<string, unknown> }>('/api/admin/results', async (request) => {
    const query = adminQuery(request.query);
    const { items: audit, ...auditPagination } = answers.audit(query);
    return {
      participants: sessions.list().map((p) => ({
        id: p.id,
        firstName: p.firstName,
        lastName: p.lastName,
        nickname: p.nickname,
      })),
      ...questionResults(contest, query),
      standings: contest.standings(),
      audit,
      auditPagination,
    };
  });
  app.post<{ Body: Review }>('/api/admin/review', async (request) => {
    answers.review(request.body);
    reconcile(request.body.participantId);
    changed();
    return { ok: true };
  });
  app.put<{ Body: { config: Config; questions: Question[] } }>(
    '/api/admin/config',
    async (request) => {
      contest.configure(request.body?.config, request.body?.questions);
      changed();
      return { ok: true };
    },
  );
  app.post<{ Body: { confirmed: boolean } }>('/api/admin/reset', async (request) => {
    if (request.body?.confirmed !== true) throw new Error('Potwierdź reset konkursu.');
    const backup = contest.reset();
    for (const participant of sessions.list()) reconcile(participant.id);
    changed();
    return { backup };
  });
  app.post<{ Body: { command: Command } }>('/api/admin/command', async (request) => {
    contest.command(request.body?.command);
    changed();
    return { ok: true };
  });
}
