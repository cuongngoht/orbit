// A task room on a real disk, on a clock a test moves -- what every task test stands on. Its door is
// Orbit Control's unless a test says otherwise (`door: null` is a terminal): a person's decision
// that allows something is written only there.
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { realIo } from "../src/store/io.mjs";
import { loadTask } from "../src/task/load.mjs";
import { apply, createTask } from "../src/task/ops.mjs";
import { JOURNAL, createTasks } from "../src/task/store.mjs";
import { taskView } from "../src/task/views.mjs";

export const CHECKOUT = "c".repeat(64);
export const OTHER_CHECKOUT = "d".repeat(64);
export const START = "2026-10-06T21:03:00.000Z";

export function taskWorld(t, opts = {}) {
  const dir = opts.dir ?? mkdtempSync(join(tmpdir(), "orbit-task-"));
  if (!opts.dir) t.after(() => rmSync(dir, { recursive: true, force: true }));
  const clock = { at: Date.parse(opts.start ?? START) };
  const now = () => new Date(clock.at).toISOString();
  const tasks = createTasks(dir, realIo({ host: "laptop-a", now }));
  const ctx = { tasks, project: opts.project ?? "repo-a", checkout: opts.checkout ?? CHECKOUT, session: null, door: opts.door === undefined ? "control" : opts.door, now };
  const world = { dir, tasks, ctx, clock, now };
  world.tick = (minutes = 1) => { clock.at += minutes * 60000; };
  world.op = (id, name, given = {}) => apply(ctx, id, name, given);
  world.create = (given = {}) => createTask(ctx, { project: ctx.project, checkout: ctx.checkout, objective: "PBI-482 Refund validation", ...given }).task;
  world.view = (id) => taskView(loadTask(ctx, id).model, now());
  world.text = (id) => readFileSync(join(tasks.dirOf(id), JOURNAL), "utf8");
  world.kinds = (id) => tasks.read(id).map((l) => l.kind);
  return world;
}

// The approval PBI-482 asks for, and the action it allows.
export const MIGRATION = { type: "database.migrate", environment: "dev", params: { schema: 82 } };

export const ASK = { ...MIGRATION, reason: "integration verification needs schema v82", risk: "DEV database state will be changed" };

// A task in the state PBI-482 reaches: three attempts, a decision, receipts, and a regression
// running when it asks a person to approve one migration.
export function pbi482(w) {
  const id = w.create({ work: "w-0123456789ab", root: "req-0123456789ab", snapshot: "rs-0123456789ab", actor: "claude-code" });
  const steps = [
    ["stage", { stage: "CONTEXT" }], ["link-workspace", { workspace: "task-a82f" }], ["stage", { stage: "IMPLEMENTING" }],
    ["attempt-start", {}], ["link-file", { path: "src/RefundService.cs", change: "modified", added: 40, removed: 10 }],
    ["stage", { stage: "BUILDING" }], ["act-start", { type: "build", label: "build" }], ["act-complete", { action: "act-1", outcome: "succeeded" }],
    ["stage", { stage: "TESTING" }], ["act-start", { type: "test", label: "RefundTests" }],
    ["link-receipt", { domain: "test", ref: "test-receipt-28", outcome: "FAILED", summary: "2 failed", action: "act-2" }],
    ["act-complete", { action: "act-2", outcome: "failed", summary: "2 failed" }], ["attempt-complete", { outcome: "failed", failureSignature: "a1b2c3d4e5f6" }],
    ["stage", { stage: "DIAGNOSING" }], ["decide", { observed: "2 refund boundary tests failed", hypothesis: "validation occurs after rounding", nextAction: "inspect-refund-validation", evidence: ["test:test-receipt-28"] }],
    ["attempt-start", { cause: "fix" }], ["stage", { stage: "FIXING" }], ["link-file", { path: "src/RefundService.cs", change: "modified", added: 21, removed: 8 }],
    ["stage", { stage: "TESTING" }], ["act-start", { type: "test", label: "RefundTests" }], ["act-complete", { action: "act-3", outcome: "failed", summary: "1 failed" }],
    ["attempt-complete", { outcome: "failed", failureSignature: "f6e5d4c3b2a1" }], ["attempt-start", { cause: "fix" }],
    ["act-start", { type: "test", label: "RefundTests" }], ["link-receipt", { domain: "test", ref: "test-receipt-31", outcome: "PASSED", action: "act-4" }],
    ["act-complete", { action: "act-4", outcome: "succeeded" }], ["stage", { stage: "REGRESSION" }], ["act-start", { type: "test", label: "Regression" }],
  ];
  for (const [name, given] of steps) w.op(id, name, given);
  return id;
}
