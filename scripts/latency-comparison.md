# Latency comparison: nearly clear versus ten-minute bot history

The comparison uses the optimized production app under 100 protocol bots, four real play browsers,
a projector, all admin sections, concurrent HTTP probes and ordinary browser polling. All values
are milliseconds, shown as **median / p95 / maximum**. p95 means 95% of measured operations completed
within that time. HTTP timings include complete bodies and queueing behind other requests.

| Dataset                | Initial revisions | Revisions before lifecycle reset | Main measurement |
| ---------------------- | ----------------: | -------------------------------: | ---------------- |
| Nearly clear           |                 0 |                            7,600 | 10 seconds       |
| Ten-minute bot history |           119,475 |                          137,450 | 60 seconds       |

The ten-minute dataset is the original 119,475-revision fixture. The separate ten-minute endurance
run started from that fixture and ended at 250,030 revisions; it is a larger stress case, not a
clean database with exactly one ten-minute round of data. Both compared databases kept receiving
new entries during measurement, so these are workload observations, not fixed-size isolated-query
benchmarks. Different durations and small samples in the fresh run limit causal comparisons.

## Answer processing and play screens

| Operation                                    |     Nearly clear | Ten-minute history |
| -------------------------------------------- | ---------------: | -----------------: |
| Answer save while active                     | 1.6 / 4.9 / 32.5 |   1.6 / 7.4 / 73.3 |
| Late answer save after reveal                | 2.1 / 7.8 / 57.7 |  2.2 / 10.7 / 71.7 |
| Old-question save during next question       | 2.1 / 8.2 / 41.9 |  2.1 / 11.1 / 53.2 |
| Save during finished/reset boundary          | 2.1 / 8.6 / 36.6 | 2.3 / 43.3 / 378.5 |
| play-desktop-0 input to visible confirmation |  2.1 / 3.5 / 3.5 |   2.0 / 6.6 / 36.0 |
| play-desktop-1 input to visible confirmation |  1.9 / 4.9 / 4.9 |  2.0 / 28.5 / 49.5 |
| play-mobile-2 input to visible confirmation  |  2.0 / 3.7 / 5.2 |   2.1 / 7.4 / 29.8 |
| play-mobile-3 input to visible confirmation  |  2.0 / 5.1 / 5.1 |  2.0 / 13.4 / 35.0 |

The finished/reset boundary includes the synchronous backup and expected rejection of queued
old-question edits after reset. It should not be interpreted as normal typing latency. Input-to-save
confirmation ends when both the DOM and persisted draft confirm the newly typed value.

## HTTP requests

These distributions include the scenario's lifecycle observations. Fresh repeated reads typically
have 17 samples per variant and history reads 37; joins/moderation have only 3 and 8 samples.
Control actions often have one or two samples. Startup login/logout are setup measurements.
Personal-results success rows below include only HTTP 200, with four samples in each scenario.

| Request                                     |       Nearly clear |    Ten-minute history |
| ------------------------------------------- | -----------------: | --------------------: |
| Public state                                |    1.9 / 4.7 / 4.7 |       1.8 / 3.6 / 8.2 |
| Admin overview                              |    1.8 / 4.5 / 4.5 |       1.6 / 3.5 / 8.2 |
| Counted answers, first page                 |    2.0 / 4.6 / 4.6 |       1.8 / 3.6 / 8.3 |
| Counted answers, last page                  |    2.0 / 4.7 / 4.7 |       1.9 / 3.7 / 8.5 |
| Monitoring, default late filter             |    4.9 / 7.4 / 7.4 |      2.5 / 6.7 / 12.3 |
| Monitoring, all history                     |  8.4 / 10.7 / 10.7 |     6.5 / 10.8 / 16.3 |
| Monitoring, deep page                       | 11.9 / 15.7 / 15.7 |    17.7 / 22.2 / 27.5 |
| Monitoring, value substring                 | 15.9 / 20.0 / 20.0 |    31.3 / 37.4 / 41.2 |
| Monitoring, participant filter              | 18.1 / 22.9 / 22.9 |    36.4 / 45.8 / 46.9 |
| Monitoring, question filter                 | 21.8 / 29.1 / 29.1 |    46.1 / 55.4 / 61.1 |
| Moderation history                          | 22.2 / 29.6 / 29.6 |    46.5 / 55.8 / 65.0 |
| Account recovery                            | 22.8 / 30.2 / 30.2 |    47.4 / 59.0 / 67.0 |
| Registration under load                     |  5.6 / 16.0 / 16.0 |       2.6 / 9.2 / 9.2 |
| Host exclusion/restoration                  |  5.6 / 24.6 / 24.6 |     3.3 / 44.0 / 44.0 |
| Host login (setup)                          | 12.9 / 12.9 / 12.9 |    12.1 / 12.1 / 12.1 |
| Host logout (setup)                         |    1.2 / 1.2 / 1.2 |       1.0 / 1.0 / 1.0 |
| Start contest                               |    1.7 / 1.7 / 1.7 |                     — |
| Pause                                       |    3.1 / 3.1 / 3.1 |       1.5 / 1.5 / 1.5 |
| Resume                                      |    1.8 / 1.8 / 1.8 |       2.1 / 2.1 / 2.1 |
| Extend time                                 |    1.9 / 1.9 / 1.9 |       3.1 / 3.1 / 3.1 |
| Advance/close question                      |    2.8 / 2.8 / 2.8 |       2.2 / 2.2 / 2.2 |
| Finish contest                              |    2.3 / 2.3 / 2.3 |       4.8 / 4.8 / 4.8 |
| Reset with consistent backup                | 25.5 / 25.5 / 25.5 | 387.6 / 387.6 / 387.6 |
| Save configuration (setup)                  |    1.6 / 1.6 / 1.6 |                     — |
| Save configuration after reset              |                  — |       2.1 / 2.1 / 2.1 |
| Unauthorized admin request (401)            | 22.2 / 29.5 / 29.5 |    46.3 / 55.7 / 64.9 |
| Unauthorized personal-results request (401) | 22.3 / 29.6 / 29.6 |    46.4 / 55.8 / 65.1 |
| Missing recovery code (404)                 | 22.9 / 30.1 / 30.1 |    47.4 / 59.0 / 67.3 |
| Personal results, successful response       | 23.4 / 29.7 / 29.7 |    50.9 / 52.4 / 52.4 |

Configuration changes and starting a contest are unavailable while the retained contest is
active. Thus no valid startup/configuration-save latency exists for that state. The history
configuration-save-after-reset measurement occurs after history has been cleared. The deep-page
probe requests page 1 in the nearly clear fixture and approximately page 1195 in the large fixture.
These differences reflect available data rather than identical query work.

## Static files

| Request                    |      Nearly clear | Ten-minute history |
| -------------------------- | ----------------: | -----------------: |
| /                          | 2.8 / 18.9 / 18.9 |  1.6 / 65.7 / 65.7 |
| /play                      | 7.1 / 20.6 / 20.6 |  4.6 / 68.0 / 68.0 |
| /assets/index-ByVvPTGT.css | 5.8 / 20.5 / 20.5 |  2.8 / 67.9 / 67.9 |
| /screen                    | 7.2 / 21.3 / 21.3 |  4.4 / 68.3 / 68.3 |
| font                       | 6.5 / 21.5 / 21.5 |  3.2 / 69.1 / 69.1 |
| /assets/index-BPoxPxuN.js  | 7.1 / 21.0 / 21.0 |  4.0 / 68.4 / 68.4 |
| /admin                     | 7.4 / 21.8 / 21.8 |  4.5 / 69.5 / 69.5 |

These are HTTP transfers, not complete page-open times. Static samples are small (10 versus 20),
with grouped requests sometimes queued behind reporting queries. The separate cold-context test
on the retained-history fixture measured initial heading/fonts/two-frame readiness at 63–113 ms
across 24 navigations. No equivalent nearly-clear cold-context series was recorded.

## Admin pages and projector

Browser fetch distributions include the endpoints each page polls. Values are network/body
completion, not the delay from a participant save until the next polling refresh.

| Browser page/metric                  |       Nearly clear | Ten-minute history |
| ------------------------------------ | -----------------: | -----------------: |
| Contest controls: fetch              |    1.8 / 1.9 / 1.9 |    1.9 / 4.8 / 9.1 |
| Questions/settings: fetch            |    2.0 / 2.9 / 2.9 |    1.7 / 2.9 / 3.0 |
| Participants: fetch                  |    2.1 / 2.2 / 2.2 |    2.3 / 4.8 / 4.9 |
| Accepted answers: fetch              |    3.3 / 4.5 / 4.5 |   3.7 / 8.0 / 11.9 |
| Default results/monitoring: fetch    |    3.2 / 3.7 / 3.7 |    2.9 / 5.3 / 5.5 |
| Unfiltered history: fetch            | 10.1 / 14.2 / 14.2 | 11.6 / 17.7 / 18.3 |
| Text-filtered history: fetch         |  5.9 / 12.3 / 12.3 | 18.3 / 21.7 / 36.0 |
| Paginated history: fetch             | 10.0 / 12.4 / 12.4 | 12.4 / 16.0 / 20.5 |
| Projector: state delivery            |    2.0 / 2.0 / 3.0 |    1.0 / 2.0 / 3.0 |
| Projector: next frame after state    |  9.9 / 15.6 / 15.9 |  8.6 / 15.7 / 16.7 |
| Projector: frame interval            | 16.7 / 16.8 / 18.9 | 16.7 / 16.8 / 20.0 |
| Pair of automated admin tab switches | 66.8 / 86.7 / 86.7 | 66.5 / 81.9 / 81.9 |

Admin tables poll every 2.5 seconds, so a newly saved value may appear up to approximately
2.5 seconds plus fetch/render time later. Public state is coalesced at approximately ten updates
per second, so projector updates may first wait up to approximately 100 ms before delivery.
Those cadences are distinct from the small delivery/fetch times above.

Neither compared run recorded browser JavaScript errors, frames over 50 ms, or long main-thread
tasks. No acknowledged accepted/paused bot operations were missing from the reset backups.

## Interpretation

- Typical save latency remained around 1.6 ms. Its p95 rose from 4.9 to 7.4 ms with the ten-minute
  history. Median play confirmation stayed around 2 ms, with occasional query-related tails.
- Reporting work increases with history. Expensive query groups also queue cheap recovery and
  review requests: their client timing includes that queue, not just their own SQL execution.
- Reset was the largest isolated delay: 25.5 ms versus 387.6 ms, because the larger database is
  backed up synchronously. The largest receipt during that boundary was 36.6 versus 378.5 ms.
- The larger 250,030-revision endurance case reached save p95 10.4 ms, p99 56.0 ms and reset
  913.8 ms, while retaining smooth rendering. See [full workload report](full-app-performance.md).

These are local-loopback observations on the same Ryzen 7 7700X host and Node 22.22.0. The small
sample counts and different test lengths explain some apparently faster large-database values;
those should not be read as evidence that additional history makes the app faster. Wi-Fi and
physical-device latency are not included. All raw reports remain under
performance-results/full-app/{fresh-10s,history-60s}/.
