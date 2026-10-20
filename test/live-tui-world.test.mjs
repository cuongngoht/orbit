// `live tui` over REAL journals on a real disk (test/task.harness.mjs), through the same feed, follower registry
// and sources `watch` and Orbit Control use: a line another writer appends appears; a workflow's engineering task
// appears the moment the workflow links it; QA begun later is found; a task that ends stays inspectable and its
// leases go; a journal that shrank is read again from its first line; and leaving changes no byte of any journal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { rmSync, writeFileSync } from "node:fs";
import { runTui } from "../cli/live-tui.mjs";
import { openFeed } from "../src/live/feed.mjs";
import { createFollowers } from "../src/live/followers.mjs";
import { parseCursor } from "../src/live/cursor.mjs";
import { QA_SOURCE } from "../src/investigation/live.mjs";
import { createInvestigations } from "../src/investigation/store.mjs";
import { TASK_SOURCE } from "../src/task/live.mjs";
import { taskView } from "../src/task/views.mjs";
import { loadTask } from "../src/task/load.mjs";
import { realIo } from "../src/store/io.mjs";
import { CHECKOUT, taskWorld } from "./task.harness.mjs";
import { fakeTimers, fakeTty, screenOf } from "./fakes/tty.mjs";

const PLACE = { key: "repo-a", project: "repo-a", checkoutId: CHECKOUT, branch: "main", root: "/work/repo-a" };
const SETTINGS = { idleAfterSec: 120, finishedForSec: 600, terminal: { maxRows: 200, showQa: true, showLogs: false } };

function worldOf(w, followers) {
  const io = realIo({ now: w.now });
  const rows = () => w.tasks.list().map((id) => ((m) => ({ id, checkout: CHECKOUT, session: null, terminal: Boolean(m.ended), createdAt: m.meta.at, endedAt: m.ended?.at ?? null, coordinates: m.meta.provider === "automation" }))(loadTask(w.ctx, id).model));
  return {
    nowMs: () => w.clock.at, followers, settings: SETTINGS,
    projects: () => [{ key: "repo-a", name: "repo-a", checkouts: [{ id: CHECKOUT, root: "/work/repo-a", summary: null }] }],
    rows, associate: () => ({ how: "none", task: null, ids: [] }), locate: () => null,
    open: (place, id, cursor) => openFeed({ io, followers, task: TASK_SOURCE, qa: QA_SOURCE }, { taskCtx: { tasks: w.tasks, checkoutSummary: null, now: w.now }, task: id, createdAt: loadTask(w.ctx, id).model.meta.at, qa: QA_SOURCE.open(w.dir, io) }, parseCursor(cursor)),
    show: (place, id) => taskView(loadTask(w.ctx, id).model, w.now()),
    console: async () => ({ message: "no sandbox in this test" }),
  };
}

function viewing(t, root, opts = {}) {
  const w = opts.w ?? taskWorld(t);
  const followers = createFollowers({ pollMs: 15 });
  const tty = fakeTty({ columns: 120, rows: 40 });
  const timers = fakeTimers();
  const id = root ?? w.create();
  const run = runTui(worldOf(w, followers), tty, { start: { place: PLACE, association: { how: "explicit", task: id, ids: [id] }, root: id, overlay: null }, timers });
  return { w, id, tty, timers, followers, run, screen: () => screenOf(tty.all(), 120, 40).join("\n") };
}

const waited = (ms = 60) => new Promise((r) => setTimeout(r, ms));

async function painted(v, ms = 60) {
  await waited(ms);
  v.timers.fire(100);
}

test("a line another writer appends to the journal appears without a refresh, and leaving writes nothing", async (t) => {
  const v = viewing(t);
  v.w.op(v.id, "stage", { stage: "BUILDING" });
  v.w.op(v.id, "act-start", { type: "build", label: "build" });
  await painted(v);
  assert.match(v.screen(), /STAGE +EXECUTING · BUILDING/);
  v.w.op(v.id, "act-complete", { action: "act-1", outcome: "failed", summary: "exit 2" });
  await painted(v);
  assert.match(v.screen(), /BUILD +✗ .*exit 2/);
  const before = v.w.text(v.id);
  v.tty.type("q");
  await v.run;
  assert.equal(v.w.text(v.id), before, "the viewer wrote no byte of the journal");
  assert.equal(v.followers.size(), 0, "no follower lease is left");
});

test("a workflow's engineering task appears by itself when the workflow links it, and is followed too", async (t) => {
  const w = taskWorld(t);
  const wf = w.create({ provider: "automation" });
  w.tick();
  const v = viewing(t, wf, { w });
  await painted(v);
  assert.match(v.screen(), /no engineering task yet/);
  w.tick();
  const eng = w.create({ provider: "autonomous-engineering" });
  w.op(wf, "link-receipt", { domain: "task", ref: eng, outcome: "STARTED" });
  w.op(eng, "stage", { stage: "TESTING" });
  await painted(v);
  await painted(v);
  assert.match(v.screen(), new RegExp(`engineering ${eng} VERIFYING · TESTING`));
  assert.match(v.screen(), /ENGINEER/);
  v.tty.type("c");
  assert.match(v.screen().split("\n")[0], new RegExp(`${eng} .*ORBITING +engineering task`));
  v.tty.type("q");
  await v.run;
  assert.equal(v.followers.size(), 0);
});

test("QA begun after the viewer opened is found and shown, from its allow-listed activity", async (t) => {
  const v = viewing(t);
  await painted(v);
  const inv = createInvestigations(v.w.dir, realIo({ now: v.w.now }));
  const id = inv.create({ objective: "refund form", mode: "observe", inputMode: "pbi", runtime: { task: v.id } });
  inv.append(id, "action", { id: "a1", do: "click", on: "Save", state: "done", ms: 30, headers: { cookie: "secret=1" } });
  inv.append(id, "observation", { id: "o1", action: "a1", layer: "network", state: "observed", data: { requests: [{ method: "POST", endpoint: "/api/refunds", status: 500, body: "Authorization: Bearer abc" }] } });
  v.timers.fire(15000);
  await painted(v);
  assert.match(v.screen(), new RegExp(`QA +${id} · observe · 1 step`));
  assert.match(v.screen(), /last failed POST \/api\/refunds 500/);
  assert.ok(!/secret=1|Bearer abc/.test(v.tty.all()), "nothing the allow-list drops reaches the terminal");
  v.tty.type("q");
  await v.run;
});

test("a task that ends while it is watched stays on screen as it ended, and its leases are released", async (t) => {
  const v = viewing(t);
  await painted(v);
  v.w.op(v.id, "complete", { summary: "refund validated" });
  await painted(v);
  await painted(v);
  assert.match(v.screen(), /COMPLETED/);
  assert.equal(v.followers.size(), 0, "the ended task's journal is no longer polled");
  v.tty.type("q");
  await v.run;
});

test("a journal that shrank is read again from its first line, and the viewer says so", async (t) => {
  const v = viewing(t);
  v.w.op(v.id, "stage", { stage: "BUILDING" });
  v.w.op(v.id, "stage", { stage: "TESTING" });
  await painted(v);
  const first = v.w.text(v.id).split("\n")[0];
  writeFileSync(v.w.tasks.journalFile(v.id), `${first}\n`);
  await painted(v, 80);
  await painted(v);
  assert.match(v.screen(), /journal was begun again; read from its first line/);
  assert.match(v.screen(), /STAGE +QUEUED/, "what the journal now holds: its first line");
  v.tty.type("q");
  await v.run;
});

test("a journal removed while it is watched is not an error: the viewer keeps what it read", async (t) => {
  const v = viewing(t);
  v.w.op(v.id, "stage", { stage: "BUILDING" });
  await painted(v);
  rmSync(v.w.tasks.dirOf(v.id), { recursive: true, force: true });
  await painted(v);
  assert.match(v.screen(), /BUILDING/);
  v.tty.type("q");
  assert.equal((await v.run).why, "detached");
});

test("switching between two tasks fifty times leaves at most their leases, and none after leaving", async (t) => {
  const w = taskWorld(t);
  const a = w.create();
  w.tick();
  const b = w.create({ work: "w-0123456789ab" });
  const v = viewing(t, a, { w });
  for (let i = 0; i < 50; i += 1) {
    v.tty.type("t");
    v.timers.fire(5000);
    v.tty.type(i % 2 ? "k" : "j");
    v.tty.type("\r");
  }
  await painted(v);
  assert.ok(v.followers.size() <= 2, `${v.followers.size()} leases`);
  assert.ok([a, b].includes((await (v.tty.type("q"), v.run)).task));
  assert.equal(v.followers.size(), 0);
});
