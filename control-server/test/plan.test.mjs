// AC-09 (0.0.4): a coordinated workflow's plan and a declared playbook's run, as Mission Control serves them and as a
// terminal's Plan view draws them, are ONE projection of the same journals: the same run, its pin, its steps in the same
// words, the provider and the receipts each rests on. Control computes it with the live core's own function
// (src/live/plan.mjs planViewOf) and keeps none of it; a page never derives a state of its own.
import { test } from "node:test";
import assert from "node:assert/strict";
import { projectStoreRoot } from "../../src/project/repository.mjs";
import { createFollowers } from "../../src/live/followers.mjs";
import { openFeed } from "../../src/live/feed.mjs";
import { zeroCursor } from "../../src/live/cursor.mjs";
import { PLAN_SOURCE } from "../../src/automation/source.mjs";
import { SKILL_SOURCE } from "../../src/skill-factory/source.mjs";
import { QA_SOURCE } from "../../src/investigation/live.mjs";
import { TASK_SOURCE } from "../../src/task/live.mjs";
import { derivedOf } from "../../src/live/tui/derive.mjs";
import { initialState } from "../../src/live/tui/model.mjs";
import { paneOf } from "../../src/live/tui/pane.mjs";
import { reduce } from "../../src/live/tui/reducer.mjs";
import { next, start } from "../../test/fakes/automation.mjs";
import { declared, roomWritten, skillWorld, spec } from "../../test/fakes/skill-run.mjs";
import { runtimeWorld, serve } from "./checkout.mjs";
import { machine, SHOP, snapshot } from "./machine.mjs";

const at = (p, tail = "") => `/api/v1/projects/${encodeURIComponent(p.key)}/checkouts/${p.checkout}/tasks${tail}`;

// A declared playbook run to its end inside the shop project's own store: the journal, its plan artifact and the
// pinned skill all where a checkout keeps them.
async function ranInShop(t) {
  const m = machine(t);
  const root = projectStoreRoot(m.root.store, SHOP.key);
  const s = skillWorld(t, { world: { dir: root, project: SHOP.key, checkout: SHOP.checkout }, base: root });
  await declared(s);
  const st = start(s.ports, spec);
  await next(s, st.task);
  await next(s, st.task);
  roomWritten(s, st.task, root);
  return { m, s, root, id: st.task };
}

// The frames a terminal's viewer is sent for the task, through the live core's own feed, folded the way it folds them.
function viewerOf(s, root, id) {
  const deps = { io: s.h.io, followers: createFollowers({ pollMs: 60_000 }), task: TASK_SOURCE, qa: QA_SOURCE, plan: PLAN_SOURCE, skill: SKILL_SOURCE };
  const opened = { taskCtx: { tasks: s.w.tasks, checkoutSummary: null, now: s.w.now }, task: id, createdAt: s.w.view(id).task.createdAt, qa: QA_SOURCE.open(root, s.h.io), plans: PLAN_SOURCE.open(root, s.h.io), skills: SKILL_SOURCE.open(root, s.h.io) };
  const frames = [];
  const feed = openFeed(deps, opened, zeroCursor());
  feed.start({ send: (f) => frames.push(f) > 0, end: () => {}, closed: false });
  feed.close();
  const base = initialState({ association: { how: "pin", task: id, ids: [id] }, root: id, columns: 140, rows: 48, nowMs: Date.parse(s.w.now()), settings: { idleAfterSec: 120, finishedForSec: 600, terminal: { maxRows: 200, showQa: true, showLogs: false } } });
  const state = reduce(reduce(base, { type: "feed-opened", task: id, role: "root" }), { type: "frames", task: id, frames });
  return { frames, pane: paneOf(state, derivedOf(state)) };
}

const shapeOf = (runs) => runs.map((r) => ({ run: r.run, pin: r.pin, step: r.step, word: r.word, state: r.state, steps: r.steps.map((x) => ({ id: x.id, word: x.word, provider: x.provider, receipt: x.receipt, invocation: x.invocation, calls: x.calls })) }));

test("AC-09: Mission Control's plan and a terminal's Plan view show the same run, steps, words and receipts", async (t) => {
  const { m, s, root, id } = await ranInShop(t);
  const api = await serve(t, m.root, runtimeWorld(m.root));
  const res = await fetch(`http://127.0.0.1:${api.port}${at(SHOP, `/${id}/plan`)}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  const page = body.plan;
  assert.ok(page, "a coordinated workflow has a plan");
  assert.equal(page.readable, true, "the plan artifact was read by its digest");
  assert.equal(page.runs.length, 1);
  assert.deepEqual(page.runs[0].steps.map((x) => [x.id, x.word]), [["evidence", "CONTRACT_MET"], ["notes", "CONTRACT_MET"]]);
  assert.equal(page.runs[0].state, "REPORTED", "a run whose calls only answered is REPORTED, never VERIFIED");
  assert.equal(page.steps.find((x) => x.id === "playbook").state, "REPORTED");
  const terminal = viewerOf(s, root, id);
  assert.ok(terminal.frames.some((f) => f.event === "skill-view"), "the viewer was sent the pinned workflow");
  assert.deepEqual(shapeOf(terminal.pane.plan.runs), shapeOf(page.runs), "one projection, two viewers");
  assert.deepEqual(terminal.pane.plan.steps.map((x) => [x.id, x.state]), page.steps.map((x) => [x.id, x.state]));
  const rows = terminal.pane.views.find((v) => v.id === "plan").rows.map((r) => [...r.left, ...r.right].map((x) => x.text).join(""));
  assert.ok(rows.some((l) => /skill release-readiness-verification v0\.1\.0.*REPORTED/.test(l)), rows.join("\n"));
  assert.ok(rows.some((l) => /evidence\s+release\.evidence\.read.*REPORTED/.test(l)), "a nested step of the run");
  assert.ok(rows.some((l) => /notes\s+release\.notes\.search · search.*REPORTED.*managed:corp/.test(l)), "its tool and the provider it went through");
});

test("the plan route is a read: it writes nothing, a task that is no workflow has no plan, and an unknown task is refused", async (t) => {
  const { m, id } = await ranInShop(t);
  const api = await serve(t, m.root, runtimeWorld(m.root));
  const before = snapshot(m.root.store);
  const got = await (await fetch(`http://127.0.0.1:${api.port}${at(SHOP, `/${id}/plan`)}`)).json();
  assert.ok(got.plan);
  const other = await (await fetch(`http://127.0.0.1:${api.port}${at(SHOP, `/${m.working}/plan`)}`)).json();
  assert.equal(other.plan, null);
  const unknown = await fetch(`http://127.0.0.1:${api.port}${at(SHOP, "/tsk-000000000000/plan")}`);
  assert.equal(unknown.ok, false);
  assert.deepEqual(snapshot(m.root.store), before, "nothing in the store was written, byte for byte");
});

test("a declared skill's page shows its workflow, the runs the project's workflows carried, and the review they answer", async (t) => {
  const { m, s } = await ranInShop(t);
  const api = await serve(t, m.root, runtimeWorld(m.root));
  const id = s.factory.list()[0].id;
  const res = await fetch(`http://127.0.0.1:${api.port}/api/v1/projects/${encodeURIComponent(SHOP.key)}/generated-skills/${id}`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.skill.runs, "declared");
  assert.deepEqual(body.workflow.steps.map((x) => [x.id, x.capability, x.evidence]), [["evidence", "release.evidence.read", "report"], ["notes", "release.notes.search", "report"]]);
  assert.equal(JSON.stringify(body.workflow).includes("context.objective"), false, "a step's bindings are never shown, only what it asks");
  assert.deepEqual(body.runs.map((r) => [r.word, r.pin]), [["REPORTED", body.skill.pin]]);
  assert.equal(body.review.reliability.word, "INSUFFICIENT", "one run is never reliable");
  assert.equal(body.review.proposal.writes, "nothing");
});
