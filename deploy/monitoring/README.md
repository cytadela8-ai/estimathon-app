# Caddy monitoring

Use the HTTPS monitoring commands in the root [README](../../README.md#live-caddy-monitoring).

Prometheus scrapes Caddy's internal port 9180 and the app's opt-in `/internal/metrics` endpoint
every five seconds. The app endpoint exports only aggregate Socket.IO connection gauges. Caddy
blocks `/internal/*` on the public HTTPS listener and keeps its administration API on loopback.

Grafana provisions its Prometheus datasource and dashboard from this directory at startup.
The datasource UID `prometheus` and dashboard UID `estymathon-caddy` are stable references used
by the JSON panels and operational checks. The dashboard is managed through files rather than UI edits.

Queries select the `estymathon_https` server and one `subroute` handler to avoid counting
redirects, monitoring scrapes, or multiple middleware measurements. The HTTPS handlers are grouped
in a `route` block to retain the `subroute` label when accepting all
hostnames and IP addresses; selecting `reverse_proxy` would yield no samples.
HTTP 101 responses are omitted
from latency/throughput queries because their duration represents a WebSocket connection's lifetime.
Percentiles use one-minute rates of classic histogram buckets. Idle windows have no percentile;
they must not be represented as zero latency. Long polling remains part of the HTTP timing data.

Socket.IO counts use public Socket.IO socket/transport APIs and include anonymous projectors.
They track live application connections rather than TCP keep-alives or unique participant accounts.
No participant IDs, IP addresses, credentials, URL paths, or query strings become metric labels.
