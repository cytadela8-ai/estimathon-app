/** SQLite durability boundary. All acknowledged writes commit with WAL + FULL synchronization. */
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function openDatabase(path: string): Database.Database {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  db.function('polish_lower', { deterministic: true }, (value) =>
    String(value).toLocaleLowerCase('pl'),
  );
  db.exec(`
    CREATE TABLE IF NOT EXISTS contest (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY, firstName TEXT NOT NULL, lastName TEXT NOT NULL,
      nickname TEXT NOT NULL, token TEXT UNIQUE NOT NULL, recoveryCode TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS participant_ips (
      participantId TEXT NOT NULL REFERENCES participants(id), ip TEXT NOT NULL,
      PRIMARY KEY(participantId,ip)
    );
    CREATE TABLE IF NOT EXISTS answers (
      participantId TEXT NOT NULL REFERENCES participants(id), questionId TEXT NOT NULL,
      operationId TEXT NOT NULL, revision INTEGER NOT NULL, text TEXT NOT NULL,
      acceptedAt INTEGER NOT NULL, PRIMARY KEY(participantId, questionId)
    );
    CREATE TABLE IF NOT EXISTS operations (
      participantId TEXT NOT NULL, operationId TEXT NOT NULL, payload TEXT NOT NULL,
      receipt TEXT NOT NULL, PRIMARY KEY(participantId, operationId)
    );
    CREATE TABLE IF NOT EXISTS question_windows (
      questionId TEXT PRIMARY KEY, startedAt INTEGER NOT NULL, endsAt INTEGER
    );
    CREATE TABLE IF NOT EXISTS submissions (
      participantId TEXT NOT NULL, operationId TEXT NOT NULL, questionId TEXT NOT NULL,
      revision INTEGER NOT NULL, text TEXT NOT NULL, receivedAt INTEGER NOT NULL,
      timing TEXT, eligible INTEGER NOT NULL, status TEXT NOT NULL, excluded INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(participantId, operationId)
    );
    CREATE INDEX IF NOT EXISTS submissions_question ON submissions(questionId, participantId);
    CREATE INDEX IF NOT EXISTS submissions_arrival
      ON submissions(receivedAt DESC,operationId,participantId);
    CREATE INDEX IF NOT EXISTS answers_arrival
      ON answers(acceptedAt DESC,operationId,participantId,questionId);
    CREATE INDEX IF NOT EXISTS answers_question ON answers(questionId,participantId);
    INSERT OR IGNORE INTO submissions
      (participantId,operationId,questionId,revision,text,receivedAt,eligible,status)
      SELECT participantId,operationId,questionId,revision,text,acceptedAt,1,'accepted' FROM answers;
    CREATE TABLE IF NOT EXISTS submission_reviews (
      id INTEGER PRIMARY KEY, participantId TEXT NOT NULL, operationId TEXT NOT NULL,
      excluded INTEGER NOT NULL, reason TEXT NOT NULL, reviewedAt INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS scores (
      participantId TEXT NOT NULL, questionId TEXT NOT NULL, score REAL,
      PRIMARY KEY(participantId, questionId)
    );
    CREATE INDEX IF NOT EXISTS reviews_operation
      ON submission_reviews(participantId,operationId,id DESC);
  `);
  return db;
}
