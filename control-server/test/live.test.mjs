// Orbit Live through a real socket: one task's journal, its view and its QA activity as Server-Sent Events, resumable
// from a cursor, refused as JSON before any header, ended when the task ends, and read-only from end to end.
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectStoreRoot } from "../../src/project/repository.mjs";
import { realIo } from "../../src/store/io.mjs";
import { createInvestigations } from "../../src/investigation/store.mjs";
import { CURSOR } from "../src/live/cursor.mjs";
import { ROUTES } from "../src/router.mjs";
import { runtimeWorld, serve } from "./checkout.mjs";
import { kinds, stream, waitFor } from "./live.mjs";
import { machine, PAYMENTS, SHOP, snapshot } from "./machine.mjs";

const at = (p, tail = "") => `/api/v1/projects/${encodeURIComponent(p.key)}/checkouts/${p.checkout}/tasks${tail}`;
const live = (m, id = m.working) => at(SHOP, `/${id}/events/stream`);
const hasView = (frames) => frames.some((f) => f.event === "task-view");
const ids = (frames) => frames.filter((f) => f.event !== "ping" && f.id !== undefined).map((f) => f.id);

async function served(t) {
  const m = machine(t);
  return { ...m, api: await serve(t, m.root, runtimeWorld(m.root)) };
}

const decide = (m, observed = "the refund page rendered") => m.shop.op(m.working, "decide", { observed, hypothesis: "the API answers", nextAction: "check-refund" });

// An investigation begun against `task`'s sandbox, in the shop project's own room, with one browser step.
function investigation(m, id, task) {
  const store = createInvestigations(projectStoreRoot(m.root.store, SHOP.key), realIo({ now: () => "2026-10-06T21:05:00.000Z" }));
  store.create({ id, objective: "verify the refund", mode: "observe", runtime: { environment: "env-0123456789ab", task, sourceTree: "a".repeat(40) } });
  store.append(id, "action", { id: "act-1", do: "goto", on: "/orders/821", state: "done", ms: 721, url: { before: null, after: "/orders/821" }, screenshot: "evidence/act-1.png", boundary: { mark: 3 } });
  return store;
}

test("a first connection is 200 text/event-stream, uncached, with a retry, the task's lines from zero in order, one view, and a cursor as every id", async (t) => {
  const m = await served(t);
  const got = await stream(m.api.port, live(m), { until: hasView });
  assert.equal(got.status, 200);
  assert.match(got.type, /^text\/event-stream/);
  assert.match(got.cache, /no-cache/);
  assert.equal(got.frames[0].retry, "3000");
  assert.deepEqual(kinds(got.frames), ["created", "stage"]);
  assert.deepEqual(got.frames.filter((f) => f.event === "task-event").map((f) => [f.data.source, f.data.n]), [["task", 0], ["task", 1]]);
  assert.ok(ids(got.frames).every((id) => CURSOR.test(id)), "every id is a cursor");
  const view = got.frames.find((f) => f.event === "task-view");
  assert.deepEqual([view.id, view.data.revision, view.data.view.stage, view.data.view.terminal], ["t=2", 2, "TESTING", false]);
});

test("reconnecting with Last-Event-ID resumes after the cursor with no line twice; ?since is read when no Last-Event-ID is sent, and the header wins", async (t) => {
  const m = await served(t);
  const first = await stream(m.api.port, live(m), { until: hasView });
  const cursor = ids(first.frames).at(-1);
  decide(m);
  m.shop.op(m.working, "attempt-start", {});
  const again = await stream(m.api.port, live(m), { headers: { "last-event-id": cursor }, until: hasView });
  assert.deepEqual(again.frames.filter((f) => f.event === "task-event").map((f) => [f.data.n, f.data.kind]), [[2, "decision"], [3, "attempt-started"]]);
  const since = await stream(m.api.port, `${live(m)}?since=t=3`, { until: hasView });
  assert.deepEqual(kinds(since.frames), ["attempt-started"]);
  const both = await stream(m.api.port, `${live(m)}?since=t=0`, { headers: { "last-event-id": "t=4" }, until: hasView });
  assert.deepEqual(kinds(both.frames), []);
  const bad = await stream(m.api.port, live(m), { headers: { "last-event-id": "t=1;../etc=4" }, until: hasView });
  assert.equal(kinds(bad.frames).length, 4, "a cursor that is not the grammar starts from zero, never somewhere invented");
});

test("a malformed id is 400, an unknown task, another checkout's task and an unknown project are 404 -- as JSON, before any stream header", async (t) => {
  const m = await served(t);
  const asked = [[at(SHOP, "/tsk-XYZ/events/stream"), 400], [at(SHOP, "/tsk-000000000000/events/stream"), 404, "TASK_UNKNOWN"], [at(PAYMENTS, `/${m.working}/events/stream`), 404, "TASK_UNKNOWN"], [at({ key: "repo-none", checkout: "e".repeat(64) }, `/${m.working}/events/stream`), 404, "PROJECT_UNKNOWN"]];
  for (const [path, status, code] of asked) {
    const got = await stream(m.api.port, path);
    assert.equal(got.status, status, path);
    assert.match(got.type, /^application\/json/, path);
    if (code) assert.equal(got.json.error.code, code, path);
  }
});

test("a finished task sends its lines, a final view, then end -- and the server closes the response", async (t) => {
  const m = await served(t);
  const got = await stream(m.api.port, live(m, m.finished));
  assert.equal(got.ended, true, "the server ended it");
  const order = got.frames.filter((f) => !f.retry && f.event !== "ping").map((f) => f.event);
  assert.deepEqual(order, ["task-event", "task-event", "task-view", "end"]);
  assert.deepEqual(got.frames.at(-1).data, { source: "task", reason: "terminal" });
  assert.equal(got.frames.find((f) => f.event === "task-view").data.view.lifecycle, "COMPLETED");
});

test("a line written while a page watches arrives, followed by the view it moved, and a heartbeat event comes on its own", async (t) => {
  const m = await served(t);
  setTimeout(() => decide(m), 60);
  const got = await stream(m.api.port, live(m), { until: (fs) => fs.some((f) => f.event === "task-view" && f.data.revision === 3) && fs.some((f) => f.event === "ping") });
  assert.deepEqual(kinds(got.frames), ["created", "stage", "decision"]);
  const after = got.frames.slice(got.frames.findIndex((f) => f.data?.kind === "decision"));
  assert.equal(after.find((f) => f.event === "task-view").data.revision, 3);
  assert.ok(got.frames.some((f) => f.event === "ping" && f.id === undefined), "a ping carries no id, so it never moves the cursor");
});

test("two pages share one follower and both get the line; when the last leaves, the follower and its timer are gone", async (t) => {
  const m = await served(t);
  const decided = (fs) => fs.some((f) => f.data?.kind === "decision");
  const a = stream(m.api.port, live(m), { until: decided });
  const b = stream(m.api.port, live(m), { until: decided });
  await waitFor(() => m.api.ctx.live.streams.size() === 2);
  assert.equal(m.api.ctx.live.followers.size(), 1, "one follower for one task");
  decide(m);
  const [ga, gb] = await Promise.all([a, b]);
  assert.deepEqual([kinds(ga.frames), kinds(gb.frames)], [["created", "stage", "decision"], ["created", "stage", "decision"]]);
  await waitFor(() => m.api.ctx.live.streams.size() === 0 && m.api.ctx.live.followers.size() === 0);
});

test("an investigation begun against the task is found from its first line, and its activity arrives allow-listed with its id as source; one for another task never does", async (t) => {
  const m = await served(t);
  const store = investigation(m, "inv-20261006-210500-aaaa", m.working);
  investigation(m, "inv-20261006-210600-bbbb", m.finished);
  const stepped = (fs) => fs.filter((f) => f.event === "qa-event").length >= 3;
  setTimeout(() => store.append("inv-20261006-210500-aaaa", "observation", { id: "obs-1", action: "act-2", layer: "network", state: "observed", data: { requests: [{ n: 9, method: "POST", endpoint: "/api/refund", status: 500, headers: { values: { authorization: "Bearer x" } } }] } }), 60);
  const got = await stream(m.api.port, live(m), { until: stepped });
  const qa = got.frames.filter((f) => f.event === "qa-event").map((f) => f.data);
  assert.deepEqual(qa.map((e) => [e.source, e.kind]), [["inv-20261006-210500-aaaa", "qa.started"], ["inv-20261006-210500-aaaa", "qa.step"], ["inv-20261006-210500-aaaa", "qa.network"]]);
  assert.deepEqual(qa[1], { source: "inv-20261006-210500-aaaa", n: 1, kind: "qa.step", at: "2026-10-06T21:05:00.000Z", id: "act-1", do: "goto", on: "/orders/821", state: "done", ms: 721, url: "/orders/821", screenshot: true });
  assert.ok(!JSON.stringify(got.frames).includes("Bearer"), "no header reaches a page");
  assert.match(ids(got.frames).at(-1), /;inv-20261006-210500-aaaa=3$/);
});

test("the plain read answers the events, cursor and view a fresh stream opens with, and takes the same cursor", async (t) => {
  const m = await served(t);
  investigation(m, "inv-20261006-210500-aaaa", m.working);
  m.shop.tick(5);
  decide(m);
  const once = await m.api.get(at(SHOP, `/${m.working}/activity`));
  const streamed = await stream(m.api.port, live(m), { until: hasView });
  assert.equal(once.status, 200);
  assert.deepEqual(once.json.events, streamed.frames.filter((f) => f.event === "task-event" || f.event === "qa-event").map((f) => f.data));
  assert.equal(once.json.cursor, streamed.frames.find((f) => f.event === "task-view").id);
  assert.deepEqual([once.json.terminal, once.json.view.revision], [false, 3]);
  assert.deepEqual(once.json.events.map((e) => e.kind), ["created", "stage", "qa.started", "qa.step", "decision"], "merged by time, each source in its own order");
  const later = await m.api.get(at(SHOP, `/${m.working}/activity?since=${encodeURIComponent(once.json.cursor)}`));
  assert.deepEqual(later.json.events, []);
});

test("nothing is written by a stream or a read, and closing every stream ends them before the server closes", async (t) => {
  const m = await served(t);
  const before = snapshot(m.root.store);
  const open = stream(m.api.port, live(m), { timeoutMs: 3000 });
  await waitFor(() => m.api.ctx.live.streams.size() === 1);
  await m.api.get(at(SHOP, `/${m.working}/activity`));
  m.api.ctx.live.streams.closeAll();
  const got = await open;
  assert.equal(got.ended, true);
  assert.deepEqual(snapshot(m.root.store), before);
  await waitFor(() => m.api.ctx.live.followers.size() === 0);
});

test("every stream row is a GET that never mutates and takes no body, and no route path says command, shell, exec or restart", () => {
  const streams = ROUTES.filter((r) => r.stream);
  assert.equal(streams.length, 2);
  for (const r of streams) assert.deepEqual([r.method, Boolean(r.mutates), Boolean(r.body), typeof r.open], ["GET", false, false, "function"], String(r.path));
  assert.deepEqual(ROUTES.filter((r) => /command|shell|exec|restart/i.test(String(r.path))), []);
});

// 1.8.5: what a running check was observed doing (src/orchestration/activity/) reaches a page as ONE projection per
// check action -- `activity-view` on the stream, `activity` in the plain read -- the same one a terminal draws.
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { activityFile } from "../../src/orchestration/activity/source.mjs";

test("a check's observation is streamed as one activity-view and answered by the plain read: the same projection", async (t) => {
  const m = await served(t);
  const act = m.shop.op(m.working, "act-start", { type: "test", label: "test · node:api · test" }).lines.find((l) => l.kind === "action-started").id;
  const file = activityFile(projectStoreRoot(m.root.store, SHOP.key), m.working, act);
  mkdirSync(dirname(file), { recursive: true });
  const line = (seq, kind, extra) => `${JSON.stringify({ v: 1, seq, gen: 1, at: "2026-10-06T21:06:00.000Z", kind, ...extra })}\n`;
  appendFileSync(file, line(0, "activity.started", { task: m.working, action: act, check: "chk-1", adapter: { id: "tap", capabilities: { cases: "reported" }, observes: ["passed", "failed"] } }) + line(1, "case.reported", { key: "1", name: "refund is held to what was paid", state: "passed" }));
  const got = await stream(m.api.port, live(m), { until: (fs) => fs.some((f) => f.event === "activity-view") });
  const sent = got.frames.find((f) => f.event === "activity-view");
  assert.deepEqual([sent.data.source, sent.data.action, sent.data.view.counts.passed, sent.data.view.recent[0].name], ["activity", act, 1, "refund is held to what was paid"]);
  assert.ok(CURSOR.test(sent.id), "its id is the task's cursor: a reconnect replays the projection, it never skips a line");
  const once = await m.api.get(at(SHOP, `/${m.working}/activity`));
  assert.deepEqual(once.json.activity[act], sent.data.view);
});
