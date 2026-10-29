/** Admin account removal revokes credentials before terminating all participant sockets. */
import type { FastifyInstance } from 'fastify';
import type { Contest } from '#est-server/contest';

interface Context {
  contest: Contest;
  connections: Map<string, number>;
  disconnect: (participantId: string) => void;
  changed: () => void;
}

export function registerParticipantAdmin(app: FastifyInstance, context: Context): void {
  app.delete<{ Params: { participantId: string } }>(
    '/api/admin/participants/:participantId',
    async (request, reply) => {
      const id = request.params.participantId;
      if (!context.contest.removeParticipant(id)) {
        return reply.code(404).send({ error: 'Nie znaleziono uczestnika.' });
      }
      context.disconnect(id);
      context.connections.delete(id);
      context.changed();
      return { ok: true };
    },
  );
}
