/** Durable answer ledger with indefinite delayed delivery and reversible host exclusions. */
import type Database from 'better-sqlite3';
import type {
  Operation,
  Answer,
  Receipt,
  Review,
  AuditEntry,
  AnswerState,
} from '#est-shared/protocol';
import { compareOperations, validNumber } from '#est-shared/protocol';
import { auditEntries, validTiming } from '#est-server/audit';
import type { Contest } from '#est-server/contest';
export class AnswerStore {
  constructor(
    readonly db: Database.Database,
    readonly contest: Contest,
  ) {}
  all(participantId: string): Answer[] {
    return this.db
      .prepare('SELECT * FROM answers WHERE participantId=?')
      .all(participantId) as Answer[];
  }
  /** Restore counted answers and revision watermarks, including excluded submissions. */
  snapshot(participantId: string): AnswerState {
    const revisions = this.db
      .prepare(`SELECT questionId,MAX(revision) AS revision FROM submissions
      WHERE participantId=? GROUP BY questionId`)
      .all(participantId) as { questionId: string; revision: number }[];
    return {
      answers: this.all(participantId),
      revisions: Object.fromEntries(revisions.map((row) => [row.questionId, row.revision])),
    };
  }
  audit(): AuditEntry[] {
    return auditEntries(this.db);
  }
  save(participantId: string, input: Operation, now = Date.now()): Receipt {
    this.contest.tick(now);
    if (!isOperation(input)) return { operationId: '', status: 'invalid', answer: null };
    return this.db.transaction(() => this.commit(participantId, input, now))();
  }
  private commit(participantId: string, op: Operation, now: number): Receipt {
    if (!this.started(op.questionId))
      return { operationId: op.operationId, status: 'invalid', answer: null };
    const previous = this.previous(participantId, op);
    if (previous) return previous;
    const payload = operationPayload(op);
    const answer = this.current(participantId, op.questionId);
    const status = this.status(op, answer);
    const eligible = status === 'accepted' || status === 'stale';
    this.record(participantId, op, now, status);
    if (status === 'paused') return { operationId: op.operationId, status, answer: answer ?? null };
    if (eligible) this.selectAnswer(participantId, op.questionId);
    const receipt: Receipt = {
      operationId: op.operationId,
      status,
      answer: this.current(participantId, op.questionId) ?? null,
    };
    this.db
      .prepare('INSERT INTO operations VALUES(?,?,?,?)')
      .run(participantId, op.operationId, payload, JSON.stringify(receipt));
    return receipt;
  }
  private previous(participantId: string, op: Operation): Receipt | undefined {
    const previous = this.db
      .prepare(`SELECT payload,receipt FROM operations
      WHERE participantId=? AND operationId=?`)
      .get(participantId, op.operationId) as { payload: string; receipt: string } | undefined;
    const payload = operationPayload(op);
    if (previous)
      return previous.payload === payload
        ? (JSON.parse(previous.receipt) as Receipt)
        : { operationId: op.operationId, status: 'invalid', answer: null };
    const observed = this.db
      .prepare(`SELECT questionId,revision,text,timing FROM submissions
      WHERE participantId=? AND operationId=?`)
      .get(participantId, op.operationId) as
      | (Omit<Operation, 'timing'> & { timing: string | null })
      | undefined;
    if (
      observed &&
      payload !==
        JSON.stringify([
          observed.questionId,
          observed.revision,
          observed.text,
          observed.timing ? JSON.parse(observed.timing) : null,
        ])
    )
      return { operationId: op.operationId, status: 'invalid', answer: null };
    return undefined;
  }
  private record(
    participantId: string,
    op: Operation,
    now: number,
    status: Receipt['status'],
  ): void {
    const eligible = status === 'accepted' || status === 'stale';
    this.db
      .prepare(`INSERT OR IGNORE INTO submissions
      (participantId,operationId,questionId,revision,text,receivedAt,timing,eligible,status)
      VALUES(?,?,?,?,?,?,?,?,?)`)
      .run(
        participantId,
        op.operationId,
        op.questionId,
        op.revision,
        op.text,
        now,
        op.timing ? JSON.stringify(op.timing) : null,
        Number(eligible),
        status,
      );
    // A paused operation can become eligible on resume without changing its first arrival.
    if (eligible)
      this.db
        .prepare(`UPDATE submissions SET eligible=1,status=?
      WHERE participantId=? AND operationId=?`)
        .run(status, participantId, op.operationId);
  }
  private current(participantId: string, questionId: string): Answer | undefined {
    return this.db
      .prepare('SELECT * FROM answers WHERE participantId=? AND questionId=?')
      .get(participantId, questionId) as Answer | undefined;
  }
  private status(op: Operation, answer: Answer | undefined): Receipt['status'] {
    if (!validNumber(op.text, this.contest.data.config.maxAnswer)) return 'invalid';
    if (op.questionId === this.contest.question?.id && this.contest.state.phase === 'paused')
      return 'paused';
    if (answer && compareOperations(op, answer) <= 0) return 'stale';
    return 'accepted';
  }
  private started(questionId: string): boolean {
    const index = this.contest.data.questions.findIndex((q) => q.id === questionId);
    return index >= 0 && index <= this.contest.state.index;
  }
  private selectAnswer(participantId: string, questionId: string): void {
    const candidate = this.db
      .prepare(`SELECT participantId,questionId,operationId,revision,text,
      receivedAt AS acceptedAt FROM submissions WHERE participantId=? AND questionId=?
      AND eligible=1 AND excluded=0 ORDER BY revision DESC,operationId DESC LIMIT 1`)
      .get(participantId, questionId) as Answer | undefined;
    this.db
      .prepare('DELETE FROM answers WHERE participantId=? AND questionId=?')
      .run(participantId, questionId);
    if (candidate)
      this.db
        .prepare(`INSERT INTO answers VALUES
      (@participantId,@questionId,@operationId,@revision,@text,@acceptedAt)`)
        .run(candidate);
    this.contest.answerChanged(questionId);
  }
  /** Exclude or restore a unique operation, retaining the decision history and prior revisions. */
  review(input: Review, now = Date.now()): void {
    if (
      !input ||
      typeof input.excluded !== 'boolean' ||
      typeof input.reason !== 'string' ||
      !input.reason.trim() ||
      input.reason.length > 500
    )
      throw new Error('Podaj powód decyzji.');
    const row = this.db
      .prepare(`SELECT questionId FROM submissions
      WHERE participantId=? AND operationId=?`)
      .get(input.participantId, input.operationId) as { questionId: string } | undefined;
    if (!row) throw new Error('Nie znaleziono odpowiedzi do oceny.');
    this.db.transaction(() => {
      this.db
        .prepare(`UPDATE submissions SET excluded=? WHERE participantId=? AND operationId=?`)
        .run(Number(input.excluded), input.participantId, input.operationId);
      this.db
        .prepare(`INSERT INTO submission_reviews
        (participantId,operationId,excluded,reason,reviewedAt) VALUES(?,?,?,?,?)`)
        .run(
          input.participantId,
          input.operationId,
          Number(input.excluded),
          input.reason.trim(),
          now,
        );
      this.selectAnswer(input.participantId, row.questionId);
    })();
  }
}
function isOperation(op: Operation): boolean {
  return (
    !!op &&
    typeof op.questionId === 'string' &&
    op.questionId.length <= 100 &&
    typeof op.operationId === 'string' &&
    /^[a-zA-Z0-9-]{16,100}$/.test(op.operationId) &&
    validValue(op)
  );
}

function validValue(op: Operation): boolean {
  return (
    Number.isSafeInteger(op.revision) &&
    op.revision > 0 &&
    typeof op.text === 'string' &&
    op.text.length <= 100 &&
    validTiming(op.timing)
  );
}
function operationPayload(op: Operation): string {
  return JSON.stringify([op.questionId, op.revision, op.text, op.timing ?? null]);
}
