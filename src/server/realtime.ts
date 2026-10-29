/** Socket handlers authorize identity once and acknowledge only committed answer writes. */
import type { FastifyInstance } from 'fastify';
import type { Server } from 'socket.io';
import type { Contest } from '#est-server/contest';
import type { Sessions } from '#est-server/sessions';
import type { AnswerStore } from '#est-server/answers';
import type { ClientEvents, ServerEvents } from '#est-shared/protocol';
interface Context {
  trustProxy: boolean;
  contest: Contest;
  sessions: Sessions;
  answers: AnswerStore;
  connections: Map<string, number>;
  changed: () => void;
}
export function registerRealtime(
  app: FastifyInstance,
  io: Server<ClientEvents, ServerEvents>,
  context: Context,
): void {
  const { contest, sessions, answers, connections, changed } = context;
  io.use((socket, next) => {
    const session = sessions.find(socket.handshake.auth['token']);
    if (socket.handshake.auth['token'] && !session)
      return next(new Error('Sesja wygasła. Odzyskaj konto kodem.'));
    if (session) {
      const forwarded = socket.handshake.headers['x-forwarded-for'];
      const ip =
        context.trustProxy && typeof forwarded === 'string'
          ? forwarded.split(',').at(-1)!.trim()
          : socket.handshake.address;
      sessions.recordIp(session.participant.id, ip);
    }
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
        ack({
          snapshot: contest.snapshot(),
          ...(id ? answers.snapshot(id) : { answers: [], revisions: {} }),
        });
    });
    socket.on('save', (operation, ack) => {
      if (!id || typeof ack !== 'function') return;
      try {
        const receipt = answers.save(id, operation);
        ack(receipt);
        if (receipt.status === 'accepted' && receipt.answer) {
          io.to(id).emit('answers', answers.snapshot(id));
          changed();
        }
      } catch (error) {
        app.log.error(error, 'Answer transaction failed; no acknowledgment issued');
      }
    });
    socket.on('disconnect', () => {
      if (id) connections.set(id, Math.max(0, (connections.get(id) ?? 1) - 1));
    });
  });
}
