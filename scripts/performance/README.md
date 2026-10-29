# Full application performance test

This harness runs the compiled production app in a separate process and uses only temporary SQLite
files. Existing contest data is opened read-only and backed up before any fixture changes. No app
behavior or database durability setting is changed by the harness. Existing dependencies suffice.
Run from the repository root after building:

```bash
pnpm build
# One fresh smoke test, followed by existing-history and revealed-history tests and endurance.
PERF_DATABASE_PATH=/absolute/path/to/synthetic-contest.sqlite \
  node scripts/performance/full-app.mjs fresh:10 history:60 revealed:60 endurance:600
```

Omit scenario arguments for those defaults. A short standalone check is
`node scripts/performance/full-app.mjs fresh:10`. The history fixture requires 100 participants,
a started question and stored submissions. It is intended for synthetic load-test data. Passwords,
recovery codes and participant identities in the copy are test fixtures, not production credentials.

Each scenario has a main interval of the requested duration plus roughly 35 seconds for question
progression, late edits, finishing and reset. All bot submissions continue through those phases.
Pause/resume UI checks add a small amount of time to the nominal main interval.

## Workload

- 100 protocol bots, with independently scheduled uniform integer delays of 1–1000 ms. They do not
  wait for acknowledgments. Ninety-five use WebSockets and five use polling-only Socket.IO.
- Four additional real `/play` pages: two desktop and two mobile layouts, with actual input events,
  localStorage, synchronization and DOM confirmation. In the endurance scenario one mobile page
  uses Chromium's 4x CPU throttle. This simulates reduced CPU performance, not a physical phone.
- A real `/screen` page and eight host pages: all five sections plus unfiltered, text-filtered and
  paginated monitoring views. Ordinary page polling remains enabled. The endurance scenario also
  measures local recovery-QR generation. Earlier short scenarios preceded those added probes.
- Every 2.5 seconds, a concurrent group of HTTP clients requests public state, overview, both ends
  of counted answers, six monitoring variants (including a deep page), review history, recovery,
  personal results and expected authorization/missing-code errors. Full response bodies are read.
- Static HTML, JavaScript, CSS and a font are requested every five seconds. Additional actions
  cover login/logout, configuration save/lock, registration, moderation, start, pause/resume,
  extension, progression, finish and reset. There is one new registration and review per ten seconds.
- During the endurance scenario's final-results observation, 100 simulated participants also fetch
  personal results on every public state broadcast for ten seconds. Four browser participants keep
  their own normal refresh behavior. This specifically tests a potential results-refresh storm
  while late edits continue; it is deliberately more demanding than an idle finished contest.

`history` and `endurance` resume the source question with a future deadline, retaining old revisions.
`revealed` instead reveals it and puts its deadline near the midpoint of historical arrival times,
so roughly half the retained submissions match the late-only view. That fixture stresses populated
late filtering and score recomputation. A second question is appended to test progression and
participants editing a new question while bots still deliver to the earlier one.

## Measurements and artifacts

Outputs are isolated from Playwright cleanup in `performance-results/full-app/KIND-DURATIONs/`:

- `report.json`: per-stage Socket.IO latency/statuses, ten-second windows, per-transport latency,
  complete-body HTTP latency by route/variant and phase, browser metrics, controls, validation,
  server CPU/RSS and event-loop stalls.
- `http-samples.json`: individual HTTP timing/size/status samples, without bodies or auth headers.
- `resource-samples.json`: one-second server resource/event-loop samples.
- `server.log`: production Fastify logs, including server-side HTTP service times.

Browser frame intervals use `performance.now()` inside callbacks, rather than animation timestamps.
Long tasks use PerformanceObserver. Input-to-confirmation time ends when both the visible save
message and persisted draft show the newly typed value as confirmed. State arrival is measured
against the server snapshot timestamp on the same host; next-frame timing is not a pixel-paint
measurement. The endurance scenario additionally records intervals between state messages.
Browser `main`, `revealed`, `finished` and `reset` snapshots capture their described observation
windows; `nextQuestion` includes its transition. The first smoke test used cumulative later-phase
browser snapshots; its `main` window remains directly usable.

Before reset, the app writes its normal consistent backup. The harness verifies all bot operations
acknowledged as accepted/paused are present in that backup and runs SQLite integrity checking.
Invalid receipts after reset and paused receipts during pause are expected. Expected HTTP 400,
401, 404 and 409 responses are recorded separately from unexpected failures.

## Limits

This is loopback on one shared server/generator/browser host, not a Wi-Fi test. Four representative
play renderers are exercised, not 100 phone renderers. Query probes deliberately arrive in groups,
so client timings include queueing behind other synchronous queries. Server logs distinguish
handler time from client-observed delay. Configuration and lifecycle actions have small sample
counts; report their observed times rather than treating a single observation as a capacity bound.
CPU percent is per core (100% means one core); event-loop delay sampling has a 10 ms baseline.
Temporary files are retained at the printed/report paths. No dependencies are installed or upgraded.

## Navigation during load

While a full-app workload is running, its startup line prints the loopback origin. Measure fresh
browser contexts against that live process with:

```bash
PERF_URL=http://127.0.0.1:PORT PERF_DATABASE_PATH=/path/to/the/same/source-fixture.sqlite \
  node scripts/performance/navigation.mjs
```

The source fixture supplies one retained participant credential; no writes are made to it.
The probe opens desktop/mobile layouts for `/`, `/play`, `/screen` and `/admin`, three times each.
It records HTTP status, navigation/paint timings, heading/font/two-frame readiness and JavaScript
errors in `performance-results/full-app/navigation/report.json`. The server must still be running.

## Bots against an already running instance

```bash
node scripts/performance/live-bots.mjs http://localhost:3000 600
```

This creates 100 participants named `Load-...`, waits for an active question, and changes their
answers after independent uniform integer delays of 1–1000 ms for 600 seconds. Each answer is an
independent uniform integer from **1 through 999,999**, sent as decimal text. The question and its
correct answer do not influence the generated values; consecutive values can repeat. The configured
contest maximum must admit this range if all generated answers are to be accepted.

Each bot replicates the play screen's normal automatic participant traffic:

- Fetch `/play` and its same-origin linked JS/CSS/favicon/fonts on first arrival and post-join reload.
- Open an anonymous Socket.IO connection before joining, then authenticate a new connection after
  `POST /api/session`. Use Socket.IO's normal polling handshake, WebSocket upgrade, heartbeats and
  automatic transport reconnection instead of forcing WebSocket-only connections.
- Subscribe independently to `state` and private `answers` events. Authentication makes the server
  join that participant's answer room; the protocol has no separate subscription request.
- Request a snapshot on connection/reconnection and every 15 seconds, estimate clock offset from
  the midpoint, and reconcile accepted answers and revision watermarks (including exclusions).
- Send edits only during active answering and before the locally adjusted deadline. Include the
  same input/deadline/offset telemetry as the browser.
- Keep latest pending edits per question, including earlier questions. Retry on state updates and
  every 1.5 seconds, with the same operation ID/payload and a two-second acknowledgment timeout.
  Private answer events can confirm saves even if their direct acknowledgments are lost.
- When finished, fetch authenticated `/api/results` on entry, changed public versions and reconnect,
  with a three-second retry cadence after failures. Preserve the app's current per-version request
  behavior rather than introducing a lighter synthetic polling schedule.

The final summary includes resource, event, snapshot, reconnection, retry and personal-results
request counts, outstanding edits and latency/error diagnostics. `sent` and `accepted` count save
attempts and acknowledgment responses, not unique database rows. A lost acknowledgment can still
be confirmed through an `answers` event.

Use `/admin` to reset/start the contest yourself; the script never controls the contest or makes
host-only requests. Ctrl+C stops the bots. Test accounts and saved answers remain in the target
database. This is network/protocol emulation with in-memory drafts: it does not render 100 browser
pages, persist offline drafts across process exits, or simulate manual account recovery/admin
navigation. Use the full-app browser harness for rendering tests. Older live-bot measurements
predate this added automatic traffic and should be rerun for direct comparisons.

Verification uses real HTTP/Socket.IO integration tests for subscriptions, snapshot refreshes,
lost saves and acknowledgments, paused edits, excluded watermarks, reconnects and result retries,
plus an isolated 100-client command smoke test. No load is run against your existing instance
as part of that verification.
