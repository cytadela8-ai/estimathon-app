/** A deployment stop must release live WebSockets before waiting for the HTTP listener to close. */
import { afterEach, expect, it } from 'vitest';
import { io, type Socket } from 'socket.io-client';
import { createApp } from '#est-server/app';

let server: Awaited<ReturnType<typeof createApp>> | undefined;
let socket: Socket | undefined;

afterEach(async () => {
  socket?.disconnect();
  await server?.app.close();
});

it.each(['polling', 'websocket'] as const)(
  'closes the server and database with %s connected',
  async (transport) => {
    server = await createApp({ databasePath: ':memory:', password: 'test-password-12345678' });
    await server.app.listen({ host: '127.0.0.1', port: 0 });
    const address = server.app.server.address();
    if (!address || typeof address === 'string') throw new Error('No TCP listener');
    socket = io(`http://127.0.0.1:${address.port}`, {
      transports: [transport],
      reconnection: false,
    });
    await new Promise<void>((resolve, reject) => {
      socket!.once('connect', resolve);
      socket!.once('connect_error', reject);
    });
    const closing = server.app.close();
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        closing,
        new Promise<never>((_resolve, reject) => {
          timeout = setTimeout(
            () => reject(new Error(`Shutdown waited for a live ${transport} connection`)),
            1000,
          );
        }),
      ]);
      expect(server.db.open).toBe(false);
      expect(server.app.server.listening).toBe(false);
    } finally {
      clearTimeout(timeout);
      socket.disconnect();
      await closing;
    }
  },
);
