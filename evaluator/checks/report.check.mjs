// The report and the export, from a campaign room written by hand: rates leave INFRA_ERROR out and list it, a run not
// run is said, arms are compared task by task, and an export keeps a stream over 1 MB only as its digest and never a
// file that holds the credential.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { exportCampaign } from "../lib/run/export.mjs";
import { markdownOf, reportOf } from "../lib/run/report.mjs";
import { appendLine, writeJson } from "../lib/core/util.mjs";

const LIMITS = { usd: 1, turns: 60, minutes: 30, cpus: 2, memoryMb: 4096, pids: 1024 };

const PLAN = [["plain", "pack:a"], ["orbit", "pack:a"], ["plain", "pack:b"], ["orbit", "pack:b"], ["plain", "pack:c"]].map(([arm, task]) => ({ arm, task, trial: 1, key: `${arm}__${task.replace(":", "_")}__t1` }));

function room(home) {
  const dir = join(home, "campaigns", "c1");
  mkdirSync(dir, { recursive: true });
  writeJson(join(dir, "campaign.json"), { id: "c1", model: "m", effort: "medium", limits: LIMITS, budgetUsd: 3, claudeCode: "2.1.322", arms: { plain: { kind: "claude" }, orbit: { kind: "claude+orbit", rev: "v0.5.0", frozen: { commit: "abc" } } }, plan: PLAN, evaluator: { commit: "e1", dirty: false } });
  const j = join(dir, "journal.jsonl");
  const ended = (key, cost, summary = {}) => (appendLine(j, { kind: "started", run: key, attempt: 1, capUsd: 1 }), appendLine(j, { kind: "ended", run: key, attempt: 1, chargedUsd: cost ?? 1, wallMs: 120000, summary: { costUsd: cost, turns: 10, asked: false, tools: { skills: { "orbit-help": 2 }, agents: {} }, orbit: { commands: 3 }, plugins: ["orbit@0.5.0"], ...summary }, patch: { bytes: 10, paths: ["src/a.mjs"] } }));
  const word = (key, w, why = null) => appendLine(j, { kind: "outcome", run: key, attempt: 1, word: w, why });
  ended(PLAN[0].key, 0.2);
  word(PLAN[0].key, "UNRESOLVED");
  ended(PLAN[1].key, 0.4);
  word(PLAN[1].key, "RESOLVED");
  ended(PLAN[2].key, null);
  word(PLAN[2].key, "INFRA_ERROR", "API: 401");
  ended(PLAN[3].key, 0.6, { asked: true });
  word(PLAN[3].key, "FALSE_DONE");
  appendLine(j, { kind: "skipped", run: PLAN[4].key, reason: "the budget has $0.8 left" });
  const r = join(dir, "runs", "orbit-pack-a-t1", "a1");
  mkdirSync(join(r, "out"), { recursive: true });
  writeFileSync(join(r, "stream.jsonl"), "x".repeat(1024 * 1024 + 1));
  writeFileSync(join(r, "patch.diff"), "diff");
  writeFileSync(join(r, "outcome.json"), "{}");
  writeFileSync(join(r, "egress.log"), "token=sk-test-0123456789abcdef");
  return dir;
}

test("per arm: INFRA_ERROR out of the rate and listed, a skipped run said, the plugin's use counted", () => {
  const home = mkdtempSync(join(tmpdir(), "evl-rep-"));
  try {
    const rep = reportOf(room(home));
    const plain = rep.arms.find((a) => a.arm === "plain");
    const orbit = rep.arms.find((a) => a.arm === "orbit");
    assert.deepEqual([plain.gradable, plain.resolved, plain.rate, plain.words.INFRA_ERROR], [1, 0, 0, 1]);
    assert.deepEqual(plain.infraErrors, [{ key: PLAN[2].key, why: "API: 401" }]);
    assert.deepEqual(plain.notRun.map((n) => n.word), ["NOT_RUN"]);
    assert.deepEqual([orbit.gradable, orbit.resolved, orbit.rate, orbit.words.FALSE_DONE, orbit.interventions], [2, 1, 0.5, 1, 1]);
    assert.deepEqual(orbit.usage, { skillCalls: 4, agentCalls: 0, pluginCommands: 6, runsWithPluginLoaded: 2 });
    assert.equal(orbit.medianCostUsd, 0.5);
    assert.deepEqual(rep.pairwise.find((p) => p.task === "pack:a").arms, { plain: ["UNRESOLVED"], orbit: ["RESOLVED"] });
    assert.equal(rep.ledger.chargedUsd, 2.2);
    const md = markdownOf(rep);
    assert.match(md, /a difference of one task is noise/);
    assert.match(md, /INFRA_ERROR — API: 401/);
    assert.match(md, /NOT_RUN — the budget/);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("an export keeps a large stream as its digest and drops a file that holds the credential", () => {
  const home = mkdtempSync(join(tmpdir(), "evl-exp-"));
  const before = process.env.CLAUDE_CODE_OAUTH_TOKEN;
  try {
    room(home);
    process.env.CLAUDE_CODE_OAUTH_TOKEN = "sk-test-0123456789abcdef";
    const out = exportCampaign("c1", join(home, "out"), { home });
    const run = join(out.dest, "runs", "orbit-pack-a-t1", "a1");
    assert.equal(existsSync(join(run, "stream.jsonl")), false);
    assert.equal(JSON.parse(readFileSync(join(run, "stream.digest.json"), "utf8")).bytes, 1024 * 1024 + 1);
    assert.equal(existsSync(join(run, "patch.diff")), true);
    assert.deepEqual(out.leaked, ["runs/orbit-pack-a-t1/a1/egress.log"]);
    for (const f of ["campaign.json", "journal.jsonl", "report.json", "REPORT.md"]) assert.ok(existsSync(join(out.dest, f)), f);
  } finally {
    if (before === undefined) delete process.env.CLAUDE_CODE_OAUTH_TOKEN;
    else process.env.CLAUDE_CODE_OAUTH_TOKEN = before;
    rmSync(home, { recursive: true, force: true });
  }
});
