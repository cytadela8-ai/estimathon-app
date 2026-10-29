/** Host-only immutable first-arrival telemetry and append-only moderation history. */
import type Database from 'better-sqlite3';
import type { AuditEntry, InputTiming, Operation, Receipt } from '#est-shared/protocol';
import { REVIEW_PREVIEW_SIZE, type AdminQuery, type Page } from '#est-shared/admin';
import { adminQuery, pageInfo } from '#est-server/pagination';
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
/** Read one filtered page; only visible operations load a bounded decision preview. */
export function auditEntries(
  db: Database.Database,
  query: AdminQuery = adminQuery(),
): Page<AuditEntry> {
  const { from, params } = auditFilter(query);
  const { total } = db.prepare(`SELECT COUNT(*) AS total ${from}`).get(params) as { total: number };
  const pagination = pageInfo(total, query.auditPage);
  const rows = db
    .prepare(`WITH visible AS (
      SELECT s.* ${from} ORDER BY s.receivedAt DESC,s.operationId,s.participantId
      LIMIT @limit OFFSET @offset
    ) SELECT s.participantId,s.operationId,s.questionId,s.revision,s.text,s.receivedAt,
    s.status,s.excluded,s.timing AS timingJson,p.nickname,p.firstName,p.lastName,
    w.endsAt AS deadlineAt,
    EXISTS(SELECT 1 FROM answers a WHERE a.participantId=s.participantId
      AND a.questionId=s.questionId AND a.operationId=s.operationId) AS counted
    FROM visible s JOIN participants p ON p.id=s.participantId
    LEFT JOIN question_windows w ON w.questionId=s.questionId
    ORDER BY s.receivedAt DESC,s.operationId,s.participantId`)
    .all({
      ...params,
      limit: pagination.pageSize,
      offset: (pagination.page - 1) * pagination.pageSize,
    }) as Submission[];
  return { ...pagination, items: rows.map((row) => auditEntry(db, row)) };
}

/** Apply only active predicates; late reads start at each question's indexed arrival boundary. */
function auditFilter(query: AdminQuery) {
  const predicates: string[] = [];
  const params: Record<string, string | number> = {};
  let from = 'FROM submissions s';
  if (query.lateOnly) {
    from = `FROM question_windows w CROSS JOIN submissions s
      ON s.questionId=w.questionId AND s.receivedAt>=w.endsAt+@minimumMs`;
    predicates.push('w.endsAt IS NOT NULL');
    params['minimumMs'] = query.minimumSeconds * 1000;
  }
  if (query.questionId) {
    predicates.push(`${query.lateOnly ? 'w' : 's'}.questionId=@questionId`);
    params['questionId'] = query.questionId;
  }
  if (query.participant) {
    predicates.push(`s.participantId IN (SELECT id FROM participants
      WHERE instr(polish_lower(firstName || ' ' || lastName || ' ' || nickname),@participant)>0)`);
    params['participant'] = query.participant;
  }
  if (query.value) {
    predicates.push('instr(s.text,@value)>0');
    params['value'] = query.value;
  }
  if (predicates.length) from += ` WHERE ${predicates.join(' AND ')}`;
  return { from, params };
}

/** Read a bounded page of decisions for one operation, newest page first. */
export function reviewHistory(
  db: Database.Database,
  participantId: string,
  operationId: string,
  page: number,
): Page<AuditEntry['reviews'][number]> {
  const { total } = db
    .prepare(`SELECT COUNT(*) AS total FROM submission_reviews
    WHERE participantId=? AND operationId=?`)
    .get(participantId, operationId) as { total: number };
  const pagination = pageInfo(total, page, REVIEW_PREVIEW_SIZE);
  const reviews = db
    .prepare(`SELECT excluded,reason,reviewedAt FROM submission_reviews
    WHERE participantId=? AND operationId=? ORDER BY id DESC LIMIT ? OFFSET ?`)
    .all(
      participantId,
      operationId,
      pagination.pageSize,
      (pagination.page - 1) * pagination.pageSize,
    ) as {
    excluded: number;
    reason: string;
    reviewedAt: number;
  }[];
  return {
    ...pagination,
    items: reviews.reverse().map((review) => ({ ...review, excluded: !!review.excluded })),
  };
}

function auditEntry(db: Database.Database, row: Submission): AuditEntry {
  const { timingJson, ...entry } = row;
  const timing = timingJson ? (JSON.parse(timingJson) as InputTiming) : undefined;
  const history = reviewHistory(db, row.participantId, row.operationId, 1);
  return {
    ...entry,
    ...(timing ? { timing } : {}),
    excluded: !!row.excluded,
    counted: !!row.counted,
    serverLateMs: row.deadlineAt === null ? null : row.receivedAt - row.deadlineAt,
    phoneLateMs: timing ? timing.inputAt - timing.endsAt : null,
    reviewCount: history.total,
    reviews: history.items,
  };
}
