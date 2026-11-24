// THE NATIVE TIER: what only a REAL binary can show, run where the pinned CLI is installed (npm run test:native -w
// @orbit-web/api) and never in the deterministic tier (scripts/ci.mjs), whose rule is that every test it collects runs
// and passes. Skipped, saying why, where codex is not installed: a skip here is reported as a skip, never as a pass.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { neutralizedCodexModel } from "../../src/contexts/execution/infrastructure/employee-runtimes.js";
import { NodeProcessPort } from "../../src/infra/process/node-process.js";
import { CODEX_BRIDGE_MAIN, observeCodexSplit } from "../../src/modules/connections/codex-split.js";

// The observation itself, on the codex binary installed here -- skipped where there is none (the CI): Orbit's entry and
// flags are held; the model's own entry is not.
const codex = spawnSync("codex", ["--version"], { encoding: "utf8" });
test("on the installed codex: Orbit's model plane is held to Orbit's tools, the model's own is not", { skip: codex.status !== 0 ? "codex is not installed here" : false, timeout: 120_000 }, async () => {
  const scratch = mkdtempSync(join(tmpdir(), "codex-split-"));
  try {
    const bundled = spawnSync("codex", ["debug", "models", "--bundled"], { encoding: "utf8", env: { PATH: process.env.PATH ?? "", HOME: scratch, CODEX_HOME: scratch }, maxBuffer: 8 * 1024 * 1024 });
    const entry = (JSON.parse(bundled.stdout) as { models: Record<string, unknown>[] }).models.find((m) => m.slug === "gpt-6.1-sol" || m.visibility === "list") as Record<string, unknown>;
    const deps = { process: new NodeProcessPort(), codex: "codex", node: process.execPath, bridge: CODEX_BRIDGE_MAIN, scratchParent: scratch, env: { PATH: process.env.PATH ?? "" }, timeoutMs: 60_000 };
    const held = await observeCodexSplit(deps, { model: String(entry.slug), entry: neutralizedCodexModel(entry) });
    assert.equal(held.split, "yes", JSON.stringify(held));
    assert.ok(held.offered.includes("mcp__orbit_tools.submit_handoff"), JSON.stringify(held.offered));
    const own = await observeCodexSplit(deps, { model: String(entry.slug), entry });
    assert.equal(own.split, "no", JSON.stringify(own));
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
});
