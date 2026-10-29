/** Bounded Prometheus gauges for transport connections; no participant IDs or credentials. */
import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import type { ClientEvents, ServerEvents } from '#est-shared/protocol';

/**
 * Register transport gauges on the internal endpoint consumed by the monitoring Compose stack.
 *
 * Args:
 *   app: Application listener, isolated behind Caddy when monitoring is enabled.
 *   io: Socket.IO server including anonymous projector connections.
 */
export function registerMetrics(
  app: FastifyInstance,
  io: Server<ClientEvents, ServerEvents>,
): void {
  app.get('/internal/metrics', (_request, reply) => {
    let polling = 0;
    let websocket = 0;
    for (const socket of io.sockets.sockets.values()) {
      if (socket.conn.transport.name === 'polling') polling++;
      if (socket.conn.transport.name === 'websocket') websocket++;
    }
    return reply
      .type('text/plain; version=0.0.4; charset=utf-8')
      .send(
        [
          '# HELP estymathon_socketio_connections Open Socket.IO transport connections.',
          '# TYPE estymathon_socketio_connections gauge',
          `estymathon_socketio_connections ${io.sockets.sockets.size}`,
          '# HELP estymathon_socketio_transport_connections Open connections by transport.',
          '# TYPE estymathon_socketio_transport_connections gauge',
          `estymathon_socketio_transport_connections{transport="polling"} ${polling}`,
          `estymathon_socketio_transport_connections{transport="websocket"} ${websocket}`,
          '',
        ].join('\n'),
      );
  });
}
