/** Ending remains available throughout a running contest and closes all connected views. */
import { test, expect } from '#est-e2e/fixtures';
import { host, join } from '#est-e2e/helpers';
import type { Config, Question } from '#est-shared/protocol';
for (const phase of ['active', 'paused', 'closing'] as const) {
  test(`host can end the contest while ${phase}`, async ({ page, context, contest }) => {
    await contest.configure();
    const overview = await contest.request<{ config: Config; questions: Question[] }>(
      '/api/admin/overview',
      undefined,
      'GET',
    );
    await contest.request(
      '/api/admin/config',
      { questions: overview.questions, config: { ...overview.config, revealDelaySeconds: 3 } },
      'PUT',
    );
    const player = await context.newPage();
    await join(player, contest, 'Jan');
    const projector = await context.newPage();
    await projector.goto(contest.url + '/screen');
    await host(page, contest);
    const finish = page.getByRole('button', { name: 'Zakończ konkurs', exact: true });
    await expect(finish).toBeDisabled();
    await page.getByRole('button', { name: 'Rozpocznij konkurs', exact: true }).click();
    await expect(player.getByLabel('Twoja estymacja')).toBeEnabled();
    await player.getByLabel('Twoja estymacja').fill('100');
    await expect(player.getByText('Zapisano na serwerze', { exact: true })).toBeVisible();
    if (phase === 'paused') {
      await page.getByRole('button', { name: 'Wstrzymaj', exact: true }).click();
      await expect.poll(async () => (await contest.state()).state.phase).toBe('paused');
    }
    if (phase === 'closing') {
      await page.getByRole('button', { name: 'Zamknij pytanie', exact: true }).click();
      await expect.poll(async () => (await contest.state()).state.phase).toBe('closing');
    }
    await expect(finish).toBeEnabled();
    await finish.click();
    await expect.poll(async () => (await contest.state()).state.phase).toBe('finishing');
    await expect(finish).toBeDisabled();
    await expect(player.getByLabel('Twoja estymacja')).toHaveCount(0);
    await expect(
      projector.getByRole('heading', { name: 'Koniec czasu', exact: true }),
    ).toBeVisible();
    expect((await contest.state()).correct).toBeNull();
    await expect(
      player.getByRole('heading', { name: 'Wyniki końcowe', exact: true }),
    ).toBeVisible();
    await expect(
      projector.getByRole('heading', { name: 'Wyniki końcowe', exact: true }),
    ).toBeVisible();
    await expect(projector.locator('.podium-person[data-place="1"]')).toContainText('Jan');
    expect((await contest.results()).standings[0]?.score).toBe(1000);
    expect((await contest.state()).state.index).toBe(0);
    await expect(finish).toBeDisabled();
    await expect(page.getByRole('alert')).toHaveCount(0);
  });
}
