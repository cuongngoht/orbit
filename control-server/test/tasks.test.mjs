// One checkout's tasks through a real socket: read by project, checkout and task; decided by a
// person with the page's token and the revision the page read -- and refused when the task moved,
// when the approval was decided already, or when the request is not a person's.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { realIo } from "../../src/store/io.mjs";
import { TOKEN_HEADER } from "../src/security.mjs";
import { TOKEN } from "./fixture.mjs";
import { runtimeWorld, serve } from "./checkout.mjs";
import { bind, machine, PAYMENTS, SHOP, tasksIn } from "./machine.mjs";

const OTHER_PAYMENTS = { key: PAYMENTS.key, checkout: "f".repeat(64), dir: "payments-review" };

const path = (p, tail = "") => `/api/v1/projects/${encodeURIComponent(p.key)}/checkouts/${p.checkout}/tasks${tail}`;

async function served(t, opts = {}) {
  const m = machine(t);
  const world = { ...runtimeWorld(m.root), ...(opts.io ? { io: opts.io } : {}) };
  return { ...m, api: await serve(t, m.root, world) };
}

const kindsOf = (m, id) => m.payments.kinds(id);

test("a task is read by project, checkout and task: the list, the task as the page shows it, and its journal from a position on", async (t) => {
  const m = await served(t);
  const list = await m.api.get(path(PAYMENTS));
  assert.deepEqual([list.status, list.json.tasks.map((r) => r.id)], [200, [m.waiting]]);
  const one = await m.api.get(path(PAYMENTS, `/${m.waiting}`));
  assert.equal(one.status, 200);
  assert.deepEqual([one.json.task.lifecycle, one.json.task.stage, one.json.task.attempt.number, one.json.task.decision.nextAction], ["WAITING_APPROVAL", "REGRESSION", 3, "inspect-refund-validation"]);
  const events = await m.api.get(path(PAYMENTS, `/${m.waiting}/events?since=28`));
  assert.deepEqual([events.json.since, events.json.events.map((e) => e.kind)], [28, ["action-started", "approval-requested"]]);
});

test("an unknown task, project or approval is a 404 in its own words, and a malformed id a 400", async (t) => {
  const m = await served(t);
  const unknown = await m.api.get(path(PAYMENTS, "/tsk-000000000000"));
  assert.deepEqual([unknown.status, unknown.json.error.code], [404, "TASK_UNKNOWN"]);
  const project = await m.api.get(path({ key: "repo-nobody", checkout: PAYMENTS.checkout }));
  assert.deepEqual([project.status, project.json.error.code], [404, "PROJECT_UNKNOWN"]);
  const malformed = await m.api.get(path(PAYMENTS, "/tsk-..%2F..%2Fx"));
  assert.deepEqual([malformed.status, malformed.json.error.code], [400, "INVALID_TASK_ID"]);
  const approval = await m.api.post(path(PAYMENTS, `/${m.waiting}/approvals/apr-9/approve`), { human: true, expectedRevision: m.payments.view(m.waiting).revision });
  assert.deepEqual([approval.status, approval.json.error.code], [404, "APPROVAL_UNKNOWN"]);
});

test("another checkout cannot address this checkout's task, even of the same project", async (t) => {
  const m = await served(t);
  bind(m.root, OTHER_PAYMENTS);
  const read = await m.api.get(path(OTHER_PAYMENTS, `/${m.waiting}`));
  assert.deepEqual([read.status, read.json.error.code], [404, "TASK_UNKNOWN"]);
  const write = await m.api.post(path(OTHER_PAYMENTS, `/${m.waiting}/cancel`), { human: true, expectedRevision: m.payments.view(m.waiting).revision });
  assert.deepEqual([write.status, write.json.error.code], [404, "TASK_UNKNOWN"]);
  assert.equal(kindsOf(m, m.waiting).includes("cancelled"), false);
});

test("a decision without the page's token, or from another origin, is refused before anything is read", async (t) => {
  const m = await served(t);
  const body = { human: true, expectedRevision: m.payments.view(m.waiting).revision };
  const bare = await m.api.bare("POST", path(PAYMENTS, `/${m.waiting}/approvals/apr-1/approve`), body);
  assert.deepEqual([bare.status, bare.json.error.code], [403, "MUTATION_TOKEN_REQUIRED"]);
  const evil = await m.api.raw("POST", path(PAYMENTS, `/${m.waiting}/approvals/apr-1/approve`), body, { "content-type": "application/json", origin: "https://evil.example", [TOKEN_HEADER]: TOKEN });
  assert.deepEqual([evil.status, evil.json.error.code], [403, "ORIGIN_NOT_ALLOWED"]);
  assert.equal(kindsOf(m, m.waiting).includes("approval-granted"), false);
});

test("a body is a person's choice among named fields: no human, an unknown field or no revision is refused, and nothing written", async (t) => {
  const m = await served(t);
  const rev = m.payments.view(m.waiting).revision;
  const at = path(PAYMENTS, `/${m.waiting}/approvals/apr-1/approve`);
  const unasked = await m.api.post(at, { expectedRevision: rev });
  assert.deepEqual([unasked.status, unasked.json.error.code], [400, "HUMAN_REQUIRED"]);
  const smuggled = await m.api.post(at, { human: true, expectedRevision: rev, project: SHOP.key, command: "migrate --all" });
  assert.deepEqual([smuggled.status, smuggled.json.error.code], [400, "TASK_BODY_INVALID"]);
  const blind = await m.api.post(at, { human: true });
  assert.deepEqual([blind.status, blind.json.error.code], [400, "TASK_BODY_INVALID"]);
  assert.equal(kindsOf(m, m.waiting).includes("approval-granted"), false);
});

test("Approve once writes one human decision on the revision read; a stale revision is a 409 and a second approve grants nothing", async (t) => {
  const m = await served(t);
  const rev = m.payments.view(m.waiting).revision;
  const at = path(PAYMENTS, `/${m.waiting}/approvals/apr-1/approve`);
  const stale = await m.api.post(at, { human: true, expectedRevision: rev - 2 });
  assert.deepEqual([stale.status, stale.json.error.code], [409, "STALE_REVISION"]);
  assert.equal(kindsOf(m, m.waiting).includes("approval-granted"), false, "a stale decision is never applied, nor retried");
  const done = await m.api.post(at, { human: true, expectedRevision: rev });
  assert.equal(done.status, 200);
  assert.deepEqual([done.json.task.approvals[0].state, done.json.task.revision], ["granted", rev + 1]);
  const twice = await m.api.post(at, { human: true, expectedRevision: rev + 1 });
  assert.deepEqual([twice.status, twice.json.error.code], [409, "APPROVAL_DECIDED"]);
  const grants = m.payments.tasks.read(m.waiting).filter((l) => l.kind === "approval-granted");
  assert.deepEqual(grants.map((l) => [l.by, l.seen]), [["person", rev]], "one grant, by a person, on the revision they read");
});

test("Reject writes one human decision with its reason, and the rejection stays in the history", async (t) => {
  const m = await served(t);
  const rev = m.payments.view(m.waiting).revision;
  const done = await m.api.post(path(PAYMENTS, `/${m.waiting}/approvals/apr-1/reject`), { human: true, expectedRevision: rev, reason: "not during the release freeze" });
  assert.deepEqual([done.status, done.json.task.approvals[0].state, done.json.task.lifecycle], [200, "rejected", "VERIFYING"]);
  assert.deepEqual(m.payments.tasks.read(m.waiting).filter((l) => l.kind === "approval-rejected").map((l) => l.reason), ["not during the release freeze"]);
});

test("pause, resume and cancel are their own routes; each is refused when it would change nothing or the task has ended", async (t) => {
  const m = await served(t);
  const rev = () => m.payments.view(m.waiting).revision;
  const paused = await m.api.post(path(PAYMENTS, `/${m.waiting}/pause`), { human: true, expectedRevision: rev(), because: "a person wants to look first" });
  assert.deepEqual([paused.status, paused.json.task.lifecycle], [200, "PAUSED"]);
  const again = await m.api.post(path(PAYMENTS, `/${m.waiting}/pause`), { human: true, expectedRevision: rev() });
  assert.deepEqual([again.status, again.json.error.code], [409, "TASK_PAUSED"]);
  assert.equal((await m.api.post(path(PAYMENTS, `/${m.waiting}/resume`), { human: true, expectedRevision: rev() })).json.task.lifecycle, "WAITING_APPROVAL");
  const cancelled = await m.api.post(path(PAYMENTS, `/${m.waiting}/cancel`), { human: true, expectedRevision: rev() });
  assert.deepEqual([cancelled.json.task.lifecycle, cancelled.json.task.stopReason], ["CANCELLED", "CANCELLED_BY_HUMAN"]);
  const late = await m.api.post(path(PAYMENTS, `/${m.waiting}/approvals/apr-1/approve`), { human: true, expectedRevision: rev() });
  assert.deepEqual([late.status, late.json.error.code], [409, "TASK_ENDED"]);
});

test("a task whose checkout folder is gone is still read and governed: it lives in the store", async (t) => {
  const m = await served(t);
  rmSync(join(m.root.base, "work", "payments"), { recursive: true, force: true });
  assert.equal((await m.api.get(path(PAYMENTS, `/${m.waiting}`))).status, 200);
  const done = await m.api.post(path(PAYMENTS, `/${m.waiting}/pause`), { human: true, expectedRevision: m.payments.view(m.waiting).revision });
  assert.equal(done.json.task.lifecycle, "PAUSED");
});

test("a task another session is writing answers 503, and the decision is not taken", async (t) => {
  const m = await served(t, { io: { ...realIo(), backoff: [1, 1] } });
  const lock = join(m.payments.tasks.dirOf(m.waiting), ".lock");
  mkdirSync(lock);
  writeFileSync(join(lock, "owner.json"), JSON.stringify({ host: "elsewhere", pid: 1, at: new Date().toISOString(), token: "theirs" }));
  const busy = await m.api.post(path(PAYMENTS, `/${m.waiting}/approvals/apr-1/approve`), { human: true, expectedRevision: m.payments.view(m.waiting).revision });
  assert.deepEqual([busy.status, busy.json.error.code], [503, "TASK_OPERATION_FAILED"]);
  assert.equal(kindsOf(m, m.waiting).includes("approval-granted"), false);
});

test("the tasks room of a project is never opened for a checkout the registry does not know", async (t) => {
  const m = await served(t);
  const shop = tasksIn(t, m.root, SHOP);
  const id = shop.create({ objective: "only shop's" });
  const res = await m.api.get(path({ key: SHOP.key, checkout: "9".repeat(64) }, `/${id}`));
  assert.deepEqual([res.status, res.json.error.code], [404, "PROJECT_UNKNOWN"]);
});
