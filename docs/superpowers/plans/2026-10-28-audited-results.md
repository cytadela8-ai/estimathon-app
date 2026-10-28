# Audited Results Implementation Plan

**Goal:** Accept delayed synchronization without a cutoff, audit all submissions, support host
exclusions, shared competition places, zero missing scores, and minimal participant screens.
**Architecture:** Keep the SQLite answer ledger and add immutable per-operation arrival telemetry,
persisted question deadlines, and reversible host exclusions. Recalculate each revealed question in
the same transaction as a counted-answer change. Reveal after five seconds; advance only manually.
**Tech Stack:** Existing TypeScript stack; Playwright Test for real-browser automation.
**Spec:** User's October 28 follow-up and explicit choice to count late answers automatically.

## Constraints and review focus

- Code/docs in English; Polish UI; continue on authorized master with verified milestone commits.
- Late attempts for any started question sync indefinitely, including after final results.
- Phone timestamps are untrusted telemetry; first server arrival is immutable under retries.
- Excluding an operation must select the previous eligible revision; restoring it must recompute.
- Missing submissions score zero but never enter the logarithmic median.
- Places use competition ranking: 1, 1, 3; podium and top-five include tied places.
- Client edit guard uses the offset-adjusted deadline even while disconnected; sync never stops.

## Tasks

- [x] Add failing tests for shared ranks/zero scores, indefinite late arrivals, duplicate first
      arrival timing, exclusions/restoration, restart and manual progression.
- [x] Update shared protocol, SQLite audit and deadlines, answer ledger, score finalization and
      authenticated results/audit/exclusion endpoints. Verify engine/transport tests and commit.
- [x] Record input timing in storage-first edits; lock edit entry at the deadline; retain retries.
      Add host results/audit UI with question/participant/search filters and a default >=3 s arrival
      delay filter, full timestamps and signed phone/server offsets. Verify and commit.
- [x] Render shared-place podium/rankings; remove participant navigation and decorative extras,
      retain essential identity recovery. Verify component/type/lint checks and commit.
- [x] Add Playwright Test with isolated SQLite servers and mobile/desktop Chromium contexts.
      Exercise offline close/reopen/late retry, timeout lock, tabs, recovery, host audit filters and
      exclusions, manual progression, tied podium, projector reconnect. Verify suite and commit.
- [x] Update README with new timing/acceptance/ranking rules and test instructions; run all
      checks, production audit and browser tests, review changes and commit delivery notes.

No external deployment or push is part of this task. No existing contest data will be deleted.

Validation: engine, ledger, transport, host review and projector tests; eight production-browser
cases across desktop and mobile, including process restart. Final verification recorded in delivery.
