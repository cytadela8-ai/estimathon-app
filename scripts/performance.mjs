/** Isolated production load test. Run after pnpm build: node scripts/performance.mjs.
 * Optional durations (seconds): node scripts/performance.mjs 10 60 600.
 * Uses existing dependencies, temporary SQLite databases, and loopback only.
 * Bots schedule edits independently of acknowledgments to expose queue buildup.
 * Reports persist in performance-results; application data is never opened.
 */
import { spawn } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { resolve, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { io } from 'socket.io-client';
import Database from 'better-sqlite3';

const password = 'isolated-performance-password';
const durations = process.argv.slice(2).map(Number);
if (!durations.length) durations.push(10, 60, 600);
if (durations.some((n) => !Number.isInteger(n) || n < 1 || n > 3600)) {
  throw new Error('Durations must be integer seconds between 1 and 3600.');
}
const historyPath = process.env['PERF_DATABASE_PATH'];
const label = process.env['PERF_LABEL'] ?? 'history';
let initialSubmissionRows = 0;
let historyRevisionBase = 0;
const output = resolve('performance-results', historyPath ? label : '.');
await mkdir(output, { recursive: true });
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? 0;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
}
async function api(url, path, token, body, method = 'POST') {
  const response = await fetch(url + path, {
    method,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`${path}: ${response.status} ${await response.text()}`);
  return response.json();
}
async function instrument(page) {
  await page.addInitScript(() => {
    window.perf = { frames: [], tasks: [], errors: [], requests: [] };
    let last = performance.now();
    function frame(now) {
      window.perf.frames.push(now - last);
      last = now;
      requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) window.perf.tasks.push(entry.duration);
    }).observe({ type: 'longtask', buffered: true });
    window.addEventListener('error', (event) => window.perf.errors.push(event.message));
    const original = window.fetch;
    window.fetch = async (...args) => {
      const start = performance.now();
      try {
        const response = await original(...args);
        window.perf.requests.push({
          path: String(args[0]),
          ms: performance.now() - start,
          status: response.status,
        });
        return response;
      } catch (error) {
        window.perf.errors.push(String(error));
        throw error;
      }
    };
  });
}
async function openPages(browser, url, token) {
  const pages = {};
  for (const name of ['screen', 'answers', 'results', 'people', 'questions', 'contest']) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
    const page = await context.newPage();
    await instrument(page);
    await page.addInitScript((value) => sessionStorage.setItem('estymator.admin', value), token);
    await page.goto(url + (name === 'screen' ? '/screen' : '/admin'));
    if (name !== 'screen') {
      const labels = {
        answers: 'Odpowiedzi',
        results: 'Wyniki i monitoring',
        people: 'Uczestnicy',
        questions: 'Pytania i ustawienia',
        contest: 'Przebieg konkursu',
      };
      await page.getByRole('button', { name: labels[name], exact: true }).click();
    }
    pages[name] = page;
  }
  return pages;
}
function startBot(socket, questionId, end, metrics) {
  let revision = metrics.revisionBase;
  return (async () => {
    while (performance.now() < end) {
      const delay = randomInt(1, 1001);
      metrics.delays.push(delay);
      await sleep(delay);
      if (performance.now() >= end) break;
      const start = performance.now();
      const op = {
        questionId,
        operationId: randomUUID(),
        revision: ++revision,
        text: String(randomInt(1, 1000000)),
      };
      metrics.sent++;
      socket.timeout(15000).emit('save', op, (error, receipt) => {
        if (error) {
          metrics.errors.push(String(error));
          return;
        }
        const elapsed = performance.now() - start;
        metrics.acks.push(elapsed);
        const bucket = Math.min(
          metrics.windows.length - 1,
          Math.floor((start - metrics.start) / 10000),
        );
        metrics.windows[bucket].push(elapsed);
        if (receipt.status !== 'accepted') metrics.errors.push(receipt.status);
      });
    }
  })();
}
async function browserMetrics(pages) {
  const result = {};
  for (const [name, page] of Object.entries(pages)) {
    const raw = await page.evaluate(() => window.perf);
    result[name] = {
      framesMs: stats(raw.frames),
      framesOver50ms: raw.frames.filter((n) => n > 50).length,
      longTasksMs: stats(raw.tasks),
      errors: raw.errors,
      fetchMs: stats(raw.requests.map((r) => r.ms)),
      failedRequests: raw.requests.filter((r) => r.status >= 400),
    };
  }
  return result;
}
async function seedHistory(database, seconds) {
  const source = new Database(historyPath, { readonly: true });
  await source.backup(database);
  source.close();
  const db = new Database(database);
  initialSubmissionRows = db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n;
  const row = db.prepare('SELECT data FROM contest WHERE id=1').get();
  const data = row ? JSON.parse(row.data) : null;
  if (!data?.questions[data.state.index]) {
    db.close();
    throw new Error('History benchmark requires a contest with a started question.');
  }
  const { revision } = db.prepare('SELECT MAX(revision) AS revision FROM submissions').get();
  historyRevisionBase = Math.max(Date.now(), revision ?? 0);
  if (!Number.isSafeInteger(historyRevisionBase + seconds * 1000)) {
    db.close();
    throw new Error('Stored revisions leave insufficient safe integer space for this workload.');
  }
  const now = Date.now();
  data.state.phase = 'active';
  data.state.startedAt = now;
  data.state.endsAt = now + (seconds + 60) * 1000;
  data.state.closesAt = null;
  data.state.resultsAt = null;
  db.prepare('UPDATE contest SET data=? WHERE id=1').run(JSON.stringify(data));
  db.prepare('UPDATE question_windows SET endsAt=? WHERE questionId=?').run(
    data.state.endsAt,
    data.questions[data.state.index].id,
  );
  db.close();
}
async function connectBots(url, sessions, sockets) {
  for (const session of sessions) {
    const socket = io(url, {
      auth: { token: session.token },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve);
      socket.once('connect_error', reject);
    });
  }
}
async function prepare(url, seconds, sockets, database) {
  if (historyPath) {
    const db = new Database(database, { readonly: true });
    const sessions = db.prepare('SELECT token FROM participants ORDER BY id LIMIT 100').all();
    db.close();
    if (sessions.length !== 100) throw new Error('History benchmark requires 100 participants.');
    await connectBots(url, sessions, sockets);
    return (await api(url, '/api/login', '', { password })).token;
  }
  const { token } = await api(url, '/api/login', '', { password });
  await api(
    url,
    '/api/admin/config',
    token,
    {
      config: { durationSeconds: seconds + 30, revealDelaySeconds: 1, maxAnswer: '999999999' },
      questions: [{ id: '', text: 'Performance test', correct: '1000', seconds: seconds + 30 }],
    },
    'PUT',
  );
  const sessions = [];
  for (let i = 0; i < 100; i++) {
    sessions.push(
      await api(url, '/api/session', '', {
        firstName: 'Bot',
        lastName: `Test${i}`,
        nickname: `Bot${i}`,
      }),
    );
  }
  await connectBots(url, sessions, sockets);
  return token;
}
async function saveReport({
  seconds,
  metrics,
  baseline,
  loaded,
  interactions,
  pages,
  finalState,
  rows,
  bytes,
}) {
  const report = {
    seconds,
    historyPath: historyPath ?? null,
    environment: { node: process.version, cpus: cpus().length, cpu: cpus()[0].model },
    sent: metrics.sent,
    acknowledgments: stats(metrics.acks),
    errors: metrics.errors,
    delayMs: stats(metrics.delays),
    meanDelayMs: metrics.delays.reduce((a, b) => a + b, 0) / metrics.delays.length,
    windows10s: metrics.windows.map(stats),
    baseline,
    loaded,
    adminTwoTabClicksMs: stats(interactions),
    afterReveal: await browserMetrics(pages),
    finalPhase: finalState.state.phase,
    submissionRows: rows,
    initialSubmissionRows,
    databaseBytes: bytes,
  };
  await writeFile(join(output, `${seconds}s.json`), JSON.stringify(report, null, 2));
  if (
    rows !== initialSubmissionRows + metrics.sent ||
    metrics.acks.length !== metrics.sent ||
    metrics.errors.length
  ) {
    throw new Error('Load test failed: inspect report for missing/rejected submissions.');
  }
  console.log(
    JSON.stringify({
      seconds,
      sent: report.sent,
      ack: report.acknowledgments,
      errors: report.errors.length,
      rows,
      bytes,
    }),
  );
}
async function databaseCopy(seconds) {
  const directory = await mkdtemp(join(tmpdir(), 'estimathon-performance-'));
  const database = join(directory, 'contest.sqlite');
  if (historyPath) await seedHistory(database, seconds);
  return database;
}
function workloadMetrics(seconds) {
  return {
    revisionBase: historyRevisionBase,
    start: performance.now(),
    sent: 0,
    acks: [],
    delays: [],
    errors: [],
    windows: Array.from({ length: Math.ceil(seconds / 10) }, () => []),
  };
}
async function startContest(url, token) {
  if (!historyPath) await api(url, '/api/admin/command', token, { command: 'start' });
  return api(url, '/api/state', '', undefined, 'GET');
}
async function run(seconds) {
  const database = await databaseCopy(seconds);
  const child = spawn(process.execPath, ['dist/server/index.js'], {
    env: {
      ...process.env,
      HOST: '127.0.0.1',
      PORT: '0',
      DATABASE_PATH: database,
      ADMIN_PASSWORD: password,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let logs = '';
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  const sockets = [];
  let browser;
  try {
    for (let i = 0; i < 100 && !logs.includes('Server listening'); i++) await sleep(100);
    const url = logs.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0];
    if (!url) throw new Error(`Server did not start: ${logs}`);
    const token = await prepare(url, seconds, sockets, database);
    browser = await chromium.launch({
      args: [
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
      ],
    });
    const pages = await openPages(browser, url, token);
    await sleep(3000);
    const baseline = await browserMetrics(pages);
    for (const page of Object.values(pages)) {
      await page.evaluate(() => {
        window.perf = { frames: [], tasks: [], errors: [], requests: [] };
      });
    }
    const state = await startContest(url, token);
    const metrics = workloadMetrics(seconds);
    const end = metrics.start + seconds * 1000;
    const interactions = [];
    const probe = setInterval(async () => {
      const start = performance.now();
      try {
        await pages.contest.getByRole('button', { name: 'Uczestnicy', exact: true }).click();
        await pages.contest.getByRole('button', { name: 'Przebieg konkursu', exact: true }).click();
        interactions.push(performance.now() - start);
      } catch (error) {
        metrics.errors.push(`Interaction: ${error}`);
      }
    }, 5000);
    console.log(`START ${seconds}s: 100 bots, database ${database}`);
    await Promise.all(sockets.map((socket) => startBot(socket, state.question.id, end, metrics)));
    clearInterval(probe);
    await sleep(2000);
    const loaded = await browserMetrics(pages);
    await api(url, '/api/admin/command', token, { command: 'finish' });
    await sleep(8500);
    const finalState = await api(url, '/api/state', '', undefined, 'GET');
    const db = new Database(database, { readonly: true });
    const rows = db.prepare('SELECT COUNT(*) AS count FROM submissions').get().count;
    const bytes =
      db.pragma('page_count', { simple: true }) * db.pragma('page_size', { simple: true });
    db.close();
    await saveReport({
      seconds,
      metrics,
      baseline,
      loaded,
      interactions,
      pages,
      finalState,
      rows,
      bytes,
    });
  } finally {
    for (const socket of sockets) socket.disconnect();
    await browser?.close();
    child.kill('SIGTERM');
    await new Promise((resolve) => child.once('exit', resolve));
    await writeFile(join(output, `${seconds}s-server.log`), logs);
  }
}
for (const seconds of durations) await run(seconds);
