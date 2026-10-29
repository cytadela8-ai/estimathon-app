/**
 * Opaque persistent participant credentials; recovery codes are high-entropy bearer credentials.
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { isIP } from 'node:net';
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
  /** Persist each distinct observed address; forwarded values must already be trusted. */
  recordIp(participantId: string, ip: string): void {
    if (!isIP(ip)) return;
    this.db
      .prepare('INSERT OR IGNORE INTO participant_ips(participantId,ip) VALUES(?,?)')
      .run(participantId, ip);
  }
  list(): (Participant & { recoveryCode: string; ips: string[] })[] {
    const addresses = new Map<string, string[]>();
    const rows = this.db.prepare('SELECT * FROM participant_ips ORDER BY ip').all() as {
      participantId: string;
      ip: string;
    }[];
    for (const row of rows) {
      const ips = addresses.get(row.participantId) ?? [];
      ips.push(row.ip);
      addresses.set(row.participantId, ips);
    }
    const participants = this.db
      .prepare(
        'SELECT id,firstName,lastName,nickname,recoveryCode FROM participants ORDER BY nickname',
      )
      .all() as (Participant & { recoveryCode: string })[];
    return participants.map((person) => ({ ...person, ips: addresses.get(person.id) ?? [] }));
  }
}
function toSession(row: Row): Session {
  const { token, recoveryCode, ...participant } = row;
  return { token, recoveryCode, participant };
}
