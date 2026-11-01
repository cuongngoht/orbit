// The release ship's journal through the REAL task door (node cli/task.mjs, in a store of the test's own): a known
// finding repaired, the repair integrated in the ship's own workspace, a full retest, SHIPPABLE -- every line the ship
// writes accepted by the door every Orbit task is written through, and read back the way Orbit Live and Mission
// Control read it. The benchmark is the double (test/fakes/ship-world.mjs); nothing reaches Docker or a model.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { test } from "node:test";
import { begunShip } from "../skills/orbit-release/ship/session.mjs";
import { driven } from "../skills/orbit-release/ship/steps.mjs";
import { GIT_ENV, headOf, shipWorldOf } from "./fakes/ship-world.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");

test("a ship's whole journal, repair and retest included, goes through the real task door and reads as Live and Control read it", async (t) => {
  const w = shipWorldOf(t, { realDoor: true });
  const start = headOf(w.repo);
  const ctx = begunShip(w.world, { repair: true, failFast: true, limits: {}, version: "9.9.9" });
  const result = await driven(ctx);
  assert.deepEqual([result.outcome, result.exit], ["SHIPPABLE", 0], result.summary);
  const view = w.world.door.show(ctx.task);
  assert.deepEqual([view.lifecycle, view.task.provider, view.terminal], ["COMPLETED", "release", true]);
  assert.deepEqual(view.attempts.map((a) => [a.cause, a.outcome]), [["fresh", "failed"], ["retest", "succeeded"]]);
  assert.ok(view.actions.every((a) => a.state !== "running"), "no action is left open");
  assert.ok(view.receipts.some((r) => r.domain === "commit" && r.outcome === "COMMITTED"), "the integrated repair's commit, as a receipt");
  assert.ok(view.receipts.some((r) => r.domain === "test" && r.outcome === "REPAIRED_VERIFIED"), "the repair run, by its benchmark id");
  assert.ok(view.receipts.some((r) => r.domain === "task" && r.outcome === "STARTED"), "each benchmark run's own task, linked for Live to follow");
  const satisfied = new Set(view.verification.filter((v) => v.state === "satisfied").map((v) => v.subject));
  assert.ok(["CALC-001:real", "CALC-002:real", "QA-001:autonomous", "CALC-001:self-healing"].every((id) => satisfied.has(id)), "a verification row per row of the catalog, satisfied on its receipt");
  const machine = JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "task.mjs"), "machine", "--json"], { cwd: w.repo, env: sealed({ ...GIT_ENV, ORBIT_STORE_DIR: join(w.base, "store") }), encoding: "utf8" }).stdout);
  assert.ok(machine.tasks.some((r) => r.id === ctx.task && r.provider === "release" && r.lifecycle === "COMPLETED"), "Mission Control's machine view lists the ship");
  assert.equal(headOf(w.repo), start, "the person's checkout never moved");
});
