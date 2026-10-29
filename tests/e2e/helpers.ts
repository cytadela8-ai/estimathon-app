/** Reusable browser actions use visible controls and observable server behavior. */
import type { Page } from '@playwright/test';
import { expect, password, type Driver } from '#est-e2e/fixtures';
export async function join(page: Page, contest: Driver, nickname: string): Promise<void> {
  await page.goto(contest.url + '/play');
  await page.getByLabel('Imię', { exact: true }).fill(nickname);
  await page.getByLabel('Nazwisko', { exact: true }).fill('Test');
  await page.getByLabel('Pseudonim', { exact: true }).fill(nickname);
  await page.getByRole('button', { name: 'Dołącz do konkursu', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Czekamy na start', exact: true })).toBeVisible();
  await expect(page.locator('a')).toHaveCount(0);
}
export async function host(page: Page, contest: Driver): Promise<void> {
  await page.goto(contest.url + '/admin');
  await page.getByLabel('Hasło prowadzącego').fill(password);
  await page.getByRole('button', { name: 'Zaloguj się', exact: false }).click();
  await expect(
    page.getByRole('button', { name: 'Wyniki i monitoring', exact: true }),
  ).toBeVisible();
}
export async function noOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
