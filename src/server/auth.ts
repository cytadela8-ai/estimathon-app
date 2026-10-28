/** Host authentication is independent of persistent participant sessions. */
import type { FastifyInstance } from 'fastify';
import { randomBytes, timingSafeEqual } from 'node:crypto';
export function registerAuth(app: FastifyInstance, password: string) {
  const adminTokens = new Map<string, number>();
  const attempts = new Map<string, { count: number; until: number }>();
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
    const expected = Buffer.from(password);
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      return reply.code(401).send({ error: 'Nieprawidłowe hasło.' });
    }
    const token = randomBytes(32).toString('hex');
    adminTokens.set(token, now + 12 * 3600_000);
    return { token };
  });
  app.post('/api/admin/logout', async (request) => {
    adminTokens.delete(request.headers.authorization?.replace(/^Bearer /, '') ?? '');
    return { ok: true };
  });

  return () => {
    const now = Date.now();
    for (const [token, until] of adminTokens) if (until <= now) adminTokens.delete(token);
    for (const [ip, attempt] of attempts) if (attempt.until <= now) attempts.delete(ip);
  };
}
