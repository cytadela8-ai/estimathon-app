# Full application performance after optimization

Tested the production build locally using the existing optimized app. No application behavior was
changed for this task. Each scenario ran in a separate process with a disposable SQLite database.
The large fixture began at 119,475 revisions. The same host ran the server, generator and Chromium.
Machine: Node v22.22.0, AMD Ryzen 7 7700X 8-Core Processor, 14 logical CPUs exposed.

The workload was 100 independently scheduled bots (1–1000 ms delays), including five polling-only
clients, four additional real play browsers, a projector and eight admin views. Parallel HTTP
probes exercised all API routes, history filters/deep pages, static assets and expected error
responses. Every scenario also progressed through question results, a second question, final
results, and reset while bots continued sending to the earlier question. See [methodology and
reproduction](performance/README.md).

The app kept up with this workload, with smooth play/projector/admin rendering. Remaining costs
are synchronous reporting reads and the consistent reset backup. Final-results refreshes also
amplify request volume during continuing late edits; that stress test completed successfully.

## Submissions and sustained load

| Scenario                | Bot operations, including lifecycle | Main save p50 | Main save p95 | Main save p99 | Main maximum |
| ----------------------- | ----------------------------------: | ------------: | ------------: | ------------: | -----------: |
| Fresh (10 s)            |                               8,135 |        1.6 ms |        4.9 ms |       13.5 ms |      32.5 ms |
| History (60 s)          |                              18,136 |        1.6 ms |        7.4 ms |       38.9 ms |      73.3 ms |
| Revealed history (60 s) |                              17,886 |        2.2 ms |       10.6 ms |       42.5 ms |     110.9 ms |
| Endurance (600 s)       |                             126,550 |        1.6 ms |       10.4 ms |       56.0 ms |     268.3 ms |

All 170,707 bot operations received acknowledgments. Accepted and paused operations were
verified in each app-generated pre-reset backup; integrity checks passed and no acknowledged
bot operations were missing. Paused receipts during pause and invalid receipts after reset were
expected. Reports recorded 0 unexpected protocol/HTTP failures. Four browser personal-results requests
queued across the endurance reset returned HTTP 409 after the contest had returned to setup;
these are expected stale reads rejected by the results-phase guard. No browser JavaScript errors
were recorded.

The endurance run ended with 250,030 stored revisions before reset. Its ten-second latency windows
are retained in the raw report. The final-results stage additionally simulated all 100 bots
fetching personal results on every state broadcast for ten seconds, alongside the four browsers.

## Complete-body HTTP response times

The table uses the endurance scenario. Timings include response bodies and server queueing;
parallel probes deliberately create contention. Operations with one sample are single observed
times, not statistically established percentile bounds. Expected 400/401/404/409 responses count
as successful tests of their guards. Configuration save/start also succeeded in the fresh setup.

| Request/variant         | Samples |      p50 |      p95 |  Maximum |
| ----------------------- | ------: | -------: | -------: | -------: |
| state                   |     254 |   1.5 ms |   4.6 ms |  68.8 ms |
| overview                |     254 |   1.5 ms |   5.0 ms |  68.8 ms |
| answers-first           |     254 |   1.6 ms |   5.2 ms |  69.0 ms |
| answers-last            |     254 |   1.8 ms |   5.3 ms |  69.1 ms |
| monitor-default-late    |     254 |   2.2 ms |   6.2 ms |  69.2 ms |
| monitor-all             |     254 |  11.0 ms |  16.2 ms |  69.4 ms |
| monitor-deep            |     254 |  26.0 ms |  33.1 ms |  69.8 ms |
| monitor-value           |     254 |  43.6 ms |  55.9 ms |  70.1 ms |
| monitor-person          |     254 |  49.3 ms |  62.4 ms |  70.9 ms |
| monitor-question        |     254 |  63.7 ms |  80.9 ms |  94.5 ms |
| reviews                 |     254 |  64.1 ms |  81.4 ms |  95.0 ms |
| recover                 |     254 |  65.3 ms |  85.2 ms | 102.4 ms |
| recover-missing         |     254 |  65.3 ms |  85.2 ms | 102.4 ms |
| admin-unauthorized      |     254 |  64.2 ms |  81.4 ms |  97.4 ms |
| personal-unauthorized   |     254 |  64.4 ms |  83.2 ms |  97.4 ms |
| personal-results        |     254 |  64.6 ms |  84.0 ms | 102.0 ms |
| personal-results-fanout |    9700 |  15.4 ms |  19.9 ms |  74.0 ms |
| join                    |      62 |   1.8 ms |   4.1 ms |  17.6 ms |
| moderation              |      62 |   2.1 ms |   5.5 ms |  45.7 ms |
| login-under-load        |       1 |   1.3 ms |   1.3 ms |   1.3 ms |
| logout-under-load       |       1 |   0.5 ms |   0.5 ms |   0.5 ms |
| config-locked           |       1 |   1.0 ms |   1.0 ms |   1.0 ms |
| command-pause           |       1 |   2.0 ms |   2.0 ms |   2.0 ms |
| command-resume          |       1 |   3.8 ms |   3.8 ms |   3.8 ms |
| command-extend          |       1 |   1.7 ms |   1.7 ms |   1.7 ms |
| command-next            |       2 |   5.4 ms |   5.4 ms |   5.4 ms |
| command-finish          |       1 |   1.8 ms |   1.8 ms |   1.8 ms |
| contest-reset           |       1 | 913.8 ms | 913.8 ms | 913.8 ms |
| config-save-after-reset |       1 |   2.7 ms |   2.7 ms |   2.7 ms |

Individual phase and status distributions, polling/WebSocket comparisons, and every static HTML,
JavaScript, CSS and font request are in the raw reports.

## Browser responsiveness

Main-interval endurance measurements below include one mobile layout with 4x CPU throttling.
Confirmation ends at visible saved status plus a matching non-pending local draft, after a real
input event. Frame gaps use wall-clock callback intervals. State arrival measures transport delay
from a server snapshot; it excludes time before the server creates that snapshot.

| Browser        | Confirmation p95 | Fetch p95 | Frame p95 | Worst frame | Frames >50 ms | Long tasks >50 ms |
| -------------- | ---------------: | --------: | --------: | ----------: | ------------: | ----------------: |
| contest        |                — |    3.7 ms |   16.8 ms |     21.4 ms |             0 |                 0 |
| questions      |                — |    4.5 ms |   16.8 ms |     23.0 ms |             0 |                 0 |
| people         |                — |    5.4 ms |   16.8 ms |     22.1 ms |             0 |                 0 |
| answers        |                — |    6.6 ms |   16.8 ms |     20.3 ms |             0 |                 0 |
| results        |                — |    6.1 ms |   16.8 ms |     21.0 ms |             0 |                 0 |
| history        |                — |   19.9 ms |   16.8 ms |     32.3 ms |             0 |                 0 |
| filtered       |                — |   28.1 ms |   16.9 ms |     25.3 ms |             0 |                 0 |
| deep           |                — |   19.7 ms |   16.8 ms |     31.4 ms |             0 |                 0 |
| screen         |                — |         — |   16.8 ms |     20.5 ms |             0 |                 0 |
| play-desktop-0 |          10.6 ms |         — |   16.8 ms |     21.0 ms |             0 |                 0 |
| play-desktop-1 |          10.3 ms |         — |   16.9 ms |     20.6 ms |             0 |                 0 |
| play-mobile-2  |          11.0 ms |         — |   16.9 ms |     20.5 ms |             0 |                 0 |
| play-mobile-3  |           9.8 ms |         — |   17.4 ms |     38.1 ms |             0 |                 0 |

Admin pairs of tab switches: p95 83.0 ms, maximum 89.0 ms.
Recovery QR visible after 52.5 ms (one observation). Pause/resume command-to-visible
transition timings for all play probes and the projector are retained in the report.

## Server resources

| Scenario                | Median CPU, one core = 100% | Maximum CPU sample | Median RSS | Maximum RSS sample | Worst sampled event-loop gap |
| ----------------------- | --------------------------: | -----------------: | ---------: | -----------------: | ---------------------------: |
| Fresh (10 s)            |                       21.8% |              30.2% |  141.1 MiB |          154.9 MiB |                      34.2 ms |
| History (60 s)          |                       21.1% |              47.6% |  154.0 MiB |          156.9 MiB |                     401.9 ms |
| Revealed history (60 s) |                       26.8% |              44.2% |  155.0 MiB |          155.8 MiB |                     384.8 ms |
| Endurance (600 s)       |                       20.1% |              71.5% |  161.7 MiB |          165.8 MiB |                     864.6 ms |

Resource samples include lifecycle operations and reset backups; peak loop delays must not be
confused with steady-state processing. Event-loop sampling has an approximately 10 ms baseline.

## Server-side attribution

The following service times come from Fastify logs for exact probe paths in the endurance run.
They help separate query work from queueing visible to clients.

| Request/variant      | Service p50 | Service p95 |  Maximum |
| -------------------- | ----------: | ----------: | -------: |
| state                |      0.2 ms |      0.3 ms |   3.3 ms |
| overview             |      0.3 ms |      0.4 ms |   3.3 ms |
| answers-first        |      0.3 ms |      0.3 ms |   1.8 ms |
| monitor-default-late |      1.0 ms |      1.3 ms |   4.9 ms |
| monitor-all          |      8.8 ms |     10.8 ms |  14.5 ms |
| monitor-deep         |     14.8 ms |     17.3 ms |  20.9 ms |
| monitor-value        |     17.4 ms |     22.1 ms |  26.7 ms |
| monitor-person       |      5.8 ms |      7.2 ms |  10.3 ms |
| monitor-question     |     14.1 ms |     19.0 ms |  22.1 ms |
| reviews              |      0.2 ms |      0.2 ms |   0.3 ms |
| recover              |      0.1 ms |      0.2 ms |   0.3 ms |
| contest-reset        |    838.7 ms |    838.7 ms | 838.7 ms |

## Findings and proposed next steps

1. **Reporting still causes history-dependent latency tails.** During endurance, the first minute's
   ten-second save p95 values were 7.0–8.1 ms; the last minute's were 11.2–17.9 ms. Median save
   latency stayed near 1.6 ms, and throughput stayed near 200 bot edits/second. Server-side text
   filter service time rose from a median 13.0 ms in the first minute to 21.7 ms in the last;
   the deep-page query rose from 10.7 to 16.6 ms. This supports remaining scan/OFFSET cost as the
   history grows. Concurrent query bursts queue other work: review-history and recovery handlers
   themselves take roughly 0.2 ms at p95, while client p95 reaches about 81–85 ms in the burst.
   Consider cursor pagination for deep history and putting expensive reporting reads on a worker
   with a separate SQLite connection. Exact filtered counts still require work over matching data;
   changing pagination alone will not remove substring-search/count costs.
2. **Reset briefly blocks the server.** With 250,030 revisions, the consistent backup was about
   333.5 MiB. The reset request took 913.8 ms end to end; server service time was 838.7 ms and
   sampled event-loop delay reached 864.6 ms. Bot receipt latency briefly reached 957.1 ms around
   that reset. No acknowledged data was lost. If other requests must remain responsive during
   reset, move the consistent backup off the main thread while preserving an explicit boundary
   between archived writes and the reset. Merely wrapping synchronous serialization in a Promise
   would not help. This was a post-contest operation, not a steady-state typing delay.
3. **Results refreshes amplify traffic.** During ten seconds of continuing late edits, simulated
   participants made 9,700 personal-results fetches; all returned HTTP 200, with p95 19.9 ms and
   maximum 74.0 ms. The app handled the test, but the source ties each personal-results fetch to
   every public version update. Coalescing refreshes and retaining one in-flight request across
   version changes would reduce avoidable work and overlapping fetches on slower networks.

The projector received state snapshots with 2 ms p95 transport delay and reached the next frame
within 15.8 ms at p95. Broadcast intervals were 104 ms at p95, with one interval reaching 301 ms.
Pause/resume became visible across play and projector probes in approximately 51–104 ms. No
frames over 50 ms or main-thread long tasks were recorded in any observation phase, including
final results and reset. These observations distinguish smooth rendering from occasionally
slower server-fed updates.

Public snapshot size reached 34,243 bytes during results. At approximately ten updates/second to
113 connected bot/browser clients, that would imply roughly 39 MB/s of payload if such late-edit
traffic continued (an estimate, not measured Wi-Fi utilization). Idle results do not incur that
continuous dirty-state broadcast load. The venue network still needs its own capacity test.

## Evidence and limits

Raw JSON reports, HTTP/resource samples and production logs are under
`performance-results/full-app/{fresh-10s,history-60s,revealed-60s,endurance-600s}/`.
The additional navigation workload and its samples are retained under
`performance-results/full-app/endurance-30s/` and `performance-results/full-app/navigation/`.
The original source database was never opened for writing. Short-scenario sample sizes are small;
the broad concurrent workload is heavier than the earlier default-only monitoring benchmark,
so its percentile values are not directly interchangeable with that benchmark.

This tests local processing, mobile layouts and one synthetic CPU slowdown. It does not establish
Wi-Fi capacity or physical-phone performance, and it uses four play renderers rather than 100.
The endurance final-results fanout emulates the other participants at the HTTP layer.

## Cold browser contexts under load

A separate 30-second existing-history workload opened all four entry points in fresh Chromium
contexts during active answering: desktop and mobile layouts, three samples per path/layout.
All 24 navigations returned HTTP 200 with no browser errors. Initial heading, fonts and two
animation frames were ready in 62.5–112.5 ms. This is a small sample with a warm
server/filesystem; it is not a cold server boot or an exact input-interactive metric.

| Entry point | Desktop observed range | Mobile layout observed range |
| ----------- | ---------------------: | ---------------------------: |
| /           |           77.7–86.0 ms |                 63.5–79.0 ms |
| /play       |           63.0–93.1 ms |                 62.5–95.8 ms |
| /screen     |           78.1–79.4 ms |                 76.7–80.3 ms |
| /admin      |           78.3–91.4 ms |                78.1–112.5 ms |
