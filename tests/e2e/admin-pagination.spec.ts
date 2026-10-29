/** Real browser pagination keeps host answer/version fetches bounded, including live polling. */
import { randomUUID } from 'node:crypto';
import { io } from 'socket.io-client';
import { test, expect, type Driver } from '#est-e2e/fixtures';
import { host, noOverflow } from '#est-e2e/helpers';

async function seed(contest: Driver): Promise<void> {
  await contest.configure();
  await contest.command('start');
  const questionId = (await contest.state()).question!.id;
  await Promise.all(
    Array.from({ length: 105 }, async (_, index) => {
      const session = await contest.session(`Player${String(index).padStart(3, '0')}`);
      const socket = io(contest.url, { auth: { token: session.token } });
      try {
        for (let revision = 1; revision <= (index === 104 ? 106 : 1); revision++) {
          const receipt = await socket.timeout(5000).emitWithAck('save', {
            questionId,
            operationId: randomUUID(),
            revision,
            text: revision === 106 ? '777' : '100',
          });
          expect(receipt.status).toBe('accepted');
        }
      } finally {
        socket.disconnect();
      }
    }),
  );
}

test('host pages answers and versions, filters history, and polls the current page', async ({
  page,
  contest,
}) => {
  await seed(contest);
  const entry = (await contest.results()).audit.find((entry) => entry.revision === 106)!;
  for (let i = 1; i <= 25; i++) {
    await contest.request('/api/admin/review', {
      participantId: entry.participantId,
      operationId: entry.operationId,
      excluded: false,
      reason: `Review ${i}`,
    });
  }
  await host(page, contest);
  await page.getByRole('button', { name: 'Odpowiedzi', exact: true }).click();
  const answers = page.getByRole('table', { name: 'Przyjęte odpowiedzi', exact: true });
  const answerPages = page.getByRole('navigation', { name: 'Strony przyjętych odpowiedzi' });
  await expect(answers.locator('tbody tr')).toHaveCount(100);
  await answerPages.getByRole('button', { name: 'Następne' }).click();
  await expect(answers.locator('tbody tr')).toHaveCount(5);
  await expect(answerPages).toContainText('Strona 2 / 2');
  const poll = await page.waitForResponse((response) =>
    response.url().includes('/api/admin/answers?page=2'),
  );
  expect((await poll.json()).items).toHaveLength(5);
  await answerPages.getByRole('button', { name: 'Poprzednie' }).click();
  await expect(answers.locator('tbody tr')).toHaveCount(100);

  await page.getByRole('button', { name: 'Wyniki i monitoring', exact: true }).click();
  await page.getByLabel('Tylko spóźnione').uncheck();
  const history = page.getByRole('table', { name: 'Historia odpowiedzi', exact: true });
  const auditPages = page.getByRole('navigation', { name: 'Strony historii odpowiedzi' });
  await expect(history.locator('tbody tr')).toHaveCount(100);
  await expect(page.getByText('Liczba operacji: 210', { exact: true })).toBeVisible();
  await auditPages.getByRole('button', { name: 'Następne' }).click();
  await expect(auditPages).toContainText('Strona 2 / 3');
  const monitoringPoll = await page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/api/admin/results' && url.searchParams.get('auditPage') === '2';
  });
  const data = await monitoringPoll.json();
  expect(data.audit).toHaveLength(100);
  expect(
    data.questions.flatMap((question: { results: unknown[] }) => question.results),
  ).toHaveLength(100);

  await page.getByLabel('Uczestnik — imię, nazwisko lub pseudonim').fill('Player104');
  await expect(page.getByText('Liczba operacji: 106', { exact: true })).toBeVisible();
  await expect(auditPages).toContainText('Strona 1 / 2');
  await auditPages.getByRole('button', { name: 'Następne' }).click();
  await expect(history.locator('tbody tr')).toHaveCount(6);
  await page.getByLabel('Wpisana wartość zawiera').fill('777');
  await expect(history.locator('tbody tr')).toHaveCount(1);
  await expect(history).toContainText('Wersja 106');
  await expect(auditPages).toHaveCount(0);
  await page.getByText('Historia decyzji (25)', { exact: true }).click();
  const decisions = page.getByRole('navigation', { name: 'Strony historii decyzji' });
  await expect(decisions).toContainText('Strona 1 / 2');
  await decisions.getByRole('button', { name: 'Następne' }).click();
  await expect(decisions).toContainText('Strona 2 / 2');
  await expect(history.getByText(/: Review 1$/)).toBeVisible();
  await noOverflow(page);
});
