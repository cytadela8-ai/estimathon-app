/** Atomic answer ledger: idempotency receipts and a deterministic revision order share one commit. */
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
    const state = this.contest.state;
    if (state.phase === 'paused' && op.questionId === this.contest.question?.id) {
      return { ...receipt, status: 'paused' };
    }
    if (
      op.questionId !== this.contest.question?.id ||
      !['active', 'closing'].includes(state.phase) ||
      now >= (state.closesAt ?? 0)
    ) {
      receipt.status = 'closed';
    } else if (!validNumber(op.text, this.contest.data.config.maxAnswer))
      receipt.status = 'invalid';
    else if (answer && compareOperations(op, answer) <= 0) receipt.status = 'stale';
    else {
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
}
function isOperation(op: Operation): boolean {
  return (
    !!op &&
    typeof op.questionId === 'string' &&
    op.questionId.length <= 100 &&
    typeof op.operationId === 'string' &&
    /^[a-zA-Z0-9-]{16,100}$/.test(op.operationId) &&
    Number.isSafeInteger(op.revision) &&
    op.revision > 0 &&
    typeof op.text === 'string' &&
    op.text.length <= 100
  );
}
