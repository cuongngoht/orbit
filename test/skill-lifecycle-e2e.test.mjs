// The whole reusable-skill lifecycle (0.0.4) on a FRESH store, through the real command lines a host runs -- no fake
// between them: a project registers two read-only capabilities of its own (qc-tool), a goal written in Vietnamese is
// analyzed into a structured intent and planned, its unit starts a coordinated workflow that finds nothing provides the
// capability, drafts a declared playbook the host writes, registers it, and RUNS it through the capability pipeline; a
// viewer reads the run; a second session reuses the skill without drafting anything; and a run killed mid-call is
// reconciled as interrupted, never run again by itself. AC-18, with AC-03, AC-06, AC-07, AC-12 and AC-14 end to end.
import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CAPABILITY = "release.readiness.verification";

// Two read-only capabilities of the project's own: the release evidence for an objective, and the release notes for
// one item. The evidence never answers for an objective that asks it to hang -- what a killed process leaves open.
const CAPABILITIES = `export default [
  { id: "relevidence.read", apiVersion: "orbit.capability/v1", doc: "the release evidence for an objective", provides: ["release.evidence.read"], page: false,
    inputSchema: { q: { type: "string", esc: "text", doc: "what the evidence is for" } }, required: ["q"], tools: [], timeoutSec: 60,
    invoke(ext, input) { return String(input.q).includes("(hang)") ? new Promise(() => {}) : { count: 1, first: "REL-7" }; } },
  { id: "relnotes.read", apiVersion: "orbit.capability/v1", doc: "the release notes for one item", provides: ["release.notes.search"], page: false,
    inputSchema: { query: { type: "string", esc: "text", doc: "the item" } }, required: ["query"], tools: [], timeoutSec: 30,
    invoke(ext, input) { return { hits: [{ title: "notes for " + input.query }] }; } },
];
`;

const SKILL = `---
name: release-readiness-verification
description: Check a release is ready by reading its evidence and the release notes it names, and say what still needs a person.
user-invocable: false
---

# Release readiness verification

The engine runs this playbook's declared workflow step by step:

1. Read the release evidence for the objective.
2. Read the release notes for the first item the evidence names.

Each step is reported as its receipt shows it; nothing here is verified unless an owner's record proves it.
`;

const WORKFLOW = { api: "orbit.skill-workflow/v1", bounds: { maxCalls: 6 }, steps: [
  { id: "evidence", capability: "release.evidence.read", input: { q: { from: "context.objective" } }, outputs: { count: { type: "number", path: "count" }, first: { type: "string", path: "first" } }, success: [{ output: "count", op: "gte", value: 1 }] },
  { id: "notes", capability: "release.notes.search", after: ["evidence"], input: { query: { from: "steps.evidence.first" } }, outputs: { hits: { type: "count", path: "hits" } }, success: [{ output: "hits", op: "gte", value: 1 }] },
] };

function project(t) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "orbit-skill-e2e-")));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const repo = join(dir, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  execFileSync("git", ["-C", repo, "-c", "user.email=a@b.c", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "init"], { env: sealed() });
  const env = (session = "s-1") => sealed({ ORBIT_STORE_DIR: join(dir, "store"), ORBIT_TRACE: "off", ORBIT_LIVE: "off", ORBIT_SESSION: session, ORBIT_HOST: "claude" });
  return { dir, repo, env, scratch: join(dir, "scratch") };
}

const cli = (p, name, args, { input, session } = {}) => spawnSync(process.execPath, [join(ROOT, "cli", name), ...args], { cwd: p.repo, env: p.env(session), input, encoding: "utf8" });

function json(r) {
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr || r.stdout}`);
  return JSON.parse(r.stdout);
}

// One decided step, as a host takes it: the context's revision, then the step on stdin.
function stepped(p, task, step, session) {
  const c = json(cli(p, "automation.mjs", ["context", task, "--json"], { session }));
  const decision = { schemaVersion: 1, decisionId: `d-${step}-${c.revision}`, expectedRevision: c.revision, action: { kind: "run", step }, observed: `${step} is ready`, hypothesis: `running ${step} moves the workflow on` };
  return { decision, answer: json(cli(p, "automation.mjs", ["step", task, "--json"], { input: JSON.stringify(decision), session })) };
}

const events = (p, task, session) => json(cli(p, "task.mjs", ["events", task, "--json"], { session })).events;

const receipts = (p, task, domain, session) => events(p, task, session).filter((e) => e.kind === "receipt" && e.domain === domain);

// The project's own capabilities, scaffolded, written, verified and registered in the machine store.
const said = (r) => {
  if (r.status !== 0) throw new Error(`exit ${r.status}: ${r.stderr || r.stdout}`);
  return r.stdout;
};

function capabilitiesRegistered(p) {
  said(cli(p, "qc-tool.mjs", ["new", "release-checks", join(p.scratch, "release-checks")]));
  writeFileSync(join(p.scratch, "release-checks", "capabilities.mjs"), CAPABILITIES);
  assert.match(said(cli(p, "qc-tool.mjs", ["verify", join(p.scratch, "release-checks")])), /holds to orbit\.extension\/v2 — offers relevidence\.read, relnotes\.read/);
  said(cli(p, "qc-tool.mjs", ["register", join(p.scratch, "release-checks")]));
}

// What the host writes into the draft a propose step scaffolded, through the factory's one door for it.
function drafted(p, draft) {
  mkdirSync(join(p.scratch, "draft"), { recursive: true });
  writeFileSync(join(p.scratch, "draft", "SKILL.md"), SKILL);
  writeFileSync(join(p.scratch, "draft", "workflow.json"), JSON.stringify(WORKFLOW, null, 2));
  json(cli(p, "skill-factory.mjs", ["put", draft, join(p.scratch, "draft", "SKILL.md"), "--json"]));
  json(cli(p, "skill-factory.mjs", ["put", draft, join(p.scratch, "draft", "workflow.json"), "--json"]));
}

const ANALYSIS = (digest) => ({ objective: "Tạo quy trình kiểm tra chất lượng trước khi phát hành", intent: { category: "procedure", workKinds: ["procedure"], capabilities: [CAPABILITY], verification: ["mỗi kiểm tra có kết quả được ghi lại"] }, requirements: [{ statement: "Quy trình chạy mọi kiểm tra chất lượng đã khai báo", sourceRef: `spec@${digest}#L1` }], acceptance: [{ statement: "Mỗi kiểm tra có kết quả được ghi lại", sourceRef: `spec@${digest}#L2` }], unknowns: [], conflicts: [] });

test("AC-18: from an empty store, a Vietnamese goal becomes a generated, declared, registered skill that runs through the capability pipeline -- and a second session reuses it", { timeout: 240_000 }, async (t) => {
  const p = project(t);
  assert.equal(existsSync(join(p.dir, "store")), false, "an empty machine store: nothing to discover, nothing to migrate");
  execFileSync(process.execPath, [join(ROOT, "cli", "init.mjs"), p.repo, "--origin=http://localhost:3000"], { env: p.env(), stdio: "ignore" });
  capabilitiesRegistered(p);

  const goal = json(cli(p, "orbit.mjs", ["goal", "start", "--stdin", "--json"], { input: "Tạo quy trình kiểm tra chất lượng trước khi phát hành.\nAC1: Mỗi kiểm tra có kết quả được ghi lại.\n" }));
  json(cli(p, "orbit.mjs", ["goal", "analyze", goal.id, "--stdin", "--json"], { input: JSON.stringify(ANALYSIS(goal.specDigest)) }));
  assert.equal(json(cli(p, "orbit.mjs", ["goal", "plan", goal.id, "--json"])).units, 1, "one procedure unit, planned from the structured intent");
  const unit = json(cli(p, "orbit.mjs", ["goal", "step", goal.id, "--json"]));
  const task = unit.task;
  assert.match(task, /^tsk-[0-9a-f]{12}$/);
  const plan = json(cli(p, "automation.mjs", ["plan", task, "--json"]));
  assert.deepEqual(plan.plan.steps.map((s) => s.kind), ["context", "propose-skill", "register-skill", "playbook"], "nothing provides it: a workflow gap the factory may close, planned whole");
  assert.ok(receipts(p, task, "goal").some((r) => r.ref === `${goal.id}:${unit.unit}`), "the workflow names the goal and unit it serves");

  stepped(p, task, "context");
  const proposed = stepped(p, task, "propose-skill");
  const draft = json(cli(p, "skill-factory.mjs", ["drafts", "--json"]))[0]?.id;
  assert.equal(draft, "release-readiness-verification");
  drafted(p, draft);
  json(cli(p, "automation.mjs", ["settle", task, "--json"], { input: JSON.stringify({ schemaVersion: 1, decisionId: proposed.decision.decisionId, expectedRevision: proposed.answer.revision, stepId: "propose-skill", executionState: "succeeded", evidenceRefs: [`skill:${draft}`] }) }));
  assert.equal(stepped(p, task, "register-skill").answer.stepState, "succeeded", "verified and registered under the factory's lock");
  const ran = stepped(p, task, "playbook").answer;
  assert.equal(ran.stepState, "reported", "two calls that answered within their contracts are reported, never verified");
  assert.equal(ran.lifecycle, "COMPLETED");

  const run = receipts(p, task, "skillrun").at(-1);
  assert.equal(run.outcome, "REPORTED");
  const calls = receipts(p, task, "invocation");
  assert.deepEqual(calls.map((c) => [c.ref.split(".").slice(-2)[0], c.outcome, c.operation]), [["evidence", "OK", "read"], ["notes", "OK", "read"]], "each step asked once, through the capability pipeline, reading");
  assert.ok(calls.every((c) => /^[0-9a-f]{64}$/.test(c.queryDigest) && /^[0-9a-f]{64}$/.test(c.resultDigest)));
  assert.equal(JSON.stringify(events(p, task)).includes("notes for REL-7"), false, "what a call answered is never kept");

  const live = json(cli(p, "live.mjs", ["status", task, "--json"]));
  assert.deepEqual(live.plan.runs.map((r) => [r.pin, r.state]), [[run.pin, "REPORTED"]]);
  assert.deepEqual(live.plan.runs[0].steps.map((s) => [s.id, s.word]), [["evidence", "CONTRACT_MET"], ["notes", "CONTRACT_MET"]]);

  const discovered = json(cli(p, "skill-factory.mjs", ["discover", `--for=${CAPABILITY}`, "--json"]));
  assert.deepEqual([discovered.label, discovered.pin, discovered.runs], ["REUSABLE", run.pin, "declared"]);
  assert.equal(json(cli(p, "skill-factory.mjs", ["runs", draft, "--json"])).runs.length, 1);
  assert.equal(json(cli(p, "skill-factory.mjs", ["review", draft, "--json"])).reliability.word, "INSUFFICIENT");

  // AC-14: another session, the same project -- the skill is reused, pinned, and nothing is drafted.
  const second = json(cli(p, "automation.mjs", ["start", "--for=Create a pre-release quality verification workflow", "--intent=engineering", `--capability=${CAPABILITY}`, "--json"], { session: "s-2" }));
  assert.deepEqual(second.plan.steps.map((s) => s.kind), ["context", "playbook"], "reuse first: no draft, no register step");
  stepped(p, second.task, "context", "s-2");
  assert.equal(stepped(p, second.task, "playbook", "s-2").answer.stepState, "reported");
  assert.equal(receipts(p, second.task, "skillrun", "s-2").at(-1).pin, run.pin, "the second session ran the version the first one registered");
  assert.deepEqual(json(cli(p, "skill-factory.mjs", ["drafts", "--json"])), []);
  assert.equal(json(cli(p, "skill-factory.mjs", ["review", draft, "--json"])).reliability.word, "UNPROVEN", "two sessions' runs, answered and never proven");

  const store = join(p.dir, "store");
  assert.ok(readdirSync(store).length > 0);
  assert.equal(existsSync(join(p.repo, "generated-skills")), false, "nothing generated is written into the checkout");
  assert.equal(execFileSync("git", ["-C", p.repo, "status", "--porcelain"], { encoding: "utf8" }).trim(), "", "the repository is untouched");
});

test("AC-12: a run killed mid-call is reconciled as INTERRUPTED and is never run again by itself", { timeout: 240_000 }, async (t) => {
  const p = project(t);
  execFileSync(process.execPath, [join(ROOT, "cli", "init.mjs"), p.repo, "--origin=http://localhost:3000"], { env: p.env(), stdio: "ignore" });
  capabilitiesRegistered(p);
  const first = json(cli(p, "automation.mjs", ["start", "--for=Check the release is ready", "--intent=engineering", `--capability=${CAPABILITY}`, "--json"]));
  stepped(p, first.task, "context");
  const proposed = stepped(p, first.task, "propose-skill");
  drafted(p, "release-readiness-verification");
  json(cli(p, "automation.mjs", ["settle", first.task, "--json"], { input: JSON.stringify({ schemaVersion: 1, decisionId: proposed.decision.decisionId, expectedRevision: proposed.answer.revision, stepId: "propose-skill", executionState: "succeeded", evidenceRefs: ["skill:release-readiness-verification"] }) }));
  stepped(p, first.task, "register-skill");

  const hung = json(cli(p, "automation.mjs", ["start", "--for=Check the release is ready (hang)", "--intent=engineering", `--capability=${CAPABILITY}`, "--json"], { session: "s-3" }));
  stepped(p, hung.task, "context", "s-3");
  const c = json(cli(p, "automation.mjs", ["context", hung.task, "--json"], { session: "s-3" }));
  const child = spawn(process.execPath, [join(ROOT, "cli", "automation.mjs"), "step", hung.task, "--json"], { cwd: p.repo, env: p.env("s-3"), stdio: ["pipe", "ignore", "ignore"] });
  child.stdin.end(JSON.stringify({ schemaVersion: 1, decisionId: "d-hang", expectedRevision: c.revision, action: { kind: "run", step: "playbook" }, observed: "the playbook is ready", hypothesis: "its run answers" }));
  const open = () => receipts(p, hung.task, "skillstep", "s-3").some((r) => r.ref.endsWith(".evidence") && r.outcome === "RUNNING");
  for (let i = 0; i < 400 && !open(); i += 1) await new Promise((r) => setTimeout(r, 25));
  assert.ok(open(), "the step was recorded before it was asked");
  child.kill("SIGKILL");
  await new Promise((r) => child.once("exit", r));

  const reconciled = json(cli(p, "automation.mjs", ["reconcile", hung.task, "--json"], { session: "s-3" }));
  assert.ok(reconciled.settled.length >= 2, "the playbook step's engine action and its open step were both closed");
  const words = receipts(p, hung.task, "skillstep", "s-3").filter((r) => r.ref.endsWith(".evidence")).map((r) => r.outcome);
  assert.deepEqual(words.slice(-1), ["INTERRUPTED"], "it read, so it is interrupted -- never claimed done");
  assert.equal(receipts(p, hung.task, "skillrun", "s-3").at(-1).outcome, "INTERRUPTED");
  const after = json(cli(p, "task.mjs", ["show", hung.task, "--json"], { session: "s-3" }));
  assert.equal(after.task?.lifecycle ?? after.lifecycle, "FAILED", "with no retry left it ends; nothing reruns it by itself");
  assert.equal(events(p, hung.task, "s-3").filter((e) => e.kind === "action-started" && e.type === "skill.step").length, 1, "the call was started once and never again");
  assert.equal(readFileSync(join(p.repo, ".git", "HEAD"), "utf8").length > 0, true);
});
