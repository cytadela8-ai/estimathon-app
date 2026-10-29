/** Question rankings and centered answer histograms stay legible and update independently. */
import { test, expect } from '#est-e2e/fixtures';
import { join, noOverflow } from '#est-e2e/helpers';

test('question results show their own ranking alongside the overall contest', async ({
  page,
  context,
  contest,
}) => {
  await contest.configure();
  await join(page, contest, 'Ania');
  const otherContext = await context.browser()!.newContext({ viewport: page.viewportSize()! });
  try {
    const other = await otherContext.newPage();
    await join(other, contest, 'Bartek');
    const screen = await context.newPage();
    await screen.goto(contest.url + '/screen');
    await expect(screen.locator('.brand')).toHaveText('≈estymathon');
    await expect(screen).toHaveTitle('Estymathon');
    await contest.command('start');
    await page.getByLabel('Twoja estymacja').fill('100');
    await other.getByLabel('Twoja estymacja').fill('200');
    await expect.poll(async () => (await contest.state()).answerCount).toBe(2);
    await contest.command('next');
    await expect.poll(async () => (await contest.state()).state.phase).toBe('results');
    await contest.command('next');
    await page.getByLabel('Twoja estymacja').fill('400');
    await other.getByLabel('Twoja estymacja').fill('200');
    await expect.poll(async () => (await contest.state()).answerCount).toBe(2);
    await contest.command('next');
    const question = screen.getByRole('region', { name: 'Klasyfikacja pytania', exact: true });
    const overall = screen.getByRole('region', { name: 'Klasyfikacja łączna', exact: true });
    await expect(question).toBeVisible();
    await expect(question.locator('.leader-row').first()).toContainText('Bartek');
    await expect(question.locator('.leader-row').first()).toContainText('600 pkt');
    await expect(overall.locator('.leader-row').first()).toContainText('Ania');
    await expect(overall.locator('.leader-row').first()).toContainText('1429 pkt');
    await expect(question.locator('.leader-row').nth(1)).toContainText('429 pkt');
    await expect(overall.locator('.leader-row').nth(1)).toContainText('933 pkt');
    await expect(screen.locator('.chart-column')).toHaveCount(14);
    await expect(screen.getByLabel('Zakres odpowiedzi')).toContainText('100');
    const viewport = screen.viewportSize()!;
    if (viewport.width > 1000) {
      const bounds = await overall.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
      expect(
        await screen
          .locator('.chart-column span')
          .first()
          .evaluate((node) => parseFloat(getComputedStyle(node).fontSize)),
      ).toBeGreaterThanOrEqual(28);
    }
    await noOverflow(screen);
    await screen.screenshot({ path: `test-results/results-${viewport.width}.png`, fullPage: true });
  } finally {
    await otherContext.close();
  }
});
