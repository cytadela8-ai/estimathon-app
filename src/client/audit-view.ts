/** Host audit formatting keeps signed millisecond precision and labels phone timing as untrusted. */
import type { AuditEntry } from '#est-shared/protocol';
export interface AuditFilter {
  questionId: string;
  participant: string;
  value: string;
  lateOnly: boolean;
  minimumSeconds: number;
}
export function filterAudit(entries: AuditEntry[], filter: AuditFilter): AuditEntry[] {
  const identity = filter.participant.trim().toLocaleLowerCase('pl');
  return entries.filter(
    (row) =>
      (!filter.questionId || row.questionId === filter.questionId) &&
      `${row.firstName} ${row.lastName} ${row.nickname}`
        .toLocaleLowerCase('pl')
        .includes(identity) &&
      row.text.includes(filter.value.trim()) &&
      (!filter.lateOnly ||
        (row.serverLateMs !== null &&
          row.serverLateMs >= Math.max(0, filter.minimumSeconds || 0) * 1000)),
  );
}
export function timestamp(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Brak danych';
  if (Math.abs(value) > 8.64e15) return String(value);
  return new Date(value).toISOString();
}
export function difference(value: number | null): string {
  if (value === null) return 'Brak danych';
  return `${value >= 0 ? '+' : '−'}${(Math.abs(value) / 1000).toFixed(3).replace('.', ',')} s`;
}
