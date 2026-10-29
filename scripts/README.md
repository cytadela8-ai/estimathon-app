# Performance testing

Build the production app and run the isolated workload:

```bash
pnpm build
pnpm exec playwright install chromium  # if Chromium is not installed
node scripts/performance.mjs           # 10 seconds, 60 seconds, 600 seconds
```

For a shorter verification run: `node scripts/performance.mjs 10`.

The script starts a separate production Node process and fresh temporary file-backed SQLite
database for each duration. It never opens the configured application database. Existing
Socket.IO and Playwright dependencies provide 100 authenticated bots and six Chromium pages:
projector, host contest controls, questions, participants, answers, and results/monitoring.
Each bot submits unique revisions after uniformly sampled integer delays from 1 through 1000 ms
(the theoretical mean is 500.5 ms). Scheduling does not wait for acknowledgments, so server
queueing is included rather than reducing the offered load. Expect approximately 200 edits/second.

JSON summaries and server logs are written to `performance-results/`. Temporary databases
are retained at paths printed on startup for inspection; they contain synthetic credentials only.
No application source, dependency, configuration, or existing contest data is modified.

Measurements include acknowledgment latency with ten-second windows, errors and submission row
counts, database size, browser animation-frame intervals and long tasks (over 50 ms), browser
fetch latency, and timed pairs of admin tab switches every five seconds. A three-second idle
baseline precedes each workload. Reports include a final reveal observation after bots stop.
The `afterReveal` browser statistics are cumulative since the workload began, not reveal-only.
Fetch timings end at response headers; they do not include JSON parsing or rendering. Frame and
long-task observations measure the browser main thread separately. Baseline timings include
navigation and initial page work and have a small sample size.

This is a local production-build test on the current machine, not a Wi-Fi capacity guarantee.
Bots use WebSockets directly; they exercise answer commits and reconciliation but do not simulate
100 browser renderers, typing/debounce behavior, network outages, or slow phones. Browser probes
use headless desktop Chromium with background throttling disabled. All load runs use one question;
multiple questions and concurrent late edits after reveal are outside this workload. Browser and
load generator share the server host, so resource contention can affect results.

## Testing existing revision history

Run the same workload against a disposable backup of an existing contest:

```bash
PERF_DATABASE_PATH=/absolute/path/to/contest.sqlite \
PERF_LABEL=history-watermarks node scripts/performance.mjs 30
```

The source is opened read-only and copied with SQLite backup. The copy resumes its current
question with a future deadline, keeps all history, and connects the first 100 stored participants.
It requires a started contest and at least 100 participants. Bot revisions start above the original
load-test history. Results are saved in `performance-results/PERF_LABEL/`.
The copy's question window is adjusted to the new deadline, so historical submissions become
on-time in the single-question fixture. This reproduces the original growing-history monitoring
workload (the default late-only view has no matches). It does not measure a populated late-only
result set. Existing-source submission counts are recorded before startup, and the script fails
if acknowledged/stored new edits do not match the sent count.

## Whole-application coverage

For real participant typing, mobile layouts, all HTTP routes, history filters, polling transport,
late-answer rescoring, lifecycle transitions, reset backups, resource sampling and a final-results
refresh stress test, use [the full application harness](performance/README.md).
