// A coordinated workflow's PLAN as a live source (1.8.6, ADR 0022): read by its digest from the coordinator's own room
// and nowhere else, never drawn when it is not what its digest says, and delivered by the feed as ONE replaceable
// frame per artifact -- once when a viewer joins, again when a revision makes another artifact ACTIVE -- while the
// journal it is read beside stays byte for byte as it was.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { digestOf, planOf } from "../src/automation/plan.mjs";
import { PLAN_SOURCE, activeRef, projectionOf } from "../src/automation/source.mjs";
import { effectiveOf } from "../src/automation/settings.mjs";
import { collectFeed, openFeed } from "../src/live/feed.mjs";
import { createFollowers } from "../src/live/followers.mjs";
import { zeroCursor } from "../src/live/cursor.mjs";
import { QA_SOURCE } from "../src/investigation/live.mjs";
import { realIo } from "../src/store/io.mjs";
import { TASK_SOURCE } from "../src/task/live.mjs";
import { taskWorld } from "./task.harness.mjs";

const values = effectiveOf([{ by: "machine", content: {  } }]).values;

const facts = { objective: "o", ref: null, intent: "development", confidence: "high", matched: ["development"], requirement: null, startable: ["web"], capabilities: [{ capability: "development.implementation", outcome: "provided", named: false }], named: [], playbook: { capability: "development.implementation" } };

function world(t) {
  const w = taskWorld(t);
  const io = realIo({ now: w.now });
  const id = w.create({ objective: "o", provider: "automation" });
  const written = (plan) => {
    mkdirSync(join(w.dir, "automation", id, "plans"), { recursive: true });
    writeFileSync(join(w.dir, "automation", id, "plans", `${plan.digest}.json`), `${JSON.stringify(plan, null, 2)}\n`);
    return plan;
  };
  const deps = { io, followers: createFollowers({ pollMs: 60_000 }), task: TASK_SOURCE, qa: QA_SOURCE, plan: PLAN_SOURCE };
  const opened = () => ({ taskCtx: { tasks: w.tasks, checkoutSummary: null, now: w.now }, task: id, createdAt: w.view(id).task.createdAt, qa: QA_SOURCE.open(w.dir, io), plans: PLAN_SOURCE.open(w.dir, io) });
  return { w, io, id, written, deps, opened };
}

test("the active plan is read by its digest from the coordinator's own room, as the projection a viewer draws", (t) => {
  const s = world(t);
  const plan = s.written(planOf(facts, values));
  s.w.op(s.id, "link-receipt", { domain: "plan", ref: plan.digest, outcome: "ACTIVE", summary: "plan-1" });
  assert.equal(activeRef(s.w.view(s.id)), plan.digest);
  const got = PLAN_SOURCE.open(s.w.dir, s.io).read(s.id, plan.digest);
  assert.deepEqual(got, projectionOf(plan));
  assert.deepEqual(got.steps.map((x) => [x.id, x.strict]), [["context", false], ["runtime", true], ["engineering", true], ["qa", true], ["regression", true], ["review", true]]);
  assert.equal(got.steps.find((x) => x.id === "qa").obligation, "an investigation of the running change ended with no defect");
});

test("nothing a journal says can point the read elsewhere, and an artifact that is not what its digest says is never drawn", (t) => {
  const s = world(t);
  const plan = s.written(planOf(facts, values));
  const read = PLAN_SOURCE.open(s.w.dir, s.io).read;
  for (const [task, ref] of [["../../etc", plan.digest], [s.id, "../x"], [s.id, "0123456789abcdeF"], ["tsk-0", plan.digest]]) assert.equal(read(task, ref), null, `${task} ${ref}`);
  const file = join(s.w.dir, "automation", s.id, "plans", `${plan.digest}.json`);
  writeFileSync(file, readFileSync(file, "utf8").replace("context", "deploy"));
  assert.equal(read(s.id, plan.digest), null, "edited by hand: its digest no longer holds");
  assert.equal(read(s.id, "0123456789abcdef"), null, "gone");
});

test("the feed sends the plan once per artifact -- on joining, and again when a revision makes another one active -- and writes nothing", (t) => {
  const s = world(t);
  const first = s.written(planOf(facts, values));
  s.w.op(s.id, "link-receipt", { domain: "plan", ref: first.digest, outcome: "ACTIVE", summary: "plan-1" });
  const journal = readFileSync(s.w.tasks.journalFile(s.id));
  const collected = collectFeed(s.deps, s.opened(), zeroCursor());
  assert.equal(collected.plan.ref, first.digest);
  const frames = [];
  const feed = openFeed(s.deps, s.opened(), zeroCursor());
  feed.start({ closed: false, send: (f) => frames.push(f) > 0, end: () => {} });
  feed.tick();
  feed.tick();
  assert.equal(frames.filter((f) => f.event === "plan-view").length, 1, "a tick resends nothing");
  const next = s.written({ ...first, n: 2, prev: first.digest, replans: [{ n: 2, trigger: "TASK_FAILED", response: "retry", step: "engineering" }], digest: undefined });
  const sealed = s.written({ ...next, digest: digestOf(next) });
  s.w.op(s.id, "link-receipt", { domain: "plan", ref: first.digest, outcome: "SUPERSEDED", summary: "plan-1" });
  s.w.op(s.id, "link-receipt", { domain: "plan", ref: sealed.digest, outcome: "ACTIVE", summary: "plan-2" });
  const lease = s.deps.followers.acquire(`task:${s.w.tasks.journalFile(s.id)}`, () => null);
  lease.refresh();
  lease.release();
  feed.close();
  const plans = frames.filter((f) => f.event === "plan-view");
  assert.deepEqual(plans.map((f) => f.data.revision), [1, 2]);
  assert.deepEqual(plans[1].data.view.replans.map((r) => r.trigger), ["TASK_FAILED"]);
  assert.ok(readFileSync(s.w.tasks.journalFile(s.id)).subarray(0, journal.length).equals(journal), "the journal it read beside is untouched by the reading");
});

test("a feed with no plan source -- an earlier composition root -- sends no plan, and nothing else changes", (t) => {
  const s = world(t);
  const plan = s.written(planOf(facts, values));
  s.w.op(s.id, "link-receipt", { domain: "plan", ref: plan.digest, outcome: "ACTIVE", summary: "plan-1" });
  const { plan: _, ...older } = s.deps;
  assert.equal(collectFeed(older, s.opened(), zeroCursor()).plan, null);
});
