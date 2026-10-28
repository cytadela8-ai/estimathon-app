/**
 * Reliable browser synchronization: storage before emit, retries, snapshots and clock estimation.
 */
import { io, type Socket } from 'socket.io-client';
import { writable } from 'svelte/store';
import type {
  ClientEvents,
  ServerEvents,
  Snapshot,
  Session,
  Answer,
  Operation,
} from '#est-shared/protocol';
import { compareOperations, isPositiveInteger } from '#est-shared/protocol';
import { Ledger } from '#est-client/ledger';
export interface ClientState {
  session: Session | null;
  snapshot: Snapshot | null;
  connected: boolean;
  text: string;
  pending: boolean;
  error: string | null;
  offset: number;
  confirmed: string | null;
}
export const client = writable<ClientState>({
  session: null,
  snapshot: null,
  connected: false,
  text: '',
  pending: false,
  error: null,
  offset: 0,
  confirmed: null,
});
let current: ClientState;
client.subscribe((value) => {
  current = value;
});
let socket: Socket<ServerEvents, ClientEvents>;
let ledger: Ledger | null = null;
const confirmed = new Map<string, Answer>();
const inFlight = new Set<string>();
function refreshDraft(): void {
  const id = current.snapshot?.question?.id;
  const draft = id ? ledger?.read(id) : null;
  const confirmedText = id ? confirmed.get(id)?.text : undefined;
  client.update((v) => ({ ...v, ...draftView(draft), confirmed: confirmedText ?? null }));
}
function draftView(draft: import('#est-client/ledger').Draft | null | undefined) {
  if (!draft) return { text: '', pending: false, error: null };
  return { text: draft.operation.text, pending: draft.pending, error: draft.error };
}
function guarded(action: () => void): void {
  try {
    action();
  } catch (error) {
    client.update((v) => ({
      ...v,
      error: error instanceof Error ? error.message : 'Błąd pamięci przeglądarki.',
    }));
  }
}
function receive(snapshot: Snapshot): void {
  if (current.snapshot && snapshot.state.version < current.snapshot.state.version) return;
  client.update((v) => ({ ...v, snapshot }));
  guarded(refreshDraft);
}
function remember(answer: Answer): void {
  const old = confirmed.get(answer.questionId);
  if (!old || compareOperations(answer, old) > 0) confirmed.set(answer.questionId, answer);
}
function apply(answer: Answer): void {
  remember(answer);
  ledger?.remote(answer);
  refreshDraft();
}
function showTimeout(operation: Operation): void {
  if (current.snapshot?.question?.id !== operation.questionId) return;
  if (ledger?.pendingOperation(operation.questionId)?.operationId !== operation.operationId) return;
  client.update((v) => ({ ...v, error: 'Brak potwierdzenia zapisu. Ponawiamy synchronizację.' }));
}
function send(operation: Operation): void {
  if (!socket?.connected || inFlight.has(operation.operationId)) return;
  inFlight.add(operation.operationId);
  socket.timeout(2000).emit('save', operation, (error: Error | null, receipt) => {
    inFlight.delete(operation.operationId);
    if (error) {
      guarded(() => showTimeout(operation));
      return;
    }
    guarded(() => {
      if (receipt.answer) remember(receipt.answer);
      ledger?.receipt(receipt, operation.questionId);
      refreshDraft();
    });
  });
}
function flush(): void {
  guarded(() => {
    if (!ledger) return;
    // Include drafts from previous questions so late rejection is explicit after reconnect.
    const prefix = `estymator.answer.${ledger.participantId}.`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(prefix)) continue;
      const operation = ledger.pendingOperation(key.slice(prefix.length));
      if (operation) send(operation);
    }
  });
}
export function edit(text: string): void {
  const question = current.snapshot?.question;
  if (!question || !ledger) return;
  // Update visible text even when storage is unavailable; do not claim it was saved.
  client.update((v) => ({ ...v, text }));
  guarded(() => {
    const draft = ledger!.edit(
      question.id,
      text,
      cryptoId(),
      confirmed.get(question.id)?.revision ?? 0,
    );
    refreshDraft();
    if (isPositiveInteger(text)) send(draft.operation);
  });
}
function cryptoId(): string {
  // getRandomValues works on HTTP LAN origins where randomUUID may be unavailable.
  return Array.from(crypto.getRandomValues(new Uint8Array(20)), (n) =>
    n.toString(16).padStart(2, '0'),
  ).join('');
}
/** Store identity before connecting so reopening the browser restores the same participant. */
export function setSession(session: Session): void {
  localStorage.setItem('estymator.session', JSON.stringify(session));
  window.location.assign('/play');
}
export async function api<T>(
  path: string,
  body?: unknown,
  token?: string,
  method = 'POST',
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json();
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? 'Nie udało się połączyć z serwerem.'), {
      status: response.status,
    });
  return data as T;
}
export function initialize(): () => void {
  guarded(() => {
    const stored = localStorage.getItem('estymator.session');
    const session = stored ? (JSON.parse(stored) as Session) : null;
    client.update((v) => ({ ...v, session }));
    if (session) ledger = new Ledger(localStorage, session.participant.id);
  });
  socket = io({ auth: { token: current.session?.token } });
  const synchronize = () => {
    if (!socket.connected) return;
    const sent = Date.now();
    socket.timeout(3000).emit('snapshot', (error: Error | null, hello) => {
      if (error) return;
      client.update((v) => ({ ...v, offset: hello.snapshot.serverNow - (sent + Date.now()) / 2 }));
      guarded(() => {
        for (const answer of hello.answers) apply(answer);
        receive(hello.snapshot);
        flush();
      });
    });
  };
  socket.on('connect', () => {
    client.update((v) => ({ ...v, connected: true, error: null }));
    synchronize();
  });
  socket.on('disconnect', () => {
    client.update((v) => ({ ...v, connected: false }));
  });
  socket.on('connect_error', (error) => {
    client.update((v) => ({ ...v, connected: false, error: error.message }));
  });
  socket.on('state', (snapshot) => {
    receive(snapshot);
    flush();
  });
  socket.on('answer', (answer) => {
    guarded(() => apply(answer));
  });
  const storage = (event: StorageEvent) => {
    if (event.key === 'estymator.session') window.location.reload();
    if (event.key?.startsWith('estymator.answer.'))
      guarded(() => {
        refreshDraft();
        flush();
      });
  };
  window.addEventListener('storage', storage);
  const retry = setInterval(flush, 1500);
  const clock = setInterval(synchronize, 15_000);
  return () => {
    socket.disconnect();
    clearInterval(retry);
    clearInterval(clock);
    window.removeEventListener('storage', storage);
  };
}
