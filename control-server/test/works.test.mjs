// One checkout's tracked works through a real socket: the list and one work as the page shows it -- the SAME `workViewOf` the
// terminal and Orbit Live read -- found by project, checkout and work, and never written. The works here are written through the
// work subject's own door (src/work/track/write.mjs) and the sessions' working sets are files in the store's own room, so a hook
// is not part of this test: nothing in it is evidence that a host's hook ran.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { projectStoreRoot } from "../../src/project/repository.mjs";
import { realIo } from "../../src/store/io.mjs";
import { taskSessionMark } from "../../src/memory/session.mjs";
import { createWorks } from "../../src/work/store.mjs";
import { link, report, track } from "../../src/work/track/write.mjs";
import { workingSetRoom } from "../../src/work/track/tail.mjs";
import { runtimeWorld, serve } from "./checkout.mjs";
import { bind, machine, PAYMENTS, snapshot, SHOP } from "./machine.mjs";

const path = (p, tail = "") => `/api/v1/projects/${encodeURIComponent(p.key)}/checkouts/${p.checkout}/works${tail}`;

const OTHER_PAYMENTS = { key: PAYMENTS.key, checkout: "f".repeat(64), dir: "payments-review" };

const SESSION = "sess-works-1";

let clock = 0;
const stamp = () => new Date(Date.UTC(2026, 9, 17, 9, 0, clock++)).toISOString();

function writer(m, p, session = SESSION) {
  const storeRoot = projectStoreRoot(m.root.store, p.key);
  const ctx = { works: createWorks(storeRoot, realIo({ host: "laptop-a", now: stamp })), now: stamp, session: taskSessionMark(session), checkout: p.checkout, host: "claude" };
  return { ctx, storeRoot };
}

// The lines a Claude Code session's hooks keep: an edit, then a check named like one.
function workingSet(m, p, host, session, lines) {
  const dir = workingSetRoom(projectStoreRoot(m.root.store, p.key), host, p.checkout);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${taskSessionMark(session)}.jsonl`), `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`);
}

async function served(t) {
  const m = machine(t);
  const world = runtimeWorld(m.root);
  return { ...m, world, api: await serve(t, m.root, world) };
}

test("a checkout's works are listed by what was reported, and one is read as the engine's own view of it", async (t) => {
  const m = await served(t);
  const { ctx } = writer(m, PAYMENTS);
  const made = track(ctx, { objective: "Fix the refund limit", route: "orbit-develop", because: "a small change" });
  const list = await m.api.get(path(PAYMENTS));
  assert.deepEqual([list.status, list.json.works.map((w) => [w.work, w.title, w.mode, w.standing])], [200, [[made.work, "Fix the refund limit", "developer", "OPEN"]]]);
  const one = await m.api.get(path(PAYMENTS, `/${made.work}`));
  assert.equal(one.status, 200);
  assert.deepEqual([one.json.work.work, one.json.work.mode, one.json.work.lifecycle.state, one.json.work.evidence.level, one.json.work.route.to], [made.work, "developer", "RECEIVED", "none", "orbit-develop"]);
});

test("the session's observed edits and checks are in the view, flagged as observed, and a path another session wrote is shared", async (t) => {
  const m = await served(t);
  const { ctx } = writer(m, PAYMENTS);
  const made = track(ctx, { objective: "Fix the refund limit" });
  const lines = [
    { t: stamp(), ev: "post-tool", tool: "edit", paths: ["src/RefundService.cs", "src/Shared.cs"], call: "c1" },
    { t: stamp(), ev: "post-tool", tool: "command", cmd: { class: "test", exe: "dotnet", ok: true }, call: "c2" },
  ];
  workingSet(m, PAYMENTS, m.api.ctx.world.io.host, SESSION, lines);
  workingSet(m, PAYMENTS, m.api.ctx.world.io.host, "sess-works-other", [{ t: stamp(), ev: "post-tool", tool: "edit", paths: ["src/Shared.cs"], call: "c9" }]);
  const view = (await m.api.get(path(PAYMENTS, `/${made.work}`))).json.work;
  assert.deepEqual([...view.activity.files].sort((a, b) => a.path.localeCompare(b.path)), [{ path: "src/RefundService.cs", attribution: "observed" }, { path: "src/Shared.cs", attribution: "shared" }]);
  assert.deepEqual(view.activity.checks.map((c) => [c.what, c.result, c.current]), [["dotnet (named like a test)", "exit-ok", true]]);
  assert.equal(view.lifecycle.state, "IN_PROGRESS");
});

test("a host's done is reported, never verified; a linked task that is not readable here is said so", async (t) => {
  const m = await served(t);
  const { ctx } = writer(m, PAYMENTS);
  const made = track(ctx, { objective: "Fix the refund limit" });
  link(ctx, { work: made.work, what: "task", target: "tsk-0123456789ab" });
  report(ctx, { work: made.work, outcome: "done", summary: "fixed", proved: ["the unit test ended ok"] });
  const view = (await m.api.get(path(PAYMENTS, `/${made.work}`))).json.work;
  assert.deepEqual([view.lifecycle.state, view.evidence.level, view.tasks[0].readable], ["REPORTED_DONE", "reported", false]);
  assert.deepEqual(view.summary.proved, ["the unit test ended ok"]);
});

test("an unknown work, another checkout's work and a work nobody tracked are one answer: 404 in the route's words; a malformed id is a 400", async (t) => {
  const m = await served(t);
  bind(m.root, OTHER_PAYMENTS);
  const { ctx } = writer(m, PAYMENTS);
  const made = track(ctx, { objective: "Fix the refund limit" });
  const unknown = await m.api.get(path(PAYMENTS, "/w-000000000000"));
  assert.deepEqual([unknown.status, unknown.json.error.code], [404, "WORK_UNKNOWN"]);
  const other = await m.api.get(path(OTHER_PAYMENTS, `/${made.work}`));
  assert.deepEqual([other.status, other.json.error.code], [404, "WORK_UNKNOWN"]);
  const project = await m.api.get(path({ key: "repo-nobody", checkout: PAYMENTS.checkout }));
  assert.deepEqual([project.status, project.json.error.code], [404, "PROJECT_UNKNOWN"]);
  const malformed = await m.api.get(path(PAYMENTS, "/w-..%2F..%2Fx"));
  assert.deepEqual([malformed.status, malformed.json.error.code], [400, "INVALID_WORK_ID"]);
});

test("another project's checkout sees none of this checkout's works", async (t) => {
  const m = await served(t);
  const { ctx } = writer(m, PAYMENTS);
  track(ctx, { objective: "Fix the refund limit" });
  const shop = await m.api.get(path(SHOP));
  assert.deepEqual([shop.status, shop.json.works], [200, []]);
});

test("a work is read, never written: no POST or PUT is a route, and a read leaves the store as it was", async (t) => {
  const m = await served(t);
  const { ctx, storeRoot } = writer(m, PAYMENTS);
  const made = track(ctx, { objective: "Fix the refund limit" });
  const before = snapshot(storeRoot);
  for (const read of [path(PAYMENTS), path(PAYMENTS, `/${made.work}`)]) await m.api.get(read);
  assert.deepEqual(snapshot(storeRoot), before);
  for (const method of ["post", "put"]) assert.equal((await m.api[method](path(PAYMENTS, `/${made.work}`), { state: "failed" })).status, 405);
  assert.equal((await m.api.post(path(PAYMENTS), { objective: "make one" })).status, 405);
  assert.deepEqual(snapshot(storeRoot), before);
});
