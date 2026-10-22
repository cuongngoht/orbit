// END TO END, opt in (ORBIT_SATELLITE_E2E=1): a real mission through the real Satellite CLI drives a REAL Orbit
// autonomous-engineering task on a planted defect -- the baseline fails, the change is made in the task's own
// workspace, the declared test passes, the task completes on its own evidence -- and the mission completes VERIFIED by
// that independent owner, with the primary checkout never written. Off by default: it runs npm and Orbit's whole
// engineering loop, and the suite stays fast. Everything lives under a temporary directory.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sealed } from "../../test/home.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SAT = join(ROOT, "satellite", "cli", "satellite.mjs");
const ENG = join(ROOT, "cli", "autonomous-engineering.mjs");
const BUGGY = "export const add = (a, b) => a - b;\n";

const FILES = {
  "add.mjs": BUGGY,
  "package.json": `${JSON.stringify({ name: "e2e", version: "1.0.0", type: "module", scripts: { test: "node --test" } }, null, 2)}\n`,
  "package-lock.json": `${JSON.stringify({ name: "e2e", version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name: "e2e", version: "1.0.0" } } }, null, 2)}\n`,
  "test/add.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../add.mjs";\ntest("adds", () => assert.equal(add(2, 3), 5));\n',
};

function checkout(t) {
  const dir = mkdtempSync(join(tmpdir(), "sat-e2e-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  for (const [rel, text] of Object.entries(FILES)) (mkdirSync(join(repo, rel, ".."), { recursive: true }), writeFileSync(join(repo, rel), text));
  const git = (args) => spawnSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { cwd: repo, encoding: "utf8" });
  for (const args of [["init", "-q"], ["add", "."], ["commit", "-qm", "init"]]) git(args);
  return { repo, git, env: sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_LIVE: "off", ORBIT_TRACE: "off", ORBIT_HOST: "claude" }) };
}

const cli = (w, file, args, input = "") => ((r) => ({ status: r.status, json: JSON.parse(r.stdout || "null"), err: r.stderr }))(spawnSync(process.execPath, [file, ...args], { cwd: w.repo, env: w.env, input, encoding: "utf8" }));

function satStep(w, msn, id, action) {
  const revision = cli(w, SAT, ["mission", "context", msn]).json.revision;
  return cli(w, SAT, ["mission", "step", msn], JSON.stringify({ schemaVersion: 1, decisionId: id, expectedRevision: revision, action, observed: "the context shows what is next" }));
}

function engStep(w, task, action, reason) {
  const revision = cli(w, ENG, ["context", task, "--json"]).json.revision;
  return cli(w, ENG, ["step", task, "--json"], JSON.stringify({ schemaVersion: 1, expectedRevision: revision, action, observed: "the context shows what the task needs next", hypothesis: "add subtracts where it should add", reason }));
}

function dispatched(w) {
  const msn = /msn-[a-f0-9]{12}/.exec(spawnSync(process.execPath, [SAT, "mission", "start", "Fix add so it returns the sum of its two arguments."], { cwd: w.repo, env: w.env, encoding: "utf8" }).stdout)[0];
  const goal = cli(w, SAT, ["mission", "show", msn]).json.mission.goalDigest.slice(0, 8);
  const steps = [{ kind: "analyze", intent: { facts: [{ statement: "add subtracts instead of adding", sourceRef: `goal@${goal}` }], acceptanceCriteria: [{ statement: "the declared test passes on the changed code" }] } }, { kind: "plan", units: [{ key: "fix", kind: "implement", objective: "make add return the sum of its two arguments", acceptanceCriteriaRefs: ["acc-1"] }] }, { kind: "resolve-role", unit: "wu-1", responsibilities: [{ activity: "implement", subject: "arithmetic" }], profile: "IMPLEMENT", purpose: "Change add so it returns the sum.", restrictions: ["It edits only inside the engineering task workspace."], completionCriteria: ["The engineering task completes on its own verification."] }, { kind: "resolve-template", unit: "wu-1" }];
  steps.forEach((action, i) => assert.equal(satStep(w, msn, `d-${i}`, action).status, 0, action.kind));
  return { msn, out: satStep(w, msn, "d-dispatch", { kind: "dispatch", unit: "wu-1" }).json };
}

// The engineer agent's half, as orbit:satellite-engineer would do it: drive the task the envelope names.
function engineered(w, task) {
  for (const kind of ["gather-context", "check-environment", "prepare-workspace"]) assert.equal(engStep(w, task, { kind }).status, 0, kind);
  assert.equal(engStep(w, task, { kind: "plan", intent: "change add so it returns the sum of its arguments", scope: ["add.mjs"] }, "the defect lives in add.mjs alone").status, 0);
  const check = cli(w, ENG, ["context", task, "--json"]).json.verificationPlan.required[0].id;
  assert.equal(engStep(w, task, { kind: "check", command: check }, "a baseline tells an old failure from a new one").json.outcome, "failed");
  assert.equal(engStep(w, task, { kind: "implement" }, "the plan names the one file").status, 0);
  writeFileSync(join(cli(w, ENG, ["context", task, "--json"]).json.workspace.path, "add.mjs"), "export const add = (a, b) => a + b;\n");
  assert.equal(engStep(w, task, { kind: "record-changes" }, "the change is made in the workspace").status, 0);
  const passed = engStep(w, task, { kind: "check", command: check }, "the change is held to the test it reaches");
  assert.equal(passed.json.outcome, "succeeded");
  assert.equal(engStep(w, task, { kind: "review" }, "the required check passed on the recorded change").json.lifecycle, "COMPLETED");
  return passed.json.data.check;
}

test("a real mission completes VERIFIED on a real engineering task's own evidence, and the checkout is never written", { skip: process.env.ORBIT_SATELLITE_E2E !== "1" && "set ORBIT_SATELLITE_E2E=1 to run Orbit's whole engineering loop" }, (t) => {
  const w = checkout(t);
  const { msn, out } = dispatched(w);
  const task = out.result.envelope.drive.task;
  assert.match(task, /^tsk-[a-f0-9]{12}$/);
  const chk = engineered(w, task);
  const report = { schemaVersion: 1, agentRunId: "arn-1", executionState: "reported", findings: [{ say: "add now adds, in the task's own workspace", refs: [`task:${task}`] }], evidenceRefs: [`task:${task}`, `check:${task}:${chk}`], remainingUnknowns: [], summary: "the engineering task completed on its own verification" };
  assert.equal(cli(w, SAT, ["agent", "report", msn, "arn-1"], JSON.stringify(report)).json.outcome, "succeeded");
  const end = cli(w, SAT, ["mission", "finish", msn]).json;
  assert.deepEqual([end.lifecycle, end.verdict, end.acceptance[0].independent], ["COMPLETED", "VERIFIED", true]);
  assert.deepEqual([readFileSync(join(w.repo, "add.mjs"), "utf8"), w.git(["status", "--porcelain"]).stdout], [BUGGY, ""]);
});
