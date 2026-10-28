/** Same-origin HTTP and Socket.IO transport; public broadcasts never contain live answers. */
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Contest } from '#est-server/contest';
import { openDatabase } from '#est-server/database';
import { AnswerStore } from '#est-server/answers';
import { Sessions } from '#est-server/sessions';
import type { Scorer } from '#est-server/scoring';
import type {
  ClientEvents,
  ServerEvents,
  Config,
  Question,
  Command,
  Participant,
} from '#est-shared/protocol';
interface Options {
  databasePath: string;
  password: string;
  score?: Scorer;
  staticPath?: string;
}
/** Create an isolated server instance; caller owns listening and graceful shutdown. */
export async function createApp(options: Options) {
  if (options.password.length < 16)
    throw new Error('ADMIN_PASSWORD must contain at least 16 characters.');
  const db = openDatabase(options.databasePath);
  const contest = new Contest(db, options.score);
  const answers = new AnswerStore(db, contest);
  const sessions = new Sessions(db);
  const app = Fastify({ logger: process.env['NODE_ENV'] !== 'test', bodyLimit: 256_000 });
  const io = new Server<ClientEvents, ServerEvents>(app.server, { maxHttpBufferSize: 16_384 });
  const connections = new Map<string, number>();
  const adminTokens = new Map<string, number>();
  const attempts = new Map<string, { count: number; until: number }>();
  let dirty = false;
  let lastVersion = -1;
  app.setErrorHandler((error, _request, reply) => {
    const message = error instanceof Error ? error.message : 'Błąd serwera';
    if (!reply.sent) void reply.code(400).send({ error: message });
  });
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!request.url.startsWith('/api/admin/')) return;
    const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
    if ((adminTokens.get(token) ?? 0) <= Date.now()) {
      adminTokens.delete(token);
      return reply.code(401).send({ error: 'Zaloguj się jako prowadzący.' });
    }
  });
  app.post<{ Body: { password: string } }>('/api/login', async (request, reply) => {
    const now = Date.now();
    const attempt = attempts.get(request.ip) ?? { count: 0, until: now + 60_000 };
    if (now > attempt.until) {
      attempt.count = 0;
      attempt.until = now + 60_000;
    }
    attempt.count++;
    attempts.set(request.ip, attempt);
    if (attempt.count > 10) return reply.code(429).send({ error: 'Spróbuj ponownie za minutę.' });
    const supplied = Buffer.from(request.body?.password ?? '');
    const expected = Buffer.from(options.password);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).send({ error: 'Nieprawidłowe hasło.' });
    }
    const token = randomBytes(32).toString('hex');
    adminTokens.set(token, now + 12 * 3600_000);
    return { token };
  });
  app.post<{ Body: Omit<Participant, 'id'> }>('/api/session', async (request) => {
    const session = sessions.create(request.body);
    dirty = true;
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
      dirty = true;
      return { ok: true };
    },
  );
  app.post<{ Body: { command: Command } }>('/api/admin/command', async (request) => {
    contest.command(request.body?.command);
    dirty = true;
    return { ok: true };
  });
  app.post('/api/admin/logout', async (request) => {
    adminTokens.delete(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
    return { ok: true };
  });
  io.use((socket, next) => {
    const session = sessions.find(socket.handshake.auth['token']);
    if (socket.handshake.auth['token'] && !session)
      return next(new Error('Sesja wygasła. Odzyskaj konto kodem.'));
    socket.data['participantId'] = session?.participant.id;
    next();
  });
  io.on('connection', (socket) => {
    const id = socket.data['participantId'] as string | undefined;
    if (id) {
      connections.set(id, (connections.get(id) ?? 0) + 1);
      void socket.join(id);
    }
    socket.on('snapshot', (ack) => {
      if (typeof ack === 'function')
        ack({ snapshot: contest.snapshot(), answers: id ? answers.all(id) : [] });
    });
    socket.on('save', (operation, ack) => {
      if (!id || typeof ack !== 'function') return;
      try {
        const receipt = answers.save(id, operation);
        ack(receipt);
        if (receipt.status === 'accepted' && receipt.answer) {
          io.to(id).emit('answer', receipt.answer);
          dirty = true;
        }
      } catch (error) {
        app.log.error(error, 'Answer transaction failed; no acknowledgment issued');
      }
    });
    socket.on('disconnect', () => {
      if (id) connections.set(id, Math.max(0, (connections.get(id) ?? 1) - 1));
    });
  });
  const timer = setInterval(() => {
    contest.tick();
    if (dirty || lastVersion !== contest.state.version) {
      io.emit('state', contest.snapshot());
      lastVersion = contest.state.version;
      dirty = false;
    }
    const now = Date.now();
    for (const [token, until] of adminTokens) if (until <= now) adminTokens.delete(token);
    for (const [ip, attempt] of attempts) if (attempt.until <= now) attempts.delete(ip);
  }, 100);
  const staticPath = options.staticPath ?? resolve('dist/client');
  if (existsSync(staticPath)) {
    await app.register(fastifyStatic, { root: staticPath });
    app.setNotFoundHandler((request, reply) => {
      if (['/', '/play', '/admin', '/screen'].includes(request.url.split('?')[0] ?? '')) {
        return reply.sendFile('index.html');
      }
      return reply.code(404).send({ error: 'Nie znaleziono strony.' });
    });
  }
  app.addHook('onClose', async () => {
    clearInterval(timer);
    io.disconnectSockets();
    await new Promise<void>((r) => io.close(() => r()));
    db.close();
  });
  return { app, contest, db, io };
}
