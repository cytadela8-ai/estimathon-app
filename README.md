# Estymathon

The application is named Estymathon. Existing `estymator.*` browser-storage keys and
`data/estymator.sqlite` remain unchanged to preserve sessions, drafts, and saved contests.

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

After final results, open **Przebieg konkursu → Resetuj konkurs → Potwierdź reset**. Reset returns
to setup, keeps questions, settings, participant accounts and recovery codes, and clears the current
answers, points, schedule and submission/review history. You can edit the questions and start again;
connected participants and the projector return to the waiting screen automatically.

Before resetting, the server writes a consistent, owner-readable SQLite backup beside the active
database, named `DATABASE_FILENAME.backup-TIMESTAMP-UUID.sqlite`. The dashboard displays its name.
It contains the finished contest's results, submissions, host decisions and participant credentials.
If the backup fails, the contest stays unchanged. Keep these files private and manage their retention
on the server. To inspect an archived contest, stop the process and point `DATABASE_PATH` at its copy.

Question IDs change on reset. Queued answers from the previous run are rejected, including after a
participant reconnects; they cannot affect the new run. Only a finished contest can be reset, and
reset requires confirmation. The private API is `POST /api/admin/reset` with `{ "confirmed": true }`
and the host bearer token; it returns `{ "backup": "filename.sqlite" }`.

Each database has **one active contest**. You can instead start with a new `DATABASE_PATH` to keep
participants separate between events. Configuration freezes at contest start and unlocks on reset.

For development, run `pnpm dev` and `pnpm dev:client` in separate terminals. Vite proxies API and
Socket.IO requests to port 3000. Use Vite's port for the frontend during development.

## Docker deployment

Requires Docker Engine with BuildKit and Docker Compose v2 or newer. Choose one of the two
standalone Compose files. Both build the same production image and run one Node process with
non-root permissions, a read-only root filesystem, a health check, restart policy, and bounded logs.
Neither Compose file sets CPU, memory, or PID limits for the services.
The image uses the existing frozen pnpm lockfile; only `better-sqlite3` runs its native build script.
Build tools, development dependencies, local databases, and environment files stay out of the image.

```bash
cp .env.production.example .env.production
chmod 600 .env.production
# Edit .env.production: set ADMIN_PASSWORD to a unique password of at least 16 characters.
```

**HTTP:** set `HTTP_PORT` if port 80 is unavailable, then run:

```bash
docker compose --env-file .env.production -f docker-compose.http.yml up -d --build --wait
```

Open `http://SERVER_LAN_IP` (include `:HTTP_PORT` if you changed the port). HTTP exposes passwords,
session tokens, and answers to network observers; use it only on a trusted network.

**HTTPS:** supply your own certificate and private key. Set these in `.env.production`:

```dotenv
TLS_CERT_PATH=/absolute/path/to/fullchain.pem
TLS_KEY_PATH=/absolute/path/to/privkey.pem
```

Use PEM files: the certificate file contains the server certificate followed by any intermediate
certificates; the private key must match and be unencrypted.
Both paths must already exist and be readable by Caddy's UID/GID **1000:1000**. Keep the key private,
for example mode `0640` with group `1000`. Store these files outside the repository; Compose mounts
them read-only, and they are never copied into the image. Missing files cause startup to fail.

Use the server's LAN IP, or resolve any hostname to it with local DNS or client hosts files.
Caddy accepts all hostnames and IP addresses; no `DOMAIN` setting is required. The certificate
must still cover the address used by the browser: use DNS subject alternative names for hostnames
and IP subject alternative names for IP addresses. Other addresses reach the same server but fail
normal browser certificate validation. Allow TCP ports 80 and 443 on the LAN; UDP 443 is optional
for HTTP/3. Public DNS, public inbound access, and Internet
access for certificate management are unnecessary. Clients must trust your certificate's issuer;
install your private CA's root certificate on participant and projector devices if needed. Run:

```bash
docker compose --env-file .env.production -f docker-compose.https.yml up -d --build --wait
docker compose --env-file .env.production -f docker-compose.https.yml logs --tail=100 caddy
```

Open `https://SERVER_LAN_IP` or `https://YOUR_HOSTNAME`. Caddy serves the supplied certificate,
redirects HTTP to HTTPS on the same host while preserving the path and query string, and
proxies both Socket.IO polling and WebSocket connections. Certificate automation and OCSP fetching
are explicitly disabled: Caddy does not contact ACME or renew these files. See the
[Caddy TLS documentation](https://caddyserver.com/docs/caddyfile/directives/tls) for PEM file loading.
Only Caddy publishes host ports; the app is on an internal network.
Use one address consistently during a contest: browser sessions and drafts are stored per origin.

Manage certificate expiration and renewal yourself. After replacing the certificate or key on the
host, recreate Caddy so file bind mounts pick up the new files, including atomically replaced files:

```bash
docker compose --env-file .env.production -f docker-compose.https.yml up -d \
  --no-deps --force-recreate --wait caddy
```

The HTTPS file sets `TRUST_PROXY=1` so login limits use the client address supplied by the single
trusted Caddy hop. Leave this unset for direct HTTP. Enable it only when the application listener
is reachable exclusively through your trusted proxy. Caddy's administration endpoint stays inside
its container on loopback. No separate proxy or application port needs to be exposed.

Both files use the `estymathon` Compose project and its `app-data` volume, mounted at `/app/data`.
This contains `estymator.sqlite`, its WAL files, and automatic pre-reset backups. The HTTPS file
also persists Caddy runtime storage and configuration in `caddy-data` and `caddy-config` volumes;
the supplied certificate and key remain in the host files specified above.
Use reliable local storage and keep these volumes private. Existing host `data/` files are not
imported automatically. Run a single app container; in-memory timers, tokens, and broadcasts are
not designed for multiple replicas sharing SQLite.

For subsequent commands, use your chosen Compose file consistently. For HTTPS, for example:

```bash
# Status and recent logs.
docker compose --env-file .env.production -f docker-compose.https.yml ps
docker compose --env-file .env.production -f docker-compose.https.yml logs --tail=100 app caddy

# Rebuild after updating source. Review pinned base image versions/digests for security updates.
docker compose --env-file .env.production -f docker-compose.https.yml build --pull
docker compose --env-file .env.production -f docker-compose.https.yml pull caddy
docker compose --env-file .env.production -f docker-compose.https.yml up -d --wait

# Stop before taking a consistent backup; copy the entire data directory, including any WAL files.
docker compose --env-file .env.production -f docker-compose.https.yml stop app
mkdir -m 700 backup
docker compose --env-file .env.production -f docker-compose.https.yml cp app:/app/data/. ./backup/
docker compose --env-file .env.production -f docker-compose.https.yml start app
```

Choose a fresh backup directory each time and store a protected copy off the server. To restore
or import an existing contest, stop the app and use a temporary container to access its volume:

```bash
# Replace /absolute/path/to/backup with a directory containing estymator.sqlite and any WAL files.
docker compose --env-file .env.production -f docker-compose.https.yml stop app
docker compose --env-file .env.production -f docker-compose.https.yml run --rm --no-deps \
  --user 0:0 --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER \
  -v /absolute/path/to/backup:/restore:ro app \
  sh -c 'find /app/data -mindepth 1 -maxdepth 1 -type f -delete && \
    cp -a /restore/. /app/data/ && chown -R node:node /app/data'
docker compose --env-file .env.production -f docker-compose.https.yml start app
```

Restoring replaces the active contest: back it up first. To inspect a pre-reset archive instead,
copy that archive into a fresh backup directory as `estymator.sqlite` and restore that directory.
Application restarts retain participant accounts and contest state; the host must log in again.

To switch HTTP/HTTPS, run `down` with the old file, then `up -d --build --wait` with the new file,
using the same environment file and project name. `down` retains volumes; **`down -v` deletes them**.
Switching origins requires participant recovery codes because browser storage is origin-specific.
Check certificate expiration and test backups before a live contest. Docker marks failed health
checks as unhealthy; the restart policy restarts exited processes, not merely unhealthy containers.

### Live Caddy monitoring

For the HTTPS deployment, an optional Prometheus/Grafana overlay provides a preconfigured dashboard.
Set a dedicated `GRAFANA_ADMIN_PASSWORD` in `.env.production`, then run:

```bash
docker compose --env-file .env.production -f docker-compose.https.yml \
  -f docker-compose.monitoring.yml up -d --build --wait
```

Open **http://127.0.0.1:3100**, log in as `admin` with that password, and open **Estymathon · Caddy**
(also the default home dashboard). The password initializes Grafana on its first startup; change
an existing account's password in Grafana rather than editing the environment variable.
From another machine, use an SSH tunnel and open the same local URL:

```bash
ssh -N -L 3100:127.0.0.1:3100 USER@SERVER_LAN_IP
```

The dashboard refreshes every **5 seconds**, showing:

- HTTP latency p50, **p95**, and p99, calculated over a rolling **one-minute** window.
- Completed requests per second, HTTP status rates, and 5xx responses per second.
- Live Socket.IO connections, split into polling and WebSocket transports, including projectors.
- Active proxied requests/streams, Caddy availability, CPU usage, and resident memory.

Percentiles are estimates from Caddy's fixed histogram buckets, not exact per-request timings.
They measure completed HTTP requests at the proxy, including Socket.IO long polling; long polls can
therefore increase them during an otherwise idle contest. HTTP 101 WebSocket lifetimes are excluded.
These metrics do not measure Socket.IO message acknowledgments or browser network round-trip times.
Socket.IO connection counts represent connected app sockets, not unique people or all TCP sockets;
idle HTTP keep-alive connections and HTTP/2 multiplexing are not counted as Socket.IO connections.
See [Caddy's metric definitions](https://caddyserver.com/docs/metrics) for the underlying histograms.
Allow two scrape intervals and some requests before expecting latency data. With no completed
requests in the window, latency panels show no samples.

Only Grafana publishes a host port, bound to loopback. Prometheus and the metrics listeners stay
inside Docker; Caddy's administrative API remains on container loopback. The app's metrics endpoint
is enabled only by the monitoring overlay and is blocked from the public HTTPS routes. Monitoring
uses local provisioned dashboards and disables Grafana update checks, reporting, and plugin downloads.
It does not require a cloud account or Internet access after the images have been downloaded.

Prometheus retains at most **7 days or 1 GB** of time-series blocks, whichever limit is reached first;
its WAL and current head data use additional space. `prometheus-data` and `grafana-data` volumes
persist history and dashboard accounts independently of the contest database. Use both Compose files
for subsequent monitoring operations. To stop monitoring while leaving the contest running:

```bash
docker compose --env-file .env.production -f docker-compose.https.yml \
  -f docker-compose.monitoring.yml stop grafana prometheus
```

Provisioning files and dashboard queries live in `deploy/monitoring/`; no manual dashboard import
or plugin installation is needed. This overlay requires the HTTPS file, which defines Caddy.

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
operations. Counted answers, question result rows and submission operations use server-side pages
of at most **100 rows**. Filters apply to the entire matching dataset before pagination. Changing
a filter returns to page one; automatic refreshes retain the current page. The overview fetches
configuration and participants without including answer records or the public results snapshot.
The **Odpowiedzi** tab fetches counted answers only while it is open.

For each operation, the host can inspect:

- Participant name/nickname, question, exact answer text, revision and operation ID.
- First server arrival and server deadline as ISO timestamps with milliseconds in UTC.
- Signed server arrival minus server deadline: negative before the deadline, positive after it.
- Phone-reported input time, its locally estimated deadline, their signed difference, and the
  phone's estimated server clock offset at input. These values persist with the original edit.
- Accepted/stale/invalid/paused status, whether the operation is counted or excluded, and the
  timestamped host decisions with reasons, paged in groups of 20 when the history is expanded.

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

`GET /api/admin/answers?page=1` returns `{ items, page, pageSize, total }` for counted answers.
`GET /api/admin/results` accepts `auditPage` and `resultsPage` (both default to 1), plus `questionId`,
`participant` (name or nickname), `value` (literal substring), `lateOnly=true|false` and
`minimumSeconds` (nonnegative server delay). `value`, `lateOnly` and `minimumSeconds` filter the
submission history; question and participant filters also apply to question results. The response
contains `auditPagination` and `resultsPagination` with `{ page, pageSize, total }`, alongside the
bounded `audit` array and `questions[].results` arrays (at most 100 result rows across all questions).
Ranks are calculated before filtering or pagination. Page sizes are fixed on the server; invalid
page numbers return HTTP 400, and pages beyond the end resolve to the last available page.
`GET /api/admin/reviews/:participantId/:operationId?page=1` returns a decision-history page of at
most 20 entries. Monitoring includes only the latest 20 decisions for each visible operation;
expanding its history fetches older decisions on demand.

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
7. Revision watermarks persist in a per-participant/question SQLite table, updated in the same
   transaction as submission history. Existing databases initialize it from history once on first
   startup; reset clears it. Watermarks remain separate from the counted draft. Recovery snapshots include
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
or DNS service is required during the contest with pre-provisioned certificates. The Docker HTTPS
setup above bundles Caddy; the Node process itself serves HTTP. A Service Worker is not bundled;
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
exclusion/restoration and tied podium; ending from active/paused/closing phases; reset confirmation,
restart of the contest with retained sessions/questions, offline draft isolation between runs; and
participant/projector reconnection after a server restart.
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

### Question results

After each question, the projector shows separate top-five rankings for that question and the
whole contest, including shared places. The question ranking shows each participant’s submitted
value beside their name (or **Brak odpowiedzi**). The host's question tables show all participants in
score order with their question places, independently of the overall ranking.

The answer histogram is centered on the correct answer and spans ±2M in logarithmic space.
M is the same median absolute logarithmic error used in scoring, with a minimum of 0.05.
Forty-eight equal-width log buckets cover the range; two additional overflow buckets retain extreme
answers. Nine vertical numeric labels mark half-M steps from −2M through the correct answer to +2M.
Bar counts are hidden. Axis values and the center marker appear with the correct-answer reveal.
Late answers and host reviews automatically update both rankings and the chart.

### Clear participant browser data

On `/play`, open the nickname / recovery-code menu and choose **Wyczyść dane i wyloguj**.
The confirmation explains that this clears all localStorage for this origin, the current tab's
sessionStorage, login credentials, and unsent drafts. Other open participant tabs also sign out.
Server-side accounts and confirmed answers remain; save the recovery code before confirming.

### Participant final results

At the end of the contest, `/play` shows the participant's confirmed answer and points for each
played question. Questions without a counted answer show **Brak odpowiedzi** and zero points. Each row
has **Pokaż treść** / **Ukryj treść** controls for the question text. Unplayed questions are omitted
when the host ends early. The table restores after reopening the browser and refreshes after
late synchronization or host reviews; failed loads retry automatically.

`GET /api/results` requires the participant's `Authorization: Bearer <token>` credential. It
returns `{ version, questions }`, where each personal row contains `questionId`, `number`, `text`,
`answer` and `score`. It exposes neither other participants' answers nor correct-answer fields,
and returns HTTP 409 before the contest finishes.

### Revision-history performance

See [performance testing](scripts/README.md) for isolated 100-bot load tests and testing copies of
existing contest databases. The [stepwise optimization results](scripts/history-performance.md)
compare real production HTTP, Socket.IO, and browser probes on the same retained revision history.

### Participant moderation and IP history

In `/admin`, open **Uczestnicy** to see each participant's distinct observed IP addresses.
Addresses are recorded on registration, successful recovery, authenticated results requests,
and authenticated Socket.IO connections. History survives restarts; addresses from before this
feature cannot be reconstructed. IP history is available only in the authenticated admin overview.
Direct connections ignore forwarded headers. With `TRUST_PROXY=1`, the nearest forwarded
address is used; keep the app accessible only through the configured trusted proxy.

Choose **Usuń uczestnika**, then **Potwierdź usunięcie** to permanently delete the account,
answers, scores, submission/review history, and recorded IPs. Active sessions disconnect and the
old token and recovery code stop working. Remaining participants' revealed scores are recalculated.
Deletion does not ban someone from registering again. Existing database backups retain their data.

Agents can use `GET /api/admin/overview` (`participants[].ips` is a string array) and
`DELETE /api/admin/participants/:participantId`, both with the host bearer token. Deletion returns
`{ ok: true }`, or HTTP 404 if the participant does not exist.

### Timer adjustment and history cleanup

During an active or paused question, **−30 sekund** removes 30 seconds, clamped to zero.
An active question with less than 30 seconds remaining closes immediately and waits the full
configured reveal delay. A paused question stays paused until resumed.
Agents can send `POST /api/admin/command` with `{ "command": "shorten" }`.

Under **Przebieg konkursu**, **Wyczyść historię odpowiedzi** opens a confirmation before permanently
removing old submission history across all participants and questions. It retains the ten most
recent first arrivals per participant/question (timestamp ties use descending revision, then
operation ID), plus the currently counted answer when it is older. Groups with at most ten
submissions are unchanged. Excluded paused submissions without a permanent receipt are also retained
so retries cannot undo moderation. Current answers, scores, accounts, question deadlines and revision
watermarks remain intact. Decisions for deleted submissions are removed; those submissions can
no longer be reviewed or restored. Decisions for retained submissions remain available.

Idempotency receipts in `operations` remain to prevent retries from reviving deleted/excluded
submissions or accepting reused operation IDs with different content. Cleanup reduces the history
queried by monitoring; it does not bound receipt storage. SQLite reuses the freed pages for later
writes; cleanup does not shrink the database file or run a blocking `VACUUM`.

The authenticated agent endpoint is `POST /api/admin/cleanup` with `{ "confirmed": true }`.
It returns `{ deletedSubmissions, deletedReviews }`. Cleanup is transactional and safe to repeat.
