/** Validate host query parameters and clamp pages after counting matching rows. */
import { ADMIN_PAGE_SIZE, type AdminQuery, type PageInfo } from '#est-shared/admin';

export function pageInfo(total: number, page: number, pageSize = ADMIN_PAGE_SIZE): PageInfo {
  return {
    total,
    page: Math.min(Math.max(1, page), Math.max(1, Math.ceil(total / pageSize))),
    pageSize,
  };
}

/** Reject malformed paging and filters rather than allowing an unbounded SQL LIMIT. */
export function adminQuery(query: Record<string, unknown> = {}): AdminQuery {
  const lateOnly = query['lateOnly'] ?? 'false';
  if (lateOnly !== 'true' && lateOnly !== 'false')
    throw new Error('Parametr lateOnly musi mieć wartość true lub false.');
  const minimumSeconds = Number(query['minimumSeconds'] ?? 0);
  if (!Number.isFinite(minimumSeconds) || minimumSeconds < 0)
    throw new Error('Minimalne spóźnienie musi być nieujemną, skończoną liczbą sekund.');
  return {
    page: positivePage(query['page']),
    auditPage: positivePage(query['auditPage']),
    resultsPage: positivePage(query['resultsPage']),
    questionId: textFilter(query['questionId']),
    participant: textFilter(query['participant']).toLocaleLowerCase('pl'),
    value: textFilter(query['value']),
    lateOnly: lateOnly === 'true',
    minimumSeconds,
  };
}

function positivePage(input: unknown): number {
  if (input === undefined) return 1;
  const page = typeof input === 'string' && /^\d+$/.test(input) ? Number(input) : NaN;
  if (!Number.isSafeInteger(page) || page < 1)
    throw new Error('Numer strony musi być dodatnią liczbą całkowitą.');
  return page;
}

function textFilter(input: unknown): string {
  if (input === undefined) return '';
  if (typeof input !== 'string' || input.length > 250)
    throw new Error('Filtr musi być tekstem o długości do 250 znaków.');
  return input.trim();
}
