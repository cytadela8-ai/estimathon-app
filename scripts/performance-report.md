# Performance test results

Tested the production build locally with Node 22.22.0 on an AMD Ryzen 7 7700X host
(14 logical CPUs exposed). Application code and existing contest data were unchanged.
Each run used a fresh file-backed SQLite database with the app's WAL/FULL durability settings,
100 authenticated WebSocket bots, and six desktop Chromium pages. See [usage](README.md).

## Answer processing

| Duration   | Sent, acknowledged, stored | Ack p50 |  Ack p95 |   Ack p99 |   Maximum |
| ---------- | -------------------------: | ------: | -------: | --------: | --------: |
| 10 seconds |                      1,981 | 1.50 ms |  3.60 ms |   5.86 ms |  15.47 ms |
| 1 minute   |                     11,991 | 1.46 ms |  4.13 ms |   6.79 ms |  21.94 ms |
| 10 minutes |                    119,475 | 2.09 ms | 39.52 ms | 137.81 ms | 229.28 ms |

No acknowledgment errors, rejected operations, missing submissions, failed browser fetches, or
browser errors were recorded. The final contest phase was `finished`. The ten-minute database
passed SQLite `integrity_check`. Throughput remained approximately 199 edits/second.
Uniform delays were sampled independently of acknowledgments; the long-run sampled mean was
501.88 ms (the theoretical mean of integers 1–1000 is 500.5 ms).

**There is measurable degradation over time.** In the ten-minute run, acknowledgment p95
increased from **3.83 ms in the first ten-second window to 143.81 ms in the last**;
p99 increased from 5.90 to 174.80 ms. Median latency increased from 1.45 to 3.86 ms.
The app kept up, but periodic delays became much larger as history accumulated.

## Screen and host pages

All six browser pages had frame p95 around 16.7 ms, zero recorded frames over 50 ms, and zero
recorded main-thread long tasks. This also held through the post-load final reveal observation.
No browser rendering slowdown was observed in these desktop headless probes.

| Host page          | Browser fetch p95, 1 minute | Browser fetch p95, 10 minutes | Maximum, 10 minutes |
| ------------------ | --------------------------: | ----------------------------: | ------------------: |
| Answers            |                      4.9 ms |                        7.0 ms |            313.7 ms |
| Results/monitoring |                     18.3 ms |                      168.1 ms |            269.0 ms |
| Participants       |                      3.2 ms |                      174.6 ms |            221.1 ms |
| Questions/settings |                      2.7 ms |                      125.5 ms |            186.4 ms |
| Contest controls   |                      4.4 ms |                       90.6 ms |            147.0 ms |

Results/answers pages also poll overview, so these fetch distributions combine their requests.
Fetch timing ends at response headers. Timed pairs of host tab switches remained responsive:
ten-minute p95 71.9 ms, maximum 72.8 ms, across 120 probes. These are automated click timings,
not a formal input-to-paint metric. Smooth frames do not mean server-fed data arrived promptly.
The host UI additionally has its existing 2.5-second polling interval.

## Findings and proposed fixes (not implemented)

1. **Monitoring work grows with submission history and blocks unrelated work.**
   `src/server/audit.ts:36–59` builds joins and substring filters for every audit count and page.
   Even empty filters evaluate `polish_lower` on joined names for every historical submission.
   `EXPLAIN QUERY PLAN` confirmed a submission-table scan for the count. Production server logs
   show `/api/admin/results` rising from approximately 1–3 ms initially to 172–186 ms in the
   final five requests. Running `auditEntries` alone on the completed database took 72–80 ms
   over five calls. These synchronous queries run on the same event loop as answer commits.
   Overview handlers themselves still took less than 1 ms at the end, despite much higher
   browser-observed latency. This supports server queueing as the explanation for spillover
   delays, although a CPU profile was not collected.

   **Recommended first fix:** build SQL predicates only for active filters. Skip name/text
   functions and unnecessary joins when those filters are empty; provide a cheap unfiltered
   count path. Resolve matching participant IDs once per filtered request. Recheck query plans
   and repeat this workload. Consider cached counts and cursor pagination if deeper-page or
   filtered-history tests still show excessive cost. Moving reporting reads to a worker with
   its own SQLite connection can isolate unavoidable scans, but adds complexity and should
   follow measurement of the simpler query changes.

2. **Per-save history queries provide another growth path.**
   `src/server/realtime.ts:55` sends `answers.snapshot(id)` after accepted saves.
   `src/server/answers.ts:19–26` groups historical submissions to recover maximum revisions.
   `src/server/answers.ts` also searches historical candidates ordered by revision when selecting
   the counted answer. These paths grow as each bot accumulates revisions. Their individual
   contribution to measured slowdown was not isolated from monitoring queries.

   **Proposal:** profile these queries with monitoring disabled. If material, maintain revision
   watermarks transactionally and evaluate an index supporting participant/question/revision
   ordering for candidate selection. Preserve excluded-submission watermarks and receipt
   semantics; verify with the existing synchronization/moderation tests. Avoid reducing SQLite
   durability merely to improve benchmark numbers.

3. **Persistent history grows quickly at this edit rate.**
   SQLite logical size reached **127,909,888 bytes (122 MiB)** for 119,475 edits in ten minutes,
   excluding WAL and backups. Every unique edit retains submission and idempotency records.
   This is expected durable-history behavior, but matters for long contests and backup capacity.
   Sampled server RSS stayed around 150–158 MB; sampled lifetime CPU average rose from about
   14% to 27% of one core. These samples do not establish a leak or resource exhaustion.

   **Proposal:** size storage/backups for the expected contest length and edit rate. Archive
   finished contests under an explicit retention policy. Do not delete active revision or
   idempotency history: the app supports indefinite delayed delivery. Any retention change
   needs a deliberate product decision about that guarantee.

## Reproducibility and limits

Run `pnpm build && node scripts/performance.mjs`. The original 10/60/600-second raw artifacts
were cleared when Playwright reset its output directory; the measured summary above is retained.
New load-test output uses the separate ignored `performance-results/` directory. Current stepwise
raw comparisons and their reproduction details are in [history-performance.md](history-performance.md).
The script was syntax checked, linted with oxlint, formatted with oxfmt, and exercised again for
ten seconds after extracting helper functions.

This is one run per duration on loopback, with server, generator, and browser sharing a host.
It does not establish venue Wi-Fi capacity, low-end phone rendering, maximum supported users,
or behavior over multiple questions. Bots exercise the actual save protocol rather than browser
keystrokes/debounce/retries. The final reveal was observed after bots stopped; concurrent late
edits during reveal were not stress-tested. No application fixes were applied.
