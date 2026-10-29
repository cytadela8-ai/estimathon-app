/** Audit formatting keeps signed arrival delays and millisecond timestamp precision. */
import { expect, it } from 'vitest';
import { difference, timestamp } from '#est-client/audit-view';
it('formats timestamps and signed timing differences with millisecond precision', () => {
  expect(timestamp(1234)).toBe('1970-01-01T00:00:01.234Z');
  expect(timestamp(null)).toBe('Brak danych');
  expect(timestamp(9e15)).toBe('9000000000000000');
  expect(difference(3001)).toBe('+3,001 s');
  expect(difference(-100)).toBe('−0,100 s');
  expect(difference(null)).toBe('Brak danych');
});
