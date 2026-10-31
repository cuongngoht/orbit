import assert from "node:assert/strict";
import { test } from "node:test";
import { intakeFromText, persistIntake } from "../src/goal/intake.mjs";
import { analyzeGoal, planGoal, resumeGoal, stepGoal } from "../src/goal/index.mjs";
import { createGoals } from "../src/goal/store.mjs";
import { fakeIo } from "./fakes/io.mjs";

// Resuming a goal settles every unit whose task ENDED, as the task views spell a lifecycle (COMPLETED, FAILED,
// CANCELLED ...), and keeps the settlement in the goal's journal, so a later look reads it back.

const ctx = { project: "acme-web", checkout: "co-111111111111", session: "s-1", host: "test" };

function harness(workKinds) {
  const io = fakeIo();
  const goals = createGoals("/store/acme", io);
  const tasks = [];
  const p = { ctx, io, goals, tasks: { list: () => [], read: () => null }, automation: { start: () => started(tasks) }, taskSummaries: () => tasks.map((t) => ({ ...t })) };
  const id = planned(p, workKinds);
  return { p, id, tasks };
}

function started(tasks) {
  const task = `tsk-${String(tasks.length + 1).padStart(12, "0")}`;
  tasks.push({ id: task, lifecycle: "EXECUTING", stopReason: null });
  return { task };
}

function planned(p, workKinds) {
  const intake = intakeFromText(ctx, "Fix bug\nAC1: one payment only\n");
  persistIntake(p.goals, p.io, intake);
  analyzeGoal(p, intake.id, { objective: "Fix double payment", intent: { category: "change", workKinds }, requirements: [], acceptance: [{ statement: "one payment", sourceRef: `spec@${intake.spec.digest}#L3` }] });
  planGoal(p, intake.id);
  return intake.id;
}

const end = (h, n, lifecycle) => Object.assign(h.tasks[n - 1], { lifecycle, stopReason: lifecycle === "COMPLETED" ? null : "stopped" });

// A unit is named by the kind of work its plan gave it (a journal line about a unit keeps no kind of its own).
const kindOf = (r) => new Map(r.model.plan.units.map((u) => [u.id, u.kind]));

const states = (r) => [...r.model.units.values()].map((u) => `${kindOf(r).get(u.id)}:${u.state}`);

const frontier = (r) => r.frontier.map((u) => kindOf(r).get(u.id));

test("a unit whose task COMPLETED is completed on resume, and the next unit may start", () => {
  const h = harness(["change", "verify"]);
  stepGoal(h.p, h.id);
  end(h, 1, "COMPLETED");
  const r = resumeGoal(h.p, h.id);
  assert.deepEqual(states(r), ["change:completed", "verify:planned"]);
  assert.deepEqual(frontier(r), ["verify"]);
  assert.equal(r.lifecycle, "ready");
});

test("the settlement is kept in the goal's journal: a later look reads it back", () => {
  const h = harness(["change", "verify"]);
  stepGoal(h.p, h.id);
  end(h, 1, "COMPLETED");
  resumeGoal(h.p, h.id);
  h.p.taskSummaries = () => [];
  assert.equal(resumeGoal(h.p, h.id).lifecycle, "ready");
  stepGoal(h.p, h.id);
  assert.deepEqual(states(resumeGoal(h.p, h.id)), ["change:completed", "verify:running"]);
});

test("a unit whose task FAILED or was CANCELLED is failed, the goal is blocked, and nothing after it starts", () => {
  for (const lifecycle of ["FAILED", "CANCELLED"]) {
    const h = harness(["change", "verify"]);
    stepGoal(h.p, h.id);
    end(h, 1, lifecycle);
    const r = resumeGoal(h.p, h.id);
    assert.deepEqual(states(r), ["change:failed", "verify:planned"]);
    assert.deepEqual(frontier(r), []);
    assert.equal(r.lifecycle, "blocked");
  }
});

test("a task that has not ended keeps its unit running, and resuming again changes nothing more", () => {
  const h = harness(["change", "verify"]);
  stepGoal(h.p, h.id);
  end(h, 1, "PAUSED");
  assert.equal(resumeGoal(h.p, h.id).lifecycle, "running");
  end(h, 1, "COMPLETED");
  const before = h.p.goals.read(h.id).length;
  resumeGoal(h.p, h.id);
  const r = resumeGoal(h.p, h.id);
  assert.equal(h.p.goals.read(h.id).length, before + 1);
  assert.deepEqual(states(r), ["change:completed", "verify:planned"]);
});

test("a goal whose units' tasks all completed has nothing left to start and is verifying", () => {
  const h = harness(["analyze", "change", "verify"]);
  for (const n of [1, 2, 3]) {
    stepGoal(h.p, h.id);
    end(h, n, "COMPLETED");
    resumeGoal(h.p, h.id);
  }
  const r = resumeGoal(h.p, h.id);
  assert.deepEqual(states(r), ["analyze:completed", "change:completed", "verify:completed"]);
  assert.deepEqual(frontier(r), []);
  assert.equal(r.lifecycle, "verifying");
});
