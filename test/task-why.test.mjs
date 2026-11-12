// `task why` (0.6.0, P6): for each decision, how it SETTLED and what moved the task next, on which receipt -- read off
// the task's own fold, never judged again. A fixture journal holds every settlement word to its row: a decision settled
// on a receipt, one that only REPORTED (never proven), one OPEN (reconcile reads it back), one AMBIGUOUS (read back,
// never resent), one that asked a person, one that started nothing. Then the real CLI, in a throwaway checkout.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { modelOf } from "../src/task/model.mjs";
import { TASK_SCHEMA } from "../src/task/vocab.mjs";
import { SETTLED, WHY_VERSION, whyOf } from "../src/task/why.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = "2026-11-12T10:59:00.000Z";

let minute = 0;
const at = () => `2026-11-12T10:${String(minute++).padStart(2, "0")}:00.000Z`;

function journal(...lines) {
  minute = 0;
  return [{ kind: "created", id: "tsk-0123456789ab", project: "repo-a", checkout: "c".repeat(64), objective: "reject refunds over the paid amount", budget: { attempts: 8, actions: 100 }, schema: TASK_SCHEMA }, ...lines].map((l) => ({ at: at(), ...l }));
}

const decide = (id, nextAction, more = {}) => ({ kind: "decision", id, attempt: "att-1", observed: `observed for ${id}`, hypothesis: `hypothesis for ${id}`, nextAction, evidence: [], ...more });

// The fixture: six decisions, one of each settlement, and what moved the task between them.
const FIXTURE = journal(
  { kind: "attempt-started", id: "att-1", cause: "fresh" },
  decide("dec-1", "implement", { reason: "the plan names validator.js", evidence: ["plan:pl-1", "nothing-here"] }),
  { kind: "action-started", id: "act-1", attempt: "att-1", type: "implement", label: "change validator.js" },
  { kind: "receipt", domain: "check", ref: "chk-1", outcome: "succeeded", summary: "test passed", action: "act-1" },
  { kind: "action-completed", id: "act-1", outcome: "succeeded", summary: "validator.js changed" },
  { kind: "stage", stage: "TESTING", because: "the change is recorded" },
  { kind: "verification", obligation: "refunds over the paid amount are refused", state: "satisfied", evidence: "check:chk-1" },
  decide("dec-2", "inspect", { evidence: ["check:chk-1", "act-1"] }),
  { kind: "action-started", id: "act-2", attempt: "att-1", type: "inspect", label: "read the log" },
  { kind: "action-completed", id: "act-2", outcome: "succeeded", summary: "the log looked fine" },
  { kind: "stage", stage: "REVIEWING" },
  decide("dec-3", "run-check"),
  { kind: "action-started", id: "act-3", attempt: "att-1", type: "run-check", label: "npm test" },
  decide("dec-4", "step.qa"),
  { kind: "action-started", id: "act-4", attempt: "att-1", type: "skill", label: "qa: write the refund", mutates: true },
  { kind: "receipt", domain: "skillstep", ref: "qa-1", outcome: "AMBIGUOUS", summary: "interrupted while it may have written", action: "act-4" },
  { kind: "action-failed", id: "act-4", reason: "what ran this step is gone" },
  decide("dec-5", "migrate"),
  { kind: "approval-requested", id: "apr-1", action: "database.migrate", fingerprint: "f".repeat(16), environment: "dev", reason: "schema v82", risk: "dev data" },
  decide("dec-6", "wait"),
  { kind: "attempt-completed", id: "att-1", outcome: "failed", failureSignature: "a".repeat(12) },
);

const why = whyOf(modelOf(FIXTURE), NOW);

const byId = (id) => why.decisions.find((d) => d.id === id);

test("every decision is there, in order, with what was seen, the hypothesis, the reason and the evidence it cited -- found or not", () => {
  assert.equal(why.version, WHY_VERSION);
  assert.deepEqual([why.task, why.objective, why.revision], ["tsk-0123456789ab", "reject refunds over the paid amount", FIXTURE.length]);
  assert.deepEqual(why.decisions.map((d) => d.id), ["dec-1", "dec-2", "dec-3", "dec-4", "dec-5", "dec-6"]);
  const first = byId("dec-1");
  assert.deepEqual([first.observed, first.hypothesis, first.reason, first.nextAction, first.attempt], ["observed for dec-1", "hypothesis for dec-1", "the plan names validator.js", "implement", "att-1"]);
  assert.deepEqual(first.cited, [{ id: "plan:pl-1", is: "unknown" }, { id: "nothing-here", is: "unknown" }], "evidence this journal does not hold is said so");
  assert.deepEqual(byId("dec-2").cited, [{ id: "check:chk-1", is: "receipt" }, { id: "act-1", is: "action" }]);
});

test("a decision settled on its owner's receipt, and the stage and verification row it allowed, each on the receipt it rests on", () => {
  const d = byId("dec-1");
  assert.equal(d.settled.word, "RECEIPT");
  assert.deepEqual(d.settled.actions.map((a) => [a.id, a.state, a.receipts.map((r) => [r.key, r.outcome])]), [["act-1", "succeeded", [["check:chk-1", "succeeded"]]]]);
  assert.deepEqual(d.moved.map((x) => [x.kind, x.to ?? x.state, x.by.map((b) => [b.key, b.found])]), [["stage", "TESTING", [["check:chk-1", true]]], ["verification", "satisfied", [["check:chk-1", true]]]]);
  assert.equal(d.moved[0].because, "the change is recorded");
});

test("an action no owner's receipt names is REPORTED, never proven -- and what it moved stands on no receipt", () => {
  const d = byId("dec-2");
  assert.equal(d.settled.word, "REPORTED");
  assert.match(d.settled.say, /never proven/);
  assert.deepEqual(d.settled.actions.map((a) => [a.id, a.state, a.receipts]), [["act-2", "succeeded", []]]);
  assert.deepEqual(d.moved.map((x) => [x.kind, x.to, x.by]), [["stage", "REVIEWING", []]]);
});

test("an action that started and never settled is OPEN: read back by reconcile, never sent again", () => {
  const d = byId("dec-3");
  assert.equal(d.settled.word, "OPEN");
  assert.match(d.settled.say, /reconcile reads it back.*never sends it again/);
  assert.deepEqual(d.settled.actions.map((a) => a.state), ["running"]);
});

test("an AMBIGUOUS action is said as read back, never resent -- a person decides, and the failure line is not a proof", () => {
  const d = byId("dec-4");
  assert.equal(d.settled.word, "AMBIGUOUS");
  assert.match(d.settled.say, /read back, never sent again -- a person decides/);
  assert.deepEqual(d.settled.actions.map((a) => [a.state, a.mutates, a.reason, a.outcomes]), [["error", true, "what ran this step is gone", ["AMBIGUOUS"]]]);
});

test("a decision that asked a person started nothing; one that only noted started nothing; an attempt's end is a move", () => {
  assert.deepEqual([byId("dec-5").settled.word, byId("dec-5").settled.actions], ["ASKED", []]);
  assert.match(byId("dec-5").settled.say, /apr-1/);
  assert.equal(byId("dec-6").settled.word, "NOTHING_STARTED");
  assert.deepEqual(byId("dec-6").moved.map((x) => [x.kind, x.to, x.attempt]), [["attempt", "failed", "att-1"]]);
  assert.deepEqual(why.settled, { RECEIPT: 1, REPORTED: 1, OPEN: 1, AMBIGUOUS: 1, ASKED: 1, NOTHING_STARTED: 1 });
});

test("the settlement table: every row reachable, ordered, the last always answering -- and a task with no decision says none", () => {
  assert.deepEqual(SETTLED.map((r) => r.word), ["ASKED", "NOTHING_STARTED", "AMBIGUOUS", "OPEN", "INTERRUPTED", "RECEIPT", "REPORTED"]);
  assert.equal(SETTLED.at(-1).when({}), true);
  const interrupted = whyOf(modelOf(journal(decide("dec-1", "read"), { kind: "action-started", id: "act-1", type: "read" }, { kind: "receipt", domain: "skillrun", ref: "r-1", outcome: "INTERRUPTED", action: "act-1" }, { kind: "action-failed", id: "act-1" })), NOW);
  assert.equal(interrupted.decisions[0].settled.word, "INTERRUPTED");
  assert.deepEqual(whyOf(modelOf(journal()), NOW).decisions, []);
});

test("it is the task's own fold read once more: src/task/why.mjs imports only the fold and the views", () => {
  const text = readFileSync(join(ROOT, "src", "task", "why.mjs"), "utf8");
  const imports = [...text.matchAll(/from\s+"([^"]+)"/g)].map((m) => relative(join(ROOT, "src", "task"), resolve(join(ROOT, "src", "task"), m[1])).split(sep).join("/"));
  assert.deepEqual(imports.sort(), ["model.mjs", "views.mjs"]);
});

// ---- the real CLI --------------------------------------------------------------------------------------------------

function checkout(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-task-why-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  execFileSync("git", ["init", "-q", repo], { env: sealed() });
  return { repo, store: join(base, "store") };
}

const cli = (p) => (...args) => {
  const r = spawnSync(process.execPath, [join(ROOT, "cli", "task.mjs"), ...args], { cwd: p.repo, env: sealed({ ORBIT_STORE_DIR: p.store }), encoding: "utf8", timeout: 60000 });
  assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}${r.stdout}`);
  return r.stdout;
};

test("node cli/task.mjs why <task> [--json]: what each decision rested on, through the real CLI, writing nothing", (t) => {
  const p = checkout(t);
  const task = cli(p);
  const id = JSON.parse(task("create", "reject refunds over the paid amount", "--json")).task;
  task("attempt", "start", id);
  task("decide", id, "--observed=validator accepts any amount", "--hypothesis=a bound check is missing", "--next=implement", "--reason=the plan names it");
  task("act", "start", id, "--type=implement", "--label=change validator");
  task("link", "receipt", id, "--domain=check", "--ref=chk-1", "--outcome=succeeded", "--action=act-1");
  task("act", "complete", id, "act-1", "--outcome=succeeded");
  task("stage", id, "TESTING", "--because=the change is recorded");
  task("decide", id, "--observed=the test is green", "--hypothesis=it holds", "--next=inspect", "--evidence=check:chk-1");
  task("act", "start", id, "--type=inspect");
  const before = task("events", id, "--json");
  const answer = JSON.parse(task("why", id, "--json"));
  assert.deepEqual(answer.decisions.map((d) => [d.id, d.settled.word]), [["dec-1", "RECEIPT"], ["dec-2", "OPEN"]]);
  assert.deepEqual(answer.decisions[0].moved.map((x) => [x.kind, x.to, x.by.map((b) => b.key)]), [["stage", "TESTING", ["check:chk-1"]]]);
  assert.equal(task("events", id, "--json"), before, "a read writes nothing");
  const text = task("why", id);
  assert.match(text, /^TASK {7}tsk-[0-9a-f]{12} — reject refunds over the paid amount · VERIFYING · revision \d+$/m);
  assert.match(text, /DECISIONS {2}2 · RECEIPT 1 · OPEN 1/);
  assert.match(text, /settled {5}RECEIPT — settled on its owner's receipt\n {6}act-1 implement "change validator" · succeeded · check:chk-1 succeeded\n {4}then {8}stage TESTING \(the change is recorded\) on check:chk-1/);
  assert.match(text, /cited {7}check:chk-1 \(receipt\)/);
  assert.match(text, /settled {5}OPEN — started and never settled/);
});
