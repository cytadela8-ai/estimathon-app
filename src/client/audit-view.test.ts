/** Audit filtering uses server arrival delay, never the phone's untrusted clock. */
import { expect, it } from 'vitest';
import { difference, filterAudit, timestamp } from '#est-client/audit-view';
import type { AuditEntry } from '#est-shared/protocol';
const entry: AuditEntry = {
  participantId: 'p',
  operationId: 'op',
  questionId: 'q',
  revision: 1,
  text: '00123',
  firstName: 'Łukasz',
  lastName: 'Test',
  nickname: 'LT',
  receivedAt: 8000,
  deadlineAt: 5000,
  serverLateMs: 3000,
  phoneLateMs: -100,
  status: 'accepted',
  excluded: false,
  counted: true,
  reviews: [],
};
const filter = { questionId: '', participant: '', value: '', lateOnly: true, minimumSeconds: 3 };
it('includes the threshold boundary and combines question, identity and value filters', () => {
  expect(filterAudit([entry], filter)).toEqual([entry]);
  expect(filterAudit([entry], { ...filter, minimumSeconds: 3.001 })).toEqual([]);
  expect(
    filterAudit([entry], { ...filter, questionId: 'q', participant: 'łukasz', value: '123' }),
  ).toEqual([entry]);
  expect(filterAudit([entry], { ...filter, value: '999' })).toEqual([]);
  expect(filterAudit([entry], { ...filter, questionId: 'other' })).toEqual([]);
  expect(filterAudit([{ ...entry, serverLateMs: null }], filter)).toEqual([]);
  expect(
    filterAudit([{ ...entry, serverLateMs: null }], { ...filter, lateOnly: false }),
  ).toHaveLength(1);
});
it('formats timestamps and signed timing differences with millisecond precision', () => {
  expect(timestamp(1234)).toBe('1970-01-01T00:00:01.234Z');
  expect(timestamp(null)).toBe('Brak danych');
  expect(timestamp(9e15)).toBe('9000000000000000');
  expect(difference(3001)).toBe('+3,001 s');
  expect(difference(-100)).toBe('−0,100 s');
  expect(difference(null)).toBe('Brak danych');
});
