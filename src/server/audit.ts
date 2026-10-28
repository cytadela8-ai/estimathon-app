/** Host-only immutable first-arrival telemetry and append-only moderation history. */
import type Database from 'better-sqlite3';
import type { AuditEntry, InputTiming, Operation, Receipt } from '#est-shared/protocol';
interface Submission extends Operation {
  participantId: string;
  receivedAt: number;
  timingJson: string | null;
  status: Receipt['status'];
  excluded: number;
  counted: number;
  nickname: string;
  firstName: string;
  lastName: string;
  deadlineAt: number | null;
}
/** Validate optional, explicitly untrusted client timing without imposing an acceptance cutoff. */
export function validTiming(timing: InputTiming | undefined): boolean {
  if (timing === undefined) return true;
  return (
    timing !== null &&
    ['inputAt', 'endsAt', 'offsetMs'].every(
      (key) =>
        typeof timing[key as keyof InputTiming] === 'number' &&
        Number.isFinite(timing[key as keyof InputTiming]) &&
        Math.abs(timing[key as keyof InputTiming]) <= Number.MAX_SAFE_INTEGER,
    )
  );
}
/** Read each unique operation once; retries never change the recorded first arrival. */
export function auditEntries(db: Database.Database): AuditEntry[] {
  const rows = db
    .prepare(`SELECT s.participantId,s.operationId,s.questionId,s.revision,s.text,s.receivedAt,
    s.status,s.excluded,s.timing AS timingJson,p.nickname,p.firstName,p.lastName,
    w.endsAt AS deadlineAt,COALESCE(a.operationId=s.operationId,0) AS counted
    FROM submissions s JOIN participants p ON p.id=s.participantId
    LEFT JOIN question_windows w ON w.questionId=s.questionId
    LEFT JOIN answers a ON a.participantId=s.participantId AND a.questionId=s.questionId
    ORDER BY s.receivedAt DESC,s.operationId`)
    .all() as Submission[];
  const reviews = db
    .prepare(`SELECT participantId,operationId,excluded,reason,reviewedAt
    FROM submission_reviews ORDER BY id`)
    .all() as {
    participantId: string;
    operationId: string;
    excluded: number;
    reason: string;
    reviewedAt: number;
  }[];
  const history = new Map<string, AuditEntry['reviews']>();
  for (const review of reviews) {
    const key = `${review.participantId}/${review.operationId}`;
    const decisions = history.get(key) ?? [];
    decisions.push({
      excluded: !!review.excluded,
      reason: review.reason,
      reviewedAt: review.reviewedAt,
    });
    history.set(key, decisions);
  }
  return rows.map((row) => {
    const { timingJson, ...entry } = row;
    const timing = timingJson ? (JSON.parse(timingJson) as InputTiming) : undefined;
    return {
      ...entry,
      ...(timing ? { timing } : {}),
      excluded: !!row.excluded,
      counted: !!row.counted,
      serverLateMs: row.deadlineAt === null ? null : row.receivedAt - row.deadlineAt,
      phoneLateMs: timing ? timing.inputAt - timing.endsAt : null,
      reviews: history.get(`${row.participantId}/${row.operationId}`) ?? [],
    };
  });
}
