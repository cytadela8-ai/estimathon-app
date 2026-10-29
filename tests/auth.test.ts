/** Admin authorization follows the matched route, including encoded read and write URLs. */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createApp } from '#est-server/app';
import { Sessions } from '#est-server/sessions';

const password = 'auth-test-password-12345678';
const config = { durationSeconds: 180, revealDelaySeconds: 1, maxAnswer: '9999' };
const questions = [{ id: '', text: 'Private question', correct: '123', seconds: 180 }];
const adminRequests = [
  { method: 'GET', url: '/api/admin/overview' },
  { method: 'HEAD', url: '/api/admin/overview' },
  { method: 'GET', url: '/api/admin/results' },
  { method: 'HEAD', url: '/api/admin/results' },
  { method: 'PUT', url: '/api/admin/config', payload: { config, questions: [] } },
  { method: 'POST', url: '/api/admin/command', payload: { command: 'start' } },
  { method: 'POST', url: '/api/admin/reset', payload: { confirmed: true } },
  { method: 'POST', url: '/api/admin/review', payload: {} },
  { method: 'POST', url: '/api/admin/logout' },
  { method: 'DELETE', url: '/api/admin/participants/test-user' },
] as const;
const prefixes = [
  '/api/admin/',
  '/api/%61dmin/',
  '/api/ad%6Din/',
  '/%61pi/admin/',
  '/%61pi/%61%64%6D%69%6E/',
];
let server: Awaited<ReturnType<typeof createApp>>;
let participantToken: string;

beforeEach(async () => {
  server = await createApp({ databasePath: ':memory:', password });
  server.contest.configure(config, questions);
  participantToken = new Sessions(server.db).create({
    firstName: 'Private',
    lastName: 'Participant',
    nickname: 'Player',
  }).token;
});
afterEach(async () => {
  vi.restoreAllMocks();
  await server.app.close();
});

it.each(adminRequests)('protects $method $url for every path spelling', async (request) => {
  const before = structuredClone(server.contest.data);
  for (const prefix of prefixes) {
    const url = request.url.replace('/api/admin/', prefix);
    for (const token of ['', 'invalid-admin-token', participantToken]) {
      const response = await server.app.inject({
        ...request,
        url,
        headers: token ? { authorization: `Bearer ${token}` } : {},
      });
      expect(response.statusCode, `${request.method} ${url}`).toBe(401);
      if (request.method !== 'HEAD') {
        expect(response.json()).toEqual({ error: 'Zaloguj się jako prowadzący.' });
      }
      expect(server.contest.data).toEqual(before);
    }
  }
});

it('allows authenticated encoded reads and writes and revokes tokens on encoded logout', async () => {
  const login = await server.app.inject({
    method: 'POST',
    url: '/api/%6cogin',
    payload: { password },
  });
  expect(login.statusCode).toBe(200);
  const headers = { authorization: `Bearer ${login.json<{ token: string }>().token}` };
  const overview = await server.app.inject({
    url: '/%61pi/%61dmin/%6fverview?view=private',
    headers,
  });
  expect(overview.statusCode).toBe(200);
  expect(overview.json().questions[0].correct).toBe('123');
  const changedConfig = { ...config, durationSeconds: 240 };
  const update = await server.app.inject({
    method: 'PUT',
    url: '/api/%61dmin/config',
    headers,
    payload: { config: changedConfig, questions },
  });
  expect(update.statusCode).toBe(200);
  expect(server.contest.data.config).toEqual(changedConfig);
  const logout = await server.app.inject({ method: 'POST', url: '/api/%61dmin/logout', headers });
  expect(logout.statusCode).toBe(200);
  for (const url of ['/api/admin/overview', '/api/%61dmin/overview']) {
    expect((await server.app.inject({ url, headers })).statusCode).toBe(401);
  }
});

it('rejects expired admin tokens on ordinary and encoded routes', async () => {
  const now = Date.now();
  const login = await server.app.inject({
    method: 'POST',
    url: '/api/login',
    payload: { password },
  });
  const headers = { authorization: `Bearer ${login.json<{ token: string }>().token}` };
  vi.spyOn(Date, 'now').mockReturnValue(now + 13 * 3600_000);
  for (const url of ['/api/admin/overview', '/api/%61dmin/overview']) {
    expect((await server.app.inject({ url, headers })).statusCode).toBe(401);
  }
});
