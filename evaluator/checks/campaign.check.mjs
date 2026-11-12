// A campaign's definition, its plan, and the arms: the same flags, prompt and limits for every model arm, with only
// --plugin-dir between them; controls that act on a run allowed on a scripted arm alone.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { armOf } from "../lib/arms/index.mjs";
import { ALLOWED_TOOLS, DISALLOWED_TOOLS, hostArgs } from "../lib/arms/claude.mjs";
import { loadCampaign, planOf } from "../lib/run/campaign.mjs";
import { CLOSING, promptOf } from "../lib/run/prompt.mjs";
import { selfcheckCampaign, SELF_CONTROLS } from "../lib/run/selfcheck.mjs";

const LIMITS = { usd: 1, turns: 60, minutes: 30, cpus: 2, memoryMb: 4096, pids: 1024 };

const def = (o = {}) => ({ schema: 1, id: "c1", model: "m", effort: "medium", budgetUsd: 10, limits: LIMITS, arms: { plain: { kind: "claude" }, orbit: { kind: "claude+orbit", rev: "v0.5.0" } }, tasks: ["pack:orders-e2e-001", "pack:lending-hld-001"], trials: 2, ...o });

function loaded(d) {
  const dir = mkdtempSync(join(tmpdir(), "evl-camp-"));
  try {
    writeFileSync(join(dir, "c.json"), JSON.stringify(d));
    return loadCampaign(join(dir, "c.json"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("every arm on every task for every trial, and a seeded shuffle is the same order every time", () => {
  const plan = planOf(def());
  assert.equal(plan.length, 8);
  assert.equal(new Set(plan.map((r) => r.key)).size, 8);
  const a = planOf(def({ order: { shuffle: 7 } })).map((r) => r.key);
  assert.deepEqual(a, planOf(def({ order: { shuffle: 7 } })).map((r) => r.key));
  assert.notDeepEqual(a, plan.map((r) => r.key));
  assert.deepEqual([...a].sort(), plan.map((r) => r.key).sort());
});

test("a memory track keeps its declared order after the rest, one store for its tasks", () => {
  const plan = planOf(def({ tasks: [], tracks: [{ id: "m1", arm: "orbit", tasks: ["pack:orders-e2e-001", "pack:orders-e2e-002"] }] }));
  assert.deepEqual(plan.map((r) => [r.task, r.track, r.step]), [["pack:orders-e2e-001", "m1", 1], ["pack:orders-e2e-002", "m1", 2]]);
});

test("a definition is refused with every reason, and a model arm needs a model and an effort", () => {
  assert.throws(() => loaded({ ...def(), model: undefined, limits: { usd: 1 } }), (e) => /model and effort/.test(e.message) && /limits.turns/.test(e.message));
  assert.doesNotThrow(() => loaded(def()));
  assert.doesNotThrow(() => loaded(selfcheckCampaign({ id: "s1" })));
});

test("the model arms differ by --plugin-dir alone", () => {
  const ctx = { model: "m", effort: "medium", limits: LIMITS };
  const plain = armOf("plain", { kind: "claude" }).argv(ctx);
  const orbit = armOf("orbit", { kind: "claude+orbit", rev: "v0.5.0" }).argv(ctx);
  const at = orbit.indexOf("--plugin-dir");
  assert.deepEqual([...orbit.slice(0, at), ...orbit.slice(at + 2)], plain);
  assert.equal(orbit[at + 1], "/opt/orbit-plugin");
  for (const flag of ["-p", "--verbose", "--strict-mcp-config", "--no-session-persistence"]) assert.ok(plain.includes(flag), flag);
  const pairs = Object.fromEntries(["--output-format", "--permission-mode", "--allowedTools", "--disallowedTools", "--setting-sources", "--model", "--effort", "--max-budget-usd", "--max-turns"].map((f) => [f, plain[plain.indexOf(f) + 1]]));
  assert.deepEqual(pairs, { "--output-format": "stream-json", "--permission-mode": "dontAsk", "--allowedTools": ALLOWED_TOOLS.join(","), "--disallowedTools": DISALLOWED_TOOLS.join(","), "--setting-sources": "user", "--model": "m", "--effort": "medium", "--max-budget-usd": "1", "--max-turns": "60" });
  assert.deepEqual(DISALLOWED_TOOLS, ["WebFetch", "WebSearch"]);
  assert.deepEqual(hostArgs({ ...ctx, usd: 1, turns: 60 }), plain);
});

test("a model arm hands its credential by name, and only a scripted arm carries run controls", () => {
  assert.deepEqual(armOf("plain", { kind: "claude" }).credentialNames, ["CLAUDE_CODE_OAUTH_TOKEN"]);
  assert.throws(() => armOf("x", { kind: "claude", credential: "ANTHROPIC_BASE_URL" }), /credential must be one of/);
  assert.throws(() => armOf("x", { kind: "claude", killAfterSeconds: 3 }), /not a field/);
  assert.throws(() => armOf("x", { kind: "claude+orbit" }), /rev/);
  assert.throws(() => armOf("x", { kind: "scripted", behaviour: "dance" }), /behaviour/);
  assert.deepEqual(armOf("x", { kind: "scripted", behaviour: "sleep", killAfterSeconds: 3 }).control, { killAfterSeconds: 3, egressAllow: null, minutes: null });
  assert.equal(armOf("x", { kind: "scripted", behaviour: "noop" }).charges, false);
});

test("the prompt is the issue and one fixed closing paragraph, the same for every arm", () => {
  assert.equal(promptOf("  Fix it.\n"), `Fix it.\n\n${CLOSING}\n`);
  assert.match(CLOSING, /EVAL_STATUS: DONE/);
  assert.match(CLOSING, /EVAL_STATUS: BLOCKED/);
});

test("the self-check covers every outcome word a control can earn without a model", () => {
  const words = new Set(Object.values(SELF_CONTROLS).map(([, w]) => w));
  for (const w of ["RESOLVED", "UNRESOLVED", "REGRESSED", "EMPTY_PATCH", "FALSE_DONE", "TIMEOUT", "INFRA_ERROR"]) assert.ok(words.has(w), w);
  const c = selfcheckCampaign({ id: "s2" });
  assert.equal(c.budgetUsd, 0);
  // Without a model: every arm of the self-check spends nothing and needs no credential (the mini arms run their
  // deterministic model).
  const arms = Object.entries(c.arms).map(([id, a]) => armOf(id, a));
  assert.ok(arms.every((a) => a.charges === false && a.credentialNames.length === 0), arms.filter((a) => a.charges !== false || a.credentialNames.length).map((a) => a.id).join(", "));
});

test("status: a run that ended and waits for its grade is GRADING, never INTERRUPTED", async () => {
  const { campaignStatus } = await import("../lib/run/campaign.mjs");
  const home = mkdtempSync(join(tmpdir(), "evl-st-"));
  try {
    const room = join(home, "campaigns", "c1");
    const plan = planOf(def({ trials: 1 }));
    mkdirSync(room, { recursive: true });
    writeFileSync(join(room, "campaign.json"), JSON.stringify({ ...def({ trials: 1 }), plan }));
    const lines = [{ kind: "started", run: plan[0].key, attempt: 1, capUsd: 1 }, { kind: "ended", run: plan[0].key, attempt: 1, chargedUsd: 0.1 }, { kind: "started", run: plan[1].key, attempt: 1, capUsd: 1 }, { kind: "interrupted", run: plan[1].key, attempt: 1, chargedUsd: 1 }];
    writeFileSync(join(room, "journal.jsonl"), lines.map((l) => JSON.stringify(l)).join("\n"));
    const states = campaignStatus("c1", { home }).rows.map((r) => r.state);
    assert.deepEqual(states.slice(0, 2), ["GRADING", "INTERRUPTED"]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
