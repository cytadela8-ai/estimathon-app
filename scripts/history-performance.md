# Performance fixes on existing revision history

The fixes were applied and benchmarked separately in the production app, retaining each previous
fix for the next stage. Each 30-second run began with an independent SQLite backup of the same
119,475-revision / 100-participant database and used 100 bots at independently sampled 1–1000 ms
intervals. Six real Chromium pages exercised the projector and all five host sections. Results
measure real Socket.IO acknowledgments and browser HTTP requests, rather than isolated SQL alone.

| Stage                                | New edits |  Save p95 |  Save p99 | Worst save | Monitoring fetch p95 |
| ------------------------------------ | --------: | --------: | --------: | ---------: | -------------------: |
| Original app, bloated database       |     5,992 | 140.64 ms | 189.40 ms |  216.21 ms |             190.9 ms |
| 1. Indexed audit filters             |     5,929 |  11.30 ms |  15.81 ms |   23.14 ms |              14.8 ms |
| 2. Indexed counted revision          |     5,936 |   7.91 ms |  13.03 ms |   21.25 ms |               6.5 ms |
| 3. Transactional revision watermarks |     5,879 |   4.42 ms |   7.21 ms |   16.86 ms |               3.1 ms |

All sent edits were acknowledged and stored in every stage. No rejected edits, browser errors,
failed browser fetches, frames over 50 ms, or browser long tasks were observed. Final phase was
`finished` for each run. Save p95 improved approximately 32-fold from baseline; monitoring fetch
p95 improved approximately 62-fold. Monitoring distributions include the overview fetch as well
as monitoring itself, with 26 fetch samples per stage; they are useful local comparisons, not
precise estimates of population percentiles. Automated pairs of host tab switches stayed under
79.4 ms throughout. Raw reports and server logs are in `performance-results/history-*/`.

## Changes

1. Audit reads build predicates only for active filters. Participant-name matching happens on the
   participant table, not once per historical submission. Late reads use each question's indexed
   `receivedAt >= endsAt + threshold` range. Row metadata and review previews are loaded only
   after pagination. A question/arrival index supports the range and question-specific history.
2. A partial participant/question/revision/operation index selects the highest eligible,
   non-excluded answer directly. It replaces the old question/participant index. Historical
   revisions remain available for moderation fallback and restoration.
3. A small durable table stores the highest recorded revision per participant/question. Each
   submission updates it in the existing transaction, including paused and invalid-number edits.
   Recovery snapshots no longer aggregate historical submissions. Existing databases populate it
   once, transactionally, on first startup; subsequent startup skips the historical aggregation.
   Contest reset clears the table alongside the other ledgers. Receipt failures roll back it and
   the submission together.

No revisions were deleted. Receipt semantics, moderation, indefinite delayed delivery, public
protocols and SQLite WAL/FULL durability remain in place. Existing production database files were
not opened for writing. Index creation and the one-time watermark initialization add work to the
first startup after upgrading; the benchmark included that initialization before measured load.

## Reproduce and interpret

See [instructions](README.md#testing-existing-revision-history). Use a distinct `PERF_LABEL` for
each build, and the same original `PERF_DATABASE_PATH` for each comparison. Each run changes only
a disposable backup: it resumes the current question, advances its deadline, and keeps all history.
For the retained one-question fixture, the default late-only filter therefore returns no matches,
matching the original workload. Populated late history and multi-question filtering are covered
by behavior tests, but were not subjected to this same concurrent browser load benchmark.

The source database stayed at 119,475 revisions. These are loopback measurements on Node 22.22.0,
AMD Ryzen 7 7700X, with 14 logical CPUs exposed. Host disk, server, generator, and browser share
resources; randomized schedules and small browser sample sizes produce run-to-run variation.
This does not establish Wi-Fi or low-end phone capacity. Exact counts of large filtered result
sets and deep OFFSET pages can still scale with the number of matching historical rows; no
reporting worker, history deletion, or altered pagination contract was introduced.

## Verification

All 173 unit/integration tests passed. The new legacy-initialization test failed before the
watermark implementation and passed afterward. Deliberately allowing a watermark to decrease
made the new regression test fail; restoring MAX semantics made it pass. Lint, formatting,
strict TypeScript/Svelte checks and the production build passed.

Five relevant desktop browser tests passed: admin pagination/filtering, contest reset, offline
reset isolation, offline delayed delivery, and multi-tab/account recovery. The restart/reconnection
browser test failed both on the optimized app and on an unchanged HEAD baseline. It is a separate
existing issue: graceful shutdown explicitly disconnects sockets, while the client's disconnect
handler does not initiate reconnection after a server-requested disconnect. No client reconnect
change is included in these performance fixes. Failure traces are retained under
`playwright-report/baseline-restart/` and `playwright-report/restart-check/`.

## Final 60-second confirmation

Starting again from the original 119,475-revision database, the completed app accepted and stored
all 11,967 additional edits (total 131,442 revisions). Save latency was
4.42 ms p95, 6.97 ms p99 and 19.58 ms maximum. Monitoring browser fetch p95 was
3.2 ms. No acknowledgment errors, browser errors, failed fetches, long tasks or frame gaps
over 50 ms were recorded, including the final reveal observation. The final database passed
integrity checking, and all 100 cached watermarks exactly matched maxima computed from history.
Raw evidence: performance-results/history-final/60s.json and its server log.
