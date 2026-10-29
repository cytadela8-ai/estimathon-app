/** Proxy-aware login limits must separate clients without trusting spoofed upstream addresses. */
import { afterEach, expect, it } from 'vitest';
import { createApp } from '#est-server/app';

const password = 'test-password-12345678';
const servers: Awaited<ReturnType<typeof createApp>>[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) await server.app.close();
});

async function login(app: Awaited<ReturnType<typeof createApp>>['app'], forwarded: string) {
  return app.inject({
    method: 'POST',
    url: '/api/login',
    headers: { 'x-forwarded-for': forwarded },
    payload: { password },
  });
}

it('ignores forwarded addresses by default so direct clients cannot bypass login limits', async () => {
  const server = await createApp({ databasePath: ':memory:', password });
  servers.push(server);
  const { app } = server;
  for (let attempt = 0; attempt < 10; attempt++) {
    expect((await login(app, `192.0.2.${attempt + 1}`)).statusCode).toBe(200);
  }
  expect((await login(app, '198.51.100.1')).statusCode).toBe(429);
});

it('uses only the nearest forwarded address when the HTTPS proxy is enabled', async () => {
  const server = await createApp({ databasePath: ':memory:', password, trustProxy: true });
  servers.push(server);
  for (let attempt = 0; attempt < 10; attempt++) {
    expect((await login(server.app, '192.0.2.1')).statusCode).toBe(200);
  }
  expect((await login(server.app, '192.0.2.1')).statusCode).toBe(429);
  expect((await login(server.app, '198.51.100.1, 192.0.2.1')).statusCode).toBe(429);
  expect((await login(server.app, '192.0.2.2')).statusCode).toBe(200);
});
