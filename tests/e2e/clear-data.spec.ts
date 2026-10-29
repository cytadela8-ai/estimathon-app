/** Browser-data removal requires confirmation, logs out all tabs, and retains server recovery. */
import { test, expect } from '#est-e2e/fixtures';
import { join, noOverflow } from '#est-e2e/helpers';

test('participant confirms browser data removal and can recover saved server answers', async ({
  page,
  context,
  contest,
}) => {
  await contest.configure();
  await join(page, contest, 'Ania');
  await contest.command('start');
  await page.getByLabel('Twoja estymacja').fill('100');
  await expect(page.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
  const session = await page.evaluate(() => JSON.parse(localStorage.getItem('estymator.session')!));
  const other = await context.newPage();
  await other.goto(contest.url + '/play');
  await expect(other.getByLabel('Twoja estymacja')).toHaveValue('100');
  await page.evaluate(() => {
    localStorage.setItem('unrelated-local-key', 'erase');
    sessionStorage.setItem('estymator.admin', 'erase');
  });
  await page.locator('.account summary').click();
  await page.getByRole('button', { name: 'Wyczyść dane i wyloguj', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Wyczyść dane przeglądarki' })).toBeVisible();
  await noOverflow(page);
  await page.screenshot({
    path: `test-results/wipe-${page.viewportSize()!.width}.png`,
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Anuluj', exact: true }).click();
  expect(await page.evaluate(() => localStorage.getItem('estymator.session'))).not.toBeNull();
  await page.getByRole('button', { name: 'Wyczyść dane i wyloguj', exact: true }).click();
  await page.getByRole('button', { name: 'Potwierdź usunięcie danych', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Dołącz do gry', exact: true })).toBeVisible();
  await expect(other.getByRole('heading', { name: 'Dołącz do gry', exact: true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.length)).toBe(0);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  await page.getByText('Masz konto? Odzyskaj dostęp', { exact: true }).click();
  await page.getByLabel('Kod odzyskiwania', { exact: true }).fill(session.recoveryCode);
  await page.getByRole('button', { name: 'Przywróć konto', exact: true }).click();
  await expect(page.getByLabel('Twoja estymacja')).toHaveValue('100');
  expect((await contest.state()).participantCount).toBe(1);
  await noOverflow(page);
});
