// The test-hook reference adapters (ADR 0035; doc §5.3, §5.5): a project's scheduler, clock and
// workers are asked through the open hook protocols at the ORIGIN the binding gives and the path
// the protocol fixes; a write whose answer was lost is AMBIGUOUS and keyed, a clock the deployment
// cannot move is a capability GAP, a read is a cursor walked for a bounded window -- complete only
// when the cursor caught up.
import assert from "node:assert/strict";
import { test } from "node:test";
import { OPERATIONS, run } from "../skills/orbit-backend-test/hooks/operations.mjs";

const ORIGIN = "http://billing-hooks:8081";
const HOOKS_CREDENTIAL = { tokenEnv: "ORBIT_HOOKS_TOKEN" };
const schedule = { alias: "billing", transport: "orbit-scheduler-v1", origin: ORIGIN, schedule: "billing-daily", credential: HOOKS_CREDENTIAL };
const clock = { alias: "clock", transport: "orbit-clock-v1", origin: ORIGIN };
const workload = { alias: "worker", transport: "orbit-workload-v1", origin: ORIGIN, workload: "reminder-worker" };

const answer = (status, body) => ({ status, json: async () => body });

function hooks(routes) {
  const calls = [];
  const fetch = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : undefined, redirect: opts.redirect, headers: opts.headers });
    const path = new URL(url).pathname;
    const route = routes[`${opts.method} ${path}`];
    if (!route) return answer(404, { error: "not_found" });
    return typeof route === "function" ? route(new URL(url), opts, calls) : route;
  };
  const deps = { fetch, env: { ORBIT_HOOKS_TOKEN: "s3cr3t-hooks" }, now: () => performance.now(), timers: { setTimeout: (f, ms) => setTimeout(f, ms), clearTimeout: (t) => clearTimeout(t) }, pollMs: 5 };
  return { calls, ask: (op, request = {}, bound = {}, deadlineMs = 2_000) => run({ v: "orbit.helper/v1", op, request, bound, deadlineMs }, deps) };
}

test("it answers the six hook operations, and nothing else", async () => {
  assert.deepEqual(OPERATIONS, ["trigger", "decisions", "advance", "attempts", "control", "issue"]);
  assert.equal((await hooks({}).ask("purge")).failure.class, "refused");
});

test("a trigger is asked at the bound origin, on the protocol's own path, for the bound schedule -- and never follows a redirect", async () => {
  const h = hooks({ "POST /orbit/scheduler/v1/trigger": answer(200, { executionRef: "exe-7", occurrenceId: "billing-daily:2026-10-22T09:00:00+07:00", scheduledFor: "2026-10-22T09:00:00+07:00", decision: "dispatched", extra: "x" }) });
  const out = await h.ask("trigger", { occurrenceId: "billing-daily:2026-10-22T09:00:00+07:00" }, { scheduleRef: schedule });
  assert.deepEqual(out.value, { executionRef: "exe-7", occurrenceId: "billing-daily:2026-10-22T09:00:00+07:00", scheduledFor: "2026-10-22T09:00:00+07:00", decision: "dispatched" });
  assert.deepEqual([h.calls[0].url, h.calls[0].method, h.calls[0].body, h.calls[0].redirect], [`${ORIGIN}/orbit/scheduler/v1/trigger`, "POST", { schedule: "billing-daily", occurrenceId: "billing-daily:2026-10-22T09:00:00+07:00" }, "manual"]);
  const redirected = hooks({ "POST /orbit/scheduler/v1/trigger": answer(302, null) });
  assert.equal((await redirected.ask("trigger", {}, { scheduleRef: schedule })).failure.class, "protocol");
});

test("nothing is asked when the binding names no origin or no schedule", async () => {
  const h = hooks({});
  assert.match((await h.ask("trigger", {}, { scheduleRef: { ...schedule, origin: "file:///etc" } })).failure.message, /no origin/);
  assert.match((await h.ask("trigger", {}, { scheduleRef: { ...schedule, origin: `${ORIGIN}/elsewhere` } })).failure.message, /no origin/);
  assert.match((await h.ask("trigger", {}, { scheduleRef: { ...schedule, schedule: undefined } })).failure.message, /no schedule id/);
  assert.equal(h.calls.length, 0);
});

test("a write whose answer never came is AMBIGUOUS and keyed; a hook nobody could reach is the transport's", async () => {
  const lost = hooks({ "POST /orbit/scheduler/v1/trigger": () => Promise.reject(Object.assign(new Error("This operation was aborted"), { name: "AbortError" })) });
  const out = await lost.ask("trigger", { occurrenceId: "billing-daily:2026-10-22T09:00:00+07:00" }, { scheduleRef: schedule });
  assert.deepEqual([out.failure.class, out.failure.operationKey], ["ambiguous", "trigger:billing-daily:billing-daily:2026-10-22T09:00:00+07:00"]);
  const refused = hooks({ "POST /orbit/scheduler/v1/trigger": () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })) });
  assert.equal((await refused.ask("trigger", {}, { scheduleRef: schedule })).failure.class, "transport");
  const reading = hooks({ "GET /orbit/workload/v1/attempts": () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })) });
  assert.equal((await reading.ask("attempts", {}, { workloadRef: workload })).failure.class, "timeout", "a lost READ is a timeout, never ambiguous");
});

test("the clock moves behind its barrier; a deployment that cannot move it is a GAP, never a failure", async () => {
  const moved = hooks({ "POST /orbit/clock/v1/advance": answer(200, { evaluatedThrough: "2026-10-22T09:00:00+07:00" }) });
  assert.deepEqual((await moved.ask("advance", { to: "2026-10-22T09:00:00+07:00" }, { clockRef: clock })).value, { evaluatedThrough: "2026-10-22T09:00:00+07:00" });
  const fixed = hooks({ "POST /orbit/clock/v1/advance": answer(409, { error: "clock-injection-unsupported" }) });
  const gap = await fixed.ask("advance", { to: "2026-10-22T09:00:00+07:00" }, { clockRef: clock });
  assert.deepEqual([gap.failure.class, gap.failure.gap.capability], ["incomplete", "orbit.clock.advance"]);
  const backwards = hooks({ "POST /orbit/clock/v1/advance": answer(409, { error: "clock-backwards" }) });
  assert.equal((await backwards.ask("advance", { to: "2026-10-21T09:00:00+07:00" }, { clockRef: clock })).failure.class, "refused");
  const slow = hooks({ "POST /orbit/clock/v1/advance": answer(504, { error: "barrier-timeout" }) });
  assert.equal((await slow.ask("advance", { to: "2026-10-22T09:00:00+07:00" }, { clockRef: clock })).failure.class, "timeout");
  assert.match((await moved.ask("advance", { to: "2026-10-22T09:00:00" }, { clockRef: clock })).failure.message, /with an offset/, "an instant without an offset is never read in a machine's zone");
});

test("decisions are read by a cursor and the answer is complete only once it caught up", async () => {
  const h = hooks({ "GET /orbit/scheduler/v1/decisions": (url) => answer(200, url.searchParams.get("since") === "0" ? { decisions: [{ seq: 6, occurrenceId: "o-1", decision: "dispatched" }, { seq: 7, occurrenceId: "o-2", decision: "skipped" }], through: 7 } : { decisions: [], through: 7 }) });
  const out = await h.ask("decisions", {}, { scheduleRef: schedule });
  assert.deepEqual([out.value.decisions.map((d) => d.occurrenceId), out.value.through, out.value.completeness], [["o-1", "o-2"], 7, "complete"]);
  assert.match(h.calls[0].url, /since=0&limit=500&schedule=billing-daily$/);
});

test("a bounded wait ends as soon as the matching decision arrives and the cursor caught up", async () => {
  let asked = 0;
  const h = hooks({ "GET /orbit/scheduler/v1/decisions": () => answer(200, (asked += 1) < 3 ? { decisions: [], through: 4 } : { decisions: [{ seq: 5, occurrenceId: "o-due", decision: "dispatched" }], through: 5 }) });
  const started = performance.now();
  const out = await h.ask("decisions", { since: 4, count: 1, match: { occurrenceId: "o-due" }, waitMs: 5_000 }, { scheduleRef: schedule }, 10_000);
  assert.ok(performance.now() - started < 2_000);
  assert.deepEqual([out.value.decisions.map((d) => d.occurrenceId), out.value.through, out.value.completeness], [["o-due"], 5, "complete"]);
});

test("what a watched read answers is what its match asked about -- another message's outcome is never this one's", async () => {
  const h = hooks({ "GET /orbit/workload/v1/attempts": answer(200, { attempts: [{ seq: 1, messageId: "msg-other", outcome: "processed" }, { seq: 2, messageId: "msg-mine", outcome: "retry" }], through: 2 }) });
  const out = await h.ask("attempts", { count: 1, match: { messageId: "msg-mine" } }, { workloadRef: workload });
  assert.deepEqual(out.value.attempts.map((a) => [a.messageId, a.outcome]), [["msg-mine", "retry"]], "the other message's processed is not an answer about this one");
  assert.deepEqual([out.value.through, out.value.completeness], [2, "complete"], "while the cursor still covers everything read");
  const all = await h.ask("attempts", {}, { workloadRef: workload });
  assert.equal(all.value.attempts.length, 2, "no match asks about everything");
});

test("a wait the call's own deadline cuts short of what it waited for is PARTIAL -- a window it did not watch is never claimed", async () => {
  const h = hooks({ "GET /orbit/workload/v1/attempts": (url) => answer(200, Number(url.searchParams.get("since")) < 1 ? { attempts: [{ seq: 1, messageId: "msg-1", outcome: "processed" }], through: 1 } : { attempts: [], through: 1 }) });
  const cut = await h.ask("attempts", { count: 2, match: { messageId: "msg-1" }, waitMs: 60_000 }, { workloadRef: workload }, 300);
  assert.deepEqual([cut.value.attempts.length, cut.value.completeness], [1, "partial"]);
  assert.match(cut.value.gaps.join(), /cut to \d+ ms by the call's own deadline, short of the 60000 ms asked/);
  const met = await h.ask("attempts", { count: 1, match: { messageId: "msg-1" }, waitMs: 60_000 }, { workloadRef: workload }, 300);
  assert.deepEqual([met.value.completeness, met.value.gaps], ["complete", []], "what it waited for was met before the deadline: nothing was cut");
  const fits = await h.ask("attempts", { count: 2, match: { messageId: "msg-1" }, waitMs: 100 }, { workloadRef: workload }, 2_000);
  assert.equal(fits.value.completeness, "complete", "a window that fits the deadline was watched whole");
});

test("what one answer cannot hold is PARTIAL, read on from through", async () => {
  const many = Array.from({ length: 500 }, (_, i) => ({ seq: i + 1, messageId: `m-${i}`, outcome: "processed" }));
  const h = hooks({ "GET /orbit/workload/v1/attempts": () => answer(200, { attempts: many, through: 500 }) });
  const out = await h.ask("attempts", { maxItems: 10 }, { workloadRef: workload });
  assert.deepEqual([out.value.attempts.length, out.value.completeness], [10, "partial"]);
  assert.match(out.value.gaps[0], /read on from through/);
});

test("a workload is controlled only by a declared action, for the bound workload", async () => {
  const h = hooks({ "POST /orbit/workload/v1/control": answer(200, { status: "armed" }) });
  assert.match((await h.ask("control", { action: "kill -9" }, { workloadRef: workload })).failure.message, /one of stop, start, restart, fault/);
  assert.equal(h.calls.length, 0);
  const out = await h.ask("control", { action: "fault", point: "after-effect-before-ack" }, { workloadRef: workload });
  assert.deepEqual([out.value.status, h.calls[0].body], ["armed", { workload: "reminder-worker", action: "fault", point: "after-effect-before-ack" }]);
});

test("the hooks' credential travels only as a bearer header, from the variable the binding names; a refused one is BLOCKED", async () => {
  const h = hooks({ "POST /orbit/scheduler/v1/trigger": answer(200, { executionRef: "exe-1" }) });
  const out = await h.ask("trigger", {}, { scheduleRef: schedule });
  assert.equal(h.calls[0].headers.authorization, "Bearer s3cr3t-hooks");
  assert.equal(JSON.stringify(h.calls[0].body).includes("s3cr3t"), false);
  assert.equal(JSON.stringify(out).includes("s3cr3t"), false);
  const anonymous = hooks({ "POST /orbit/scheduler/v1/trigger": answer(401, { error: "unauthorized" }) });
  const refused = await anonymous.ask("trigger", {}, { scheduleRef: { ...schedule, credential: undefined } });
  assert.equal(anonymous.calls[0].headers.authorization, undefined);
  assert.equal(refused.failure.class, "transport", "a credential the hooks refuse is the environment's, never the product's");
});

test("an identity is issued as the principal and tenant the binding names, behind the hooks' own credential -- a lost answer is AMBIGUOUS, and a hook that answers no token is the tool's", async () => {
  const identity = { alias: "tenant-b-reader", principal: "tenant-b-reader", tenant: "tenant-b", transport: "orbit-identity-v1", origin: ORIGIN, credential: HOOKS_CREDENTIAL };
  const h = hooks({ "POST /orbit/identity/v1/issue": answer(200, { token: "syn_0123456789abcdef0123", principal: "tenant-b-reader", tenant: "tenant-b", role: "reader" }) });
  const out = await h.ask("issue", {}, { identityRef: identity });
  assert.deepEqual(out.value, { principal: "tenant-b-reader", token: "syn_0123456789abcdef0123" }, "only the principal and the token, which the binder alone receives");
  assert.deepEqual([h.calls[0].url, h.calls[0].body, h.calls[0].headers.authorization], [`${ORIGIN}/orbit/identity/v1/issue`, { principal: "tenant-b-reader", tenant: "tenant-b" }, "Bearer s3cr3t-hooks"]);
  assert.match((await h.ask("issue", {}, { identityRef: { ...identity, tenant: "Tenant B" } })).failure.message, /no principal and tenant/);
  assert.equal((await hooks({ "POST /orbit/identity/v1/issue": answer(200, { token: "short" }) }).ask("issue", {}, { identityRef: identity })).failure.class, "protocol");
  const lost = await hooks({ "POST /orbit/identity/v1/issue": () => Promise.reject(Object.assign(new Error("aborted"), { name: "AbortError" })) }).ask("issue", {}, { identityRef: identity });
  assert.deepEqual([lost.failure.class, lost.failure.operationKey], ["ambiguous", "issue:tenant-b-reader:tenant-b"]);
});
