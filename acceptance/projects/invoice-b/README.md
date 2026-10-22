# invoice-b — a synthetic invoice application (PostgreSQL · NATS JetStream)

A small, fully synthetic invoice application: an HTTP API with a page, a daily billing scheduler,
an outbox relay, a reminder worker and a notification sink, on PostgreSQL and NATS JetStream. No
real data, no real identities. Its accepted behaviour is in `contracts/`: `pbi.md` (the criteria),
`openapi.json`, `asyncapi.json` and `schedule.json`.

## Run it

```bash
export ORBIT_SINK_TOKEN=$(openssl rand -hex 24)        # the sink's secret: nothing starts without it
docker compose up -d --build --wait      # db, broker and invoice-app; healthy when every role runs
ORBIT_TEST_HOOKS=on ORBIT_TEST_HOOKS_TOKEN=$(openssl rand -hex 24) docker compose up -d --build --wait   # with the test hooks
docker compose down -v                    # everything, volumes included
```

The image holds no secret. `ORBIT_SINK_TOKEN` (16 or more characters) is required, and the test
hooks exist only with `ORBIT_TEST_HOOKS=on` AND an `ORBIT_TEST_HOOKS_TOKEN` (16 or more
characters): without the one it needs, the application exits 2 and says which.

Published on loopback only: the API and page on `127.0.0.1:38080`, the sink on `:38081`, the test
hooks on `:39090` and the NATS client port on `:34222` (`INVOICE_API_PORT`, `INVOICE_SINK_PORT`,
`INVOICE_HOOKS_PORT`, `INVOICE_BROKER_PORT` move them). On the compose network the names are `db`,
`broker` and `invoice-app`.

## What runs

One image runs every role, each a child of an in-container supervisor (`node app/main.mjs`):

| role | what it does |
|---|---|
| `api` | `:8080` — `/api/invoices` (search, read, create), the page `/invoices`, `GET`/`POST /login`, `POST /logout`, `/health` |
| `sink` | `:8081` — the synthetic notification sink, `authorization: Bearer <ORBIT_SINK_TOKEN>`: `POST /notifications` (idempotent by `Idempotency-Key`), `GET /notifications?tenant=<id>[&key=…]` |
| `scheduler` | the `billing-daily` decision loop; a due occurrence runs the billing job, which writes its reminder requests and their outbox messages in one transaction |
| `relay` | publishes the outbox and waits for the stream's acknowledgement; a row is marked published only after it |
| `worker` | consumes reminder requests: dedupe inbox and reminder in one statement, then the sink, then the ack |
| `hooks` | `:9090` — the test hooks, only with `ORBIT_TEST_HOOKS=on` and `ORBIT_TEST_HOOKS_TOKEN` |

The scheduler runs on this machine's time (`CLOCK_INJECTION=none`): there is no business clock to
move. A period is reached when real time reaches it, or dispatched through the trigger hook; the
clock hook answers `409 clock-injection-unsupported`.

## Messaging topology

| resource | kind | |
|---|---|---|
| `BILLING` | stream, limits retention, file storage | subjects `billing.reminder.requested`; duplicate window two minutes |
| `reminders` | durable pull consumer on `BILLING` | explicit ack, ack wait 10 s, `max_deliver` 5; the worker's |
| `BILLING_DEAD` | stream, limits retention | subjects `billing.reminder.dead`, where the worker dead-letters |

Every publication carries `Nats-Msg-Id` (the logical message id, which the stream deduplicates
inside its window), `Correlation-Id` (the business key), `Causation-Id` (the execution that asked
for it) and `Nats-Expected-Stream: BILLING`. The stream keeps limits retention, so another durable
consumer may read it beside the worker's. A delivery is redelivered (`-NAK` with a delay) after a
backoff, and its third failed delivery is published to `billing.reminder.dead` with its original
headers plus `Terminal-Reason` and `Original-Subject`, then terminated (`+TERM`). The worker counts
deliveries itself (`deliveries`); the consumer's `max_deliver` is only a backstop.

## Configuration

| variable | default (in the image) | |
|---|---|---|
| `PGHOST` `PGPORT` `PGUSER` `PGDATABASE` | `db` `5432` `invoice` `invoice` | trust authentication; `PGPASSWORD` when a server wants one |
| `NATS_HOST` `NATS_PORT` | `broker` `4222` | |
| `NATS_USER` `NATS_PASSWORD` | none — compose sets `invoice` / `invoice-pass` | synthetic; the server's `--user` / `--pass` |
| `ORBIT_SINK_TOKEN` | none — required, 16+ characters | the sink's bearer secret; the worker sends it |
| `SINK_URL` | `http://127.0.0.1:8081` | where the worker notifies |
| `CLOCK_INJECTION` | `none` | |
| `BILLING_ACK_WAIT_MS` | `10000` | the consumer's ack wait |
| `ORBIT_TEST_HOOKS` | `off` | the hooks port exists only when this is `on` |
| `ORBIT_TEST_HOOKS_TOKEN` | none — required with the hooks, 16+ characters | the hooks' bearer secret, a random one per run |
| `INVOICE_ROLES` | every role | which roles the supervisor runs |

## Identities

Synthetic bearer tokens, minted only by the identity hook and kept only as their SHA-256. A
principal ending in `-writer` may create; any other reads. The page signs in with a form POST to
`/login` (the token in the body, never in a URL; `GET /login?token=` is refused), which must come
from this origin (its `Origin`, else its `Referer`); it opens a session — a random id in an
`HttpOnly`, `SameSite=Strict` cookie, eight hours — and `POST /logout` ends it. After signing in it
goes only to a path on this origin. The page's script and style are files, so its
`Content-Security-Policy` allows no inline script.

## Test hooks (`:9090`)

Every request carries `authorization: Bearer <ORBIT_TEST_HOOKS_TOKEN>`; without it, or with another
one, the answer is `401 {"error": "unauthorized"}` with `WWW-Authenticate: Bearer`.

| request | answer |
|---|---|
| `GET /orbit/scheduler/v1/decisions?since=<seq>` | `{ decisions: [{ seq, schedule, revision, occurrenceId, scheduledFor, decision, executionRef, evaluatedAt, reason, clock }], through }` |
| `POST /orbit/scheduler/v1/trigger { schedule, occurrenceId? }` | `{ executionRef, occurrenceId, scheduledFor, decision }` |
| `POST /orbit/clock/v1/advance { to }` | `409 { error: "clock-injection-unsupported" }` here |
| `GET /orbit/workload/v1/attempts?since=<seq>` | `{ attempts: [{ seq, workload, messageId, deliveryAttempt, outcome, executionRef, terminalReason, reason, businessKey, at }], through }` |
| `POST /orbit/workload/v1/control { workload, action, point? }` | `{ status }` — `stop`, `start`, `restart`, or `fault` at a point |
| `POST /orbit/identity/v1/issue { principal, tenant }` | `{ token, principal, tenant, role }` |
| `GET /orbit/workload/v1/status` | `{ workloads: [{ workload, desired, actual, ready, reason, restarts, heartbeatAt, controllable, faultPoints }] }` |
| `GET /orbit/v1` | what the hooks offer here: `clockInjection`, the schedules, each workload's fault points |

Decisions are `not-due`, `due`, `missed` (reason `coalesced` or `deadline`), `triggered` and
`duplicate-dispatch`. Attempt outcomes are `processed`, `duplicate`, `retry`, `dead-lettered`,
`dropped`, `fault` (the worker) and `published`, `publish-failed` (the relay). The worker's fault
points are `before-effect`, `after-commit-before-ack`, `after-sink-before-ack` and
`after-ack-before-effect`; the relay's is `after-confirm-before-mark`. An armed point fires once:
the workload exits hard, a `fault_events` row says where, and it stays down until started.
