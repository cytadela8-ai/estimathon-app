/** Internal monitoring reports live transport counts without exposing participant credentials. */
import { afterEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '#est-server/app';

const servers: Awaited<ReturnType<typeof createApp>>[] = [];
const sockets: Socket[] = [];
const password = 'test-password-12345678';

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.disconnect();
  for (const server of servers.splice(0)) await server.app.close();
});

it('does not expose monitoring unless explicitly enabled', async () => {
  const server = await createApp({ databasePath: ':memory:', password });
  servers.push(server);
  expect((await server.app.inject({ url: '/internal/metrics' })).statusCode).toBe(404);
});

it('counts polling and WebSocket transports and updates after disconnect', async () => {
  const server = await createApp({ databasePath: ':memory:', password, metrics: true });
  servers.push(server);
  await server.app.listen({ host: '127.0.0.1', port: 0 });
  const address = server.app.server.address();
  if (!address || typeof address === 'string') throw new Error('No TCP listener');
  const initial = await server.app.inject({ url: '/internal/metrics' });
  expect(initial.headers['content-type']).toContain('text/plain');
  expect(initial.body).toContain('estymathon_socketio_connections 0\n');
  for (const transport of ['polling', 'websocket'] as const) {
    const socket = io(`http://127.0.0.1:${address.port}`, {
      transports: [transport],
      forceNew: true,
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
  }
  const response = await server.app.inject({ url: '/internal/metrics' });
  expect(response.body).toContain('estymathon_socketio_connections 2\n');
  expect(response.body).toContain(
    'estymathon_socketio_transport_connections{transport="polling"} 1',
  );
  expect(response.body).toContain(
    'estymathon_socketio_transport_connections{transport="websocket"} 1',
  );
  expect(response.body).not.toContain(password);
  for (const socket of sockets) socket.disconnect();
  await expect
    .poll(async () => (await server.app.inject({ url: '/internal/metrics' })).body)
    .toContain('estymathon_socketio_connections 0\n');
});
