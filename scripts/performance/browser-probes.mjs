/** Real browser input handlers and persisted confirmations; wall-clock frame gaps and live state. */
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { randomInt } from 'node:crypto';
import { chromium } from '@playwright/test';
export const tabs = {
  contest: 'Przebieg konkursu',
  questions: 'Pytania i ustawienia',
  people: 'Uczestnicy',
  answers: 'Odpowiedzi',
  results: 'Wyniki i monitoring',
};
function installCoreProbe() {
  window.probe = {
    frames: [],
    tasks: [],
    errors: [],
    requests: [],
    edits: [],
    states: [],
    stateIntervals: [],
    render: [],
    inputCount: 0,
    superseded: 0,
    pending: null,
  };
  let last = performance.now();
  function frame() {
    const now = performance.now();
    window.probe.frames.push(now - last);
    last = now;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) window.probe.tasks.push(entry.duration);
  }).observe({ type: 'longtask', buffered: true });
  window.addEventListener('error', (e) => window.probe.errors.push(e.message));
  window.addEventListener('unhandledrejection', (e) => window.probe.errors.push(String(e.reason)));
}
function installEditProbe() {
  document.addEventListener(
    'input',
    (e) => {
      if (e.target.id !== 'estimate') return;
      if (window.probe.pending) window.probe.superseded++;
      window.probe.inputCount++;
      window.probe.pending = { text: e.target.value, start: performance.now() };
    },
    true,
  );
  function savedDraft(key, text, prefix) {
    if (!key?.startsWith(prefix)) return false;
    const draft = JSON.parse(localStorage.getItem(key));
    return draft.operation.text === text && !draft.pending && !draft.error;
  }
  function savedStatus() {
    return document.querySelector('.sync-status')?.textContent.includes('Zapisano na serwerze');
  }
  function confirm() {
    const pending = window.probe.pending;
    if (!pending) return;
    if (!savedStatus()) return;
    const session = JSON.parse(localStorage.getItem('estymator.session') ?? 'null');
    if (!session) return;
    const prefix = `estymator.answer.${session.participant.id}.`;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (savedDraft(key, pending.text, prefix)) {
        window.probe.edits.push(performance.now() - pending.start);
        window.probe.pending = null;
        break;
      }
    }
  }
  new MutationObserver(confirm).observe(document, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}
function installTransportProbe() {
  let previousState = 0;
  const NativeSocket = window.WebSocket;
  window.WebSocket = class extends NativeSocket {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        if (typeof event.data !== 'string' || !event.data.startsWith('42[')) return;
        const [name, snapshot] = JSON.parse(event.data.slice(2));
        if (name !== 'state') return;
        const received = performance.now();
        const now = Date.now();
        window.probe.states.push(now - snapshot.serverNow);
        if (previousState) window.probe.stateIntervals.push(now - previousState);
        previousState = now;
        requestAnimationFrame(() => window.probe.render.push(performance.now() - received));
      });
    }
  };
  const original = window.fetch;
  window.fetch = async (...args) => {
    const start = performance.now();
    const response = await original(...args);
    const record = {
      path: String(args[0]),
      status: response.status,
      headersMs: performance.now() - start,
    };
    void response
      .clone()
      .arrayBuffer()
      .then((body) => {
        record.completeMs = performance.now() - start;
        record.bytes = body.byteLength;
        window.probe.requests.push(record);
      })
      .catch((e) => window.probe.errors.push(String(e)));
    return response;
  };
}
async function openPage(browser, url, name, session, token) {
  const mobile = name.includes('mobile');
  const context = await browser.newContext({
    viewport: mobile ? { width: 390, height: 844 } : { width: 1920, height: 1080 },
    ...(mobile ? { isMobile: true, hasTouch: true } : {}),
  });
  const page = await context.newPage();
  if (name === 'play-mobile-3') {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  }
  page.setDefaultTimeout(15000);
  await page.addInitScript(`(${installCoreProbe.toString()})();
    (${installEditProbe.toString()})(); (${installTransportProbe.toString()})();`);
  await page.addInitScript(
    ({ session, token }) => {
      if (session) localStorage.setItem('estymator.session', JSON.stringify(session));
      if (token) sessionStorage.setItem('estymator.admin', token);
    },
    { session, token },
  );
  const path = name.startsWith('play') ? '/play' : name === 'screen' ? '/screen' : '/admin';
  await page.goto(url + path);
  return page;
}
async function setupAdmin(page, name) {
  if (name === 'screen') return;
  await page.getByRole('button', { name: tabs[name] ?? tabs.results, exact: true }).click();
  if (['history', 'filtered', 'deep'].includes(name)) {
    await page.getByLabel('Tylko spóźnione').uncheck();
  }
  if (name === 'filtered') await page.getByLabel('Wpisana wartość zawiera').fill('99');
  if (name === 'deep') {
    const next = page
      .getByRole('navigation', { name: 'Strony historii odpowiedzi' })
      .getByRole('button', { name: 'Następne' });
    if ((await next.count()) && (await next.isEnabled())) await next.click();
  }
}
/** Create independent production browser views.
 *
 * Args:
 *   url: Test origin.
 *   token: Host token.
 *   sessions: Four participant sessions.
 * Returns:
 *   Browser owner and named pages.
 */
export async function openBrowsers(url, token, sessions) {
  const browser = await chromium.launch({
    args: [
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows',
    ],
  });
  const pages = {};
  for (const name of [...Object.keys(tabs), 'history', 'filtered', 'deep', 'screen']) {
    const page = await openPage(browser, url, name, null, token);
    await setupAdmin(page, name);
    pages[name] = page;
  }
  for (let i = 0; i < 4; i++) {
    const name = `play-${i < 2 ? 'desktop' : 'mobile'}-${i}`;
    pages[name] = await openPage(browser, url, name, sessions[i], null);
  }
  await sleep(2500);
  return { browser, pages };
}
/** Start a new browser observation window.
 *
 * Args:
 *   pages: Named live pages.
 * Returns:
 *   Resolves after metrics are cleared.
 */
export async function clearBrowserMetrics(pages) {
  for (const page of Object.values(pages))
    await page.evaluate(() => {
      const p = window.probe;
      for (const key of [
        'frames',
        'tasks',
        'errors',
        'requests',
        'edits',
        'states',
        'stateIntervals',
        'render',
      ])
        p[key] = [];
      p.inputCount = 0;
      p.superseded = 0;
      p.pending = null;
    });
}
async function fillEditable(page, value) {
  const input = page.getByLabel('Twoja estymacja', { exact: true });
  if ((await input.count()) && (await input.isEnabled()))
    await input.fill(value, { timeout: 1000 });
}
/** Type through real input handlers until the workload stops.
 *
 * Args:
 *   page: Participant page.
 *   control: Shared stop/editing state.
 *   failures: Error collector.
 * Returns:
 *   Resolves when stopped.
 */
export async function drivePlayer(page, control, failures) {
  let value = randomInt(1000000, 2000000);
  while (!control.stop) {
    await sleep(randomInt(1, 1001));
    if (!control.editing || control.stop) continue;
    try {
      await fillEditable(page, String(++value));
    } catch (error) {
      if (control.editing) failures.push(`Player interaction: ${error.message}`);
      else control.skippedEdits = (control.skippedEdits ?? 0) + 1;
    }
  }
}
/** Measure host tab interactions until stopped.
 *
 * Args:
 *   pages: Host pages.
 *   control: Shared stop state.
 *   timings: Timing collector.
 *   failures: Error collector.
 * Returns:
 *   Resolves when stopped.
 */
export async function driveAdmin(pages, control, timings, failures) {
  while (!control.stop) {
    await sleep(5000);
    if (control.stop) break;
    const start = performance.now();
    try {
      await pages.contest.getByRole('button', { name: tabs.people, exact: true }).click();
      await pages.contest.getByRole('button', { name: tabs.contest, exact: true }).click();
      timings.push(performance.now() - start);
    } catch (error) {
      failures.push(`Admin interaction: ${error.message}`);
    }
  }
}
/** Collect bounded browser metric summaries.
 *
 * Args:
 *   pages: Named live pages.
 *   summarize: Percentile calculator.
 * Returns:
 *   Metrics keyed by page name.
 */
export async function browserSummary(pages, summarize) {
  const result = {};
  for (const [name, page] of Object.entries(pages)) {
    const p = await page.evaluate(() => window.probe);
    result[name] = {
      frameMs: summarize(p.frames),
      gapsOver50ms: p.frames.filter((n) => n > 50).length,
      gapsOver100ms: p.frames.filter((n) => n > 100).length,
      longTasksMs: summarize(p.tasks),
      inputCount: p.inputCount,
      confirmedEditsMs: summarize(p.edits),
      superseded: p.superseded,
      pendingAtCollection: Boolean(p.pending),
      stateArrivalMs: summarize(p.states),
      stateIntervalsMs: summarize(p.stateIntervals),
      nextFrameAfterStateMs: summarize(p.render),
      fetchMs: summarize(p.requests.map((r) => r.completeMs)),
      errors: p.errors,
      failedRequests: p.requests.filter((r) => r.status >= 400),
    };
  }
  return result;
}
