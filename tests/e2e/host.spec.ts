/** Host review and projector tests exercise real controls, delayed delivery, filters and shared places. */
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { test, expect, type Driver } from '#est-e2e/fixtures';
import { host, join, noOverflow } from '#est-e2e/helpers';
async function importQuestions(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Pytania i ustawienia', exact: true }).click();
  await page.getByLabel('Importuj JSON').setInputFiles({
    name: 'questions.json',
    mimeType: 'application/json',
    buffer: Buffer.from(
      JSON.stringify([
        { text: 'Pierwsze pytanie', correct: '100', seconds: 180 },
        { text: 'Drugie pytanie', correct: '100', seconds: 180 },
      ]),
    ),
  });
  await page.getByLabel('Oczekiwanie przed ujawnieniem wyników (sekundy)').fill('1');
  await page.getByRole('button', { name: 'Zapisz konfigurację', exact: false }).click();
  await expect(page.getByText('Konfiguracja została zapisana.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Przebieg konkursu', exact: true }).click();
}
async function players(
  browser: Browser,
  contest: Driver,
): Promise<{ contexts: BrowserContext[]; pages: Page[] }> {
  const contexts: BrowserContext[] = [];
  const pages: Page[] = [];
  for (const name of ['Ania', 'Bartek', 'Celina']) {
    const context = await browser.newContext();
    contexts.push(context);
    const page = await context.newPage();
    pages.push(page);
    await join(page, contest, name);
  }
  await contest.session('Dawid');
  return { contexts, pages };
}
async function auditFilters(page: Page): Promise<void> {
  await expect(page.getByLabel('Minimalne spóźnienie dotarcia (sekundy)')).toHaveValue('3');
  await expect(
    page.getByRole('table', { name: 'Historia odpowiedzi' }).locator('tbody tr'),
  ).toHaveCount(1);
  await page.getByLabel('Minimalne spóźnienie dotarcia (sekundy)').fill('10000');
  await expect(
    page.getByText('Brak operacji spełniających filtry.', { exact: true }),
  ).toBeVisible();
  await page.getByLabel('Tylko spóźnione').uncheck();
  await expect(
    page.getByRole('table', { name: 'Historia odpowiedzi' }).locator('tbody tr'),
  ).toHaveCount(3);
  await page.getByLabel('Wpisana wartość zawiera').fill('200');
  await expect(
    page.getByRole('table', { name: 'Historia odpowiedzi' }).locator('tbody tr'),
  ).toHaveCount(1);
  await expect(page.getByRole('table', { name: 'Historia odpowiedzi' })).toContainText('Celina');
  await page.getByLabel('Wpisana wartość zawiera').fill('');
  await page.getByLabel('Uczestnik — imię, nazwisko lub pseudonim').fill('Ania Test');
  await expect(
    page.getByRole('table', { name: 'Historia odpowiedzi' }).locator('tbody tr'),
  ).toHaveCount(1);
  await expect(
    page.getByRole('table', { name: 'Wyniki pytania 1' }).locator('tbody tr'),
  ).toHaveCount(1);
  await expect(
    page.getByRole('table', { name: 'Klasyfikacja łączna', exact: true }).locator('tbody tr'),
  ).toHaveCount(1);
  await page.getByLabel('Uczestnik — imię, nazwisko lub pseudonim').fill('');
}
async function review(page: Page, action: 'Wyklucz' | 'Przywróć'): Promise<void> {
  await page.getByRole('button', { name: `${action} odpowiedź Ania 100`, exact: true }).click();
  await page
    .getByLabel('Powód decyzji')
    .fill(action === 'Wyklucz' ? 'Sprawdzenie anomalii' : 'Potwierdzony problem Wi-Fi');
  await page.getByRole('button', { name: 'Zatwierdź decyzję', exact: true }).click();
  await expect(page.getByLabel('Powód decyzji')).toHaveCount(0);
}
async function verifyPodium(screen: Page): Promise<void> {
  await expect(screen.locator('.podium-person[data-place="1"] h2')).toHaveText(['Ania', 'Bartek']);
  await expect(screen.locator('.podium-person[data-place="2"]')).toHaveCount(0);
  await expect(screen.locator('.podium-person[data-place="3"]')).toContainText('Celina');
  await expect(screen.locator('.scrolling-results').last()).toContainText('Dawid');
  const ranks = await screen
    .locator('.all-results .leader-row > span:first-child')
    .allTextContents();
  expect(ranks).toEqual(['1', '1', '3', '4']);
  await noOverflow(screen);
}
test('host imports questions, audits late answers, excludes and restores them, and reveals tied winners', async ({
  page,
  browser,
  contest,
}) => {
  await host(page, contest);
  await importQuestions(page);
  const group = await players(browser, contest);
  const projectorContext = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const projector = await projectorContext.newPage();
    await projector.goto(contest.url + '/screen');
    await page.getByRole('button', { name: 'Rozpocznij konkurs', exact: false }).click();
    await expect(group.pages[0]!.getByLabel('Twoja estymacja')).toBeEnabled();
    await group.contexts[0]!.setOffline(true);
    await group.pages[0]!.getByLabel('Twoja estymacja').fill('100');
    await group.pages[1]!.getByLabel('Twoja estymacja').fill('100');
    await group.pages[2]!.getByLabel('Twoja estymacja').fill('200');
    await expect.poll(async () => (await contest.state()).answerCount).toBe(2);
    await projectorContext.setOffline(true);
    await page.getByRole('button', { name: 'Zamknij pytanie', exact: true }).click();
    const deadline = (await contest.state()).state.endsAt!;
    await contest.waitUntil(deadline + 3500);
    await group.contexts[0]!.setOffline(false);
    await expect.poll(async () => (await contest.state()).answerCount).toBe(3);
    await projectorContext.setOffline(false);
    await expect(projector.getByText('Prawidłowa odpowiedź', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Wyniki i monitoring', exact: true }).click();
    await auditFilters(page);
    const data = await contest.results();
    expect(data.standings.map((s) => s.place)).toEqual([1, 1, 3, 4]);
    expect(data.questions[0]!.results.find((r) => r.nickname === 'Dawid')?.score).toBe(0);
    await review(page, 'Wyklucz');
    await expect(group.pages[0]!.getByText('0 / 1000', { exact: true })).toBeVisible();
    await review(page, 'Przywróć');
    await expect(group.pages[0]!.getByText('1000 / 1000', { exact: true })).toBeVisible();
    await expect(page.getByText('Historia decyzji (2)', { exact: true })).toBeVisible();
    expect((await contest.state()).state.index).toBe(0);
    await page.getByRole('button', { name: 'Przebieg konkursu', exact: true }).click();
    await page.getByRole('button', { name: 'Zakończ konkurs', exact: true }).click();
    await verifyPodium(projector);
    await noOverflow(page);
    await expect(group.pages[0]!.locator('a')).toHaveCount(0);
  } finally {
    for (const context of group.contexts) await context.close();
    await projectorContext.close();
  }
});

test('host loads saved questions after login and reload without an error', async ({
  page,
  contest,
}) => {
  await contest.configure();
  await host(page, contest);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pytania i ustawienia', exact: true }).click();
  await expect(page.getByLabel('Treść pytania').nth(0)).toHaveValue('Pierwsze pytanie');
  await expect(page.getByLabel('Treść pytania').nth(1)).toHaveValue('Drugie pytanie');
  await page.reload();
  await page.getByRole('button', { name: 'Pytania i ustawienia', exact: true }).click();
  await expect(page.getByLabel('Treść pytania').nth(0)).toHaveValue('Pierwsze pytanie');
  await expect(page.getByLabel('Treść pytania').nth(1)).toHaveValue('Drugie pytanie');
  await expect(page.getByRole('alert')).toHaveCount(0);
});
