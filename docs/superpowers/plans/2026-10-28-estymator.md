# Estymator Implementation Plan

**Goal:** A durable LAN estimation contest with Polish browser views.
**Architecture:** One Fastify process owns SQLite, scheduling, Socket.IO and static assets.
Svelte clients persist edits before transmission and reconcile authoritative snapshots.
**Tech Stack:** TypeScript, Svelte, Vite, Fastify, Socket.IO, better-sqlite3.
**Spec:** User-provided Estymator specification, 2026-10-28.

## Constraints and decisions

English code/documentation; Polish UI. No cloud services or runtime Internet dependencies.
Per-question scoring uses logarithmic error, median normalization with a 0.05 floor,
and Math.round(1000 / (1 + error / normalization)).
Use strict acceptance by default; configurable 5-second lenient delivery window.
Manual results by default; optional timed results advance the schedule.
Positive integer strings preserve textual drafts; range configurable as decimal strings.
Revision and operation ID form a deterministic total order across tabs.

## Review focus

- Restart after deadline: advance from persisted timestamps without revealing early.
- Concurrent tabs: same revision resolves by operation ID, never arrival order.
- Lost acknowledgment: duplicate retries return the committed outcome.
- Disconnected draft: keep pending through snapshots, reject explicitly after cutoff.
- Public payloads: never send correct answers or submissions before acceptance closes.

## Milestones

- [x] Tooling: exact dependencies, strict TypeScript, oxlint/oxfmt, Vitest.
- [x] Durable engine: `src/server/database.ts`, `contest.ts`, `answers.ts`;
      protocol in `src/shared/protocol.ts`, batch scoring in `scoring.ts`.
      Verify out-of-order/duplicate operations, cutoff, pause/resume, restart and 300 answers.
- [x] Transport: `src/server/app.ts`, `index.ts`; authenticated admin HTTP routes,
      participant recovery, Socket.IO snapshots and committed answer acknowledgments.
      Verify API authentication, public redaction and reconnection.
- [x] Client sync: `src/client/sync.ts`; synchronous local writes, retry/reconcile,
      storage events, clock offset estimation. Verify lost ack, refresh and stale snapshots.
- [x] Views: `App.svelte`, `Play.svelte`, `Screen.svelte`, `Admin.svelte`, `style.css`;
      mobile play, staged projector reveal and admin question/config/recovery tools.
- [x] Delivery: README operational instructions, `.env.example`, production build,
      type/lint/tests and HTTP/Socket.IO integration checks. Commit verified milestones.

Implement directly in the authorized master workspace. No deployment or external writes.

Validation: 32 passing tests, including 300 concurrent Socket.IO clients; clean lint,
strict type checks and production build. Browser lifecycle checks documented in README.md.
Optional HTTPS/PWA remain deployment choices. Scoring rules were subsequently supplied by the organizer.

## Reliability follow-up

- [x] Retain the latest valid unacknowledged edit separately from intermediate editing text.
- [x] Settle queued receipts without overwriting a later empty draft.
- [x] Share a reactive clock across input locking, countdown and projector reveal stages.
- [x] Verify no-deadline and paused clocks, retry recovery and delayed acknowledgments.
- [x] Browser-check offline edit/clear/close/reopen and disconnected deadline locking.

Follow-up validation: 44 passing tests; clean lint, type checks and production build.

## Organizer scoring and result completion

- [x] Replace the unconfigured scoring hook with the supplied batch median/logarithmic formula.
- [x] Test odd/even fields, the median floor, multiplicative symmetry, half-up rounding and range.
- [x] Finalize each question from its latest confirmed submissions; sum persisted points.
- [x] Rebuild finalized scores on restart while leaving active questions unscored.
- [x] Remove obsolete scoring-module configuration and unconfigured UI states.
- [x] Include unranked participants in final scrolling results alongside the podium.
- [x] Check projector staging, reconnection timing, empty results and crash recovery.

Final validation: 73 passing tests, clean lint/type checks/build and production dependency audit.
Browser verification includes the supplied scoring formula and final desktop/mobile layouts.
