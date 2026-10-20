// The MACHINE-WIDE view of task executions is a projection over the projects Orbit knows: it
// reads only the store, writes nothing, survives a corrupt task, a project it cannot read and a
// checkout whose folder is gone -- and needs no session trail to be right.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Refused } from "../src/errors.mjs";
import { projectStoreRoot } from "../src/project/repository.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { createRegistry } from "../src/store/registry.mjs";
import { localDayStart, machineApprovals, machineView } from "../src/task/machine.mjs";
import { ASK, pbi482, taskWorld } from "./task.harness.mjs";

const NOW = "2026-10-06T21:30:00.000Z";
const A = { key: "repo-aaaa", checkout: "a".repeat(64) };
const B = { key: "repo-bbbb", checkout: "b".repeat(64) };
const C = { key: "repo-cccc", checkout: "1".repeat(64) };

// The store base, with three known projects -- bound, the way Orbit binds a checkout it was used
// from -- and B's checkout folder gone.
function machine(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-task-machine-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rooms = stateRooms(base);
  mkdirSync(rooms.checkouts, { recursive: true });
  for (const [p, root] of [[A, join(base, "work", "shop")], [B, join(base, "work", "payments-gone")], [C, join(base, "work", "admin")]]) writeFileSync(join(rooms.checkouts, `${p.checkout}.json`), JSON.stringify({ key: p.key, root }));
  for (const dir of ["shop", "admin"]) mkdirSync(join(base, "work", dir), { recursive: true });
  return { base, rooms };
}

const worldIn = (t, base, p) => taskWorld(t, { dir: projectStoreRoot(base, p.key), project: p.key, checkout: p.checkout, start: "2026-10-06T21:03:00.000Z" });

// Project A: one task working, one finished. Project B: one waiting for a person. Project C: none.
function seeded(t) {
  const m = machine(t);
  const a = worldIn(t, m.base, A);
  const working = a.create({ objective: "PBI-482 Refund validation" });
  a.op(working, "stage", { stage: "IMPLEMENTING" });
  const finished = a.create({ objective: "BUG-218 Search crash" });
  a.op(finished, "attempt-start", {});
  a.op(finished, "attempt-complete", { outcome: "succeeded" });
  a.op(finished, "complete", { summary: "fixed" });
  const b = worldIn(t, m.base, B);
  const waiting = pbi482(b);
  b.op(waiting, "request-approval", ASK);
  return { ...m, working, finished, waiting };
}

// An io that says every path it was asked about, and refuses to write anything.
function recording(io) {
  const seen = [];
  const wrap = (name) => (p, ...rest) => (seen.push([name, p]), io[name](p, ...rest));
  const refuse = () => { throw new Error("the machine view tried to write"); };
  const writes = Object.fromEntries(["write", "append", "mkdir", "ensureDir", "copy", "rename", "remove", "removeFile"].map((n) => [n, refuse]));
  return { io: { ...io, list: wrap("list"), read: wrap("read"), exists: wrap("exists"), ...writes }, seen };
}

const viewOf = (m, io = realIo(), extra = {}) => machineView({ registry: createRegistry(m.rooms, io), rootOf: (key) => projectStoreRoot(m.base, key), io, now: NOW, since: "2026-10-06T00:00:00.000Z", ...extra });

const walk = (dir) => (existsSync(dir) ? readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)])) : []);
const snapshot = (base) => Object.fromEntries(walk(base).map((f) => [relative(base, f), readFileSync(f, "utf8")]));

test("three projects in three states: the counters, the rows and the approval queue are what the journals say", (t) => {
  const m = seeded(t);
  const view = viewOf(m);
  assert.deepEqual(view.counts, { projects: 3, checkouts: 3, tasks: 3, running: 1, queued: 0, waitingApproval: 1, blocked: 0, paused: 0, completedToday: 1, unreadable: 0 });
  const byId = Object.fromEntries(view.tasks.map((r) => [r.id, r]));
  assert.deepEqual([byId[m.working].lifecycle, byId[m.working].project, byId[m.working].checkout], ["EXECUTING", A.key, A.checkout]);
  assert.deepEqual([byId[m.finished].lifecycle, byId[m.finished].endedAt !== null], ["COMPLETED", true]);
  assert.deepEqual([byId[m.waiting].lifecycle, byId[m.waiting].stopReason, byId[m.waiting].attempt.number], ["WAITING_APPROVAL", "HUMAN_APPROVAL_REQUIRED", 3]);
  assert.deepEqual(view.approvals.map((a) => [a.project, a.checkout, a.task, a.id, a.action, a.environment, a.revision]), [[B.key, B.checkout, m.waiting, "apr-1", "database.migrate", "dev", byId[m.waiting].revision]]);
  assert.deepEqual(machineApprovals({ registry: createRegistry(m.rooms, realIo()), rootOf: (key) => projectStoreRoot(m.base, key), io: realIo(), now: NOW, since: null }).approvals.map((a) => a.id), ["apr-1"]);
  assert.equal(view.tasks.filter((r) => r.project === C.key).length, 0, "a project with no tasks room has no tasks, and that is normal");
});

test("a checkout whose folder is gone still shows its tasks: they live in the store, not in the checkout", (t) => {
  const m = seeded(t);
  const row = viewOf(m).tasks.find((r) => r.id === m.waiting);
  assert.deepEqual([row.checkoutKnown, row.checkoutPresent, row.projectName], [true, false, "payments-gone"]);
});

test("one corrupt task is one unreadable row, and one project whose room cannot be read is one problem -- the rest stands", (t) => {
  const m = seeded(t);
  const broken = join(projectStoreRoot(m.base, A.key), "tasks", "tsk-ffffffffffff");
  mkdirSync(broken, { recursive: true });
  writeFileSync(join(broken, "journal.jsonl"), "{not json at all\n\u0000\u0001");
  const newer = join(projectStoreRoot(m.base, A.key), "tasks", "tsk-eeeeeeeeeeee");
  mkdirSync(newer, { recursive: true });
  writeFileSync(join(newer, "journal.jsonl"), `${JSON.stringify({ at: NOW, id: "tsk-eeeeeeeeeeee", project: A.key, checkout: A.checkout, objective: "from the future", schema: 99, kind: "created" })}\n`);
  const view = viewOf(m, realIo(), { rootOf: (key) => (key === C.key ? (() => { throw new Refused(`${m.base}/somewhere must stay inside`); })() : projectStoreRoot(m.base, key)) });
  assert.deepEqual([view.counts.unreadable, view.counts.running, view.counts.waitingApproval, view.counts.completedToday], [2, 1, 1, 1]);
  assert.deepEqual(view.tasks.filter((r) => r.unreadable).map((r) => [r.id, r.why]).sort(), [["tsk-eeeeeeeeeeee", "written by a newer Orbit — upgrade the plugin to read it"], ["tsk-ffffffffffff", "its journal could not be read"]]);
  assert.deepEqual(view.problems, [{ project: C.key, name: "admin", why: "its journal could not be read" }]);
  assert.doesNotMatch(JSON.stringify(view.problems), new RegExp(m.base.replace(/[\\/]/g, ".")), "a problem says what, never where on the disk");
});

test("the view reads only the store and the registered checkouts, lists no other directory, and writes nothing at all", (t) => {
  const m = seeded(t);
  const before = snapshot(m.base);
  const { io, seen } = recording(realIo());
  const view = viewOf(m, io);
  assert.equal(view.counts.tasks, 3);
  assert.deepEqual(snapshot(m.base), before, "not one byte of the store moved");
  const roots = [join(m.base, "work", "shop"), join(m.base, "work", "payments-gone"), join(m.base, "work", "admin")];
  const outside = seen.filter(([name, p]) => !String(p).startsWith(m.base) && !(name === "exists" && roots.includes(p)));
  assert.deepEqual(outside, []);
  assert.ok(seen.filter(([name]) => name === "list").every(([, p]) => String(p).startsWith(m.base)), "the only directories listed are the store's");
  assert.equal(existsSync(join(m.base, "control")), false, "there is no session trail here, and the view needed none");
});

test("'today' is where the caller says it began: a task finished before it is not counted, and none after midnight local", (t) => {
  const m = seeded(t);
  assert.equal(viewOf(m, realIo(), { since: "2026-10-07T00:00:00.000Z" }).counts.completedToday, 0);
  assert.equal(viewOf(m, realIo(), { since: null }).counts.completedToday, 0, "without a day there is no today");
  const start = localDayStart("2026-10-06T21:30:00.000Z");
  assert.ok(start <= "2026-10-06T21:30:00.000Z" && Date.parse("2026-10-06T21:30:00.000Z") - Date.parse(start) < 86400000);
});

test("a machine nobody used Orbit on has nothing to show, and says so with zeros", (t) => {
  const base = mkdtempSync(join(tmpdir(), "orbit-task-empty-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const view = machineView({ registry: createRegistry(stateRooms(base), realIo()), rootOf: (key) => projectStoreRoot(base, key), io: realIo(), now: NOW, since: null });
  assert.deepEqual([view.counts.projects, view.counts.tasks, view.tasks, view.approvals, view.problems], [0, 0, [], [], []]);
});
