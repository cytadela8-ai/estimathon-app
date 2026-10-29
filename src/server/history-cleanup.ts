/**
 * Prune first-arrival history atomically. Counted answers and retry receipts remain authoritative;
 * SQLite reuses freed pages on later writes, without a blocking VACUUM during a live contest.
 */
import type Database from 'better-sqlite3';

/** Keep ten newest arrivals per group, plus counted answers and excluded pending submissions. */
export function cleanupHistory(db: Database.Database): {
  deletedSubmissions: number;
  deletedReviews: number;
} {
  return db.transaction(() => {
    const deletedSubmissions = db
      .prepare(`
      WITH ranked AS (
        SELECT participantId,operationId,questionId,excluded,
          ROW_NUMBER() OVER (
            PARTITION BY participantId,questionId
            ORDER BY receivedAt DESC,revision DESC,operationId DESC
          ) AS position
        FROM submissions
      )
      DELETE FROM submissions AS s
      WHERE (s.participantId,s.operationId) IN (
        SELECT r.participantId,r.operationId FROM ranked r
        WHERE r.position>10 AND NOT EXISTS (
          SELECT 1 FROM answers a WHERE a.participantId=r.participantId
            AND a.questionId=r.questionId AND a.operationId=r.operationId
        ) AND NOT (
          r.excluded=1 AND NOT EXISTS (
            SELECT 1 FROM operations o
            WHERE o.participantId=r.participantId AND o.operationId=r.operationId
          )
        )
      )
    `)
      .run().changes;
    const deletedReviews = db
      .prepare(`
      DELETE FROM submission_reviews AS r WHERE NOT EXISTS (
        SELECT 1 FROM submissions s
        WHERE s.participantId=r.participantId AND s.operationId=r.operationId
      )
    `)
      .run().changes;
    return { deletedSubmissions, deletedReviews };
  })();
}
