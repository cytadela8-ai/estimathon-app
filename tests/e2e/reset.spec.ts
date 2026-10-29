/** Hosts can finish, confirm reset and relaunch without stale answers or lost participant sessions. */
import { test, expect } from '#est-e2e/fixtures';
import { host, join, noOverflow } from '#est-e2e/helpers';
test('host confirms reset, keeps players and questions, and starts another contest', async ({
  page,
  context,
  contest,
}) => {
  await contest.configure();
  const player = await context.newPage();
  await join(player, contest, 'Jan');
  const identity = await player.evaluate(() => localStorage.getItem('estymator.session'));
  const projector = await context.newPage();
  await projector.goto(contest.url + '/screen');
  await host(page, contest);
  await page.getByRole('button', { name: 'Rozpocznij konkurs', exact: true }).click();
  await player.getByLabel('Twoja estymacja').fill('100');
  await expect(player.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
  const first = await contest.state();
  await page.getByRole('button', { name: 'Zakończ konkurs', exact: true }).click();
  const reset = page.getByRole('button', { name: 'Resetuj konkurs', exact: true });
  await expect(reset).toBeVisible();
  await reset.click();
  await page.getByRole('button', { name: 'Anuluj', exact: true }).click();
  expect((await contest.state()).state.phase).toBe('finished');
  expect((await contest.results()).standings[0]?.score).toBe(1000);
  await reset.click();
  await expect(page.getByRole('form', { name: 'Reset konkursu' })).toContainText('kopię bazy');
  await page.getByRole('button', { name: 'Potwierdź reset', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rozpocznij konkurs', exact: true })).toBeEnabled();
  await expect(
    player.getByRole('heading', { name: 'Czekamy na start', exact: true }),
  ).toBeVisible();
  await expect(
    projector.getByRole('heading', { name: 'Dołącz do gry', exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Kopia bazy:');
  await noOverflow(page);
  const lobby = await contest.state();
  expect(lobby.state.version).toBeGreaterThan(first.state.version);
  expect(lobby).toMatchObject({ participantCount: 1, answerCount: 0, question: null });
  expect((await contest.results()).audit).toEqual([]);
  expect((await contest.results()).standings[0]?.score).toBe(0);
  expect(await player.evaluate(() => localStorage.getItem('estymator.session'))).toBe(identity);
  await page.getByRole('button', { name: 'Pytania i ustawienia', exact: true }).click();
  await expect(page.getByLabel('Treść pytania').nth(0)).toHaveValue('Pierwsze pytanie');
  await expect(page.getByLabel('Treść pytania').nth(1)).toHaveValue('Drugie pytanie');
  await page.getByLabel('Treść pytania').nth(0).fill('Nowe pytanie');
  await page.getByRole('button', { name: 'Zapisz konfigurację', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Konfiguracja została zapisana.');
  await page.getByRole('button', { name: 'Przebieg konkursu', exact: true }).click();
  await page.getByRole('button', { name: 'Rozpocznij konkurs', exact: true }).click();
  await expect(player.getByRole('heading', { name: 'Nowe pytanie', exact: true })).toBeVisible();
  await expect(projector.getByRole('heading', { name: 'Nowe pytanie', exact: true })).toBeVisible();
  await expect(player.getByLabel('Twoja estymacja')).toHaveValue('');
  expect((await contest.state()).question?.id).not.toBe(first.question!.id);
  await player.getByLabel('Twoja estymacja').fill('200');
  await expect(player.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Zakończ konkurs', exact: true }).click();
  await expect(player.getByRole('heading', { name: 'Wyniki końcowe', exact: true })).toBeVisible();
  expect((await contest.results()).standings[0]?.score).toBe(500);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('an offline participant reconnects after reset without importing a previous-run draft', async ({
  page,
  browser,
  contest,
}) => {
  await contest.configure();
  const offline = await browser.newContext({ viewport: page.viewportSize()! });
  try {
    const player = await offline.newPage();
    await join(player, contest, 'Offline');
    await host(page, contest);
    await page.getByRole('button', { name: 'Rozpocznij konkurs', exact: true }).click();
    await player.getByLabel('Twoja estymacja').fill('100');
    await expect(player.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
    await offline.setOffline(true);
    await player.getByLabel('Twoja estymacja').fill('999');
    await page.getByRole('button', { name: 'Zakończ konkurs', exact: true }).click();
    await page.getByRole('button', { name: 'Resetuj konkurs', exact: true }).click();
    await page.getByRole('button', { name: 'Potwierdź reset', exact: true }).click();
    await page.getByRole('button', { name: 'Rozpocznij konkurs', exact: true }).click();
    await offline.setOffline(false);
    await expect(player.getByLabel('Twoja estymacja')).toBeEnabled();
    await expect(player.getByLabel('Twoja estymacja')).toHaveValue('');
    await player.reload();
    await expect(player.getByLabel('Twoja estymacja')).toHaveValue('');
    expect((await contest.state()).answerCount).toBe(0);
    expect((await contest.results()).audit).toEqual([]);
    await player.getByLabel('Twoja estymacja').fill('200');
    await expect(player.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
    await expect.poll(async () => (await contest.state()).answerCount).toBe(1);
    const results = await contest.results();
    expect(results.audit).toHaveLength(1);
    expect(results.audit[0]?.text).toBe('200');
    await noOverflow(player);
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    await offline.close();
  }
});
