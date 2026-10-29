/** Full-body HTTP timings, variant-specific read probes and expected error responses under load. */
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';

function requestOptions(spec) {
  return {
    method: spec.method ?? 'GET',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${spec.token ?? ''}` },
    ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
    signal: AbortSignal.timeout(20000),
  };
}
function expectedStatus(spec, status) {
  const expected = spec.status ?? 200;
  return Array.isArray(expected) ? expected.includes(status) : expected === status;
}
/** Measure a complete HTTP response and validate its expected status.
 *
 * Args:
 *   context: Origin, phase and result collectors.
 *   spec: Request and expected status.
 * Returns:
 *   Parsed JSON/text, or null on a recorded failure.
 */
export async function request(context, spec) {
  const { url, records, failures } = context;
  const start = performance.now();
  try {
    const response = await fetch(url + spec.path, {
      ...requestOptions(spec),
    });
    const headersMs = performance.now() - start;
    const body = await response.text();
    const completeMs = performance.now() - start;
    const record = {
      name: spec.name,
      path: spec.path,
      stage: context.stage,
      status: response.status,
      ms: completeMs,
      headersMs,
      bytes: Buffer.byteLength(body),
      at: Date.now(),
    };
    records.push(record);
    if (!expectedStatus(spec, response.status)) {
      failures.push(
        `${spec.name}: expected ${spec.status ?? 200}, got ${response.status}: ${body.slice(0, 120)}`,
      );
    }
    return response.headers.get('content-type')?.includes('application/json')
      ? JSON.parse(body)
      : body;
  } catch (error) {
    failures.push(`${spec.name}: ${error.message}`);
    records.push({
      name: spec.name,
      stage: context.stage,
      ms: performance.now() - start,
      error: error.message,
    });
    return null;
  }
}

/** Describe the read workload for the current contest.
 *
 * Args:
 *   context: Host and participant fixtures.
 * Returns:
 *   Request specifications.
 */
export function readSpecs(context) {
  const { token, sessions, questionId, initialRows, review } = context;
  const admin = (name, path) => ({ name, path: '/api/admin/' + path, token });
  return [
    { name: 'state', path: '/api/state' },
    admin('overview', 'overview'),
    admin('answers-first', 'answers?page=1'),
    admin('answers-last', 'answers?page=999999'),
    admin('monitor-default-late', 'results?lateOnly=true&minimumSeconds=3'),
    admin('monitor-all', 'results?lateOnly=false'),
    admin('monitor-deep', `results?auditPage=${Math.max(1, Math.ceil(initialRows / 100))}`),
    admin('monitor-value', 'results?value=99'),
    admin(
      'monitor-person',
      `results?participant=${encodeURIComponent(sessions[0].participant.nickname)}`,
    ),
    admin('monitor-question', `results?questionId=${questionId}`),
    admin('reviews', `reviews/${review.participantId}/${review.operationId}?page=2`),
    {
      name: 'recover',
      path: '/api/recover',
      method: 'POST',
      body: { code: sessions[0].recoveryCode },
    },
    {
      name: 'recover-missing',
      path: '/api/recover',
      method: 'POST',
      body: { code: 'missing' },
      status: 404,
    },
    { name: 'admin-unauthorized', path: '/api/admin/overview', status: 401 },
    { name: 'personal-unauthorized', path: '/api/results', status: 401 },
    {
      name: 'personal-results',
      path: '/api/results',
      token: sessions[0].token,
      status: [200, 409],
    },
  ];
}

/** Repeat concurrent endpoint probes until stopped.
 *
 * Args:
 *   context: Live contest context.
 *   control: Shared stop state.
 * Returns:
 *   Resolves when stopped.
 */
export async function readLoop(context, control) {
  while (!control.stop) {
    const start = performance.now();
    // Independent clients request these variants concurrently, exposing head-of-line blocking.
    await Promise.all(readSpecs(context).map((spec) => request(context, spec)));
    await sleep(Math.max(0, 2500 - (performance.now() - start)));
  }
}

/** Exercise moderation and registration while writes are enabled.
 *
 * Args:
 *   context: Live contest context.
 *   control: Shared stop/write state.
 * Returns:
 *   Resolves when stopped.
 */
export async function writeLoop(context, control) {
  let iteration = 0;
  while (!control.stop) {
    await sleep(10000);
    if (control.stop || !control.writes) break;
    iteration++;
    await request(context, {
      name: 'moderation',
      path: '/api/admin/review',
      method: 'POST',
      token: context.token,
      body: { ...context.review, excluded: iteration % 2 === 1, reason: 'Load-test review' },
    });
    await request(context, {
      name: 'join',
      path: '/api/session',
      method: 'POST',
      body: { firstName: 'New', lastName: 'Arrival', nickname: `Arrival${iteration}` },
    });
  }
}

/** Time a host contest command.
 *
 * Args:
 *   context: Live contest context.
 *   name: Contest command.
 * Returns:
 *   The measured request result.
 */
export async function command(context, name) {
  return request(context, {
    name: `command-${name}`,
    path: '/api/admin/command',
    method: 'POST',
    token: context.token,
    body: { command: name },
  });
}

/** Group request timing and status statistics by variant.
 *
 * Args:
 *   records: Individual HTTP samples.
 *   summarize: Percentile calculator.
 * Returns:
 *   Metric summaries keyed by request name.
 */
export function httpSummary(records, summarize) {
  const result = {};
  for (const name of new Set(records.map((r) => r.name))) {
    const rows = records.filter((r) => r.name === name);
    result[name] = {
      fullBodyMs: summarize(rows.map((r) => r.ms)),
      statuses: Object.fromEntries(
        [...new Set(rows.map((r) => String(r.status ?? 'error')))].map((status) => [
          status,
          rows.filter((r) => String(r.status ?? 'error') === status).length,
        ]),
      ),
      maxBytes: Math.max(...rows.map((r) => r.bytes ?? 0)),
    };
  }
  return result;
}
