// What `goal resume` and `goal status` read about the tasks a goal started: each one's summary, folded from its own
// journal. A raw journal handed to the view throws, and every task then read as "unknown" -- so a goal whose analysis
// had COMPLETED never settled that unit, and nothing after it ever started (found by the benchmark's ORBIT-E2E-006
// with the real Claude Code).
import assert from "node:assert/strict";
import { test } from "node:test";
import { summariesOf } from "../cli/orbit-summaries.mjs";
import { taskWorld } from "./task.harness.mjs";

test("every task's summary is read off its folded journal, never 'unknown' for a task that exists", (t) => {
  const w = taskWorld(t);
  const id = w.create({ provider: "automation" });
  const [line] = summariesOf(w.tasks, w.now());
  assert.equal(line.id, id);
  assert.notEqual(line.lifecycle, "unknown");
  assert.equal(line.lifecycle, w.view(id).lifecycle, "the same word the task's own view gives");
  assert.equal(line.provider, "automation");
});
