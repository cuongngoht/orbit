// THE REAL CLI, through the real composition root: a temporary git checkout, a temporary machine store, a sealed
// environment (no HOME, no ORBIT_* of this machine), and Orbit's own store resolution. A whole mission goes through
// it; the checkout is never written; a stale decision exits 2 with nothing written; and Satellite Live follows the
// journal and ends by itself once the mission has.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { sealed } from "../../test/home.mjs";

const CLI = join(dirname(fileURLToPath(import.meta.url)), "..", "cli", "satellite.mjs");

function checkout(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "satellite-cli-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  mkdirSync(join(repo, "src"), { recursive: true });
  writeFileSync(join(repo, "src", "client.mjs"), "export const retries = 9;\n");
  return { repo, store: join(dir, "store"), dir, git: gitIn(repo) };
}

const gitIn = (repo) => (args) => spawnSync("git", ["-c", "user.email=t@example.invalid", "-c", "user.name=t", ...args], { cwd: repo, encoding: "utf8" });

const satellite = (w, args, input = "") => spawnSync(process.execPath, [CLI, ...args], { cwd: w.repo, input, encoding: "utf8", env: sealed({ ORBIT_STORE_DIR: w.store, ORBIT_LIVE: "off", ORBIT_TRACE: "off", ORBIT_HOST: "claude" }) });

const json = (r) => JSON.parse(r.stdout);

const decision = (id, revision, action) => JSON.stringify({ schemaVersion: 1, decisionId: id, expectedRevision: revision, action, observed: "the context shows what is next" });

const stepped = (w, msn, id, action) => satellite(w, ["mission", "step", msn], decision(id, json(satellite(w, ["mission", "context", msn])).revision, action));

function mission(t) {
  const w = checkout(t);
  w.git(["init", "-q"]);
  w.git(["add", "."]);
  w.git(["commit", "-qm", "init"]);
  return { ...w, msn: /msn-[a-f0-9]{12}/.exec(satellite(w, ["mission", "start", "Find why the nightly build times out."]).stdout)[0] };
}

const INTENT = (g) => ({ facts: [{ statement: "the nightly build times out", sourceRef: `goal@${g}` }], acceptanceCriteria: [{ statement: "the cause is named with the file that shows it" }] });

const ROLE = { unit: "wu-1", responsibilities: [{ activity: "analyze", subject: "build timeout" }], profile: "READ_ONLY", purpose: "Find what makes the build time out.", restrictions: ["It changes nothing."], completionCriteria: ["Every finding cites a file."] };

const REPORT = JSON.stringify({ schemaVersion: 1, agentRunId: "arn-1", executionState: "reported", findings: [{ say: "the client retries nine times", refs: ["file:src/client.mjs"] }], evidenceRefs: ["file:src/client.mjs"], summary: "the retry count makes the build exceed its deadline" });

function driven(w) {
  const goal = json(satellite(w, ["mission", "show", w.msn])).mission.goalDigest.slice(0, 8);
  for (const [i, action] of [{ kind: "analyze", intent: INTENT(goal) }, { kind: "plan", units: [{ key: "explore", kind: "explore", objective: "find where the timeout comes from", acceptanceCriteriaRefs: ["acc-1"] }] }, { kind: "resolve-role", ...ROLE }, { kind: "resolve-template", unit: "wu-1" }].entries()) assert.equal(stepped(w, w.msn, `d-${i}`, action).status, 0);
  return stepped(w, w.msn, "d-dispatch", { kind: "dispatch", unit: "wu-1" });
}

test("protocol answers anywhere, even outside a checkout", (t) => {
  const w = checkout(t);
  const r = spawnSync(process.execPath, [CLI, "protocol"], { cwd: w.dir, encoding: "utf8", env: sealed({ ORBIT_STORE_DIR: w.store }) });
  assert.deepEqual([r.status, json(r).decisionSchema, json(r).event.api], [0, 1, "orbit.satellite.event/v1"]);
});

test("a whole mission through the CLI: a generated role, one envelope, one report, REPORTED -- and the checkout untouched", (t) => {
  const w = mission(t);
  const dispatched = json(driven(w));
  assert.deepEqual([dispatched.open, dispatched.result.envelope.agent.subagentType, dispatched.result.envelope.role.displayName], [true, "orbit:satellite-reader", "BuildTimeoutAnalyst"]);
  assert.equal(json(satellite(w, ["agent", "report", w.msn, "arn-1"], REPORT)).outcome, "succeeded");
  assert.deepEqual(((f) => [f.lifecycle, f.verdict])(json(satellite(w, ["mission", "finish", w.msn]))), ["REPORTED", "NOT_VERIFIED"]);
  assert.equal(w.git(["status", "--porcelain"]).stdout, "", "the mission wrote nothing into the checkout");
});

test("a decision on a moved revision exits 2 and writes nothing", (t) => {
  const w = mission(t);
  const before = json(satellite(w, ["mission", "context", w.msn])).revision;
  const r = satellite(w, ["mission", "step", w.msn], decision("old", before - 1, { kind: "checkpoint" }));
  assert.deepEqual([r.status, /STALE_REVISION/.test(r.stderr), json(satellite(w, ["mission", "context", w.msn])).revision], [2, true, before]);
});

test("Satellite Live follows the journal line by line, resumes at a cursor, and ends by itself with the mission", (t) => {
  const w = mission(t);
  driven(w);
  satellite(w, ["agent", "report", w.msn, "arn-1"], REPORT);
  satellite(w, ["mission", "finish", w.msn]);
  const lines = satellite(w, ["live", "watch", w.msn, "--plain"]).stdout.trim().split("\n");
  const revision = json(satellite(w, ["mission", "context", w.msn])).revision;
  const resumed = satellite(w, ["live", "watch", w.msn, "--plain", `--since=o=${revision - 2}`]).stdout.trim().split("\n");
  const frames = satellite(w, ["live", "watch", w.msn, "--jsonl"]).stdout.trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual([lines.length, resumed.length, frames.at(-1).event, frames.at(-1).data.reason], [revision, 2, "end", "terminal"]);
});
