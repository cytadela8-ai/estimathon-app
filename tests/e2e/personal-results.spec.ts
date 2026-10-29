/** Final personal tables survive reloads and update after delayed sync and host decisions. */
import { test, expect } from '#est-e2e/fixtures';
import { join, noOverflow } from '#est-e2e/helpers';
import type { Config, Question } from '#est-shared/protocol';

test('participant sees each answer and score, with question text revealed on demand', async ({
  page,
  contest,
}, testInfo) => {
  await contest.configure();
  await join(page, contest, 'Ania');
  await contest.command('start');
  await page.getByLabel('Twoja estymacja').fill('100');
  await expect(page.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
  await expect(page.getByRole('table', { name: 'Twoje odpowiedzi i punkty' })).toHaveCount(0);
  await contest.command('next');
  await expect.poll(async () => (await contest.state()).state.phase).toBe('results');
  await contest.command('next');
  let requests = 0;
  await page.route('**/api/results', async (route) => {
    requests++;
    if (requests === 1) {
      await route.fulfill({ status: 503, json: { error: 'Przerwa w połączeniu.' } });
    } else await route.continue();
  });
  await contest.command('finish');
  await expect(page.getByRole('heading', { name: 'Wyniki końcowe', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Przerwa w połączeniu.');
  const table = page.getByRole('table', { name: 'Twoje odpowiedzi i punkty' });
  await expect(table).toBeVisible();
  const first = table.getByRole('row').filter({
    has: page.getByRole('button', { name: 'Pokaż treść pytania 1', exact: true }),
  });
  await expect(first.getByRole('cell')).toHaveText(['100', '1000']);
  const second = table.getByRole('row').filter({
    has: page.getByRole('button', { name: 'Pokaż treść pytania 2', exact: true }),
  });
  await expect(second.getByRole('cell')).toHaveText(['Brak odpowiedzi', '0']);
  await expect(table.getByText('Pierwsze pytanie', { exact: true })).toBeHidden();
  await table.getByRole('button', { name: 'Pokaż treść pytania 1', exact: true }).click();
  await expect(table.getByText('Pierwsze pytanie', { exact: true })).toBeVisible();
  await expect(table.getByText('Drugie pytanie', { exact: true })).toBeHidden();
  await table.getByRole('button', { name: 'Ukryj treść pytania 1', exact: true }).click();
  await expect(table.getByText('Pierwsze pytanie', { exact: true })).toBeHidden();
  await page.reload();
  await expect(table).toBeVisible();
  await table.getByRole('button', { name: 'Pokaż treść pytania 2', exact: true }).click();
  await expect(table.getByText('Drugie pytanie', { exact: true })).toBeVisible();
  await expect(page.locator('a')).toHaveCount(0);
  await noOverflow(page);
  await page.screenshot({
    path: testInfo.outputPath('personal-results.png'),
    fullPage: true,
  });
});

test('final personal table reconciles delayed answers and host exclusions', async ({
  page,
  context,
  contest,
}) => {
  await contest.configure();
  await join(page, contest, 'Ania');
  await contest.command('start');
  await page.getByLabel('Twoja estymacja').fill('100');
  await expect(page.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
  await contest.command('next');
  await expect.poll(async () => (await contest.state()).state.phase).toBe('results');
  await contest.command('next');
  await expect(page.getByLabel('Twoja estymacja')).toBeEnabled();
  await context.setOffline(true);
  await page.getByLabel('Twoja estymacja').fill('200');
  await contest.command('finish');
  await expect.poll(async () => (await contest.state()).state.phase).toBe('finished');
  await context.setOffline(false);
  const table = page.getByRole('table', { name: 'Twoje odpowiedzi i punkty' });
  await expect(table).toBeVisible();
  const second = table.getByRole('row').filter({
    has: page.getByRole('button', { name: 'Pokaż treść pytania 2', exact: true }),
  });
  await expect(second.getByRole('cell')).toHaveText(['200', '500']);
  const audit = (await contest.results()).audit;
  const submission = audit.find((row) => row.text === '100')!;
  const first = table.getByRole('row').filter({
    has: page.getByRole('button', { name: 'Pokaż treść pytania 1', exact: true }),
  });
  await contest.request('/api/admin/review', {
    participantId: submission.participantId,
    operationId: submission.operationId,
    excluded: true,
    reason: 'Sprawdzenie',
  });
  await expect(first.getByRole('cell')).toHaveText(['Brak odpowiedzi', '0']);
  await contest.request('/api/admin/review', {
    participantId: submission.participantId,
    operationId: submission.operationId,
    excluded: false,
    reason: 'Przywrócenie',
  });
  await expect(first.getByRole('cell')).toHaveText(['100', '1000']);
  await noOverflow(page);
  await contest.request('/api/admin/reset', { confirmed: true });
  await expect(page.getByRole('heading', { name: 'Czekamy na start', exact: true })).toBeVisible();
  await expect(table).toHaveCount(0);
  await page.reload();
  await expect(table).toHaveCount(0);
});

test('early finish omits unplayed questions and long answers fit a narrow phone', async ({
  page,
  contest,
}) => {
  await contest.configure();
  const overview = await contest.request<{ config: Config; questions: Question[] }>(
    '/api/admin/overview',
    undefined,
    'GET',
  );
  const answer = '9'.repeat(100);
  await contest.request(
    '/api/admin/config',
    {
      config: { ...overview.config, maxAnswer: answer },
      questions: overview.questions,
    },
    'PUT',
  );
  await join(page, contest, 'Ania');
  await contest.command('start');
  await page.getByLabel('Twoja estymacja').fill(answer);
  await expect(page.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
  await contest.command('finish');
  const table = page.getByRole('table', { name: 'Twoje odpowiedzi i punkty' });
  await expect(table).toBeVisible();
  await expect(table.getByRole('button')).toHaveCount(1);
  await expect(table.getByRole('cell', { name: answer, exact: true })).toBeVisible();
  await expect(table.getByRole('cell', { name: '500', exact: true })).toBeVisible();
  await page.setViewportSize({ width: 320, height: 844 });
  await table.getByRole('button', { name: 'Pokaż treść pytania 1', exact: true }).click();
  await expect(table.getByText('Pierwsze pytanie', { exact: true })).toBeVisible();
  await noOverflow(page);
});
