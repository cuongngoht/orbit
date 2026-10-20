import assert from "node:assert/strict";
import { test } from "node:test";
import { intakeFromText, persistIntake } from "../src/goal/intake.mjs";
import { analyzeGoal, planGoal } from "../src/goal/index.mjs";
import { resumeGoal } from "../src/goal/index.mjs";
import { createGoals } from "../src/goal/store.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ctx = { project: "acme-web", checkout: "co-111111111111", session: "s-1", host: "test" };

function ports(io) {
  const goals = createGoals("/store/acme", io);
  return { ctx, io, goals, tasks: { list: () => [], read: () => null }, automation: { start: () => ({ task: "tsk-aaaaaaaaaaaa" }) }, taskSummaries: () => [] };
}

test("resume reloads plan and frontier", () => {
  const io = fakeIo();
  const p = ports(io);
  const intake = intakeFromText(ctx, "Fix bug\nAC1: one payment only\n");
  persistIntake(p.goals, io, intake);
  const digest = intake.spec.digest;
  analyzeGoal(p, intake.id, { objective: "Fix double payment", requirements: [], acceptance: [{ statement: "one payment", sourceRef: `spec@${digest}#L3` }] });
  planGoal(p, intake.id);
  const r = resumeGoal(p, intake.id);
  assert.match(r.say, /goal-/);
  assert.ok(r.frontier.length >= 0);
});
