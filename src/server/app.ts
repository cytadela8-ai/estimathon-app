/** Same-origin HTTP and Socket.IO transport; public broadcasts never contain live answers. */
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { Server } from 'socket.io';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { Contest } from '#est-server/contest';
import { openDatabase } from '#est-server/database';
import { AnswerStore } from '#est-server/answers';
import { Sessions } from '#est-server/sessions';
import type { ClientEvents, ServerEvents } from '#est-shared/protocol';
import { registerAuth } from '#est-server/auth';
import { registerRoutes } from '#est-server/routes';
import { registerRealtime } from '#est-server/realtime';
interface Options {
  databasePath: string;
  password: string;
  staticPath?: string;
}
/** Create an isolated server instance; caller owns listening and graceful shutdown. */
export async function createApp(options: Options) {
  if (options.password.length < 16)
    throw new Error('ADMIN_PASSWORD must contain at least 16 characters.');
  const db = openDatabase(options.databasePath);
  const contest = new Contest(db);
  const answers = new AnswerStore(db, contest);
  const sessions = new Sessions(db);
  const app = Fastify({ logger: process.env['NODE_ENV'] !== 'test', bodyLimit: 256_000 });
  const io = new Server<ClientEvents, ServerEvents>(app.server, { maxHttpBufferSize: 16_384 });
  const connections = new Map<string, number>();
  let dirty = false;
  let lastVersion = -1;
  const cleanupAuth = registerAuth(app, options.password);
  const context = {
    contest,
    sessions,
    answers,
    connections,
    changed: () => {
      dirty = true;
    },
  };
  registerRoutes(app, context);
  registerRealtime(app, io, context);
  const timer = setInterval(() => {
    contest.tick();
    if (dirty || lastVersion !== contest.state.version) {
      io.emit('state', contest.snapshot());
      lastVersion = contest.state.version;
      dirty = false;
    }
    cleanupAuth();
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
