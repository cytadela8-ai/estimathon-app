/** Host audit formatting keeps signed millisecond precision and labels phone timing as untrusted. */
export function timestamp(value: number | null | undefined): string {
  if (value === null || value === undefined) return 'Brak danych';
  if (Math.abs(value) > 8.64e15) return String(value);
  return new Date(value).toISOString();
}
export function difference(value: number | null): string {
  if (value === null) return 'Brak danych';
  return `${value >= 0 ? '+' : '−'}${(Math.abs(value) / 1000).toFixed(3).replace('.', ',')} s`;
}
