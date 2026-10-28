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
  db.exec(`
    CREATE TABLE IF NOT EXISTS contest (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS participants (
      id TEXT PRIMARY KEY, firstName TEXT NOT NULL, lastName TEXT NOT NULL,
      nickname TEXT NOT NULL, token TEXT UNIQUE NOT NULL, recoveryCode TEXT UNIQUE NOT NULL
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
    CREATE TABLE IF NOT EXISTS scores (
      participantId TEXT NOT NULL, questionId TEXT NOT NULL, score REAL,
      PRIMARY KEY(participantId, questionId)
    );
  `);
  return db;
}
