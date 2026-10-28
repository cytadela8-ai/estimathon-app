/**
 * Opaque persistent participant credentials; recovery codes are high-entropy bearer credentials.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Participant, Session } from '#est-shared/protocol';
interface Row extends Participant {
  token: string;
  recoveryCode: string;
}
export class Sessions {
  constructor(readonly db: Database.Database) {}
  create(input: Omit<Participant, 'id'>): Session {
    for (const value of [input?.firstName, input?.lastName, input?.nickname]) {
      if (typeof value !== 'string' || !value.trim() || value.length > 80) {
        throw new Error('Wpisz imię, nazwisko i pseudonim (do 80 znaków).');
      }
    }
    const row: Row = {
      id: randomUUID(),
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      nickname: input.nickname.trim(),
      token: randomBytes(32).toString('hex'),
      recoveryCode: randomBytes(16).toString('hex'),
    };
    this.db
      .prepare(
        'INSERT INTO participants VALUES(@id,@firstName,@lastName,@nickname,@token,@recoveryCode)',
      )
      .run(row);
    return toSession(row);
  }
  find(token: unknown): Session | null {
    if (typeof token !== 'string') return null;
    const row = this.db.prepare('SELECT * FROM participants WHERE token=?').get(token) as
      | Row
      | undefined;
    return row ? toSession(row) : null;
  }
  recover(code: string): Session | null {
    if (typeof code !== 'string' || code.length > 100) return null;
    const row = this.db
      .prepare('SELECT * FROM participants WHERE recoveryCode=?')
      .get(code.trim()) as Row | undefined;
    return row ? toSession(row) : null;
  }
  list(): (Participant & { recoveryCode: string })[] {
    return this.db
      .prepare(
        'SELECT id,firstName,lastName,nickname,recoveryCode FROM participants ORDER BY nickname',
      )
      .all() as (Participant & { recoveryCode: string })[];
  }
}
function toSession(row: Row): Session {
  const { token, recoveryCode, ...participant } = row;
  return { token, recoveryCode, participant };
}
