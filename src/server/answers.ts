/**
 * Atomic answer ledger: idempotency receipts and a deterministic revision order share one commit.
 */
import type Database from 'better-sqlite3';
import type { Operation, Answer, Receipt } from '#est-shared/protocol';
import { compareOperations, validNumber } from '#est-shared/protocol';
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
  save(participantId: string, input: Operation, now = Date.now()): Receipt {
    this.contest.tick(now);
    if (!isOperation(input)) return { operationId: '', status: 'invalid', answer: null };
    return this.db.transaction(() => this.commit(participantId, input, now))();
  }
  private commit(participantId: string, op: Operation, now: number): Receipt {
    const previous = this.db
      .prepare('SELECT payload,receipt FROM operations WHERE participantId=? AND operationId=?')
      .get(participantId, op.operationId) as { payload: string; receipt: string } | undefined;
    const payload = JSON.stringify([op.questionId, op.revision, op.text]);
    if (previous)
      return previous.payload === payload
        ? (JSON.parse(previous.receipt) as Receipt)
        : { operationId: op.operationId, status: 'invalid', answer: null };
    const answer = this.db
      .prepare('SELECT * FROM answers WHERE participantId=? AND questionId=?')
      .get(participantId, op.questionId) as Answer | undefined;
    const receipt: Receipt = {
      operationId: op.operationId,
      status: 'accepted',
      answer: answer ?? null,
    };
    const status = this.status(op, answer, now);
    if (status === 'paused') return { ...receipt, status };
    receipt.status = status;
    if (status === 'accepted') {
      receipt.answer = { ...op, participantId, acceptedAt: now };
      this.db
        .prepare(`INSERT OR REPLACE INTO answers
        (participantId,questionId,operationId,revision,text,acceptedAt) VALUES(?,?,?,?,?,?)`)
        .run(participantId, op.questionId, op.operationId, op.revision, op.text, now);
    }
    this.db
      .prepare('INSERT INTO operations VALUES(?,?,?,?)')
      .run(participantId, op.operationId, payload, JSON.stringify(receipt));
    return receipt;
  }
  private accepts(now: number): boolean {
    const state = this.contest.state;
    return ['active', 'closing'].includes(state.phase) && now < (state.closesAt ?? 0);
  }
  private status(op: Operation, answer: Answer | undefined, now: number): Receipt['status'] {
    if (op.questionId !== this.contest.question?.id) return 'closed';
    const state = this.contest.state;
    if (state.phase === 'paused') return 'paused';
    if (!this.accepts(now)) return 'closed';
    if (!validNumber(op.text, this.contest.data.config.maxAnswer)) return 'invalid';
    if (answer && compareOperations(op, answer) <= 0) return 'stale';
    return 'accepted';
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
    op.text.length <= 100
  );
}
