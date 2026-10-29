# Revision history performance implementation plan

**Goal:** Keep answer processing and host monitoring responsive on the retained 119,475-row database.
**Architecture:** Indexed filter-specific audit reads, indexed counted-answer selection, and durable
per-participant/question revision watermarks. Keep existing wire formats and all revision history.
**Tech Stack:** Existing TypeScript, SQLite, Socket.IO, Svelte, Vitest, Playwright; no dependencies.
**Spec:** User request: implement fixes one by one, checking actual app performance on bloated data.

## Constraints and review focus

Preserve literal/Polish filters, inclusive late thresholds, global stable pagination, unknown question
handling, exclusion/restore ordering, paused/invalid observed watermarks, idempotency, restart and reset.
No changes to existing contest data. Benchmark copies with the same history and 100 active bots.

## Sequence

- [x] Extend the load harness to seed from a SQLite backup; baseline real production transport/pages.
- [x] Replace optional-OR audit scans with active predicates and indexed per-question late ranges.
      Add behavior tests for multiple deadlines, null deadlines, literal filters and page boundaries.
      Run pagination/audit tests, build, benchmark the bloated copy.
- [x] Index eligible counted-answer lookup in revision/operation order. Verify moderation/ties/stale
      edits and benchmark again with monitoring fix retained.
- [x] Maintain durable revision watermarks transactionally, initialize existing history once, clear
      them on reset. Test paused/invalid/excluded revisions, restart/backfill and rollback. Benchmark again.
- [x] Run relevant regression tests, lint, strict checks, production build, review changes and record
      stepwise measured results and limitations in the performance report.
