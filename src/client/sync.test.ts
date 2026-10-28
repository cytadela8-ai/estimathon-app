/** Exercise the actual browser sync controller with only transport and browser boundaries mocked. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { get } from 'svelte/store';
import { io } from 'socket.io-client';
import type { Answer, Hello, Operation, Receipt, Session, Snapshot } from '#est-shared/protocol';
vi.mock('socket.io-client', () => ({ io: vi.fn() }));
type SaveCallback = (error: Error | null, receipt?: Receipt) => void;
interface Sent {
  operation: Operation;
  persisted: Operation | null;
  ack: SaveCallback;
}
const session: Session = {
  token: 'participant-token',
  recoveryCode: 'recovery-code',
  participant: { id: 'person', firstName: 'Jan', lastName: 'Test', nickname: 'JT' },
};
function snapshot(): Snapshot {
  return {
    serverNow: 1000,
    state: {
      phase: 'active',
      index: 0,
      startedAt: 1000,
      endsAt: 181000,
      closesAt: 181000,
      remainingMs: 0,
      resultsAt: null,
      version: 1,
    },
    question: { id: 'q', text: 'Ile?' },
    totalQuestions: 2,
    participantCount: 1,
    answerCount: 0,
    correct: null,
    results: [],
    standings: [],
  };
}
const sent: Sent[] = [];
const handlers = new Map<string, (...args: unknown[]) => void>();
const data = new Map<string, string>();
let stop = () => {};
let sync: typeof import('#est-client/sync');
function accepted(item: Sent): Answer {
  return { ...item.operation, participantId: 'person', acceptedAt: 2000 };
}
function confirm(item: Sent): void {
  item.ack(null, {
    operationId: item.operation.operationId,
    status: 'accepted',
    answer: accepted(item),
  });
}
beforeEach(async () => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(1000);
  data.clear();
  sent.length = 0;
  handlers.clear();
  data.set('estymator.session', JSON.stringify(session));
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    key: (index: number) => [...data.keys()][index] ?? null,
    get length() {
      return data.size;
    },
  });
  const events = new EventTarget();
  vi.stubGlobal('window', {
    addEventListener: events.addEventListener.bind(events),
    removeEventListener: events.removeEventListener.bind(events),
  });
  const socket = {
    connected: true,
    on: (event: string, callback: (...args: unknown[]) => void) => {
      handlers.set(event, callback);
    },
    timeout: (_milliseconds: number) => socket,
    disconnect: () => {
      socket.connected = false;
    },
    emit: (event: string, ...args: unknown[]) => {
      if (event === 'snapshot') {
        const ack = args[0] as (error: Error | null, hello: Hello) => void;
        ack(null, { snapshot: snapshot(), answers: [] });
      }
      if (event === 'save') {
        const operation = args[0] as Operation;
        const text = data.get(`estymator.answer.person.${operation.questionId}`);
        const draft = text ? (JSON.parse(text) as { operation: Operation }) : null;
        sent.push({ operation, persisted: draft?.operation ?? null, ack: args[1] as SaveCallback });
      }
    },
  };
  vi.mocked(io).mockReturnValue(socket as unknown as ReturnType<typeof io>);
  sync = await import('#est-client/sync');
  stop = sync.initialize();
  handlers.get('connect')!();
});
afterEach(() => {
  stop();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('answer acknowledgments', () => {
  it('persists text before sending it and retries the valid edit behind an empty draft', () => {
    sync.edit('123');
    expect(sent[0]!.persisted).toEqual(sent[0]!.operation);
    sync.edit('');
    sent[0]!.ack(new Error('Timeout'));
    vi.advanceTimersByTime(1500);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.operation).toEqual(sent[0]!.operation);
    confirm(sent[1]!);
    expect(get(sync.client)).toMatchObject({ text: '', confirmed: '123', error: null });
  });
  it('does not show an obsolete timeout after a newer edit is confirmed', () => {
    sync.edit('1');
    sync.edit('12');
    confirm(sent[1]!);
    sent[0]!.ack(new Error('Old operation timed out'));
    expect(get(sync.client)).toMatchObject({
      text: '12',
      pending: false,
      error: null,
      confirmed: '12',
    });
  });
  it('does not show a timeout after an accepted answer broadcast confirms the operation', () => {
    sync.edit('1');
    handlers.get('answer')!(accepted(sent[0]!));
    sent[0]!.ack(new Error('Acknowledgment lost'));
    expect(get(sync.client)).toMatchObject({ pending: false, error: null, confirmed: '1' });
  });
  it('does not show an old question timeout on the new question', () => {
    sync.edit('1');
    const next = snapshot();
    next.state.version = 2;
    next.state.index = 1;
    next.question = { id: 'next', text: 'Kolejne pytanie' };
    handlers.get('state')!(next);
    sent[0]!.ack(new Error('Previous question timeout'));
    expect(get(sync.client)).toMatchObject({ text: '', pending: false, error: null });
  });
  it('reports a genuine pending timeout and clears it after a successful retry', () => {
    sync.edit('1');
    sent[0]!.ack(new Error('Timeout'));
    expect(get(sync.client).error).toContain('Brak potwierdzenia');
    vi.advanceTimersByTime(1500);
    confirm(sent[1]!);
    expect(get(sync.client)).toMatchObject({ pending: false, error: null, confirmed: '1' });
  });
});
