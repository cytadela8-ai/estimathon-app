/** Participant network model: per-user state, revision watermarks, retries, clock and result fetches.
 * Matches sync.ts/PersonalResults.svelte request cadence; in-memory state replaces browser storage.
 * Never issues host commands or polls host-only routes. Socket.IO chooses its normal transports.
 */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { io } from 'socket.io-client';

/** Create counters shared by a group of participant network clients. */
export function participantMetrics() {
  return {
    sent: 0,
    accepted: 0,
    stale: 0,
    paused: 0,
    invalid: 0,
    errors: 0,
    saveTimeouts: 0,
    retries: 0,
    stateEvents: 0,
    answerEvents: 0,
    snapshots: 0,
    snapshotFailures: 0,
    connections: 0,
    disconnects: 0,
    connectErrors: 0,
    resultRequests: 0,
    resultErrors: 0,
    resourceRequests: 0,
    resourceBytes: 0,
    pending: 0,
    latencies: [],
    resultLatencies: [],
    lastResultError: null,
    lastSnapshotError: null,
    lastSaveError: null,
    lastConnectError: null,
  };
}
function compare(a, b) {
  if (a.revision !== b.revision) return a.revision - b.revision;
  return a.operationId < b.operationId ? -1 : Number(a.operationId > b.operationId);
}

/** Protocol-level player; callers own connect, edit scheduling, and close. */
export class ParticipantBot {
  constructor({ origin, token, metrics }) {
    this.origin = origin;
    this.token = token;
    this.metrics = metrics;
    this.snapshot = null;
    this.offset = 0;
    this.revisions = new Map();
    this.answers = new Map();
    this.pending = new Map();
    this.inFlight = new Set();
    this.attempted = new Set();
    this.connectionEpoch = 0;
    this.resultKey = null;
    this.resultFailed = false;
    this.resultPending = new Set();
    this.resultJobs = new Set();
    this.ready = Promise.resolve();
    this.closed = false;
    this.socket = io(origin, { auth: { token }, autoConnect: false });
    this.socket.on('connect', () => this.connected());
    this.socket.on('disconnect', () => {
      if (!this.closed) metrics.disconnects++;
      this.clearResults();
    });
    this.socket.on('connect_error', (error) => {
      metrics.connectErrors++;
      metrics.lastConnectError = String(error);
    });
    this.socket.on('state', (state) => {
      metrics.stateEvents++;
      this.receive(state);
      this.flush();
    });
    this.socket.on('answers', (state) => {
      metrics.answerEvents++;
      this.reconcile(state);
    });
    this.timers = [
      setInterval(() => this.flush(), 1500),
      setInterval(() => {
        if (this.socket.connected)
          void this.synchronize().catch((error) => {
            metrics.snapshotFailures++;
            metrics.lastSnapshotError = String(error);
          });
      }, 15000),
    ];
  }
  connected() {
    if (this.closed) return;
    this.metrics.connections++;
    this.connectionEpoch++;
    this.resultKey = null;
    this.ready = this.synchronize();
    void this.ready.catch((error) => {
      this.metrics.snapshotFailures++;
      this.metrics.lastSnapshotError = String(error);
    });
  }
  /** Connect and obtain the same initial authoritative snapshot as a play page. */
  async connect() {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Participant connection timed out.')), 10000);
      this.socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      this.socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      this.socket.connect();
    });
    await this.ready;
  }
  async synchronize() {
    const sent = Date.now();
    const hello = await this.socket.timeout(3000).emitWithAck('snapshot');
    if (this.closed) return;
    this.metrics.snapshots++;
    this.offset = hello.snapshot.serverNow - (sent + Date.now()) / 2;
    this.reconcile(hello);
    this.receive(hello.snapshot);
    this.flush();
  }
  receive(snapshot) {
    if (this.snapshot && snapshot.state.version < this.snapshot.state.version) return;
    this.snapshot = snapshot;
    this.requestResults();
  }
  reconcile(state) {
    for (const [id, revision] of Object.entries(state.revisions)) this.observe(id, revision);
    this.answers.clear();
    for (const answer of state.answers) this.confirm(answer);
  }
  observe(id, revision) {
    this.revisions.set(id, Math.max(this.revisions.get(id) ?? 0, revision));
  }
  confirm(answer) {
    const previous = this.answers.get(answer.questionId);
    if (!previous || compare(answer, previous) > 0) this.answers.set(answer.questionId, answer);
    this.observe(answer.questionId, answer.revision);
    const pending = this.pending.get(answer.questionId);
    if (pending && compare(answer, pending) >= 0) {
      this.pending.delete(answer.questionId);
      this.attempted.delete(pending.operationId);
    }
  }
  /** Queue a valid edit using the play screen's local deadline and untrusted timing metadata. */
  edit(text) {
    if (!/^(?=.*[1-9])\d{1,100}$/.test(text)) return null;
    const snapshot = this.snapshot;
    if (!snapshot?.question || snapshot.state.phase !== 'active') return null;
    const inputAt = Date.now();
    if (snapshot.state.endsAt === null || inputAt + this.offset >= snapshot.state.endsAt)
      return null;
    const questionId = snapshot.question.id;
    const revision = (this.revisions.get(questionId) ?? 0) + 1;
    this.observe(questionId, revision);
    const operation = {
      questionId,
      revision,
      text,
      operationId: randomUUID(),
      timing: { inputAt, endsAt: snapshot.state.endsAt - this.offset, offsetMs: this.offset },
    };
    this.queue(operation);
    return operation;
  }
  queue(operation) {
    const previous = this.pending.get(operation.questionId);
    if (previous) this.attempted.delete(previous.operationId);
    this.pending.set(operation.questionId, operation);
    this.send(operation);
  }
  send(operation) {
    if (this.closed || !this.socket.connected || this.inFlight.has(operation.operationId)) return;
    const { metrics } = this;
    if (this.attempted.has(operation.operationId)) metrics.retries++;
    this.attempted.add(operation.operationId);
    this.inFlight.add(operation.operationId);
    metrics.sent++;
    metrics.pending++;
    const start = performance.now();
    this.socket.timeout(2000).emit('save', operation, (error, receipt) => {
      this.inFlight.delete(operation.operationId);
      metrics.pending--;
      if (error) {
        metrics.saveTimeouts++;
        metrics.lastSaveError = String(error);
        return;
      }
      metrics.latencies.push(performance.now() - start);
      this.receipt(operation, receipt);
    });
  }
  receipt(operation, receipt) {
    const { metrics } = this;
    if (receipt.answer) this.confirm(receipt.answer);
    if (receipt.status === 'accepted') metrics.accepted++;
    else if (receipt.status === 'stale') metrics.stale++;
    else if (receipt.status === 'paused') metrics.paused++;
    else {
      metrics.invalid++;
      metrics.errors++;
      if (this.pending.get(operation.questionId)?.operationId === operation.operationId) {
        this.pending.delete(operation.questionId);
      }
    }
  }
  flush() {
    for (const operation of this.pending.values()) this.send(operation);
  }
  canRequestResults() {
    return (
      !this.closed &&
      this.token &&
      this.snapshot?.state.phase === 'finished' &&
      this.socket.connected
    );
  }
  clearResults() {
    clearInterval(this.resultTimer);
    this.resultKey = null;
    this.resultFailed = false;
  }
  requestResults(retry = false) {
    if (!this.canRequestResults()) {
      this.clearResults();
      return;
    }
    const key = `${this.connectionEpoch}:${this.snapshot.state.version}`;
    if ((!retry && this.resultKey === key) || this.resultPending.has(key)) return;
    if (this.resultKey !== key) {
      clearInterval(this.resultTimer);
      this.resultTimer = setInterval(() => {
        if (this.resultFailed) this.requestResults(true);
      }, 3000);
    }
    this.resultKey = key;
    this.resultFailed = false;
    this.resultPending.add(key);
    const job = this.fetchResults(key);
    this.resultJobs.add(job);
    void job.finally(() => {
      this.resultPending.delete(key);
      this.resultJobs.delete(job);
    });
  }
  async fetchResults(key) {
    const start = performance.now();
    this.metrics.resultRequests++;
    try {
      const response = await fetch(this.origin + '/api/results', {
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.token}` },
        signal: AbortSignal.timeout(10000),
      });
      await response.json();
      if (!response.ok) throw new Error(`Personal results returned HTTP ${response.status}.`);
      this.metrics.resultLatencies.push(performance.now() - start);
    } catch (error) {
      this.metrics.resultErrors++;
      this.metrics.lastResultError = `GET /api/results: ${String(error)}`;
      if (this.resultKey === key && this.snapshot?.state.phase === 'finished')
        this.resultFailed = true;
    }
  }
  /** Stop automatic traffic and close the connection without changing the contest. */
  stopAutomaticTraffic() {
    this.closed = true;
    for (const timer of this.timers) clearInterval(timer);
    this.clearResults();
  }
  close() {
    this.stopAutomaticTraffic();
    this.socket.disconnect();
  }
}
