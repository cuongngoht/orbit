// The TEST HOOKS: a separate port that exists only when ORBIT_TEST_HOOKS=on. They are how a test
// reads what the scheduler and the workers decided, moves the injected business clock, asks for a
// dispatch, controls a workload and mints a synthetic identity -- never a way to write a reminder,
// a notification or an invoice. Everything goes through the tables the roles themselves read, so a
// hook never reaches into another process.
//
// Every request carries `authorization: Bearer <ORBIT_TEST_HOOKS_TOKEN>` -- a per-run random secret
// the test topology sets -- or it is answered 401 {error: "unauthorized"}; without that secret
// (or with one shorter than 16 characters) the hooks refuse to start at all.
//
//   GET  /orbit/scheduler/v1/decisions?since=<seq>        -> { decisions: [...], through }
//   POST /orbit/scheduler/v1/trigger {schedule, occurrenceId?} -> { executionRef, occurrenceId, scheduledFor }
//   POST /orbit/clock/v1/advance {to}                      -> { evaluatedThrough }   (a barrier)
//   GET  /orbit/workload/v1/attempts?since=<seq>          -> { attempts: [...], through }
//   POST /orbit/workload/v1/control {workload, action, point?} -> { status }
//   POST /orbit/identity/v1/issue {principal, tenant}      -> { token }
//   GET  /orbit/workload/v1/status                         -> { workloads: [...] }
//   GET  /orbit/v1                                         -> what these hooks offer here
import { createHash, randomBytes } from "node:crypto";
import { CONTROLLABLE, FAULT_POINTS, MIN_SECRET, WORKLOADS, config, log, secretOk } from "./config.mjs";
import { sql } from "./db.mjs";
import { HttpError, jsonBody, secretGuard, serve } from "./http.mjs";
import { heartbeat, markReady } from "./role.mjs";
import { isoIn, loadSchedule, occurrenceFromId } from "./schedule.mjs";

const NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const POLL_MS = 50;
const MAX_LIMIT = 500;
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

const invalid = (why) => new HttpError(400, "invalid", { why });

function cursorOf(url) {
  const since = url.searchParams.get("since") ?? "0";
  const limit = url.searchParams.get("limit") ?? String(MAX_LIMIT);
  if (!/^\d{1,18}$/.test(since)) throw invalid("since is a whole number, 0 or more");
  if (!/^\d{1,4}$/.test(limit) || Number(limit) < 1 || Number(limit) > MAX_LIMIT) throw invalid(`limit is 1-${MAX_LIMIT}`);
  return { since: Number(since), limit: Number(limit) };
}

async function until(test, ms = config.barrierMs) {
  const deadline = Date.now() + ms;
  for (;;) {
    const got = await test();
    if (got) return got;
    if (Date.now() >= deadline) return null;
    await pause(POLL_MS);
  }
}

const isoOrNull = (schedule, ms) => (ms === null || ms === undefined ? null : isoIn(schedule, Number(ms)));

// ---- the scheduler ------------------------------------------------------------------------------

async function decisions(db, schedule, url) {
  const { since, limit } = cursorOf(url);
  const only = url.searchParams.get("schedule");
  const where = only ? sql` AND schedule = ${only}` : "";
  const rows = (await db.query(`SELECT seq, schedule, revision, occurrence_id, decision, reason, execution_ref, clock,
      (extract(epoch FROM scheduled_for) * 1000)::bigint AS scheduled_for_ms, (extract(epoch FROM evaluated_at) * 1000)::bigint AS evaluated_at_ms
    FROM schedule_decisions WHERE seq > ${since}${where} ORDER BY seq LIMIT ${limit}`)).rows;
  const shown = rows.map((r) => ({ seq: r.seq, schedule: r.schedule, revision: r.revision, occurrenceId: r.occurrence_id, scheduledFor: isoOrNull(schedule, r.scheduled_for_ms), decision: r.decision, executionRef: r.execution_ref, evaluatedAt: isoOrNull(schedule, r.evaluated_at_ms), reason: r.reason, clock: r.clock }));
  return { body: { decisions: shown, through: rows.length ? rows.at(-1).seq : since } };
}

async function trigger(db, schedule, req) {
  const body = (await jsonBody(req)) ?? {};
  if (typeof body.schedule !== "string") throw invalid("schedule names the schedule to dispatch");
  if (body.schedule !== schedule.id) throw new HttpError(404, "unknown-schedule");
  if (body.occurrenceId !== undefined && occurrenceFromId(schedule, body.occurrenceId).error) throw new HttpError(400, "not-an-occurrence");
  const asked = (await db.query(sql`INSERT INTO trigger_requests (schedule, occurrence_id) VALUES (${body.schedule}, ${body.occurrenceId ?? null}) RETURNING id`)).rows[0].id;
  const done = await until(async () => (await db.query(sql`SELECT status, decision, execution_ref, resolved_occurrence_id, scheduled_for_ms, error FROM trigger_requests WHERE id = ${asked} AND status <> 'pending'`)).rows[0]);
  if (!done) throw new HttpError(504, "barrier-timeout", { why: "the scheduler did not take the request in time" });
  if (done.status === "failed") throw new HttpError(400, done.error ?? "failed");
  return { body: { executionRef: done.execution_ref, occurrenceId: done.resolved_occurrence_id, scheduledFor: isoOrNull(schedule, done.scheduled_for_ms), decision: done.decision } };
}

// ---- the clock ----------------------------------------------------------------------------------

function instantOf(to) {
  const ms = typeof to === "number" ? to : typeof to === "string" && /[zZ]|[+-]\d\d:\d\d$/.test(to) ? Date.parse(to) : NaN;
  if (!Number.isFinite(ms)) throw invalid("to is an ISO 8601 instant with an offset, or epoch milliseconds");
  return Math.floor(ms / 1000) * 1000;
}

async function advance(db, schedule, req) {
  if (config.clockInjection !== "live") throw new HttpError(409, "clock-injection-unsupported");
  const to = instantOf(((await jsonBody(req)) ?? {}).to);
  const moved = await db.query(sql`UPDATE clock_state SET now_ms = ${to}, updated_at = now() WHERE id = 1 AND mode = 'injected' AND now_ms <= ${to} RETURNING now_ms`);
  if (!moved.rows.length) {
    const now = (await db.query("SELECT now_ms FROM clock_state WHERE id = 1")).rows[0]?.now_ms;
    throw new HttpError(409, "clock-backwards", { now: isoOrNull(schedule, now) });
  }
  const through = await until(async () => {
    const row = (await db.query("SELECT evaluated_through_ms FROM clock_state WHERE id = 1")).rows[0];
    return row && Number(row.evaluated_through_ms) >= to ? Number(row.evaluated_through_ms) : null;
  });
  if (through === null) throw new HttpError(504, "barrier-timeout", { why: "the scheduler did not evaluate the new time in time" });
  return { body: { evaluatedThrough: isoIn(schedule, through) } };
}

// ---- workloads ----------------------------------------------------------------------------------

const TERMINAL = new Set(["dead-lettered", "dropped"]);

async function attempts(db, url) {
  const { since, limit } = cursorOf(url);
  const only = url.searchParams.get("workload");
  const where = only ? sql` AND workload = ${only}` : "";
  const rows = (await db.query(`SELECT seq, workload, message_id, business_key, delivery_attempt, outcome, execution_ref, reason,
      to_char(at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS at
    FROM attempts WHERE seq > ${since}${where} ORDER BY seq LIMIT ${limit}`)).rows;
  const shown = rows.map((r) => ({ seq: r.seq, workload: r.workload, messageId: r.message_id, deliveryAttempt: r.delivery_attempt, outcome: r.outcome, executionRef: r.execution_ref, terminalReason: TERMINAL.has(r.outcome) ? r.reason : null, reason: r.reason, businessKey: r.business_key, at: r.at }));
  return { body: { attempts: shown, through: rows.length ? rows.at(-1).seq : since } };
}

const controlRow = async (db, workload) => (await db.query(sql`SELECT desired, actual, ready_at > requested_at AS fresh FROM controls WHERE workload = ${workload}`)).rows[0];

async function settled(db, workload, wanted, needsFresh) {
  const got = await until(async () => {
    const row = await controlRow(db, workload);
    return row.actual === wanted && (!needsFresh || row.fresh) ? row : null;
  });
  if (!got) throw new HttpError(504, "barrier-timeout", { status: (await controlRow(db, workload)).actual });
  return { body: { status: wanted } };
}

const ACTIONS = {
  stop: async (db, w) => {
    await db.query(sql`UPDATE controls SET desired = 'stopped', requested_at = clock_timestamp(), updated_at = now() WHERE workload = ${w}`);
    return settled(db, w, "stopped", false);
  },
  start: async (db, w) => {
    const row = (await db.query(sql`UPDATE controls SET desired = 'running', requested_at = clock_timestamp(), updated_at = now() WHERE workload = ${w} RETURNING actual`)).rows[0];
    return row.actual === "running" ? { body: { status: "running" } } : settled(db, w, "running", true);
  },
  restart: async (db, w) => {
    await db.query(sql`UPDATE controls SET desired = 'running', restart_gen = restart_gen + 1, requested_at = clock_timestamp(), updated_at = now() WHERE workload = ${w}`);
    return settled(db, w, "running", true);
  },
  fault: async (db, w, point) => {
    const points = FAULT_POINTS[w] ?? [];
    if (!points.includes(point)) throw new HttpError(400, "unknown-point", { points });
    await db.query(sql`INSERT INTO faults (workload, point, armed, armed_at) VALUES (${w}, ${point}, TRUE, clock_timestamp())
      ON CONFLICT (workload, point) DO UPDATE SET armed = TRUE, armed_at = clock_timestamp(), fired_at = NULL`);
    return { body: { status: "armed" } };
  },
};

async function control(db, req) {
  const body = (await jsonBody(req)) ?? {};
  if (!WORKLOADS.includes(body.workload)) throw new HttpError(404, "unknown-workload", { workloads: CONTROLLABLE });
  if (!CONTROLLABLE.includes(body.workload)) throw new HttpError(409, "not-controllable", { workloads: CONTROLLABLE });
  if (!Object.hasOwn(ACTIONS, body.action)) throw invalid(`action is one of ${Object.keys(ACTIONS).join(", ")}`);
  log("hooks", `${body.action} ${body.workload}${body.point ? ` at ${body.point}` : ""}`);
  return ACTIONS[body.action](db, body.workload, body.point);
}

async function status(db) {
  const rows = (await db.query(`SELECT workload, desired, actual, reason, restarts,
      to_char(heartbeat_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS heartbeat_at,
      heartbeat_at > clock_timestamp() - interval '10 seconds' AS beating
    FROM controls ORDER BY workload`)).rows;
  return { body: { workloads: rows.map((r) => ({ workload: r.workload, desired: r.desired, actual: r.actual, ready: r.actual === "running" && r.beating === true, reason: r.reason, restarts: r.restarts, heartbeatAt: r.heartbeat_at, controllable: CONTROLLABLE.includes(r.workload), faultPoints: FAULT_POINTS[r.workload] ?? [] })) } };
}

// ---- identities ---------------------------------------------------------------------------------

async function issue(db, req) {
  const body = (await jsonBody(req)) ?? {};
  if (!NAME.test(String(body.principal ?? "")) || !NAME.test(String(body.tenant ?? ""))) throw invalid("principal and tenant are lower-case names, 1-64 characters");
  const tenant = (await db.query(sql`SELECT id FROM tenants WHERE id = ${body.tenant}`)).rows[0];
  if (!tenant) throw new HttpError(404, "unknown-tenant");
  const role = body.principal.endsWith("-writer") ? "writer" : "reader";
  const token = `syn_${randomBytes(32).toString("hex")}`;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.query(sql`INSERT INTO tokens (token_hash, principal, tenant_id, role) VALUES (${tokenHash}, ${body.principal}, ${body.tenant}, ${role})`);
  return { body: { token, principal: body.principal, tenant: body.tenant, role } };
}

const offered = (schedule) => ({
  protocol: "orbit-test-hooks/1",
  clockInjection: config.clockInjection,
  schedules: [{ id: schedule.id, revision: schedule.revision }],
  workloads: WORKLOADS.map((w) => ({ workload: w, controllable: CONTROLLABLE.includes(w), faultPoints: FAULT_POINTS[w] ?? [] })),
});

export function hooksRefusal() {
  if (!config.testHooks) return "the test hooks run only with ORBIT_TEST_HOOKS=on";
  if (!secretOk(config.hooksToken)) return `the test hooks refuse to start: ORBIT_TEST_HOOKS_TOKEN is unset or shorter than ${MIN_SECRET} characters`;
  return null;
}

export async function runHooks(db) {
  const refused = hooksRefusal();
  if (refused) throw new Error(refused);
  const schedule = loadSchedule(config.scheduleFile);
  const routes = [
    { method: "GET", path: /^\/health$/, handler: async () => (await db.query("SELECT 1"), { body: { ok: true } }) },
    { method: "GET", path: /^\/orbit\/v1$/, handler: () => ({ body: offered(schedule) }) },
    { method: "GET", path: /^\/orbit\/scheduler\/v1\/decisions$/, handler: ({ url }) => decisions(db, schedule, url) },
    { method: "POST", path: /^\/orbit\/scheduler\/v1\/trigger$/, handler: ({ req }) => trigger(db, schedule, req) },
    { method: "POST", path: /^\/orbit\/clock\/v1\/advance$/, handler: ({ req }) => advance(db, schedule, req) },
    { method: "GET", path: /^\/orbit\/workload\/v1\/attempts$/, handler: ({ url }) => attempts(db, url) },
    { method: "POST", path: /^\/orbit\/workload\/v1\/control$/, handler: ({ req }) => control(db, req) },
    { method: "GET", path: /^\/orbit\/workload\/v1\/status$/, handler: () => status(db) },
    { method: "POST", path: /^\/orbit\/identity\/v1\/issue$/, handler: ({ req }) => issue(db, req) },
  ];
  await serve({ port: config.ports.hooks, routes, name: "hooks", log, guard: secretGuard(config.hooksToken) });
  await markReady(db, "hooks");
  heartbeat(db, "hooks");
}
