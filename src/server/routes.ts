/** Validated HTTP operations for host control, registration and recovery. */
import type { FastifyInstance } from 'fastify';
import type { Contest } from '#est-server/contest';
import type { Sessions } from '#est-server/sessions';
import type { Config, Question, Command, Participant } from '#est-shared/protocol';
interface Context {
  contest: Contest;
  sessions: Sessions;
  connections: Map<string, number>;
  changed: () => void;
}
export function registerRoutes(app: FastifyInstance, context: Context): void {
  const { contest, sessions, connections, changed } = context;
  const db = contest.db;
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
  app.get('/api/admin/overview', async () => ({
    ...contest.data,
    snapshot: contest.snapshot(),
    participants: sessions.list().map((p) => ({ ...p, connections: connections.get(p.id) ?? 0 })),
    answers: db.prepare('SELECT * FROM answers').all(),
  }));
  app.put<{ Body: { config: Config; questions: Question[] } }>(
    '/api/admin/config',
    async (request) => {
      contest.configure(request.body?.config, request.body?.questions);
      changed();
      return { ok: true };
    },
  );
  app.post<{ Body: { command: Command } }>('/api/admin/command', async (request) => {
    contest.command(request.body?.command);
    changed();
    return { ok: true };
  });
}
