/** Cold browser contexts navigate every app entry point while the full-app workload runs. */
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';
import Database from 'better-sqlite3';
const url = process.env['PERF_URL'];
if (!url || new URL(url).hostname !== '127.0.0.1')
  throw new Error('Set PERF_URL to an isolated loopback test server.');
const db = new Database(process.env['PERF_DATABASE_PATH'], { readonly: true });
const { token, recoveryCode, ...participant } = db
  .prepare('SELECT * FROM participants LIMIT 1')
  .get();
db.close();
const auth = await fetch(url + '/api/login', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ password: 'broad-performance-password' }),
});
if (!auth.ok) throw new Error('Cannot authenticate to isolated test server.');
const admin = (await auth.json()).token;
const browser = await chromium.launch();
const rows = [];
try {
  for (const viewport of [
    { width: 1920, height: 1080 },
    { width: 390, height: 844 },
  ]) {
    for (const path of ['/', '/play', '/screen', '/admin']) {
      for (let iteration = 0; iteration < 3; iteration++) {
        const context = await browser.newContext({ viewport });
        const page = await context.newPage();
        const errors = [];
        page.on('pageerror', (error) => errors.push(error.message));
        await page.addInitScript(
          ({ session, admin }) => {
            localStorage.setItem('estymator.session', JSON.stringify(session));
            sessionStorage.setItem('estymator.admin', admin);
          },
          { session: { token, recoveryCode, participant }, admin },
        );
        const state = await (await fetch(url + '/api/state')).json();
        const start = performance.now();
        const response = await page.goto(url + path);
        if (path === '/admin')
          await page.getByRole('button', { name: 'Wyniki i monitoring', exact: true }).waitFor();
        else await page.getByRole('heading', { level: 1 }).first().waitFor();
        await page.evaluate(() => document.fonts.ready);
        await page.evaluate(
          () =>
            new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
        const readyMs = performance.now() - start;
        const timings = await page.evaluate(() => ({
          navigation: performance.getEntriesByType('navigation')[0].toJSON(),
          paints: performance
            .getEntriesByType('paint')
            .map((p) => ({ name: p.name, ms: p.startTime })),
        }));
        rows.push({
          path,
          viewport,
          iteration,
          phase: state.state.phase,
          status: response.status(),
          readyMs,
          timings,
          errors,
        });
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}
await mkdir('performance-results/full-app/navigation', { recursive: true });
await writeFile(
  'performance-results/full-app/navigation/report.json',
  JSON.stringify(rows, null, 2),
);
console.log(
  JSON.stringify(
    rows.map(({ path, viewport, readyMs, phase, status, errors }) => ({
      path,
      width: viewport.width,
      readyMs,
      phase,
      status,
      errors,
    })),
  ),
);
