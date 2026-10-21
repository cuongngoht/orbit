// The TEST-HOOK reference adapters' operations (ADR 0035; doc §5.3, §5.5): what a project's own
// scheduler, clock and workers SAY through the open test-hook protocols a project exposes for its
// tests -- read back by a cursor, moved behind a barrier, controlled only as declared -- over
// HTTP, with an injected `fetch` so the suite needs no network:
//
//   orbit.scheduler/v1  GET  /orbit/scheduler/v1/decisions?since&schedule  -> { decisions, through }
//                       POST /orbit/scheduler/v1/trigger {schedule, occurrenceId?}
//   orbit.clock/v1      POST /orbit/clock/v1/advance {to} -> { evaluatedThrough }, a barrier
//   orbit.workload/v1   GET  /orbit/workload/v1/attempts?since&workload    -> { attempts, through }
//                       POST /orbit/workload/v1/control {workload, action, point?}
//   orbit.identity/v1   POST /orbit/identity/v1/issue {principal, tenant}  -> { token }
//
// An identity is issued INSIDE the task's network, by the run's own binder (src/run/worker.mjs):
// nothing on the host reaches the hooks of an isolated sandbox. The token it answers is handed back
// to that binder alone and goes into a helper's environment -- it is never an output, a log line or
// an answer a case can read.
//
// The ORIGIN is the bound resource's -- a component the task started -- and the path is the
// protocol's, never the request's; a redirect is not followed. The hooks' own credential is read
// from the environment under the name the binding gave (`credential.tokenEnv`) and sent as a
// bearer header: never in the request, never in an answer. What the request may say is the
// operation's own parameters: a cursor, an instant, an action. A hook that answers it cannot do
// what was asked (`clock-injection-unsupported`) is a capability GAP; a barrier that timed out is a
// timeout; a write whose answer was lost -- a trigger, a clock move, a control -- is AMBIGUOUS,
// keyed so it can be read back, and never sent again.
const LIMIT = 500;
const MARGIN_MS = 250;
const POLL_MS = 100;
const DEFAULT_MAX = 500;
const ACTIONS = ["stop", "start", "restart", "fault"];
const NAME = /^[a-z0-9][a-z0-9.-]{0,63}$/;

const OPS = {
  trigger: (asked, deps) => trigger(asked, deps),
  decisions: (asked, deps) => decisions(asked, deps),
  advance: (asked, deps) => advance(asked, deps),
  attempts: (asked, deps) => attempts(asked, deps),
  control: (asked, deps) => control(asked, deps),
  issue: (asked, deps) => issue(asked, deps),
};

export const OPERATIONS = Object.keys(OPS);

export async function run(asked, deps) {
  const op = OPS[asked?.op];
  if (!op) return refusal(`these hooks answer ${OPERATIONS.join(", ")} — not ${String(asked?.op).slice(0, 40)}`);
  const timed = { ...asked, request: asked.request ?? {}, bound: asked.bound ?? {}, startedAt: deps.now() };
  return op(timed, deps).catch((e) => failed(e));
}

const refusal = (message) => ({ failure: { class: "refused", message } });

class HookFailure extends Error {
  constructor(cls, message, extra = {}) {
    super(message);
    Object.assign(this, { cls, extra });
  }
}

const failed = (e) => ({ failure: { class: e instanceof HookFailure ? e.cls : "protocol", message: String(e?.message ?? e).slice(0, 300), ...(e instanceof HookFailure ? e.extra : {}) } });

// ── one call ───────────────────────────────────────────────────────────────

const remaining = (asked, deps) => Math.max(1, (asked.deadlineMs ?? 30_000) - (deps.now() - asked.startedAt) - MARGIN_MS);

function originOf(value) {
  const origin = String(value?.origin ?? "");
  if (!/^https?:\/\/[^/\s?#]+$/.test(origin)) throw new HookFailure("refused", "the bound resource names no origin to reach its hooks at — an http(s) origin with no path");
  return origin;
}

// `writes` names the key a lost answer is read back by: a call that may have reached the hook and
// whose answer never came is AMBIGUOUS for a write, a timeout for a read.
async function called(asked, deps, call) {
  const controller = new AbortController();
  const timer = deps.timers.setTimeout(() => controller.abort(), remaining(asked, deps));
  try { return await answered(await deps.fetch(`${call.origin}${call.path}`, { method: call.method, headers: { accept: "application/json", ...(call.body ? { "content-type": "application/json" } : {}), ...call.auth }, body: call.body ? JSON.stringify(call.body) : undefined, redirect: "manual", signal: controller.signal }), call); }
  catch (e) { throw e instanceof HookFailure ? e : lost(e, call); }
  finally { deps.timers.clearTimeout(timer); }
}

function authOf(value, deps) {
  const token = value?.credential?.tokenEnv ? deps.env?.[value.credential.tokenEnv] : undefined;
  return token ? { authorization: `Bearer ${token}` } : {};
}

function lost(e, call) {
  const refused = /ECONNREFUSED|ENOTFOUND|EAI_AGAIN/.test(String(e?.cause?.code ?? e?.cause?.message ?? e?.message));
  if (refused) return new HookFailure("transport", `${call.method} ${call.path} could not reach the hooks — ${e?.cause?.code ?? e?.message}`);
  return call.writes ? new HookFailure("ambiguous", `${call.method} ${call.path} was sent and its answer never came`, { operationKey: call.writes }) : new HookFailure("timeout", `${call.method} ${call.path} did not answer in time`);
}

async function answered(res, call) {
  const body = await jsonOf(res);
  const row = STATUSES.find((s) => s.when(res.status, body));
  if (!row.cls) return body ?? {};
  throw new HookFailure(row.cls, `${call.method} ${call.path} answered ${res.status} ${String(body?.error ?? "").slice(0, 60)}${body?.why ? ` — ${String(body.why).slice(0, 120)}` : ""}`, row.extra?.(call) ?? {});
}

async function jsonOf(res) {
  try { return await res.json(); }
  catch { return null; }
}

const STATUSES = [
  { when: (s) => s >= 200 && s < 300, cls: null },
  { when: (s, b) => s === 409 && b?.error === "clock-injection-unsupported", cls: "incomplete", extra: (call) => ({ gap: { capability: call.capability, why: "this deployment's clock cannot be moved — its hooks say clock-injection-unsupported" } }) },
  { when: (s) => s === 504, cls: "timeout" },
  { when: (s) => s === 401 || s === 403, cls: "transport" },
  { when: (s) => s >= 300 && s < 400, cls: "protocol" },
  { when: (s) => s >= 400 && s < 500, cls: "refused" },
  { when: () => true, cls: "transport" },
];

// ── writes ─────────────────────────────────────────────────────────────────

async function trigger(asked, deps) {
  const schedule = asked.bound.scheduleRef ?? {};
  const occurrenceId = asked.request.occurrenceId ?? asked.bound.occurrenceRef?.occurrenceId;
  if (!NAME.test(String(schedule.schedule ?? ""))) return refusal("the bound schedule names no schedule id its scheduler knows");
  const body = await called(asked, deps, { origin: originOf(schedule), auth: authOf(schedule, deps), method: "POST", path: "/orbit/scheduler/v1/trigger", body: { schedule: schedule.schedule, ...(occurrenceId ? { occurrenceId: String(occurrenceId) } : {}) }, writes: `trigger:${schedule.schedule}:${occurrenceId ?? "now"}` });
  return { value: { executionRef: body.executionRef ?? null, occurrenceId: body.occurrenceId ?? null, scheduledFor: body.scheduledFor ?? null, decision: body.decision ?? null } };
}

async function advance(asked, deps) {
  const to = asked.request.to;
  if (!(typeof to === "number" || /(?:Z|[+-]\d{2}:\d{2})$/.test(String(to ?? "")))) return refusal("request.to is the business instant to move the clock to: ISO 8601 with an offset, or epoch milliseconds");
  const body = await called(asked, deps, { origin: originOf(asked.bound.clockRef), auth: authOf(asked.bound.clockRef, deps), method: "POST", path: "/orbit/clock/v1/advance", body: { to }, writes: `advance:${to}`, capability: "orbit.clock.advance" });
  return { value: { evaluatedThrough: body.evaluatedThrough ?? null } };
}

async function control(asked, deps) {
  const workload = asked.bound.workloadRef ?? {};
  const { action, point } = asked.request;
  if (!ACTIONS.includes(action)) return refusal(`request.action is one of ${ACTIONS.join(", ")}`);
  const body = await called(asked, deps, { origin: originOf(workload), auth: authOf(workload, deps), method: "POST", path: "/orbit/workload/v1/control", body: { workload: workload.workload, action, ...(point ? { point: String(point) } : {}) }, writes: `control:${workload.workload}:${action}${point ? `:${point}` : ""}` });
  return { value: { status: body.status ?? null } };
}

// A synthetic identity, as the principal and tenant the binding names: a write whose answer was lost is AMBIGUOUS,
// keyed by who it was for, and never sent again.
async function issue(asked, deps) {
  const identity = asked.bound.identityRef ?? {};
  if (!NAME.test(String(identity.principal ?? "")) || !NAME.test(String(identity.tenant ?? ""))) return refusal("the bound identity names no principal and tenant its hooks can issue it as");
  const body = await called(asked, deps, { origin: originOf(identity), auth: authOf(identity, deps), method: "POST", path: "/orbit/identity/v1/issue", body: { principal: identity.principal, tenant: identity.tenant }, writes: `issue:${identity.principal}:${identity.tenant}` });
  return typeof body.token === "string" && body.token.length >= 16 ? { value: { principal: body.principal ?? identity.principal, token: body.token } } : { failure: { class: "protocol", message: "the identity hooks answered no token" } };
}

// ── reads by a cursor, for a bounded window ────────────────────────────────

async function decisions(asked, deps) {
  const schedule = asked.bound.scheduleRef ?? {};
  const page = (since) => called(asked, deps, { origin: originOf(schedule), auth: authOf(schedule, deps), method: "GET", path: `/orbit/scheduler/v1/decisions?since=${since}&limit=${LIMIT}${schedule.schedule ? `&schedule=${encodeURIComponent(schedule.schedule)}` : ""}` });
  const seen = await watched(asked, deps, (since) => page(since).then((b) => ({ items: b.decisions ?? [], through: b.through })), { occurrenceId: (d) => d.occurrenceId, decision: (d) => d.decision });
  return seen.failure ? seen : { value: { decisions: seen.items, through: seen.through, completeness: seen.completeness, gaps: seen.gaps } };
}

async function attempts(asked, deps) {
  const workload = asked.bound.workloadRef ?? {};
  const page = (since) => called(asked, deps, { origin: originOf(workload), auth: authOf(workload, deps), method: "GET", path: `/orbit/workload/v1/attempts?since=${since}&limit=${LIMIT}${workload.workload ? `&workload=${encodeURIComponent(workload.workload)}` : ""}` });
  const seen = await watched(asked, deps, (since) => page(since).then((b) => ({ items: b.attempts ?? [], through: b.through })), { messageId: (a) => a.messageId, outcome: (a) => a.outcome, executionRef: (a) => a.executionRef });
  return seen.failure ? seen : { value: { attempts: seen.items, through: seen.through, completeness: seen.completeness, gaps: seen.gaps } };
}

// Pages from `since` until the window closes or `count` matching items were read and the cursor
// caught up. Complete only when the last page said there was nothing more to read.
async function watched(asked, deps, page, fields) {
  const until = untilOf(asked.request, fields);
  if (until.refused) return refusal(until.refused);
  const state = { items: [], through: until.since, caughtUp: false, matched: 0, endsAt: deps.now() + Math.min(until.waitMs ?? 0, remaining(asked, deps)) };
  while (!finished(state, until, deps)) await paged(state, page, until, deps);
  return { ...state, completeness: state.caughtUp ? "complete" : "partial", gaps: state.caughtUp ? [] : [`more than ${until.max} items were waiting — one answer holds at most that many; read on from through`] };
}

function untilOf(r, fields) {
  const since = r.since ?? 0;
  if (!(Number.isInteger(since) && since >= 0)) return { refused: "request.since is the cursor a previous answer's through gave, a whole number" };
  if (r.count !== undefined && !(Number.isInteger(r.count) && r.count >= 1)) return { refused: "request.count is a whole number, 1 or more" };
  const match = Object.fromEntries(Object.entries(r.match ?? {}).filter(([k, v]) => fields[k] && typeof v === "string"));
  return { since, count: r.count ?? Infinity, waitMs: Number.isInteger(r.waitMs) && r.waitMs >= 0 ? r.waitMs : 0, match, fields, max: Math.min(Number.isInteger(r.maxItems) && r.maxItems > 0 ? r.maxItems : DEFAULT_MAX, DEFAULT_MAX) };
}

const finished = (state, until, deps) => state.items.length >= until.max || (state.caughtUp && (state.matched >= until.count || deps.now() >= state.endsAt));

async function paged(state, page, until, deps) {
  const got = await page(state.through);
  const items = got.items.slice(0, until.max - state.items.length);
  Object.assign(state, { items: [...state.items, ...items], through: Number.isInteger(got.through) ? got.through : state.through, caughtUp: got.items.length < LIMIT && items.length === got.items.length, matched: state.matched + items.filter((i) => matches(i, until)).length });
  if (state.caughtUp && !finished(state, until, deps)) await new Promise((r) => deps.timers.setTimeout(r, Math.min(deps.pollMs ?? POLL_MS, Math.max(1, state.endsAt - deps.now()))));
}

const matches = (item, until) => Object.entries(until.match).every(([k, v]) => until.fields[k](item) === v);
