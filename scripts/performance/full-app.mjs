/** Full production workload on disposable databases. Run from repo root after pnpm build.
 * PERF_DATABASE_PATH=... node scripts/performance/full-app.mjs fresh:10 history:60 revealed:60 endurance:600
 * 100 bots (95 WebSocket, five polling), four real play browsers, projector, eight host views.
 * All mutations affect temporary databases only. Results persist outside Playwright cleanup.
 */
import { fork } from 'node:child_process';
import { randomInt, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, readdir, readFile } from 'node:fs/promises';
import { tmpdir, cpus } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import Database from 'better-sqlite3';
import { io } from 'socket.io-client';
const { openBrowsers, clearBrowserMetrics, drivePlayer, driveAdmin, browserSummary } = await import(
  pathToFileURL(resolve('scripts/performance/browser-probes.mjs')).href
);
const { request, readLoop, writeLoop, command, httpSummary } = await import(
  pathToFileURL(resolve('scripts/performance/http-probes.mjs')).href
);
const password = 'broad-performance-password';
const sourcePath = process.env['PERF_DATABASE_PATH'];
const scenarios = (
  process.argv.slice(2).length
    ? process.argv.slice(2)
    : ['fresh:10', 'history:60', 'revealed:60', 'endurance:600']
).map((entry) => {
  const [kind, duration] = entry.split(':');
  const seconds = Number(duration);
  if (
    !['fresh', 'history', 'revealed', 'endurance'].includes(kind) ||
    !Number.isInteger(seconds) ||
    seconds < 5 ||
    seconds > 3600
  )
    throw new Error(`Invalid scenario: ${entry}`);
  if (kind !== 'fresh' && !sourcePath)
    throw new Error('Set PERF_DATABASE_PATH to a synthetic history database.');
  return { kind, seconds };
});
function stats(values) {
  const a = [...values].sort((a, b) => a - b);
  const percentile = (p) => a[Math.min(a.length - 1, Math.floor(a.length * p))] ?? 0;
  return {
    count: a.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: percentile(1),
  };
}
async function makeDatabase(scenario) {
  const directory = await mkdtemp(join(tmpdir(), 'full-app-performance-'));
  const path = join(directory, 'contest.sqlite');
  if (scenario.kind === 'fresh') return { directory, path, initialRows: 0 };
  const source = new Database(sourcePath, { readonly: true });
  await source.backup(path);
  source.close();
  const db = new Database(path);
  const initialRows = db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n;
  const data = JSON.parse(db.prepare('SELECT data FROM contest WHERE id=1').get().data);
  const index = data.state.index;
  if (!data.questions[index]) throw new Error('History fixture must have a started question.');
  const now = Date.now();
  const median = db
    .prepare('SELECT receivedAt FROM submissions ORDER BY receivedAt LIMIT 1 OFFSET ?')
    .get(Math.floor(initialRows / 2)).receivedAt;
  const revealed = scenario.kind === 'revealed';
  const endsAt = revealed ? median : now + (scenario.seconds + 300) * 1000;
  data.config.revealDelaySeconds = 1;
  data.questions.push({
    id: randomUUID(),
    text: 'Second performance question',
    correct: '1000',
    seconds: 1200,
  });
  Object.assign(data.state, {
    phase: revealed ? 'results' : 'active',
    endsAt,
    closesAt: revealed ? endsAt + 1000 : null,
    resultsAt: revealed ? now - 9000 : null,
  });
  db.prepare('UPDATE contest SET data=? WHERE id=1').run(JSON.stringify(data));
  db.prepare('UPDATE question_windows SET endsAt=? WHERE questionId=?').run(
    endsAt,
    data.questions[index].id,
  );
  db.close();
  return { directory, path, initialRows };
}
async function launch(database) {
  const resources = [];
  let log = '';
  const child = fork(resolve('scripts/performance/server.mjs'), [database.path, password], {
    execArgv: [],
    env: { ...process.env, NODE_ENV: 'production' },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  child.stdout.on('data', (chunk) => {
    log += chunk;
  });
  child.stderr.on('data', (chunk) => {
    log += chunk;
  });
  child.on('message', (message) => {
    if (message.resource) resources.push(message.resource);
  });
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Server startup timeout: ${log.slice(-1000)}`)),
      30000,
    );
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error(`Server exited ${code}: ${log.slice(-1000)}`)));
    child.on('message', (message) => {
      if (message.url) {
        clearTimeout(timer);
        resolve(message.url);
      }
    });
  });
  return { child, url, resources, logs: () => log };
}
async function register(context, name) {
  return request(context, {
    name: 'setup-join',
    path: '/api/session',
    method: 'POST',
    body: { firstName: name, lastName: 'Load', nickname: name },
  });
}
async function configure(context) {
  const questions = [0, 1].map((n) => ({
    id: '',
    text: `Performance question ${n + 1}`,
    correct: '1000',
    seconds: context.scenario.seconds + 300,
  }));
  for (let i = 0; i < 3; i++)
    await request(context, {
      name: 'config-save',
      path: '/api/admin/config',
      method: 'PUT',
      token: context.token,
      body: {
        questions,
        config: { durationSeconds: 1200, revealDelaySeconds: 1, maxAnswer: '999999999' },
      },
    });
  await command(context, 'start');
}
async function identitySetup(context) {
  const auth = await request(context, {
    name: 'login',
    path: '/api/login',
    method: 'POST',
    body: { password },
  });
  context.token = auth.token;
  await request(context, {
    name: 'login-denied',
    path: '/api/login',
    method: 'POST',
    body: { password: 'wrong' },
    status: 401,
  });
  const other = await request(context, {
    name: 'login',
    path: '/api/login',
    method: 'POST',
    body: { password },
  });
  await request(context, {
    name: 'logout',
    path: '/api/admin/logout',
    method: 'POST',
    token: other.token,
    body: {},
  });
  if (context.scenario.kind === 'fresh') {
    context.sessions = [];
    for (let i = 0; i < 100; i++) context.sessions.push(await register(context, `Bot${i}`));
    await configure(context);
  } else {
    const db = new Database(context.path, { readonly: true });
    context.sessions = db
      .prepare('SELECT * FROM participants ORDER BY id LIMIT 100')
      .all()
      .map((row) => {
        const { token, recoveryCode, ...participant } = row;
        return { token, recoveryCode, participant };
      });
    db.close();
  }
  if (context.sessions.length !== 100) throw new Error('Expected 100 bot identities.');
  context.players = [];
  for (let i = 0; i < 4; i++) context.players.push(await register(context, `Browser${i}`));
  const state = await request(context, { name: 'setup-state', path: '/api/state' });
  context.questionId = state.question.id;
  context.revision = Date.now();
}
async function connect(context) {
  for (let i = 0; i < context.sessions.length; i++) {
    const transport = i < 5 ? 'polling' : 'websocket';
    const socket = io(context.url, {
      auth: { token: context.sessions[i].token },
      transports: [transport],
      reconnection: false,
    });
    context.sockets.push(socket);
    const start = performance.now();
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Socket connect timeout')), 15000);
      socket.once('connect', () => {
        clearTimeout(timer);
        resolve();
      });
      socket.once('connect_error', reject);
    });
    context.connections.push({ transport, ms: performance.now() - start });
    socket.on('disconnect', (reason) => {
      if (!context.control.stop)
        context.failures.push(`Unexpected ${transport} disconnect: ${reason}`);
    });
  }
  const primer = {
    questionId: context.questionId,
    operationId: randomUUID(),
    revision: context.revision,
    text: '1000',
  };
  const receipt = await context.sockets[0].timeout(20000).emitWithAck('save', primer);
  if (receipt.status !== 'accepted') throw new Error('Primer edit was not accepted.');
  context.savedIds.add(primer.operationId);
  context.review = {
    participantId: context.sessions[0].participant.id,
    operationId: primer.operationId,
  };
  for (let i = 0; i < 25; i++)
    await request(context, {
      name: 'setup-review',
      path: '/api/admin/review',
      method: 'POST',
      token: context.token,
      body: { ...context.review, excluded: false, reason: `Review ${i}` },
    });
}
async function staticRequests(context) {
  const assets = await readdir(resolve('dist/client/assets'));
  context.staticSpecs = [
    '/',
    '/play',
    '/screen',
    '/admin',
    ...assets.map((p) => '/assets/' + p),
  ].map((path) => ({ name: 'static-' + path, path }));
  const css = await readFile(
    resolve(
      'dist/client/assets',
      assets.find((p) => p.endsWith('.css')),
    ),
    'utf8',
  );
  const font = css.match(/\/fonts\/[^)"']+/)?.[0];
  if (font) context.staticSpecs.push({ name: 'static-font', path: font });
  await Promise.all(context.staticSpecs.map((spec) => request(context, spec)));
  await request(context, { name: 'missing-route', path: '/not-a-route', status: 404 });
}
async function bot(context, socket, index) {
  let revision = context.revision;
  let nextSnapshot = 0;
  while (!context.control.stop) {
    const delay = randomInt(1, 1001);
    context.delays.push(delay);
    await sleep(delay);
    if (context.control.stop) break;
    const start = performance.now();
    const stage = context.stage;
    const operationId = randomUUID();
    context.sent++;
    socket.timeout(20000).emit(
      'save',
      {
        questionId: context.questionId,
        operationId,
        revision: ++revision,
        text: String(randomInt(1, 1000000)),
      },
      (error, receipt) => {
        if (error) {
          context.failures.push(`Bot acknowledgment: ${error.message}`);
          return;
        }
        context.acks.push({
          stage,
          transport: index < 5 ? 'polling' : 'websocket',
          ms: performance.now() - start,
          status: receipt.status,
          at: start,
        });
        if (['accepted', 'paused'].includes(receipt.status)) context.savedIds.add(operationId);
        else if (receipt.status !== 'invalid' || (stage !== 'reset' && context.stage !== 'reset')) {
          context.failures.push(`Unexpected receipt ${receipt.status} in ${stage}`);
        }
      },
    );
    if (start >= nextSnapshot) {
      nextSnapshot = start + 15000;
      const snapshotStart = performance.now();
      socket.timeout(20000).emit('snapshot', (error) => {
        if (error) context.failures.push(`Snapshot: ${error.message}`);
        else context.snapshots.push(performance.now() - snapshotStart);
      });
    }
  }
}
async function staticLoop(context) {
  while (!context.control.stop) {
    await Promise.all(context.staticSpecs.map((spec) => request(context, spec)));
    await sleep(5000);
  }
}
async function waitPhase(context, phase) {
  const deadline = performance.now() + 30000;
  while (performance.now() < deadline) {
    const state = await request(context, { name: 'phase-check', path: '/api/state' });
    if (state?.state.phase === phase) return state;
    await sleep(100);
  }
  throw new Error(`Contest did not enter ${phase}.`);
}
async function commandToUi(context, name, condition) {
  const start = performance.now();
  await command(context, name);
  const pages = Object.entries(context.pages).filter(
    ([key]) => key === 'screen' || key.startsWith('play'),
  );
  await Promise.all(
    pages.map(async ([pageName, page]) => {
      await page.waitForFunction(condition, undefined, { timeout: 20000 });
      context.transitions.push({ command: name, page: pageName, ms: performance.now() - start });
    }),
  );
}
async function exerciseQr(context) {
  const start = performance.now();
  const page = context.pages.people;
  await page.getByRole('button', { name: 'Kod QR', exact: true }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Kod odzyskiwania' });
  await dialog.getByRole('img').waitFor({ state: 'visible' });
  const ms = performance.now() - start;
  await dialog.getByRole('button', { name: 'Zamknij', exact: true }).click();
  return ms;
}
async function mainPhase(context) {
  await request(context, {
    name: 'config-locked',
    path: '/api/admin/config',
    method: 'PUT',
    token: context.token,
    body: {},
    status: 400,
  });
  const temporary = await request(context, {
    name: 'login-under-load',
    path: '/api/login',
    method: 'POST',
    body: { password },
  });
  await request(context, {
    name: 'logout-under-load',
    path: '/api/admin/logout',
    method: 'POST',
    token: temporary.token,
    body: {},
  });
  context.stage = context.scenario.kind === 'revealed' ? 'revealed' : 'active';
  context.control.editing = context.stage === 'active';
  const part = (context.scenario.seconds * 1000) / 3;
  if (context.stage === 'revealed') {
    await sleep(part * 3);
    return;
  }
  await sleep(part);
  context.control.editing = false;
  await commandToUi(context, 'pause', () => {
    const input = document.querySelector('#estimate');
    return input
      ? input.disabled
      : document.querySelector('.screen-question')?.textContent.includes('Przerwa');
  });
  await sleep(300);
  await commandToUi(context, 'resume', () => {
    const input = document.querySelector('#estimate');
    return input
      ? !input.disabled
      : !document.querySelector('.screen-question')?.textContent.includes('Przerwa');
  });
  context.control.editing = true;
  await sleep(part);
  await command(context, 'extend');
  await sleep(part);
}
/** Emulate the other participants' personal-results refreshes on final-state broadcasts. */
async function finalFanout(context) {
  if (context.scenario.kind !== 'endurance') {
    await sleep(10000);
    return;
  }
  const pending = new Set();
  const handler = (snapshot) => {
    if (snapshot.state.phase !== 'finished') return;
    const batch = Promise.all(
      context.sessions.map((session) =>
        request(context, {
          name: 'personal-results-fanout',
          path: '/api/results',
          token: session.token,
        }),
      ),
    );
    pending.add(batch);
    void batch.finally(() => pending.delete(batch));
  };
  context.sockets[0].on('state', handler);
  await sleep(10000);
  context.sockets[0].off('state', handler);
  await Promise.all(pending);
}
async function lifecycle(context) {
  context.control.editing = false;
  if (context.stage !== 'revealed') {
    await command(context, 'next');
    await waitPhase(context, 'results');
  }
  context.stage = 'revealed';
  await clearBrowserMetrics(context.pages);
  await sleep(10000);
  context.browserPhases.revealed = await browserSummary(context.pages, stats);
  await clearBrowserMetrics(context.pages);
  await command(context, 'next');
  await waitPhase(context, 'active');
  context.stage = 'next-question';
  context.control.editing = true;
  await sleep(5000);
  context.control.editing = false;
  context.browserPhases.nextQuestion = await browserSummary(context.pages, stats);
  await command(context, 'finish');
  await waitPhase(context, 'finished');
  context.stage = 'finished';
  await clearBrowserMetrics(context.pages);
  await finalFanout(context);
  context.browserPhases.finished = await browserSummary(context.pages, stats);
  await clearBrowserMetrics(context.pages);
  context.control.writes = false;
  const response = await request(context, {
    name: 'contest-reset',
    path: '/api/admin/reset',
    method: 'POST',
    token: context.token,
    body: { confirmed: true },
  });
  context.backup = join(context.directory, response.backup);
  context.stage = 'reset';
  const overview = await request(context, {
    name: 'reset-overview',
    path: '/api/admin/overview',
    token: context.token,
  });
  await request(context, {
    name: 'config-save-after-reset',
    path: '/api/admin/config',
    method: 'PUT',
    token: context.token,
    body: { questions: overview.questions, config: overview.config },
  });
  await sleep(3000);
  context.browserPhases.reset = await browserSummary(context.pages, stats);
}
async function validate(context) {
  const db = new Database(context.backup, { readonly: true });
  const stored = new Set(
    db
      .prepare('SELECT operationId FROM submissions')
      .all()
      .map((r) => r.operationId),
  );
  const missing = [...context.savedIds].filter((id) => !stored.has(id));
  const count = db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n;
  const integrity = db.pragma('integrity_check', { simple: true });
  db.close();
  if (missing.length)
    context.failures.push(`${missing.length} acknowledged edits missing from reset backup`);
  if (integrity !== 'ok') context.failures.push(`Integrity check: ${integrity}`);
  return {
    initialRows: context.initialRows,
    beforeResetRows: count,
    verifiedBotOperations: context.savedIds.size,
    missingOperations: missing.length,
    integrity,
  };
}
function socketSummary(context) {
  const result = {};
  for (const stage of new Set(context.acks.map((a) => a.stage))) {
    const rows = context.acks.filter((a) => a.stage === stage);
    result[stage] = {
      ms: stats(rows.map((a) => a.ms)),
      statuses: Object.fromEntries(
        [...new Set(rows.map((a) => a.status))].map((status) => [
          status,
          rows.filter((a) => a.status === status).length,
        ]),
      ),
    };
  }
  const windowCount = Math.ceil((performance.now() - context.loadStart) / 10000);
  return {
    windows10s: Array.from({ length: windowCount }, (_, i) => {
      const rows = context.acks.filter((a) => Math.floor((a.at - context.loadStart) / 10000) === i);
      return { second: i * 10, ms: stats(rows.map((a) => a.ms)) };
    }),
    byStage: result,
    byTransport: Object.fromEntries(
      ['polling', 'websocket'].map((transport) => [
        transport,
        stats(context.acks.filter((a) => a.transport === transport).map((a) => a.ms)),
      ]),
    ),
    snapshotsMs: stats(context.snapshots),
    connectionsMs: stats(context.connections.map((a) => a.ms)),
  };
}
async function save(context, resource, generatorLag, output) {
  resource = resource.filter((sample) => sample.at >= context.loadAt);
  const validation = await validate(context);
  if (context.sent !== context.acks.length)
    context.failures.push('Not all bot operations were acknowledged.');
  const report = {
    scenario: context.scenario,
    finalResultsFanout: context.scenario.kind === 'endurance',
    browserProfiles: { 'play-mobile-3': '390x844 with 4x CPU throttle' },
    qrVisibleMs: context.qrMs,
    machine: { node: process.version, cpu: cpus()[0].model, logicalCpus: cpus().length },
    databaseCopy: context.path,
    validation,
    sent: context.sent,
    acknowledged: context.acks.length,
    delaysMs: stats(context.delays),
    sockets: socketSummary(context),
    http: httpSummary(context.records, stats),
    httpByStage: Object.fromEntries(
      [...new Set(context.records.map((r) => r.stage))].map((stage) => [
        stage,
        httpSummary(
          context.records.filter((r) => r.stage === stage),
          stats,
        ),
      ]),
    ),
    browsers: context.browserPhases,
    adminClicksMs: stats(context.clicks),
    transitions: context.transitions,
    resources: {
      rssMB: stats(resource.map((r) => r.rssMB)),
      cpuPercent: stats(resource.map((r) => r.cpuPercent)),
      eventLoopMaxMs: stats(resource.map((r) => r.loopMaxMs)),
      eventLoopP99Ms: stats(resource.map((r) => r.loopP99Ms)),
    },
    generatorLoopMaxMs: generatorLag.max / 1e6,
    failures: context.failures,
  };
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
  await writeFile(join(output, 'http-samples.json'), JSON.stringify(context.records));
  await writeFile(join(output, 'resource-samples.json'), JSON.stringify(resource));

  console.log(
    JSON.stringify({
      scenario: context.scenario,
      sent: context.sent,
      sockets: report.sockets.byStage,
      failures: context.failures.length,
    }),
  );
  if (context.failures.length)
    throw new Error(`Scenario has ${context.failures.length} failures; inspect ${output}`);
}
function progressReport(context, server) {
  return setInterval(() => {
    const recent = context.acks.filter((a) => a.at > performance.now() - 10000);
    console.log(
      JSON.stringify({
        progress: context.scenario.kind,
        stage: context.stage,
        acknowledged: context.acks.length,
        recentSaveMs: stats(recent.map((a) => a.ms)),
        server: server.resources.at(-1),
      }),
    );
  }, 30000);
}
async function scenario(spec) {
  const database = await makeDatabase(spec);
  const output = resolve('performance-results/full-app', `${spec.kind}-${spec.seconds}s`);
  await mkdir(output, { recursive: true });
  const server = await launch(database);
  const context = {
    ...database,
    scenario: spec,
    url: server.url,
    records: [],
    failures: [],
    stage: 'setup',
    control: { stop: false, editing: false, writes: true },
    sockets: [],
    connections: [],
    acks: [],
    snapshots: [],
    delays: [],
    sent: 0,
    savedIds: new Set(),
    clicks: [],
    transitions: [],
    browserPhases: {},
  };
  let browser;
  let progress;
  const lag = monitorEventLoopDelay({ resolution: 10 });
  const jobs = [];
  try {
    await identitySetup(context);
    await connect(context);
    await staticRequests(context);
    const opened = await openBrowsers(context.url, context.token, context.players);
    browser = opened.browser;
    context.pages = opened.pages;
    context.browserPhases.idle = await browserSummary(context.pages, stats);
    await clearBrowserMetrics(context.pages);
    context.stage = spec.kind === 'revealed' ? 'revealed' : 'active';
    context.control.editing = context.stage === 'active';
    context.loadStart = performance.now();
    context.loadAt = Date.now();
    lag.enable();
    jobs.push(
      ...context.sockets.map((socket, i) => bot(context, socket, i)),
      readLoop(context, context.control),
      writeLoop(context, context.control),
      staticLoop(context),
      driveAdmin(context.pages, context.control, context.clicks, context.failures),
    );
    for (const [name, page] of Object.entries(context.pages)) {
      if (name.startsWith('play')) jobs.push(drivePlayer(page, context.control, context.failures));
    }
    console.log(
      `START ${spec.kind}:${spec.seconds}, ${database.initialRows} revisions, ${context.url}`,
    );
    progress = progressReport(context, server);
    context.qrMs = await exerciseQr(context);
    await mainPhase(context);
    context.browserPhases.main = await browserSummary(context.pages, stats);
    await lifecycle(context);
    context.control.stop = true;
    await Promise.all(jobs);
    await sleep(1000);
    await save(context, server.resources, lag, output);
  } finally {
    clearInterval(progress);
    context.control.stop = true;
    for (const socket of context.sockets) socket.disconnect();
    lag.disable();
    await browser?.close();
    server.child.kill('SIGTERM');
    await new Promise((resolve) => server.child.once('exit', resolve));
    await writeFile(join(output, 'server.log'), server.logs());
  }
}
for (const spec of scenarios) await scenario(spec);
