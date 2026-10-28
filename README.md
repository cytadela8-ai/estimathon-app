# Estymator

A local-network estimation contest. Polish participant, projector and host interfaces; English
source and documentation. One Node.js process serves the built Svelte app, HTTP API and Socket.IO.
SQLite is the durable authority. No runtime CDN, font, API or cloud dependency.

## Run a contest

Requires Node **22.12 or newer in the 22 LTS line** and pnpm **10.34.7**. Prepare the server while
Internet is available; running a contest does not require Internet access.

```bash
pnpm install --frozen-lockfile
cp .env.example .env
# Edit .env: replace ADMIN_PASSWORD with a unique password of at least 16 characters.
pnpm check
pnpm test
pnpm build
pnpm start
```

Open `http://SERVER_LAN_IP:3000` on the shared Wi-Fi network:

- `/play`: register, type an answer, return to the same session, or recover with a code.
- `/screen`: projector; use the browser's fullscreen mode. Reconnection fetches a new snapshot.
- `/admin`: password-protected host dashboard, questions, settings, participants, recovery QR codes,
  live accepted answers and contest controls.

In `/admin`, add/import questions, save the configuration, then start. Pause/resume retains the
remaining time; **+30 seconds** extends it. Closing a question still respects the configured delivery
window. Results cannot appear until acceptance has closed. Advance manually, or configure an
automatic results interval (at least 15 seconds). After the last question, advancing opens the final
results view. You can also finish early from a question's results.

Each database represents **one contest**. To run another, stop the server and set `DATABASE_PATH`
to a new filename. Previous databases remain intact. Configuration freezes at contest start.

For development, run `pnpm dev` and `pnpm dev:client` in separate terminals. Vite proxies API and
Socket.IO requests to port 3000. Use Vite's port for the frontend during development.

## Questions and rules

The dashboard supports editing, JSON import and JSON export. Import is staged locally; inspect it
and click **Zapisz konfigurację**. Example import:

```json
[
  {
    "text": "Ile kilometrów ma obwód Ziemi na równiku?",
    "correct": "40075",
    "seconds": 180
  }
]
```

Use strings for correct answers so large integers retain precision. Omitted `seconds` uses the
configured default (initially 180). Up to 100 questions, 2,000 characters each. Input retains its
original text, including leading zeroes. Only positive integers are accepted; the organizer sets
the inclusive maximum (up to 100 decimal digits). Empty/invalid drafts do **not** erase the last
accepted answer; the participant interface explains this and displays that accepted value.

The initial maximum is `999999999999999999999999999999`; this is an editable setup value,
not an official contest rule. The number of questions is the length of the saved question list.

**Scoring is deliberately unconfigured.** Answers and distributions work, but the app says that
ranking awaits organizer rules. `src/server/scoring.ts` defines the independent policy:
`Scorer = (estimate: bigint, correct: bigint) => number | null`. Once rules are supplied, compile an
organizer-owned TypeScript module to ESM JavaScript and set `SCORE_MODULE` in `.env` to its absolute
path. It must export `score` with that signature. Finite scores are persisted when each question
finalizes; standings sum stored scores, highest first. Missing submissions have no score. Null
scores are unranked. Equal scores sort by nickname and participant ID for stable display; this
is not an official tie-breaking rule. Keep the scoring module fixed throughout a contest.

Do not enable a real contest's ranking until its score and tie policies have been agreed.
The screen already implements the top-five reveal, animated podium and scrolling full standings
for configured scores. No provisional points formula is silently applied.

## Synchronization protocol

`src/shared/protocol.ts` defines typed Socket.IO events and payloads.

1. Every input event writes its exact text synchronously to `localStorage`, then immediately emits
   a valid numeric edit. There is no submit button, debounce or unload dependency.
2. Each question has a revision counter and random operation ID. The server orders updates by
   `(revision, operationId)`; operation ID breaks equal-revision ties deterministically, independent
   of arrival order. Clients use the maximum locally/server-observed revision plus one.
3. The answer and idempotency receipt commit in one SQLite transaction before acknowledgment.
   Duplicate delivery returns the stored receipt; reusing an ID for different content is rejected.
   Delayed older operations cannot overwrite the latest accepted operation.
4. Unacknowledged edits retry every 1.5 seconds; acknowledgment timeout is 2 seconds. Reconnection
   fetches an authoritative snapshot and the participant's accepted answers before retrying.
5. Local drafts and a separate retry record for the latest valid edit are stored per participant
   and question. Clearing the field or typing intermediate text preserves that retry record. An older server snapshot cannot overwrite
   a newer local draft. Storage events coordinate tabs; server broadcasts accepted answers only to
   sockets belonging to that participant. Truly simultaneous edits use the tie rule above.
6. Rejected late drafts remain locally available with an explicit error. The last accepted server
   answer remains final. Paused operations remain pending until resume. Storage failures are shown
   as errors and no server save is claimed.

The last **accepted version**, rather than the last packet received, is authoritative. Browser
storage does not offer cross-tab atomic increments; simultaneous equal revisions are expected and
resolved with operation IDs. A participant should use one device for active editing. Recovery on
another device restores confirmed answers and then continues the server revision sequence.

Server events never expose current submissions or correct answers publicly while editing remains
possible. Host-only APIs may inspect live answers. Broadcast counts are coalesced to at most ten
updates per second, not one broadcast per keystroke per participant. Countdown uses an absolute
server deadline with a midpoint clock-offset estimate refreshed every 15 seconds and on reconnect;
remaining time is not broadcast every second. A shared browser clock also disables the answer
input at the deadline while disconnected, and returns zero when no deadline exists.

## Deadlines, restart and presentation

- **Strict** (initial setting): arrivals at or after `endsAt` are rejected.
- **Grace**: arrivals before `endsAt + graceSeconds` are accepted; the default editable grace value
  is 5 seconds. This explicitly permits newly created late edits too: client timestamps cannot
  establish when an answer was typed. The server never treats local time as proof.
- Both policies add a two-second non-editing transition after the acceptance window. Results only
  become public after that delay. The projector then reveals the distribution, correct answer
  after 3.5 seconds, and leaderboard after 7 seconds. Reconnecting projectors derive the stage from
  the persisted server timestamp.
- Question phase, version, deadlines, paused remaining time and configuration persist in SQLite.
  On restart an expired question closes before new edits can be accepted. Results stay visible for
  their configured duration from finalization; the server never skips unseen questions to catch up
  with downtime. A running question's absolute deadline is not extended by server downtime.
- Participant credentials survive restart. Admin tokens are deliberately in memory and require
  login again after restart; the dashboard handles expiration automatically.

## LAN operations and backups

`HOST` defaults to `0.0.0.0`, `PORT` to `3000`, and `DATABASE_PATH` to
`data/estymator.sqlite`. Permit the port in the server firewall and disable Wi-Fi client isolation.
Use a stable LAN IP or preconfigured local DNS. Keep the server clock stable and prevent sleep.

Plain HTTP works on a LAN, including random operation IDs (`crypto.getRandomValues` does not need
HTTPS). HTTP exposes credentials to network observers. For a real event, put a local HTTPS reverse
proxy in front of this process and obtain a trusted certificate in advance, for example via DNS-01.
Proxy `/socket.io/` with WebSocket upgrade support as well as normal HTTP. No certificate issuance
or DNS service is required during the contest. HTTPS and a Service Worker are not bundled;
reopening the app while fully offline is not guaranteed. An already loaded page retains offline edits.

SQLite uses WAL, foreign keys and `synchronous=FULL`. Store its files on reliable local disk.
For a consistent backup, stop the process cleanly before copying the database, or use SQLite's
online backup facility. Do not copy only the main `.sqlite` file while the process is writing:
committed transactions may still live in `-wal`. Protect the database, `.env`, and recovery codes.
Recovery codes are bearer credentials; scanning a QR prefills account recovery. Only give each code
to its owner. The recovery URL uses a fragment, which the page removes from browser history.

The login endpoint rate-limits attempts; admin tokens expire after 12 hours. Only the host password
is environment-configured. Participants receive random 256-bit session tokens and 128-bit recovery
codes. No participant credential is included in public state.

## Verification

```bash
pnpm lint       # oxlint complexity <=8 / functions <=100 lines; oxfmt including Svelte
pnpm check      # strict TypeScript and Svelte diagnostics
pnpm test       # SQLite, local draft reconciliation, real HTTP and Socket.IO integration
pnpm build      # static frontend and Node backend
pnpm audit --prod --audit-level=moderate
```

Tests exercise duplicate IDs, delayed operations, equal-revision tabs, invalid input, deadlines,
grace acceptance, pause/resume, automatic progression, scoring integration, process reopening,
stale snapshots, valid edits followed by intermediate drafts, disconnected countdowns,
browser-storage failure, account recovery, admin protection and a 300-client
simultaneous Socket.IO burst. This loopback test does not establish capacity of a venue's Wi-Fi.
Run a rehearsal with representative devices and the actual access point before the event.

Browser checks performed on a 390px viewport: registration, refresh restoration, offline editing
and reconnect, two-tab synchronization, host login/pause/resume/close, and staged projector results.
No uncaught application errors or horizontal overflow were observed in these flows.
Also checked host re-login after server restart, recovery QR generation and final results.
Follow-up browser checks confirmed that an offline valid edit survives clearing the field and
closing/reopening its tab, while the empty draft remains intact; disconnected input locks at zero.
Reversing the revision comparison deliberately failed the out-of-order regression test; the
original implementation was then restored and the full suite passed.

The development-only Svelte Vite plugin transitively includes `deepmerge@4.3.1`, reported under
GHSA-gcqx-w48m-w2h4 with no patched version available at implementation time. It merges trusted
build configuration only and is not shipped in the browser or loaded by the production server.
Production dependencies pass the moderate-severity audit. Recheck the development advisory before
changing tooling or accepting untrusted build configuration.
