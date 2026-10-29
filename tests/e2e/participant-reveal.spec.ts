/** Phones reveal answers and scores with the projector, including after a refresh. */
import { test, expect } from '#est-e2e/fixtures';
import { join } from '#est-e2e/helpers';

test('participant results follow the projector reveal stages', async ({
  page,
  context,
  contest,
}) => {
  await contest.configure();
  await join(page, contest, 'Ania');
  const screen = await context.newPage();
  await screen.goto(contest.url + '/screen');
  await contest.command('start');
  await page.getByLabel('Twoja estymacja').fill('100');
  await expect(page.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
  await contest.command('next');
  await expect.poll(async () => (await contest.state()).state.phase).toBe('results');
  await expect(page.locator('.reveal-loader')).toBeVisible();
  await expect(page.locator('.correct-value')).toHaveCount(0);
  await expect(page.getByText('Punkty za pytanie:')).toHaveCount(0);
  await expect(page.getByText('Łącznie:')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.reveal-loader')).toBeVisible();
  await expect(page.locator('.correct-value')).toHaveCount(0);
  await expect(page.locator('.correct-value')).toHaveText('100');
  await expect(screen.locator('.correct-reveal')).toBeVisible();
  await expect(page.getByText('Punkty za pytanie:')).toHaveCount(0);
  await expect(page.getByText('Łącznie:')).toHaveCount(0);
  await expect(page.getByText('Punkty za pytanie:')).toContainText('1000 / 1000');
  await expect(
    screen.getByRole('region', { name: 'Klasyfikacja pytania', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('Łącznie:')).toContainText('1000 pkt');
  await page.reload();
  await expect(page.getByText('Punkty za pytanie:')).toContainText('1000 / 1000');
  await contest.command('next');
  await expect(page.getByLabel('Twoja estymacja')).toBeEnabled();
  await expect(page.locator('.correct-value')).toHaveCount(0);
});
