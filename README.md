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
  live answers, complete results, arrival-time monitoring, host exclusions and contest controls.

In `/admin`, add/import questions, save the configuration, then start. Pause/resume retains the
remaining time; **+30 seconds** extends it. The server automatically ends answering and displays a
synchronization animation for five seconds (configurable from 1 to 60). It then reveals results.
Only the host starts the next question. After the last question, advancing opens final results;
the host can also finish early during answering, a pause, synchronization or question results.
Ending during answering locks the question and waits for the configured synchronization delay
before showing final results. Ending during synchronization keeps its existing deadline. The
pending finish survives a server restart. There is no automatic progression.

Participants remain on a minimal `/play` screen with no navigation to other views. Identity and
recovery stay in an expandable account panel on the same page.

The interface uses locally bundled Bricolage Grotesque with Polish glyphs. Font licensing and
source details are in [public/fonts/README.md](public/fonts/README.md). All visual assets work
without Internet access.

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

Scoring uses the organizer's per-question rule, implemented independently in
`src/server/scoring.ts`:

```text
d_i = abs(ln(x_i / a))
M = max(0.05, median(d_1, ..., d_N))
S_i = Math.round(1000 / (1 + d_i / M))
```

Only valid confirmed submissions for that question contribute to the median. An even-sized
field uses the average of its two middle errors. Exact answers receive 1000 points; all rounding
uses JavaScript's half-up `Math.round`. For example, estimates `100`, `200`, `400` with correct
answer `100` receive `1000`, `500`, `333` points. Each question has its own median.

Points are calculated at reveal, then recalculated for the entire question whenever delayed
answers or host exclusions change the counted submissions. This updates the median and therefore
may change everyone's points. Missing answers receive **zero points** and do not enter the median.
Standings sum per-question points. Equal totals share competition places: **1, 1, 3**. Nickname/ID
ordering only controls display order within a shared place.

The participant sees personal points and place. The projector displays the first five places,
including everyone tied at those places. Tied winners share a podium step; large tied groups scroll
within it. The final scrolling list includes everyone, including zero-point participants.

## Host results and arrival monitoring

Open **Wyniki i monitoring** in `/admin` for cumulative standings, every question's correct answer,
counted answers and points, and a history of unique submission operations. Question and participant
filters narrow the view. The arrival history also supports filtering by entered answer text and a
minimum server arrival delay, initially **3 seconds**. Untick **Tylko spóźnione** to include on-time
operations. The table displays at most 100 operations per page without truncating the history.

For each operation, the host can inspect:

- Participant name/nickname, question, exact answer text, revision and operation ID.
- First server arrival and server deadline as ISO timestamps with milliseconds in UTC.
- Signed server arrival minus server deadline: negative before the deadline, positive after it.
- Phone-reported input time, its locally estimated deadline, their signed difference, and the
  phone's estimated server clock offset at input. These values persist with the original edit.
- Accepted/stale/invalid/paused status, whether the operation is counted or excluded, and the
  timestamped history of host decisions with reasons.

**Phone timing is untrusted telemetry, not proof of when an answer was entered.** Missing phone
metadata is shown as **Brak danych**. Old accepted answers remain preserved when opening an
existing database; historical input timing and deadlines that were never recorded cannot be
reconstructed. Repeated delivery keeps the first recorded server arrival unchanged.

Late answers count automatically without a time cutoff, even after results or the final podium
appear, or after another question starts. The host can **Wyklucz** an operation with a reason and
later **Przywróć** it. Exclusion selects that participant's previous eligible, non-excluded revision;
if none exists, the question scores zero. Reviews do not delete submissions. Duplicate delivery
cannot undo exclusion. Rankings update automatically, so displayed results remain revisable.

All monitoring and review endpoints require host authentication. Agents can use the same atomic
HTTP operations as the dashboard: `GET /api/admin/results` and `POST /api/admin/review` with
`{ participantId, operationId, excluded, reason }` and the host bearer token.

## Synchronization protocol

`src/shared/protocol.ts` defines typed Socket.IO events and payloads.

1. Every input event writes its exact text synchronously to `localStorage`, then immediately emits
   a valid numeric edit. There is no submit button, debounce or unload dependency.
2. Each question has a revision counter and random operation ID. The server orders updates by
   `(revision, operationId)`; operation ID breaks equal-revision ties deterministically, independent
   of arrival order. Clients use the maximum locally/server-observed revision plus one.
3. The answer, first-arrival audit entry, any score changes and idempotency receipt commit in
   one SQLite transaction before acknowledgment.
   Duplicate delivery returns the stored receipt; reusing an ID for different content is rejected.
   Delayed older operations cannot overwrite the latest accepted operation.
4. Unacknowledged edits retry every 1.5 seconds; acknowledgment timeout is 2 seconds. Reconnection
   fetches an authoritative snapshot and the participant's accepted answers before retrying.
5. Local drafts and a separate retry record for the latest valid edit are stored per participant
   and question. Clearing the field or typing intermediate text preserves that retry record.
   An older server snapshot cannot overwrite a newer local draft. Storage events coordinate tabs; server broadcasts accepted answers only to
   sockets belonging to that participant. Truly simultaneous edits use the tie rule above.
6. Valid pending edits keep retrying for previous questions too, with no late-delivery cutoff.
   Invalid drafts remain local; invalid numeric submissions show an error. Paused operations stay
   pending until resume. Storage failures are visible and no server save is claimed.
7. Revision watermarks persist separately from the counted draft. Recovery snapshots include
   the highest observed revisions, including excluded submissions, so moderation cannot reset the
   next revision counter. Authoritative snapshots can revert confirmed answers while preserving
   genuinely unacknowledged local edits.

The highest eligible, non-excluded version is counted. Browser storage does not offer cross-tab atomic increments; simultaneous equal revisions are expected and
resolved with operation IDs. A participant should use one device for active editing. Recovery on
another device restores confirmed answers and then continues the server revision sequence.

Server events hide current submissions and correct answers until the reveal delay ends. Host-only
APIs may inspect live answers. Broadcast counts are coalesced to at most ten updates per second, not one broadcast per keystroke per participant. Countdown uses an absolute
server deadline with a midpoint clock-offset estimate refreshed every 15 seconds and on reconnect;
remaining time is not broadcast every second. A shared browser clock also disables the answer
input at the deadline while disconnected, and returns zero when no deadline exists.

## Deadlines, restart and presentation

- The server owns the question deadline. The participant input and edit handler lock locally at
  the offset-adjusted deadline, even when disconnected. This does not stop retrying stored edits.
- There is no strict/grace acceptance policy. Server arrival lateness is monitored rather than
  automatically rejected. A modified client can submit late edits; host review is the enforcement
  mechanism. Client timestamps are never trusted as evidence.
- After the deadline, the projector displays the synchronization animation for the configured
  delay (initially five seconds). It reveals the distribution, then the correct answer after
  3.5 seconds and the leaderboard after 7 seconds. Reconnecting projectors restore the stage from
  server timestamps. Later arrivals update the displayed results without restarting the animation.
- Question phase, version, deadlines, paused remaining time and configuration persist in SQLite.
  Host commands persist state and schedule together. On restart an expired question moves through
  its reveal transition; the server never starts another question without the host. Downtime does
  not extend a running deadline. Input telemetry, first arrivals and host exclusions also persist.
- Participant credentials survive restart. Admin tokens are in memory and expire after 12 hours;
  restarting requires host login again. The dashboard handles expiration automatically.

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

Tests exercise duplicate IDs, delayed/out-of-order operations, equal-revision tabs, invalid input,
indefinite late arrival, pause/resume, manual progression, median recalculation, zero missing scores,
shared places, host exclusions/restoration, audit timing, revision watermarks and abrupt termination.
The 300-client Socket.IO burst uses a real SQLite file with WAL and FULL synchronization. This
loopback test does not establish capacity of a venue's Wi-Fi; rehearse on the actual access point.

The automated Playwright suite runs Chromium at desktop (1920×1080) and mobile (390×844) sizes:

```bash
pnpm exec playwright install chromium  # download once while Internet is available
pnpm test:e2e                         # builds and tests production frontend/backend
```

Each test gets an isolated server process and temporary SQLite database, cleaned up afterward.
Coverage includes offline edit/clear/deadline/close/reopen and late delivery to an earlier question;
immediate close, two-tab synchronization and account recovery; host question import, timing filters,
exclusion/restoration and tied podium; participant/projector reconnection after a server restart.
Tests assert no participant navigation links or uncaught errors in the primary browser context,
and check overflow on participant, host and projector screens. Failure screenshots and traces go
in ignored `test-results/`; inspect traces with `pnpm exec playwright show-trace PATH_TO_TRACE`.
Use `pnpm exec playwright test --project=mobile` after building to run one viewport only.

There is no CI workflow or pre-commit hook; invoke these commands in your own automation.

The development-only Svelte Vite plugin transitively includes `deepmerge@4.3.1`, reported under
GHSA-gcqx-w48m-w2h4 with no patched version available at implementation time. It merges trusted
build configuration only and is not shipped in the browser or loaded by the production server.
Production dependencies pass the moderate-severity audit. Recheck the development advisory before
changing tooling or accepting untrusted build configuration.
