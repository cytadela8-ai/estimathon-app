/** Load an existing contest without host access or lifecycle changes.
 * Run: node scripts/performance/live-bots.mjs http://localhost:3000 600
 * Creates 100 test participants, waits for an active question, then runs for the given seconds.
 * Answers are uniform integers 1–999999; edits use independent 1–1000 ms delays.
 * Each participant performs normal resource loads, Socket.IO subscriptions, snapshots and retries.
 * See participant-bot.mjs for the automatic play/results network model; no browser UI is rendered.
 */
import { randomInt, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
const { ParticipantBot, participantMetrics } = await import(
  pathToFileURL(resolve('scripts/performance/participant-bot.mjs')).href
);
const { loadPlayResources } = await import(
  pathToFileURL(resolve('scripts/performance/player-resources.mjs')).href
);
const url = new URL(process.argv[2] ?? 'http://localhost:3000');
const seconds = Number(process.argv[3] ?? 600);
if (!['http:', 'https:'].includes(url.protocol) || url.pathname !== '/') {
  throw new Error('Supply the server origin, such as http://localhost:3000, without a page path.');
}
if (!Number.isInteger(seconds) || seconds < 1 || seconds > 3600) {
  throw new Error('Duration must be an integer from 1 to 3600 seconds.');
}
const bots = [];
const metrics = participantMetrics();
let stopped = false;
process.on('SIGINT', () => {
  stopped = true;
});
process.on('SIGTERM', () => {
  stopped = true;
});
async function connectBot(index, prefix) {
  await loadPlayResources(url.origin, metrics);
  const guest = new ParticipantBot({ origin: url.origin, metrics });
  let session;
  try {
    await guest.connect();
    const response = await fetch(url.origin + '/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ firstName: 'Load', lastName: 'Bot', nickname: `${prefix}-${index}` }),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new Error(`Bot registration failed: HTTP ${response.status}.`);
    session = await response.json();
  } finally {
    guest.close();
  }
  await loadPlayResources(url.origin, metrics);
  const bot = new ParticipantBot({ origin: url.origin, token: session.token, metrics });
  bots.push(bot);
  await bot.connect();
}
async function waitForStart() {
  console.log(
    '100 bots connected. Waiting for an active question; use /admin to reset/start if needed.',
  );
  const timeout = performance.now() + 600000;
  while (!stopped && !bots.some((bot) => bot.snapshot?.state.phase === 'active')) {
    if (performance.now() >= timeout) throw new Error('No active question after ten minutes.');
    await sleep(200);
  }
}
async function editLoop(bot, deadline) {
  while (!stopped && performance.now() < deadline) {
    await sleep(randomInt(1, 1001));
    if (stopped || performance.now() >= deadline) break;
    bot.edit(String(randomInt(1, 1000000)));
  }
}
function report() {
  const latencies = metrics.latencies.toSorted((a, b) => a - b);
  const percentile = (p) =>
    latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * p))] ?? 0;
  console.log(
    JSON.stringify(
      {
        sent: metrics.sent,
        accepted: metrics.accepted,
        paused: metrics.paused,
        errors: metrics.errors,
        connectedBots: bots.filter((bot) => bot.socket.connected).length,
        pendingEdits: bots.reduce((total, bot) => total + bot.pending.size, 0),
        automaticTraffic: {
          stateEvents: metrics.stateEvents,
          answerEvents: metrics.answerEvents,
          snapshots: metrics.snapshots,
          snapshotFailures: metrics.snapshotFailures,
          connections: metrics.connections,
          disconnects: metrics.disconnects,
          connectErrors: metrics.connectErrors,
          saveTimeouts: metrics.saveTimeouts,
          retries: metrics.retries,
          stale: metrics.stale,
          invalid: metrics.invalid,
          resultRequests: metrics.resultRequests,
          resultErrors: metrics.resultErrors,
          resourceRequests: metrics.resourceRequests,
          resourceBytes: metrics.resourceBytes,
          lastResultError: metrics.lastResultError,
          lastSnapshotError: metrics.lastSnapshotError,
          lastSaveError: metrics.lastSaveError,
          lastConnectError: metrics.lastConnectError,
        },
        acknowledgmentMs: {
          p50: percentile(0.5),
          p95: percentile(0.95),
          p99: percentile(0.99),
          max: percentile(1),
        },
      },
      null,
      2,
    ),
  );
  if (metrics.errors) process.exitCode = 1;
}
async function run() {
  let progress;
  try {
    const prefix = 'Load-' + randomUUID().slice(0, 8);
    for (let i = 0; i < 100 && !stopped; i++) await connectBot(i, prefix);
    if (stopped) return;
    await waitForStart();
    if (stopped) return;
    console.log(`Running 100 bots against ${url.origin} for ${seconds}s. Ctrl+C stops the load.`);
    progress = setInterval(
      () =>
        console.log(`Sent ${metrics.sent}; accepted ${metrics.accepted}; errors ${metrics.errors}`),
      10000,
    );
    const deadline = performance.now() + seconds * 1000;
    await Promise.all(bots.map((bot) => editLoop(bot, deadline)));
    for (const bot of bots) bot.stopAutomaticTraffic();
    while (metrics.pending) await sleep(50);
    await Promise.all(bots.flatMap((bot) => [...bot.resultJobs]));
    report();
  } finally {
    stopped = true;
    clearInterval(progress);
    for (const bot of bots) bot.close();
  }
}
await run();
