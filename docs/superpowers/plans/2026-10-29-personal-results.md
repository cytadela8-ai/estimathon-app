# Personal Final Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Show participants their per-question answers and points after the contest, with question text revealed on demand.

**Architecture:** An authenticated participant endpoint returns only that participant's confirmed
results for played questions, only in the finished phase. A focused Svelte component loads this
summary on final-screen entry, reconnection, and contest-version changes; failed loads retry.

**Tech Stack:** Existing TypeScript, Fastify, SQLite, Svelte and Playwright; no new dependencies.

**Spec:** User request in this conversation, 2026-10-29.

## Global Constraints

- Polish frontend; English code and documentation.
- Missing answers score zero; late deliveries and host reviews remain authoritative.
- Preserve existing sessions and synchronization behavior.
- The symbolic histogram overflow indicators are already removed; keep regression coverage.

## Review Focus

- Invalid/missing credentials must not expose participant summaries.
- Active and closing phases must not expose future question text or results.
- Early finish must omit unplayed questions; missing answers must remain visible with zero points.
- Late deliveries, reviews and reconnects must refresh the table without older requests winning.
- Long estimates and collapsed question controls must fit mobile widths.

### Task 1: Private result summary

**Files:** `src/shared/protocol.ts`, `src/server/contest.ts`, `src/server/routes.ts`,
`tests/personal-results.test.ts`.

**Interfaces:** `ParticipantQuestionResult { questionId, number, text, answer, score }`;
`Contest.participantResults(participantId: string): ParticipantQuestionResult[]`;
`GET /api/results` with participant Bearer token returns `{ version, questions }`.

- [x] Write endpoint tests for authorization, phase gating, isolation, missing answers,
      early finish, late answers, exclusions and restart.
- [x] Run tests and observe failure before implementation.
- [x] Implement a participant-filtered SQLite query and finished-only endpoint.
- [x] Run tests, lint and types; commit the verified server change.

### Task 2: Final participant table

**Files:** `src/client/PersonalResults.svelte`, `src/client/Play.svelte`,
`src/client/style.css`, `tests/e2e/personal-results.spec.ts`, `README.md`.

**Interfaces:** `PersonalResults` consumes the current participant session and contest snapshot
from the existing client store; it uses the endpoint from Task 1 without storing a second ledger.

- [x] Write browser coverage for final-only display, answer/zero-point rows, question show/hide,
      reload, failed-request retry, late changes/reviews, reset and mobile overflow.
- [x] Run browser tests and observe the missing table failure.
- [x] Implement the table, per-question reveal buttons, and version/reconnect-driven loading.
      Cancel stale effect results; retry failed requests automatically.
- [x] Run relevant tests, lint, types and production build; inspect desktop/mobile screenshots.
- [x] Document the endpoint and final participant table; commit the verified UI change.

Verification: five authenticated API tests and six real browser cases pass. Covered desktop,
390px mobile and 320px narrow layouts, including 100-digit answers. Lint, type checks and the
production build pass; reviewed final-table screenshots on desktop and mobile. The symbolic
histogram indicators remain absent.
