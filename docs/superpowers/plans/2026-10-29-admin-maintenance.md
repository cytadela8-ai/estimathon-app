# Admin Maintenance Implementation Plan

**Goal:** Add a −30-second control and safely prune submission history.
**Architecture:** Reuse the persisted contest deadline and authenticated admin routes. Prune in
one SQLite transaction while preserving counted answers, revision watermarks and retry receipts.
**Tech Stack:** Svelte, TypeScript, Fastify, better-sqlite3, Vitest, Playwright.
**Spec:** User request in this session.

## Constraints and review focus

- Keep the latest 10 first arrivals per participant/question; break timestamp ties by revision
  and operation ID. Protect the counted answer even if older than the retained history.
  Preserve excluded paused submissions without receipts to prevent replay bypassing moderation.
- Keep operation receipts to preserve duplicate delivery and exclusions. Keep revision watermarks.
- Delete reviews only for deleted submissions. Retained decisions remain reversible.
- Cleanup must be authenticated, explicitly confirmed, atomic and safe to repeat.
- Shortening clamps at zero, preserves the reveal delay and works while paused.

## Tasks

- [x] Add timer regression tests in `tests/engine.test.ts`; verify failure, implement `shorten`
      in `src/server/contest.ts`, `src/shared/protocol.ts` and `src/client/Admin.svelte`.
- [x] Add retention tests in `tests/history-cleanup.test.ts`; verify failure, implement
      `cleanupHistory(db)` in `src/server/history-cleanup.ts` and expose confirmed
      `POST /api/admin/cleanup` in `src/server/routes.ts`.
- [x] Add confirmation and deleted-row feedback to `src/client/Admin.svelte`; document behavior
      and endpoint in `README.md`. Add browser coverage in `tests/e2e/admin-maintenance.spec.ts`.
- [x] Run relevant unit/integration tests, lint, strict type checks, build and browser tests.
      Review the final diff for retention and retry safety.
