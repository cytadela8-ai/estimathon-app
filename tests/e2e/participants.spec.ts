/** Host moderation exposes IPs, requires confirmation, and removes the selected account. */
import { test, expect } from '#est-e2e/fixtures';
import { host, noOverflow } from '#est-e2e/helpers';

test('host can inspect IP history and cancel or confirm account deletion', async ({
  page,
  contest,
}) => {
  const removed = await contest.session('Remove me');
  await contest.session('Keep me');
  await host(page, contest);
  await page.getByRole('button', { name: 'Uczestnicy', exact: true }).click();
  const row = page.getByRole('row').filter({ hasText: 'Remove me' });
  await expect(page.getByRole('columnheader', { name: 'Adresy IP' })).toBeVisible();
  await expect(row).toContainText('127.0.0.1');
  await row.getByRole('button', { name: 'Usuń uczestnika' }).click();
  const confirmation = page.getByRole('form', { name: 'Usuwanie uczestnika' });
  await expect(confirmation).toContainText('Remove me');
  await confirmation.getByRole('button', { name: 'Anuluj' }).click();
  await expect(confirmation).toHaveCount(0);
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Usuń uczestnika' }).click();
  await confirmation.getByRole('button', { name: 'Potwierdź usunięcie' }).click();
  await expect(row).toHaveCount(0);
  await expect(page.getByRole('row').filter({ hasText: 'Keep me' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Uczestnik został usunięty.');
  const recovery = await page.request.post(contest.url + '/api/recover', {
    data: { code: removed.recoveryCode },
  });
  expect(recovery.status()).toBe(404);
  await noOverflow(page);
});
