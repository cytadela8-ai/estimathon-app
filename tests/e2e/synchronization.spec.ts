/** Full browser lifecycle tests retain drafts across disconnection, deadline, tab close and recovery. */
import { test, expect } from '#est-e2e/fixtures';
import { join, noOverflow } from '#est-e2e/helpers';
test('offline drafts survive the deadline and a closed tab, then sync the previous question', async ({
  page,
  context,
  contest,
}) => {
  await contest.configure(4);
  await join(page, contest, 'Offline');
  await contest.command('start');
  await expect(page.getByLabel('Twoja estymacja')).toBeEnabled();
  const deadline = (await contest.state()).state.endsAt!;
  await context.setOffline(true);
  await page.getByLabel('Twoja estymacja').fill('100');
  await page.getByLabel('Twoja estymacja').fill('');
  await expect(page.getByLabel('Twoja estymacja')).toBeDisabled();
  await page.close();
  await contest.waitUntil(deadline + 3500);
  await expect.poll(async () => (await contest.state()).state.phase).toBe('results');
  await contest.command('next');
  await context.setOffline(false);
  const reopened = await context.newPage();
  await reopened.goto(contest.url + '/play');
  await expect(reopened.getByRole('heading', { name: 'Drugie pytanie' })).toBeVisible();
  await expect(reopened.getByLabel('Twoja estymacja')).toHaveValue('');
  await expect
    .poll(async () => (await contest.results()).questions[0]?.results[0]?.score)
    .toBe(1000);
  const audit = (await contest.results()).audit;
  expect(audit).toHaveLength(1);
  expect(audit[0]!.serverLateMs).toBeGreaterThanOrEqual(3000);
  expect(audit[0]!.phoneLateMs).toBeLessThan(0);
  await expect(reopened.locator('a')).toHaveCount(0);
  await noOverflow(reopened);
});

test('immediate close, two tabs, and recovery on another device retain the same answer', async ({
  page,
  context,
  browser,
  contest,
}) => {
  await contest.configure();
  await join(page, contest, 'Powracający');
  await contest.command('start');
  await expect(page.getByLabel('Twoja estymacja')).toBeEnabled();
  await page.getByLabel('Twoja estymacja').fill('12');
  await page.close();
  const first = await context.newPage();
  await first.goto(contest.url + '/play');
  await expect(first.getByLabel('Twoja estymacja')).toHaveValue('12');
  const second = await context.newPage();
  await second.goto(contest.url + '/play');
  await expect(second.getByLabel('Twoja estymacja')).toHaveValue('12');
  await second.getByLabel('Twoja estymacja').fill('100');
  await expect(first.getByLabel('Twoja estymacja')).toHaveValue('100');
  await expect(second.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
  const session = await first.evaluate(() =>
    JSON.parse(localStorage.getItem('estymator.session')!),
  );
  const other = await browser.newContext();
  try {
    const recovered = await other.newPage();
    await recovered.goto(`${contest.url}/play#recover=${session.recoveryCode}`);
    await recovered.getByRole('button', { name: 'Przywróć konto', exact: true }).click();
    await expect(recovered.getByLabel('Twoja estymacja')).toHaveValue('100');
    await expect(recovered.locator('a')).toHaveCount(0);
    expect(await recovered.evaluate(() => location.hash)).toBe('');
    await noOverflow(first);
  } finally {
    await other.close();
  }
});

test('participant and projector reconnect after the production server restarts', async ({
  page,
  context,
  contest,
}) => {
  await contest.configure();
  await join(page, contest, 'Restart');
  const projector = await context.newPage();
  await projector.goto(contest.url + '/screen');
  await contest.command('start');
  await page.getByLabel('Twoja estymacja').fill('100');
  await expect(page.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
  const before = (await contest.state()).state.endsAt;
  await contest.restart();
  await expect(page.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
  await page.getByLabel('Twoja estymacja').fill('200');
  await expect.poll(async () => (await contest.results()).audit.length).toBe(2);
  await expect(projector.getByText('NA ŻYWO', { exact: true })).toBeVisible();
  expect((await contest.state()).state.endsAt).toBe(before);
  await expect(page.getByLabel('Twoja estymacja')).toHaveValue('200');
});
