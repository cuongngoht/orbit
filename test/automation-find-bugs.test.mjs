// A request to FIND bugs is an investigation, never a change to the code (1.8.7, P1). "bugs" is a development
// cue (1.8.6: "fix the two refund bugs" asks for a change), and the coordinated workflow is engineering when ANY
// matched intent is a development one -- so "find bugs" (intent investigation) used to be planned as an engineering
// task that edits code. A cue inside a longer cue another intent matched is now that intent's word alone
// (src/routing/classify.mjs); asking for a fix still plans the change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { classify } from "../src/routing/classify.mjs";
import { workflowOf } from "../src/automation/workflows.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const AUTOMATION = join(ROOT, "cli", "automation.mjs");
const HELP = join(ROOT, "cli", "help.mjs");

const ASKS = [
  { says: "find bugs", intent: "investigation", workflow: "investigation" },
  { says: "find bugs in the login screen", intent: "investigation", workflow: "investigation" },
  { says: "identify bugs on the orders screen", intent: "investigation", workflow: "investigation" },
  { says: "look for bugs in checkout", intent: "investigation", workflow: "investigation" },
  { says: "investigate duplicate requests", intent: "investigation", workflow: "investigation" },
  { says: "fix the bugs in the login screen", intent: "development", workflow: "engineering" },
  { says: "fix the two refund bugs so their tests pass", intent: "development", workflow: "engineering" },
  { says: "find and fix bugs in checkout", intent: "development", workflow: "engineering" },
  { says: "find bugs and fix them", intent: "investigation", workflow: "engineering" },
];

const factsOf = (says) => ((c) => ({ objective: says, ref: null, intent: c.intent.id, matched: c.matched, startable: [], named: [], playbook: null }))(classify(says));

test("a cue inside another intent's longer cue is that intent's word: 'bugs' in 'find bugs' is no request to change code", () => {
  assert.deepEqual(classify("find bugs").matched, ["investigation"]);
  assert.ok(classify("fix the bugs").matched.includes("development"), "asking for a fix is still development");
  assert.ok(classify("find bugs and fix them").matched.includes("development"), "'fix' is its own word, inside no other cue");
});

test("which workflow each request gets: finding bugs is investigated, fixing them is engineered", () => {
  for (const a of ASKS) {
    const f = factsOf(a.says);
    assert.equal(f.intent, a.intent, a.says);
    assert.equal(workflowOf(f).id, a.workflow, a.says);
  }
});

test("`automation plan` -- what /orbit-help runs -- plans no engineering task for 'find bugs', and one for a fix", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-find-bugs-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  const plan = (says) => JSON.parse(execFileSync(process.execPath, [AUTOMATION, "plan", `--for=${says}`, "--json"], { cwd: repo, env: sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off" }), encoding: "utf8" }));
  const found = plan("find bugs in the login screen");
  assert.equal(found.plan.workflow, "investigation");
  assert.ok(!found.plan.steps.some((s) => s.kind === "engineering"), "no step that edits code");
  assert.ok(found.plan.steps.some((s) => s.kind === "qa"));
  assert.ok(plan("fix the bugs in the login screen").plan.steps.some((s) => s.kind === "engineering"));
});

test("orbit-help names the same workflow automation plans: 'find bugs' is an investigation in its BECAUSE too", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orbit-find-bugs-help-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  const env = sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off" });
  const because = (says) => execFileSync(process.execPath, [HELP, `--for=${says}`], { cwd: repo, env, encoding: "utf8" }).split("\n").find((l) => l.startsWith("BECAUSE")) ?? "";
  assert.match(because("find bugs in the login screen"), /fits this task \(investigation\)/);
  assert.match(because("fix the bugs in the login screen"), /fits this task \(engineering\)/);
});
