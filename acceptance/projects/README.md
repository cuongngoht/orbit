# The example consuming project for Orbit 0.1.0 acceptance

A synthetic invoice application, built twice on purpose: the SAME application and the SAME
accepted contracts on two different backends, so an acceptance run can show that what Orbit
generates, binds and verifies comes from what it discovered and what each adapter declared —
never from a transport it was written for. Nothing in this directory is read by Orbit's `src/` or
its packs, and nothing here imports either. It never ships: `.gitattributes` keeps it out of the
release archive (`/acceptance/** export-ignore`).

| stack | database | messaging | business clock |
|---|---|---|---|
| `invoice-a` | PostgreSQL 16 | AMQP 0-9-1 (RabbitMQ 4) | injected (`CLOCK_INJECTION=live`) |
| `invoice-b` | PostgreSQL 16 | NATS JetStream | this machine's time (`CLOCK_INJECTION=none`) |

```
acceptance/projects/
  assemble.mjs          a stack -> one self-contained checkout (the stack + _shared, byte for byte)
  _shared/contracts/    pbi.md · openapi.json · asyncapi.json · schedule.json  (identical in both)
  _shared/app/          the application: main · config · db (a zero-dependency PostgreSQL client)
                        · schema.sql · migrate · http · api · sink · scheduler · job · cron · schedule
                        · relay · worker · hooks · supervisor · role
  _shared/smoke.mjs     brings a stack up, checks it end to end, brings it down
  _shared/selfcheck.mjs the application's pure logic, checked with no container
  invoice-a/            compose.yaml · Dockerfile · transport.mjs (AMQP) · package.json · README.md
                        · .devcontainer/devcontainer.json · ui-tests/project.json · .dockerignore
  invoice-b/            the same, with transport.mjs (JetStream) over its own nats.mjs client
```

## Assemble a checkout

```bash
node acceptance/projects/assemble.mjs invoice-a /tmp/invoice-a [--variant=<name>] [--force]
cd /tmp/invoice-a && git init -q && git add -A && git commit -qm "invoice-a"   # if a checkout is wanted
```

The checkout holds the stack's files, `app/` and `contracts/` copied byte for byte from `_shared/`,
and — for stack A — `vendor/amqp/`, the import closure of `skills/orbit-backend-test/amqp/index.mjs`
(the client, never the adapter). Stack B's client is its own (`nats.mjs`), independent of
`skills/orbit-backend-test/jetstream/`. `ui-tests/project.json` is the checkout's committed Orbit
configuration (`packs`: `orbit-api-test`, `orbit-backend-test`; `sql.command` for psql).

## Why the application is ONE image

Orbit's isolated topology (ADR 0039) reads a compose file and never runs it: a compose service with
an image is a server (`db`, `broker`), and the compose service that BUILDS the component's
directory is that component's image source — one container, run with the image's own command, and
handed none of the compose file's environment. So the image's `CMD` (`node app/main.mjs all`)
runs every role under an in-container supervisor, every default a role needs is the Dockerfile's
`ENV`, and stopping, restarting or faulting one role is the control hook's job, never a container's.
The package and the compose service share the name `invoice-app`, so the application answers to the
same host name under compose and on a sandbox's network (where a component's alias is its package
name).

## The variants are ground truth

`--variant` writes `app/VARIANT`, so a defect is a different TREE, as one in real code would be.
No endpoint, header or log line ever says which variant runs; anything that reads the source can
find out, as it could read a real defect.

| variant | what it plants | the accepted criterion it contradicts | what the fixture expects |
|---|---|---|---|
| `correct` | nothing | — | every obligation satisfied |
| `no-tenant-check` | reads ignore the caller's tenant; the worker skips its tenant check | API-AC-2 (tenant B reads `inv-a` and sees `canary-invoice-a`); FIX-ASYNC-2 | a leak observed, and a finding with its evidence |
| `broken-auth` | every identity is refused (401) | API-AC-1's positive control fails | the permission obligation INCONCLUSIVE, never a pass or a finding |
| `no-dedupe` | no inbox claim and no unique index: a second delivery writes a second reminder | FIX-ASYNC-1 | a duplicate reminder proven and CONTRADICTED. On stack B the stream's own Nats-Msg-Id window drops a duplicate PUBLICATION, which is another guard, so there only the redelivery after a commit is ground truth |
| `early-ack` | the worker acks before its effect | FIX-ASYNC-1 under a crash after the ack (`after-ack-before-effect`) | the effect missing once the completion deadline passed |
| `no-db-write` | the worker notifies and acks but never writes the reminder | FIX-ASYNC-1 (no reminder row, one notification) | CONTRADICTED below the interface |
| `toast-without-persistence` | create answers 201 and the page toasts, but nothing is stored | UI-AC-2, API-AC-3 | a case ruling only on the toast passes wrongly; the witness below the screen does not |

## The smoke

```bash
node acceptance/projects/_shared/smoke.mjs                    # both stacks, the correct variant
node acceptance/projects/_shared/smoke.mjs --stack=invoice-a --variant=no-dedupe   # exits 1: that is the point
```

It assembles into a temporary directory, runs `docker compose -p orbit-accept-smoke[-b] up -d
--build --wait` on free loopback ports with random per-run secrets, checks the fixture through its
own interfaces (API, page, hooks, broker, sink, and `psql` in the db container), prints the app's
log when anything failed, and always runs `down -v`. It is a check of the fixture, not of Orbit.
`node acceptance/projects/_shared/selfcheck.mjs` checks the application's pure logic (cron and
zones, identities, fire-once, the payload rule, SQL literals) with no container at all.

## Where Orbit binds (both stacks)

| what | stack A | stack B |
|---|---|---|
| UI origin | `http://invoice-app:8080` | same |
| HTTP endpoint (`backend`) | `http://invoice-app:8080/api` (openapi `servers`) | same |
| sink read-back | `http://invoice-app:8081/notifications?key=<businessKey>` | same |
| test hooks | `http://invoice-app:9090` | same (clock advance answers 409) |
| channel | `{exchange: "billing", routingKey: "billing.reminder.requested", endpoint: {host: "broker", port: 5672, vhost: "/"}, credential: {userEnv: "AMQP_USER", passwordEnv: "AMQP_PASSWORD"}}` | `{subject: "billing.reminder.requested", stream: "BILLING", endpoint: {host: "broker", port: 4222}, credential: {userEnv: "NATS_USER", passwordEnv: "NATS_PASSWORD"}}` |
| dead letters | exchange `billing.dlx`, key `billing.reminder.dead`, queue `billing.reminders.dead` (`x-death`) | subject `billing.reminder.dead`, stream `BILLING_DEAD` (`Terminal-Reason`) |
| observer | a queue of the fixture's namespace bound to `billing` (or `billing.dlx`) | a durable consumer of the fixture's namespace on `BILLING` (limits retention) |
| broker credential | `invoice` / `invoice-pass` (synthetic; `AMQP_USER`/`AMQP_PASSWORD` for the app) | same (`NATS_USER`/`NATS_PASSWORD`) |
| hooks credential | `authorization: Bearer $ORBIT_TEST_HOOKS_TOKEN` (`credential.tokenEnv`) | same |
| sink credential | `authorization: Bearer $ORBIT_SINK_TOKEN`; a read names `?tenant=` | same |
| SQL witness | `psql -h db -U invoice -d invoice -X -c` (trust) | same |

What the topology sets on `invoice-app`: the broker credential, `ORBIT_SINK_TOKEN` (always; 16 or
more characters), and for a test `ORBIT_TEST_HOOKS=on` with a per-run random
`ORBIT_TEST_HOOKS_TOKEN` (16 or more). The image holds none of them and defaults the hooks off;
missing the one it needs, the application exits 2 naming it. The smoke mints both secrets per run.

The SQL witness reads `invoices`, `reminders`, `inbox`, `reminder_requests`, `outbox`,
`billing_jobs`, `schedule_decisions`, `attempts`, `deliveries`, `fault_events`, `controls` and
`sink.notifications`. The identities a case names are minted by `POST /orbit/identity/v1/issue`
(`tenant-a-reader`, `tenant-b-reader`, `tenant-a-writer`, ...). Each stack's README gives the exact
shape of every hook.
