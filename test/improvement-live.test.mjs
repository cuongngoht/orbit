// Self-improvement on ORBIT LIVE (0.3.0, ADR 0045): the evaluation task a campaign runs names its campaign, the one feed
// every viewer reads sends the campaign's ONE projection as an `improvement-view` -- its phase, the mode its stage runs
// in, who carries it, the baseline beside the candidate and how far the evaluation got, the gates, and its newest lines
// as named events -- and the full-screen viewer's IMPROVE section draws exactly that, at every width. A viewer writes
// nothing, and a verdict is the campaign's word, never the viewer's.
import assert from "node:assert/strict";
import { test } from "node:test";
import { IMPROVEMENT_SOURCE } from "../src/improvement/live.mjs";
import { advance, analyseNow } from "../src/improvement/loop.mjs";
import { modelOf } from "../src/improvement/model.mjs";
import { QA_SOURCE } from "../src/investigation/live.mjs";
import { zeroCursor } from "../src/live/cursor.mjs";
import { collectFeed } from "../src/live/feed.mjs";
import { createFollowers } from "../src/live/followers.mjs";
import { displayWidth } from "../src/live/render/width.mjs";
import { unstyled } from "../src/live/render/ansi.mjs";
import { frameOf } from "../src/live/tui/frame.mjs";
import { initialState } from "../src/live/tui/model.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { improvementSection } from "../src/live/tui/sections/improvement.mjs";
import { TASK_SOURCE } from "../src/task/live.mjs";
import { FIXED, brokenHistory, improvementWorld } from "./fakes/improvement.mjs";
import { SKILL_ID } from "./fakes/skill-run.mjs";

const SETTINGS = { idleAfterSec: 120, finishedForSec: 600, terminal: { maxRows: 200, showQa: true, showLogs: false } };

async function evaluated(t) {
  const w = improvementWorld(t);
  await brokenHistory(w);
  await analyseNow(w.imp, {});
  const id = w.store.list()[0];
  w.factory.put({ id: SKILL_ID, name: "workflow.json", text: JSON.stringify(FIXED(), null, 2) });
  await advance(w.imp, id);
  return { w, id, task: modelOf(w.store.read(id)).evaluations[0].task };
}

const collected = (w, task) => collectFeed({ io: w.io, followers: createFollowers({ pollMs: 60_000 }), task: TASK_SOURCE, qa: QA_SOURCE, improvement: IMPROVEMENT_SOURCE }, { taskCtx: { tasks: w.w.tasks, checkoutSummary: null, now: w.w.now }, task, createdAt: w.w.view(task).task.createdAt, qa: QA_SOURCE.open(w.w.dir, w.io), improvements: IMPROVEMENT_SOURCE.open(w.w.dir, w.io) }, zeroCursor());

test("the one feed sends the campaign an evaluation task names, as one projection with its events -- and reading it writes nothing", async (t) => {
  const { w, id, task } = await evaluated(t);
  const before = w.store.read(id).length;
  const c = collected(w, task);
  const v = c.improvement[id];
  assert.ok(v, JSON.stringify(Object.keys(c)));
  assert.deepEqual([v.phase, v.subject.id, v.carrier, v.mode], ["EVALUATING", SKILL_ID, "improvement engine", "TESTING"]);
  assert.equal(v.evaluations[0].verdict, "BETTER");
  assert.deepEqual(v.evaluations[0].attribution, ["RUNTIME_BOUND"], "every run bound by the engine as it ran");
  for (const name of ["improvement.detected", "improvement.diagnosed", "candidate.proposed", "candidate.validated", "evaluation.started", "evaluation.completed"]) assert.ok(v.events.some((e) => e.event === name && e.campaign === id), name);
  assert.ok(v.events.every((e) => e.subject === SKILL_ID));
  assert.equal(w.store.read(id).length, before, "a viewer writes nothing");
});

test("the IMPROVE section draws the campaign's own words at every width, and nothing when there is no campaign", async (t) => {
  const { w, id, task } = await evaluated(t);
  const frames = [{ event: "improvement-view", id: "t=0", data: { source: "improvement", task, campaign: id, revision: 1, view: collected(w, task).improvement[id] } }];
  for (const columns of [60, 90, 140]) {
    const base = initialState({ association: { how: "pin", task, ids: [task] }, root: task, columns, rows: 40, ascii: false, nowMs: Date.parse(w.w.now()), settings: SETTINGS });
    const state = [{ type: "feed-opened", task, role: "root" }, { type: "frames", task, frames }].reduce(reduce, base);
    const lines = frameOf(state).lines.map(unstyled);
    const width = displayWidth(frameOf(base).lines.map(unstyled)[0]);
    assert.ok(lines.every((l) => displayWidth(l) === width), `every line is exactly as wide as the frame without a campaign (${width})`);
    if (columns >= 90) assert.ok(lines.some((l) => /IMPROVE/.test(l) && l.includes(id)), lines.join("\n"));
    if (columns >= 90) assert.ok(lines.some((l) => /ev1 · BETTER · 6\/6 run\(s\) · baseline met 0\/3 · candidate met 3\/3/.test(l)), lines.join("\n"));
  }
  assert.equal(improvementSection({ d: { root: { improvement: {} } }, state: {} }), null);
});
