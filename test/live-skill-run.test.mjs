// AC-16 (0.0.4): a declared playbook's run drawn in the full-screen viewer and the pane -- nested under the plan step
// that carried it, its steps in words their evidence earns, the tool, the provider, how long and how often -- while the
// orbit keeps turning on the viewer's own clock and moves nothing else. A running run shows RUNNING and never VERIFIED;
// every width holds its lines; an ASCII terminal gets ASCII; and what no receipt says is never drawn.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLAN_SOURCE } from "../src/automation/source.mjs";
import { QA_SOURCE } from "../src/investigation/live.mjs";
import { zeroCursor } from "../src/live/cursor.mjs";
import { openFeed } from "../src/live/feed.mjs";
import { createFollowers } from "../src/live/followers.mjs";
import { skillRunsOf } from "../src/live/plan.mjs";
import { displayWidth } from "../src/live/render/width.mjs";
import { unstyled } from "../src/live/render/ansi.mjs";
import { derivedOf } from "../src/live/tui/derive.mjs";
import { frameOf, orbitFrameOf } from "../src/live/tui/frame.mjs";
import { ASCII } from "../src/live/tui/glyphs.mjs";
import { initialState } from "../src/live/tui/model.mjs";
import { paneOf } from "../src/live/tui/pane.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";
import { SKILL_RUN_STATE, SKILL_STEP_STATE } from "../src/live/tui/skill-run-view.mjs";
import { SKILL_SOURCE } from "../src/skill-factory/source.mjs";
import { TASK_SOURCE } from "../src/task/live.mjs";
import { next, start } from "./fakes/automation.mjs";
import { declared, notesServer, roomWritten, skillWorld, spec, workflowOf } from "./fakes/skill-run.mjs";

const SETTINGS = { idleAfterSec: 120, finishedForSec: 600, terminal: { maxRows: 200, showQa: true, showLogs: false } };

function framesOf(s, id) {
  roomWritten(s, id);
  const deps = { io: s.h.io, followers: createFollowers({ pollMs: 60_000 }), task: TASK_SOURCE, qa: QA_SOURCE, plan: PLAN_SOURCE, skill: SKILL_SOURCE };
  const opened = { taskCtx: { tasks: s.w.tasks, checkoutSummary: null, now: s.w.now }, task: id, createdAt: s.w.view(id).task.createdAt, qa: QA_SOURCE.open(s.w.dir, s.h.io), plans: PLAN_SOURCE.open(s.w.dir, s.h.io), skills: SKILL_SOURCE.open(s.base, s.h.io) };
  const frames = [];
  const feed = openFeed(deps, opened, zeroCursor());
  feed.start({ send: (f) => frames.push(f) > 0, end: () => {}, closed: false });
  feed.close();
  return frames;
}

const viewer = (s, id, frames, over = {}) => {
  const base = initialState({ association: { how: "pin", task: id, ids: [id] }, root: id, columns: over.columns ?? 140, rows: over.rows ?? 48, ascii: over.ascii ?? false, nowMs: Date.parse(s.w.now()), settings: SETTINGS, layout: over.layout });
  return [{ type: "feed-opened", task: id, role: "root" }, { type: "frames", task: id, frames }, ...(over.keys ?? [])].reduce(reduce, base);
};

const planLines = (state) => paneOf(state).views.find((v) => v.id === "plan").rows.map((r) => [...r.left, ...r.right].map((x) => x.text).join(""));

// A run in flight: the evidence answered, the notes call sent and not answered yet.
async function inFlight(t) {
  const s = skillWorld(t, { server: notesServer({ hang: true }) });
  await declared(s, { wf: workflowOf({ notes: { timeoutMs: 120000 } }) });
  const st = start(s.ports, spec);
  await next(s, st.task);
  next(s, st.task).catch(() => null);
  for (let i = 0; i < 400 && !s.w.view(st.task).receipts.some((r) => r.domain === "skillstep" && r.ref.endsWith(".notes") && r.outcome === "RUNNING"); i += 1) await new Promise((r) => setTimeout(r, 5));
  return { s, id: st.task };
}

test("every word a run or its steps can be drawn in has an ASCII spelling", () => {
  for (const { glyph } of [...Object.values(SKILL_STEP_STATE), ...Object.values(SKILL_RUN_STATE)]) assert.ok(ASCII[glyph] || /^[~-]$/.test(glyph), `${glyph} has an ASCII spelling`);
});

test("AC-16: a run in flight is drawn RUNNING under its plan step, the step it carries now named in NOW -- and nothing is VERIFIED", async (t) => {
  const { s, id } = await inFlight(t);
  const frames = framesOf(s, id);
  const state = viewer(s, id, frames);
  const lines = planLines(state);
  assert.ok(lines.some((l) => /skill release-readiness-verification v0\.1\.0.*RUNNING/.test(l)), lines.join("\n"));
  assert.ok(lines.some((l) => /evidence\s+release\.evidence\.read.*REPORTED/.test(l)));
  assert.ok(lines.some((l) => /notes\s+release\.notes\.search · search.*RUNNING/.test(l)));
  assert.equal(lines.some((l) => /VERIFIED/.test(l)), false, "a call that is still out proves nothing");
  const now = paneOf(state).current.map((r) => [...r.left, ...r.right].map((x) => x.text).join(""));
  assert.ok(now.some((l) => /skill run\s+release-readiness-verification:0\.1\.0:[0-9a-f]{8} · RUNNING · 1\/2 step\(s\) answered/.test(l)), now.join("\n"));
  assert.ok(now.some((l) => /tool\s+notes · release\.notes\.search · managed:corp · search/.test(l)));
});

test("AC-16: the run's rows hold every width, a narrow pane included, and an ASCII terminal is drawn ASCII", async (t) => {
  const s = skillWorld(t);
  await declared(s);
  const st = start(s.ports, spec);
  await next(s, st.task);
  await next(s, st.task);
  const frames = framesOf(s, st.task);
  for (const columns of [44, 60, 80, 120, 200]) {
    const state = viewer(s, st.task, frames, { columns, rows: 40, keys: [{ type: "view", at: 4 }] });
    const f = frameOf(state);
    for (const line of f.lines) assert.ok(displayWidth(unstyled(line)) <= columns, `${columns} columns: ${unstyled(line)}`);
  }
  const ascii = frameOf(viewer(s, st.task, frames, { columns: 120, rows: 40, ascii: true, keys: [{ type: "view", at: 4 }] }));
  for (const line of ascii.lines) assert.ok(/^[\x20-\x7e]*$/.test(unstyled(line)), `ASCII only: ${unstyled(line)}`);
});

test("AC-16: the orbit turns on the viewer's clock while the run's rows stay what the journal says", async (t) => {
  const { s, id } = await inFlight(t);
  const state = viewer(s, id, framesOf(s, id), { columns: 120, rows: 40 });
  const d = derivedOf(state);
  const a = frameOf(state, d, { orbitMs: 0 });
  const b = orbitFrameOf(state, d, a, { orbitMs: 900 });
  assert.ok(a.orbiting, "the orbit is drawn and moving");
  const moved = a.lines.map((l, i) => l !== b.lines[i]);
  assert.ok(moved.some(Boolean), "a later moment of the orbit draws its rows again");
  assert.ok(moved.every((m, i) => !m || a.orbitRows.some((o) => o.row === i)), "only the orbit's rows move: no step's word changes with the clock");
  assert.deepEqual(skillRunsOf(d.root.plan, d.root.view, d.root.events, d.root.skills).map((r) => r.state), ["RUNNING"]);
});

test("a run whose workflow cannot be read says so, and draws only the steps its receipts name", async (t) => {
  const s = skillWorld(t);
  const reg = await declared(s);
  const st = start(s.ports, spec);
  await next(s, st.task);
  await next(s, st.task);
  s.h.io.write(`${s.factory.store.dirOf(reg.id)}/SKILL.md`, "changed by hand\n");
  const frames = framesOf(s, st.task);
  assert.equal(frames.some((f) => f.event === "skill-view"), false, "a version that is not what was verified is never sent");
  const lines = planLines(viewer(s, st.task, frames));
  assert.ok(lines.some((l) => /its workflow could not be read/.test(l)));
  assert.ok(lines.some((l) => /evidence/.test(l)) && lines.some((l) => /notes/.test(l)), "the steps its receipts name");
});

test("a step waiting for a person says WAITING, and for which request", async (t) => {
  const s = skillWorld(t);
  await declared(s, { wf: workflowOf({ notes: { approval: "owner" } }) });
  const st = start(s.ports, spec);
  await next(s, st.task);
  await next(s, st.task);
  const lines = planLines(viewer(s, st.task, framesOf(s, st.task)));
  assert.ok(lines.some((l) => /notes .*WAITING.*waits for apr-1/.test(l)), lines.join("\n"));
});
