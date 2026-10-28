// The one write door of a task, rule by rule: what each phase of the lifecycle allows, what a
// field may be, what a budget stops, what a person's decision must carry -- and that a refusal
// writes nothing. Then the subject's boundaries, held by grep.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { Refused } from "../src/errors.mjs";
import { COMMANDS, COMMAND_NAMES } from "../src/task/index.mjs";
import { NOT_TASK, OPERATIONS, governed } from "../src/task/governance.mjs";
import { GRANT_OPS, HUMAN_OPS, OPS } from "../src/task/ops.mjs";
import { JOURNAL } from "../src/task/store.mjs";
import { TASK_SCHEMA } from "../src/task/vocab.mjs";
import { ASK, CHECKOUT, MIGRATION, OTHER_CHECKOUT, pbi482, taskWorld } from "./task.harness.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TASK = join(ROOT, "src", "task");

const refusedWith = (code) => (e) => e instanceof Refused && e.code === code;
const refusedAs = (id) => (e) => e instanceof Refused && e.message.startsWith(`${id}:`);

// The journal does not move when an op is refused.
function unchanged(w, id, fn, check) {
  const before = w.text(id);
  assert.throws(fn, check);
  assert.equal(w.text(id), before, "a refusal wrote nothing");
}

test("nothing new STARTS on a paused task, and how something already running ended is still recorded", (t) => {
  const w = taskWorld(t);
  const id = pbi482(w);
  w.op(id, "pause", { human: true, expected: w.view(id).revision });
  for (const [name, given] of [["stage", { stage: "REVIEWING" }], ["act-start", { type: "test" }], ["request-approval", ASK]]) unchanged(w, id, () => w.op(id, name, given), refusedWith("TASK_PAUSED"));
  assert.deepEqual(w.op(id, "act-complete", { action: "act-5", outcome: "succeeded", summary: "regression passed" }).kinds, ["action-completed"]);
  assert.deepEqual(w.op(id, "decide", { observed: "regression passed while paused", hypothesis: "ready to review", nextAction: "review" }).kinds, ["decision"]);
  assert.equal(w.view(id).lifecycle, "PAUSED");
});

test("an ended task takes no new work and no governance, yet what was still running may still end on the record", (t) => {
  const w = taskWorld(t);
  const id = pbi482(w);
  w.op(id, "cancel", { human: true, expected: w.view(id).revision, because: "superseded" });
  for (const [name, given] of [["stage", { stage: "REVIEWING" }], ["decide", { observed: "o", hypothesis: "h", nextAction: "n" }], ["block", { stop: "ENVIRONMENT_BLOCKED", needs: "environment" }], ["complete", {}]]) unchanged(w, id, () => w.op(id, name, given), refusedWith("TASK_ENDED"));
  assert.deepEqual(w.op(id, "act-complete", { action: "act-5", outcome: "abandoned" }).kinds, ["action-completed"], "cancel never pretended the regression was interrupted");
  assert.equal(w.view(id).actions.find((a) => a.id === "act-5").state, "abandoned");
});

test("an op takes only its own fields, each as declared: unknown, missing and malformed are refused by name", (t) => {
  const w = taskWorld(t);
  const id = w.create();
  unchanged(w, id, () => w.op(id, "stage", { stage: "DEPLOYING" }), (e) => refusedAs("FIELDS")(e) && /stage must be/.test(e.message));
  unchanged(w, id, () => w.op(id, "stage", { stage: "CONTEXT", command: "rm -rf /" }), (e) => refusedAs("FIELDS")(e) && /takes no command/.test(e.message));
  unchanged(w, id, () => w.op(id, "decide", { observed: "x", nextAction: "Inspect Things" }), (e) => refusedAs("FIELDS")(e) && /no hypothesis/.test(e.message) && /nextAction does not look like/.test(e.message));
  unchanged(w, id, () => w.op(id, "attempt-start", { cause: "because" }), refusedAs("FIELDS"));
  w.op(id, "attempt-start", {});
  unchanged(w, id, () => w.op(id, "attempt-complete", { outcome: "PASS", failureSignature: "the build exploded" }), (e) => refusedAs("FIELDS")(e) && /12-character hex/.test(e.message));
});

test("free text is a sentence: too long or blank is refused, and a line break is flattened -- never a log or a chain of thought", (t) => {
  const w = taskWorld(t);
  const id = w.create();
  unchanged(w, id, () => w.op(id, "decide", { observed: "x".repeat(241), hypothesis: "h", nextAction: "n" }), refusedAs("TEXT"));
  unchanged(w, id, () => w.op(id, "decide", { observed: "   ", hypothesis: "h", nextAction: "n" }), refusedAs("TEXT"));
  w.op(id, "decide", { observed: "two tests\nfailed \u001b[2Jat refund <= paid", hypothesis: "rounding first", nextAction: "inspect" });
  assert.equal(w.view(id).decision.observed, "two tests failed [2Jat refund <= paid", "one line, no terminal control, and `<=` keeps its meaning");
});

test("a path is repository-relative or it is refused -- and kept with forward slashes", (t) => {
  const w = taskWorld(t);
  const id = w.create();
  for (const path of ["/etc/passwd", "C:\\Windows\\win.ini", "../outside.txt", "src/../../x", ""]) unchanged(w, id, () => w.op(id, "link-file", { path, change: "modified" }), (e) => refusedAs("PATH")(e) || refusedAs("TEXT")(e) || refusedAs("FIELDS")(e));
  w.op(id, "link-file", { path: "src\\Refunds\\RefundService.cs", change: "modified", added: 2, removed: 1 });
  assert.deepEqual(w.view(id).changes.paths.map((p) => p.path), ["src/Refunds/RefundService.cs"]);
});

test("budgets stop new work, never the record: attempts, actions and time each refuse a start once spent", (t) => {
  const w = taskWorld(t);
  const id = w.create({ attempts: 2, actions: 1, minutes: 30 });
  w.op(id, "attempt-start", {});
  w.op(id, "attempt-complete", { outcome: "failed" });
  w.op(id, "attempt-start", {});
  w.op(id, "attempt-complete", { outcome: "failed" });
  unchanged(w, id, () => w.op(id, "attempt-start", {}), (e) => refusedAs("BUDGET")(e) && /BUDGET_EXHAUSTED/.test(e.message));
  w.op(id, "act-start", { type: "build" });
  unchanged(w, id, () => w.op(id, "act-start", { type: "build" }), refusedAs("BUDGET"));
  const timed = w.create({ minutes: 30, objective: "another" });
  w.tick(31);
  unchanged(w, timed, () => w.op(timed, "act-start", { type: "x" }), refusedAs("BUDGET"));
  assert.deepEqual(w.view(id).budget.attempts, { spent: 2, limit: 2 });
});

test("attempts open and close in turn, and a task completes only once nothing is left running", (t) => {
  const w = taskWorld(t);
  const id = w.create();
  unchanged(w, id, () => w.op(id, "attempt-complete", { outcome: "succeeded" }), refusedAs("NO_OPEN_ATTEMPT"));
  w.op(id, "attempt-start", {});
  unchanged(w, id, () => w.op(id, "attempt-start", {}), refusedAs("OPEN_ATTEMPT"));
  w.op(id, "act-start", { type: "test" });
  unchanged(w, id, () => w.op(id, "complete", {}), refusedAs("STILL_RUNNING"));
  w.op(id, "act-complete", { action: "act-1", outcome: "succeeded" });
  unchanged(w, id, () => w.op(id, "complete", {}), refusedAs("UNFINISHED_ATTEMPT"));
  w.op(id, "attempt-complete", { outcome: "succeeded" });
  assert.equal(w.op(id, "complete", { summary: "refund validation fixed" }).kinds[0], "completed");
  assert.equal(w.view(id).lifecycle, "COMPLETED");
});

test("a decision cites only what the task recorded; a verification of satisfied or violated cites a linked receipt or is refused", (t) => {
  const w = taskWorld(t);
  const id = pbi482(w);
  unchanged(w, id, () => w.op(id, "decide", { observed: "o", hypothesis: "h", nextAction: "n", evidence: ["test-receipt-99"] }), refusedAs("REFS"));
  assert.deepEqual(w.op(id, "decide", { observed: "o", hypothesis: "h", nextAction: "n", evidence: ["test-receipt-28", "act-2", "att-1"] }).kinds, ["decision"]);
  unchanged(w, id, () => w.op(id, "link-verification", { obligation: "Refund <= paid amount", state: "satisfied" }), refusedAs("NO_RECEIPT"));
  unchanged(w, id, () => w.op(id, "link-verification", { obligation: "Refund <= paid amount", state: "satisfied", evidence: "unit:test-382" }), refusedAs("RECEIPT_UNKNOWN"));
  w.op(id, "link-verification", { obligation: "Refund <= paid amount", state: "satisfied", evidence: "test:test-receipt-31" });
  w.op(id, "link-verification", { obligation: "Persisted correctly", state: "not-verified" });
  w.op(id, "link-verification", { obligation: "Tenant isolation", state: "not-applicable" });
  assert.deepEqual(w.view(id).verification.map((v) => [v.obligation, v.state, v.evidence]), [["Refund <= paid amount", "satisfied", "test:test-receipt-31"], ["Persisted correctly", "not-verified", null], ["Tenant isolation", "not-applicable", null]]);
});

test("a sandbox's receipt names its environment and the source tree it was taken from: both optional, one is hex and never a path, and neither moves what a person decided on", (t) => {
  const w = taskWorld(t);
  const id = pbi482(w);
  const tree = "c0de000000000000000000000000000000000001";
  const seen = w.view(id).revision;
  const linked = w.op(id, "link-receipt", { domain: "sandbox", ref: "env-0123456789ab", outcome: "READY", summary: "env-0123456789ab at c0de00000000", environment: "env-0123456789ab", sourceTree: tree });
  assert.deepEqual(linked.kinds, ["receipt"]);
  assert.deepEqual(w.view(id).receipts.filter((r) => r.domain === "sandbox").map((r) => [r.key, r.outcome, r.environment, r.sourceTree]), [["sandbox:env-0123456789ab", "READY", "env-0123456789ab", tree]]);
  assert.deepEqual(w.view(id).receipts.filter((r) => r.domain !== "sandbox").map((r) => [r.environment, r.sourceTree]).slice(0, 1), [[null, null]], "a receipt that names neither says so");
  w.op(id, "link-receipt", { domain: "sandbox", ref: "env-0123456789ab", outcome: "RELEASED", environment: "env-0123456789ab", sourceTree: tree });
  assert.deepEqual(w.view(id).receipts.filter((r) => r.domain === "sandbox").map((r) => r.outcome), ["RELEASED"], "ONE receipt per environment, rewritten as it moves");
  assert.ok(w.op(id, "pause", { human: true, expected: seen }), "a receipt linked after a person read the task does not make their decision stale");
  for (const bad of ["/home/dev/ws/tree", "tree-3", "C0DE", "abc", "c0de/../x"]) unchanged(w, id, () => w.op(id, "link-receipt", { domain: "sandbox", ref: "env-0123456789ab", sourceTree: bad }), (e) => refusedAs("FIELDS")(e) && /sourceTree/.test(e.message));
  unchanged(w, id, () => w.op(id, "link-receipt", { domain: "sandbox", ref: "env-0123456789ab", environment: "a path/x" }), refusedAs("FIELDS"));
});

test("the two stop reasons a person causes cannot be written: waiting for approval and a cancel are derived", (t) => {
  const w = taskWorld(t);
  const id = w.create();
  unchanged(w, id, () => w.op(id, "block", { stop: "HUMAN_APPROVAL_REQUIRED", needs: "person" }), (e) => refusedAs("FIELDS")(e) && /derived, never written/.test(e.message));
  unchanged(w, id, () => w.op(id, "fail", { stop: "CANCELLED_BY_HUMAN" }), refusedAs("FIELDS"));
  w.op(id, "block", { stop: "ENVIRONMENT_BLOCKED", needs: "environment", because: "the database is not reachable" });
  assert.deepEqual([w.view(id).lifecycle, w.view(id).stopReason], ["BLOCKED", "ENVIRONMENT_BLOCKED"]);
  w.op(id, "unblock", { because: "it answers again" });
  unchanged(w, id, () => w.op(id, "unblock", {}), refusedAs("NOT_BLOCKED"));
});

test("a person's operations need --human and the revision they read; pause and resume are refused when they would change nothing", (t) => {
  const w = taskWorld(t);
  const id = pbi482(w);
  const rev = w.view(id).revision;
  for (const name of HUMAN_OPS) unchanged(w, id, () => w.op(id, name, { approval: "apr-1", expected: rev }), refusedAs("HUMAN"));
  unchanged(w, id, () => w.op(id, "pause", { human: true }), (e) => refusedAs("FIELDS")(e) && /no expected/.test(e.message));
  unchanged(w, id, () => w.op(id, "resume", { human: true, expected: rev }), refusedWith("TASK_NOT_PAUSED"));
  w.op(id, "pause", { human: true, expected: rev, because: "lunch" });
  unchanged(w, id, () => w.op(id, "pause", { human: true, expected: rev + 1 }), refusedWith("TASK_PAUSED"));
  assert.deepEqual(w.op(id, "resume", { human: true, expected: rev + 1 }).kinds, ["resumed"]);
  assert.deepEqual(w.tasks.read(id).filter((l) => l.kind === "paused").map((l) => [l.by, l.seen, l.because]), [["person", rev, "lunch"]]);
});

test("from a terminal a person may stop work but never allow it: approve and resume need Control's door, and nothing is written", (t) => {
  const control = taskWorld(t);
  const id = pbi482(control);
  control.op(id, "request-approval", ASK);
  const terminal = taskWorld(t, { dir: control.dir, door: null });
  const rev = () => control.view(id).revision;
  unchanged(terminal, id, () => terminal.op(id, "approve", { approval: "apr-1", human: true, expected: rev() }), (e) => refusedWith("PERSON_UNPROVEN")(e) && /Mission Control/.test(e.message));
  assert.deepEqual(terminal.op(id, "pause", { human: true, expected: rev(), because: "a person stops it from a terminal" }).kinds, ["paused"]);
  unchanged(terminal, id, () => terminal.op(id, "resume", { human: true, expected: rev() }), refusedWith("PERSON_UNPROVEN"));
  assert.deepEqual(control.op(id, "resume", { human: true, expected: rev() }).kinds, ["resumed"], "Orbit Control's door resumes it");
  assert.deepEqual(terminal.op(id, "reject", { approval: "apr-1", human: true, expected: rev(), reason: "not now" }).kinds, ["approval-rejected"]);
  assert.deepEqual(terminal.op(id, "cancel", { human: true, expected: rev() }).kinds, ["cancelled"]);
  assert.equal(control.kinds(id).includes("approval-granted"), false);
});

test("an approval may be decided while the task is paused, and spent only after it is resumed", (t) => {
  const w = taskWorld(t);
  const id = pbi482(w);
  w.op(id, "request-approval", ASK);
  w.op(id, "pause", { human: true, expected: w.view(id).revision });
  assert.equal(w.view(id).lifecycle, "PAUSED", "a person's pause outranks the wait");
  w.op(id, "approve", { approval: "apr-1", human: true, expected: w.view(id).revision });
  unchanged(w, id, () => w.op(id, "act-start", { ...MIGRATION, approval: "apr-1" }), refusedWith("TASK_PAUSED"));
  w.op(id, "resume", { human: true, expected: w.view(id).revision });
  assert.deepEqual(w.op(id, "act-start", { ...MIGRATION, approval: "apr-1" }).kinds, ["approval-consumed", "action-started"]);
});

test("one ACTIVE task per work and checkout: a second is refused while the first goes on, and allowed once it ended", (t) => {
  const w = taskWorld(t);
  const first = w.create({ work: "w-0123456789ab" });
  assert.throws(() => w.create({ work: "w-0123456789ab", objective: "again" }), refusedWith("TASK_ACTIVE"));
  assert.ok(w.create({ objective: "an ad-hoc task has no work, and no limit" }));
  assert.ok(w.create({ work: "w-ffffffffffff", objective: "another work" }));
  const elsewhere = taskWorld(t, { dir: w.dir, checkout: OTHER_CHECKOUT });
  assert.ok(elsewhere.create({ work: "w-0123456789ab", objective: "same work, another checkout" }));
  w.op(first, "fail", { stop: "EXECUTION_FAILED" });
  assert.ok(w.create({ work: "w-0123456789ab", objective: "after the first ended" }));
});

test("a task another engine wrote counts as still going: two executions of one work are refused even then", (t) => {
  const w = taskWorld(t);
  const id = w.create({ work: "w-0123456789ab" });
  const file = join(w.tasks.dirOf(id), JOURNAL);
  writeFileSync(file, readFileSync(file, "utf8").replace(`"schema":${TASK_SCHEMA}`, `"schema":${TASK_SCHEMA + 1}`));
  assert.throws(() => w.create({ work: "w-0123456789ab", objective: "again" }), refusedWith("TASK_ACTIVE"));
});

test("a checkout sees only its own tasks: another checkout's id is unknown here, even in the same project", (t) => {
  const w = taskWorld(t);
  const id = w.create();
  const other = taskWorld(t, { dir: w.dir, checkout: OTHER_CHECKOUT });
  assert.throws(() => other.view(id), refusedWith("TASK_UNKNOWN"));
  assert.throws(() => other.op(id, "pause", { human: true, expected: 1 }), refusedWith("TASK_UNKNOWN"));
  assert.equal(w.view(id).task.checkout, CHECKOUT);
});

// ---- the table, and the boundaries ------------------------------------------------------------

test("the command table and the governance table are one: every command governed, writing what it says, a person's ops human", () => {
  const gov = Object.fromEntries(governed().map((g) => [g.command, g]));
  assert.deepEqual(Object.keys(gov).sort(), [...COMMAND_NAMES].sort());
  for (const [name, entry] of Object.entries(COMMANDS)) assert.equal(entry.writes, gov[name].mutates === "none" ? "nothing" : gov[name].mutates, name);
  assert.deepEqual(governed().filter((g) => ["human", "control"].includes(g.approval)).map((g) => g.command).sort(), [...HUMAN_OPS].sort());
  assert.deepEqual(governed().filter((g) => g.approval === "control").map((g) => g.command).sort(), [...GRANT_OPS].sort(), "what allows something is Control's, and nothing else is");
  assert.deepEqual(GRANT_OPS.sort(), ["approve", "resume"]);
  assert.deepEqual(COMMAND_NAMES.filter((name) => COMMANDS[name].door === "control").sort(), ["approve", "resume"]);
  assert.deepEqual(NOT_TASK.filter((n) => OPERATIONS.some((o) => o.class === n)), []);
  assert.ok(OPERATIONS.every((o) => ["none", "store"].includes(o.mutates)), "no task command touches a repository, a process or the machine");
  assert.ok(Object.values(OPS).every((op) => ["start", "note", "record", "govern"].includes(op.phase)));
});

const walk = (dir) => readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? walk(join(dir, n)) : [join(dir, n)]));
const files = walk(TASK).filter((p) => p.endsWith(".mjs"));
const code = (p) => readFileSync(p, "utf8").split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");

// Leaves, the store primitives, the one free-text door, the protected-boundary leaf (src/protected/: which boundary an
// approval guards), and itself. Never another subject: a task references a work, a requirement, a runtime session and
// an investigation by id, and reads none of them.
const ALLOWED = /^(task|store|protected)\//;
const SINGLE = new Set(["errors.mjs", "hash.mjs", "constraints.mjs", "scrub.mjs", "printable.mjs", "project/boundary.mjs", "learn/args.mjs"]);

test("src/task imports only leaves, the store primitives and itself -- never work, runtime, investigation or requirements", () => {
  const bad = files.flatMap((p) => [...code(p).matchAll(/from\s+"(\.[^"]+)"/g)].map((m) => relative(join(ROOT, "src"), resolve(dirname(p), m[1])).replace(/\\/g, "/")).filter((target) => !SINGLE.has(target) && !ALLOWED.test(target)).map((target) => `${relative(ROOT, p)} imports ${target}`));
  assert.deepEqual(bad, []);
});

test("src/task spawns nothing, opens nothing and reads no environment, file or clock of its own", () => {
  const forbidden = /(from\s+"node:(child_process|net|http|https|fs|os|dgram|worker_threads)")|\bprocess\.(env|cwd|argv|exit|kill)\b|\bfetch\(|\bDate\.now\(/;
  const hits = files.flatMap((p) => code(p).split("\n").map((l, i) => [relative(ROOT, p), i + 1, l]).filter(([, , l]) => forbidden.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 80)}`));
  assert.deepEqual(hits, []);
});

const PRODUCTS = /\b(npm|pnpm|yarn|nodejs?|dotnet|nuget|csproj|msbuild|python3?|pip|java|golang|ruby|rustc|cargo|maven|gradle|postgres(ql)?|redis|kafka|rabbitmq|mongo(db)?|mysql|mariadb|sql ?server|playwright|github|gitlab|azure|aws|vscode|microsoft|jetbrains|kubernetes|terraform|docker|claude|codex|openai|gemini|anthropic)\b/i;

test("nothing under src/task names a stack, a product, a vendor or a host", () => {
  const hits = files.flatMap((p) => code(p).split("\n").map((l, i) => [relative(ROOT, p), i + 1, l]).filter(([, , l]) => PRODUCTS.test(l)).map(([f, n, l]) => `${f}:${n}  ${l.trim().slice(0, 100)}`));
  assert.deepEqual(hits, []);
});

test("only a composition root -- the CLI or Orbit Control -- imports the task subject: nothing else in src/ reaches it", () => {
  const importers = [];
  for (const dir of ["src", "skills", "cli", "control-server/src"]) {
    for (const p of walk(join(ROOT, dir)).filter((f) => f.endsWith(".mjs") && !f.startsWith(`${TASK}${sep}`))) {
      if ([...readFileSync(p, "utf8").matchAll(/from\s+"(\.[^"]+)"/g)].some((m) => resolve(dirname(p), m[1]).startsWith(`${TASK}${sep}`))) importers.push(relative(ROOT, p).replace(/\\/g, "/"));
    }
  }
  assert.deepEqual(importers.filter((p) => !/^(cli|control-server)\//.test(p)), []);
  assert.ok(importers.includes("cli/task.mjs"));
});
