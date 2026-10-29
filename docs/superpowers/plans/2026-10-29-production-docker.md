# Production Docker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Provide standalone HTTP and HTTPS Compose deployments of Estymathon.

**Architecture:** Build the frontend and backend in a multi-stage Node 22 image and run one
unprivileged process with persistent SQLite storage. HTTPS adds Caddy as the sole host ingress,
with operator-provided certificates and a private application network.

**Tech Stack:** Docker BuildKit, Docker Compose, Node 22, pnpm 10.34.7, Caddy 2.11.7, SQLite.

**Spec:** User request for a production Dockerfile and separate HTTP and HTTPS Compose setups.
The HTTPS deployment uses the operator's certificate and key on a private network; no ACME.

## Global Constraints

- Preserve existing uncommitted changes and the application's single-process SQLite model.
- Use the existing frozen dependency lockfile and explicitly build only the SQLite native module.
- Keep secrets and local databases out of the Docker build context.
- Implement in this session; do not commit or deploy to an external service.

## Review Focus

- Missing passwords must fail before starting; short passwords must fail at application startup.
- A fresh data volume must be writable by the unprivileged application user.
- Recreating a container must retain participant credentials and contest state.
- Both Socket.IO polling and WebSocket upgrades must work through HTTPS.
- Forwarded addresses must affect login limits only when one trusted proxy is enabled.

### Task 1: Application image and HTTP deployment

**Files:** `Dockerfile`, `.dockerignore`, `docker-compose.http.yml`.

- [x] Build production dependencies and compiled assets in separate stages; copy only runtime files.
- [x] Add health checks, restart policy, bounded logs, and persistent SQLite storage.
- [x] Build and start an isolated local test project; check assets, API, authentication,
      SQLite persistence, runtime permissions, and graceful stop with a connected WebSocket.

### Task 2: HTTPS ingress and client addresses

**Files:** `docker-compose.https.yml`, `deploy/Caddyfile`, `src/server/app.ts`,
`src/server/index.ts`, `tests/proxy.test.ts`, `tests/shutdown.test.ts`.

- [x] Write rate-limit tests for trusted and untrusted forwarded headers; demonstrate failure
      before enabling the one-hop option, then verify the implementation passes.
- [x] Add Caddy HTTPS with read-only certificate/key mounts and no published app port.
- [x] Disconnect Socket.IO clients before HTTP shutdown; verify polling and WebSocket clients
      cannot stall deployment stops.
- [x] Validate Caddy configuration and exercise HTTPS, redirects, polling, and WebSockets locally.

### Task 3: Operator instructions and final checks

**Files:** `README.md`, `.env.production.example`, `.gitignore`.

- [x] Document environment setup, both launch commands, certificates, updates, backups, and restore.
- [x] Validate Compose interpolation failures, run lint/types/relevant tests and production audit,
      and review the final diff for accidental changes or secrets.

## Verification results

- Docker build and Dockerfile checks passed; both standalone Compose models validated.
- Local HTTP and HTTPS deployments became healthy with their production security settings.
- Initial HTTPS verification used a local test certificate authority. The deployment now explicitly
  disables automation and reads operator-provided PEM files; it requires no public issuance.
- Frontend routes/assets, API authentication, polling, WebSockets, redirects, and HSTS passed.
- UID 1000, read-only root filesystems, private app ingress, SQLite integrity and WAL were verified.
- Participant credentials survived container recreation and the documented backup/restore cycle.
- The shutdown regression failed before the pre-close hook and passed afterward for both transports;
  both real containers then exited cleanly with connected WebSockets in under 250 milliseconds.
- Lint, TypeScript/Svelte checks, 11 relevant tests, and the production dependency audit passed.
- Temporary deployment projects and their test volumes were removed after verification.

## Supplied certificate verification

- Caddy configuration validated with networking disabled and the supplied PEM files mounted read-only.
- A live TLS handshake verified the exact supplied certificate fingerprint and certificate trust.
- HTTPS frontend/API, HTTP 308 redirects, Socket.IO polling and WebSockets passed.
- The live configuration disabled certificate automation and OCSP fetching, with no ACME issuer.
- Missing environment values, nonexistent files, and mismatched certificate/key pairs failed clearly.
- Atomically replacing certificate/key files and recreating Caddy served the replacement certificate.
