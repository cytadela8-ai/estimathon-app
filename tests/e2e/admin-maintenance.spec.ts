/** Host maintenance controls use explicit confirmation and update authoritative timer state. */
import { test, expect } from '#est-e2e/fixtures';
import { host, noOverflow } from '#est-e2e/helpers';

test('host subtracts time, cancels cleanup, then confirms cleanup', async ({ page, contest }) => {
  await contest.configure();
  await host(page, contest);
  const shorten = page.getByRole('button', { name: '−30 sekund', exact: true });
  await expect(shorten).toBeDisabled();
  await page.getByRole('button', { name: 'Rozpocznij konkurs', exact: true }).click();
  await expect(shorten).toBeEnabled();
  const initial = (await contest.state()).state.endsAt!;
  await shorten.click();
  await expect.poll(async () => (await contest.state()).state.endsAt).toBe(initial - 30000);
  await page.getByRole('button', { name: 'Wstrzymaj', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Wznów', exact: true })).toBeEnabled();
  const paused = (await contest.state()).state.remainingMs;
  await shorten.click();
  await expect.poll(async () => (await contest.state()).state.remainingMs).toBe(paused - 30000);
  const cleanup = page.getByRole('button', { name: 'Wyczyść historię odpowiedzi', exact: true });
  await cleanup.click();
  await page.getByRole('button', { name: 'Anuluj', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Czyszczenie historii', exact: true })).toHaveCount(
    0,
  );
  await cleanup.click();
  await page.getByRole('button', { name: 'Potwierdź czyszczenie', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Usunięto wpisy historii: 0, decyzje: 0.');
  expect((await contest.state()).state.phase).toBe('paused');
  await expect(page.getByRole('alert')).toHaveCount(0);
  await noOverflow(page);
});
