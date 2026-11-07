// THE CUT of a round a case interrupts (benchmark/lib/source/cut.mjs): the round's container stopped, with no grace, the
// moment the engineering task's own journal shows the steps the case names -- never at a minute, which a fast host
// finished before (ORBIT-E2E-007 on Sonnet: round 1 done in under four minutes, nothing interrupted). The runner store is
// the host's to write: read as untrusted, through no link, within bounds, as a clock only. And a case that declares an
// interruption is held to its having happened: a run whose round was never cut has shown nothing carried across a crash.
import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { setTimeout as sleep } from "node:timers/promises";
import { BOUNDS, cutOf, cutSaid, cuts, inOrder, journalTypesOf, reachedIn } from "../benchmark/lib/source/cut.mjs";
import { caseFindings } from "../benchmark/lib/core/suites.mjs";
import { reportOf } from "../benchmark/lib/source/report.mjs";
import { docRead } from "../benchmark/lib/core/room.mjs";
import { ACTIONS, ACTION_KINDS } from "../src/orchestration/dispatch.mjs";
import { PURPOSES } from "../src/orchestration/vocab.mjs";
import { dockerDouble, inspectedAs, ranAs, ROOT, runOf, TASK, VIEW, worldOf } from "./benchmark-double.mjs";
import { takeTurn } from "./benchmark-turn.mjs";

await takeTurn();

// ---- the steps, under the types a journal records them as ----------------------------------------------------------------

test("a step is found under the type an engineering task's journal records it as -- the dispatch rows' own, a check under its command's purpose", () => {
  for (const k of ACTION_KINDS.filter((x) => x !== "check")) assert.deepEqual(journalTypesOf(k), [ACTIONS[k].type({ kind: k }, { view: { actions: [] } })], k);
  assert.deepEqual(PURPOSES.filter((p) => !journalTypesOf("check").includes(p)), [], "every purpose a check can have");
});

test("the steps a case names are found in order, other steps between -- a baseline check before the change is not the check after it", () => {
  const AFTER = ["implement", "check"];
  assert.equal(inOrder(["plan", "test", "implement", "record-changes", "test"], AFTER), true);
  assert.equal(inOrder(["plan", "test", "implement", "record-changes"], AFTER), false, "only the baseline check, before the change was opened");
  assert.equal(inOrder(["implement", "build"], AFTER), true, "a check of any purpose");
  assert.equal(inOrder(["test", "implement"], AFTER), false);
  assert.equal(inOrder([], ["implement"]), false);
});

// ---- a runner store, read as untrusted --------------------------------------------------------------------------------------

const AFTER = ["implement", "check"];

const storeOf = (t) => ((dir) => (t.after(() => rmSync(dir, { recursive: true, force: true })), dir))(mkdtempSync(join(tmpdir(), "orbit-cut-")));

const jsonl = (lines) => lines.map((l) => `${JSON.stringify(l)}\n`).join("");

const started = (types) => types.map((type, i) => ({ kind: "action-started", id: `act-${i + 1}`, type }));

function journal(store, rel, provider, types) {
  const file = join(store, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, jsonl([{ kind: "created", id: "x", provider }, ...started(types)]));
  return file;
}

const ENG = "repo-orders/tasks/tsk-0000000000e1/journal.jsonl";

test("a runner store reaches the cut when one ENGINEERING task's journal shows the steps -- never the goal's workflow beside it", (t) => {
  const store = storeOf(t);
  assert.equal(reachedIn(join(store, "nothing-here"), AFTER), false, "a store that is not there");
  assert.equal(reachedIn(store, AFTER), false, "a store with no task");
  journal(store, "repo-orders/tasks/tsk-0000000000f1/journal.jsonl", "automation", ["implement", "test"]);
  assert.equal(reachedIn(store, AFTER), false, "a workflow's steps are not the engineering task's");
  const file = journal(store, ENG, "autonomous-engineering", ["plan", "test", "implement"]);
  assert.equal(reachedIn(store, AFTER), false, "the change opened, no check after it yet");
  appendFileSync(file, `${JSON.stringify({ kind: "action-started", id: "act-9", type: "test" })}\n{"kind":"action-sta`);
  assert.equal(reachedIn(store, AFTER), true, "the check after the change -- a torn last line left out");
});

test("a runner store is never read through a link, and never past its bounds", (t) => {
  const store = storeOf(t);
  const elsewhere = storeOf(t);
  const real = journal(elsewhere, ENG, "autonomous-engineering", ["implement", "test"]);
  assert.equal(reachedIn(elsewhere, AFTER), true);
  mkdirSync(join(store, "repo-orders", "tasks", "tsk-0000000000e1"), { recursive: true });
  symlinkSync(real, join(store, "repo-orders", "tasks", "tsk-0000000000e1", "journal.jsonl"));
  assert.equal(reachedIn(store, AFTER), false, "a journal that is a link");
  symlinkSync(join(elsewhere, "repo-orders"), join(store, "linked-project"));
  assert.equal(reachedIn(store, AFTER), false, "a project that is a link");
  symlinkSync(join(elsewhere, "repo-orders", "tasks", "tsk-0000000000e1"), join(store, "repo-orders", "tasks", "tsk-0000000000e2"));
  assert.equal(reachedIn(store, AFTER), false, "a task that is a link");
  const was = BOUNDS.journalBytes;
  t.after(() => (BOUNDS.journalBytes = was));
  BOUNDS.journalBytes = readFileSync(real).length - 1;
  assert.equal(reachedIn(elsewhere, AFTER), false, "a journal past its bound is read as none");
});

test("a case is cut only in the round it names, and a case's interruption is held to its vocabulary when the case loads", () => {
  const c = { interrupt: { round: 1, after: AFTER } };
  assert.equal(cutOf({}, 1, "/nowhere"), null);
  assert.equal(cutOf(c, 2, "/nowhere"), null);
  assert.equal(typeof cutOf(c, 1, "/nowhere"), "function");
  assert.equal(cutOf(c, 1, "/nowhere")(), false);
  assert.equal(cutSaid(c), "round 1, once its engineering task had started implement then check");
  const frozenBefore = { interrupt: { round: 1, afterMinutes: 4 } };
  assert.deepEqual([cuts(frozenBefore), cutOf(frozenBefore, 1, "/nowhere"), cutSaid(frozenBefore)], [false, null, null], "a run's frozen copy from before 0.5.0 named a minute: cut nowhere, and held to nothing");
  const dir = join(ROOT, "benchmark", "suites", "orbit-engineering", "orbit-e2e-007");
  const e2e7 = JSON.parse(readFileSync(join(dir, "case.json"), "utf8"));
  assert.deepEqual(caseFindings(e2e7, dir), [], "ORBIT-E2E-007 as it ships");
  assert.deepEqual(e2e7.interrupt, { round: 1, after: ["implement", "check"] }, "cut at the first check after its change was opened");
  assert.ok(caseFindings({ ...e2e7, interrupt: { round: 1, after: ["implement", "compile"] } }, dir).some((f) => /interrupts after steps no engineering task takes, so it would never be cut: compile/.test(f)));
  assert.ok(caseFindings({ ...e2e7, interrupt: { round: 2, after: AFTER } }, dir).some((f) => /interrupts its last round/.test(f)));
  assert.ok(caseFindings({ ...e2e7, interrupt: { round: 1, afterMinutes: 4 } }, dir).some((f) => /interrupt: takes no afterMinutes/.test(f)), "a minute is never a cut");
});

// ---- the controller: a round cut where its case says, and the run held to it ----------------------------------------------

const SPEC = `export const GROUPS = { sums: "add returns the sum of its two numbers" };
export const cases = (seed, samples) => Array.from({ length: samples }, (_, i) => ({ id: "sums-" + (i + 1), group: "sums", input: { call: "add", a: i, b: (seed % 7) + i }, expect: { exactly: [String(i + (seed % 7) + i)] } }));
export const selfTest = () => [];
`;

const PROBE = `import { join } from "node:path";
import { pathToFileURL } from "node:url";
const chunks = [];
process.stdin.on("data", (d) => chunks.push(d)).on("end", async () => {
  const inputs = JSON.parse(Buffer.concat(chunks).toString()).inputs;
  try { const m = await import(pathToFileURL(join(process.argv[2], "src/calc.mjs")).href); process.stdout.write(JSON.stringify({ answers: inputs.map((i) => ({ id: i.id, got: [String(m.add(i.a, i.b))] })) }) + "\\n"); }
  catch (e) { process.stdout.write(JSON.stringify({ error: { code: "IMPORT", message: String(e.message) } }) + "\\n"); }
});
`;

// An engineering case on a fixture of the world's own -- add() gives a difference, the goal is a sum -- whose first round
// is cut at the first check after its change was opened.
const GOAL = { schema: 1, kind: "engineering", id: "CALC-E2E-007", version: "1.0.0", baseline: "FAIL", fixture: "calc", title: "add returns a sum, across a crash", goal: "add(a, b) returns a + b, carried through an interrupted session", measures: { kind: "engineering", capability: "engineering.goal.resume", expects: "change" }, subject: { paths: ["src/calc.mjs"], exports: { "src/calc.mjs": ["add"] } }, request: "request.md", reproduce: "each failing check names its numbers", acceptance: { owner: "verifier", spec: "verifier/spec.mjs", probe: "verifier/probe.mjs", samples: 6 }, scope: { allow: ["src/*.mjs", "test/*.test.mjs"], deny: [] }, checks: { gates: [{ id: "public-tests", argv: ["node", "--test", "--test-reporter=tap", "test/calc.test.mjs"] }], agentTests: { required: true, pattern: "^test/[^/]+\\.test\\.mjs$" } }, limits: { rounds: 2, minutes: 120, usd: 5, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 30, outputMb: 1 }, verifier: { cpus: 1, memoryMb: 512, pids: 64, seconds: 60 }, engineering: { attempts: 3, actions: 50 } }, artifacts: ["manifest", "report"], cleanup: { containers: "run-label", networks: "run-label", scratch: "keep" }, variants: { real: { mutations: "variants/real.json" } }, controls: [], repairs: [], interrupt: { round: 1, after: AFTER } };

const FILES = {
  "package.json": '{ "name": "calc", "private": true, "type": "module" }\n',
  "benchmark/fixtures/calc/fixture.json": JSON.stringify({ schema: 1, id: "calc", about: "a calculator", tests: { from: "checks/", to: "test/", suffix: ".test.mjs" } }),
  "benchmark/fixtures/calc/package.json": '{ "name": "calc", "private": true, "type": "module" }\n',
  "benchmark/fixtures/calc/src/calc.mjs": "export const add = (a, b) => a + b;\n",
  "benchmark/fixtures/calc/checks/calc.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds nothing to nothing", () => {\n  assert.equal(add(0, 0), 0);\n});\n',
  "benchmark/suites/goals/suite.json": JSON.stringify({ schema: 1, id: "goals", version: "1.0.0", title: "a goal", cases: ["CALC-E2E-007"] }),
  "benchmark/suites/goals/calc-e2e-007/case.json": JSON.stringify(GOAL, null, 2),
  "benchmark/suites/goals/calc-e2e-007/request.md": "add(a, b) should return the sum of its two numbers.\n",
  "benchmark/suites/goals/calc-e2e-007/verifier/spec.mjs": SPEC,
  "benchmark/suites/goals/calc-e2e-007/verifier/probe.mjs": PROBE,
  "benchmark/suites/goals/calc-e2e-007/variants/real.json": JSON.stringify({ schema: 1, id: "real", about: "a sum made a difference", mutations: [{ id: "difference", file: "src/calc.mjs", find: "a + b", replace: "a - b", count: 1 }], files: [], deletes: [] }),
};

const FIXED = { "src/calc.mjs": "export const add = (a, b) => a + b;\n", "test/calc-sum.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("sums", () => {\n  assert.equal(add(2, 3), 5);\n});\n' };

const roundOf = (at) => Number(/rounds[\\/](\d+)[\\/]out$/.exec(at("/work/out"))?.[1] ?? 0);

const stoppedNow = (double, c) => double.s.calls.filter((a) => a[0] === "stop" && a.at(-1) === c.id);

// Round 1 as a host plays it: its engineering task plans, checks a baseline, opens the change -- each a moment no cut may
// land on -- then starts the check after it, and is held there until the controller stops it, the way a crash leaves it:
// no runner file, no stream. Every later round is a host that completes the change.
const cutAtCheck = (double, seen) => async (c, at) => {
  if (roundOf(at) !== 1) return ranAs(FIXED)(c, at);
  const file = join(at("/work/store"), "repo-calc", "tasks", TASK, "journal.jsonl");
  mkdirSync(dirname(file), { recursive: true });
  for (const type of [null, "plan", "test", "implement", "record-changes"]) {
    appendFileSync(file, `${JSON.stringify(type ? { kind: "action-started", id: `act-${type}`, type } : { kind: "created", id: TASK, provider: "autonomous-engineering" })}\n`);
    await sleep(120);
    seen.push([type, stoppedNow(double, c).length]);
  }
  appendFileSync(file, `${JSON.stringify({ kind: "action-started", id: "act-test-2", type: "test" })}\n`);
  for (let i = 0; i < 100 && !stoppedNow(double, c).length; i++) await sleep(20);
  return { exit: 137 };
};

// The inspection of each round: an engineering task still open after the cut, completed after the round that follows.
const byRound = (c, at) => (Number(/rounds[\\/](\d+)[\\/]inspect$/.exec(at("/work/out"))?.[1]) === 1 ? inspectedAs(VIEW("EXECUTING")) : inspectedAs(VIEW("COMPLETED")))(c, at);

const reportFor = (r) => reportOf(r.ctx.room, r.ctx.manifest, r.view, Object.fromEntries(r.view.actions.map((a) => [a.id, docRead(r.ctx.room, `steps/${a.id}.json`)]).filter(([, d]) => d)), docRead(r.ctx.room, "ending.json"), null, r.ctx.rec.events(r.ctx.task).events).json;

test("a case's round is cut the moment its engineering task starts the check after its change -- not before, not at a minute, with no grace -- and the next round carries the same task to verified", async (t) => {
  const w = worldOf(t, FILES);
  const seen = [];
  const double = dockerDouble({ runner: (c, at) => cutAtCheck(double, seen)(c, at), inspect: byRound });
  const r = await runOf(w, double, { caseId: "CALC-E2E-007", repair: true, cutEveryMs: 20 });
  assert.deepEqual(seen.map(([type, stops]) => [type, stops]), [[null, 0], ["plan", 0], ["test", 0], ["implement", 0], ["record-changes", 0]], "no cut on a baseline check, or while the change is being made");
  const runner1 = double.s.calls.filter((a) => a[0] === "create" && a.includes("/bench/entry.mjs"))[0];
  const id = `c${double.s.calls.filter((a) => a[0] === "create").indexOf(runner1) + 1}`;
  assert.deepEqual(double.s.calls.filter((a) => a[0] === "stop" && a.at(-1) === id).map((a) => a.slice(0, 3)), [["stop", "-t", "0"]], "stopped once, at once, the way a crash stops it");
  const out1 = docRead(r.ctx.room, "rounds/1/outcome.json");
  assert.deepEqual([out1.cut, out1.cutShort, out1.next], [true, true, "CUT_SHORT"], "a cut round is no failed round: another round on the same task");
  assert.deepEqual([r.result.outcome, r.view.lifecycle], ["PASS", "COMPLETED"]);
  assert.deepEqual(docRead(r.ctx.room, "rounds/2/outcome.json").records.find((x) => x.id === "interrupted")?.ok, true, "the run is held to its cut having happened");
  const stages = r.ctx.rec.events(r.ctx.task).events.filter((e) => e.kind === "stage").map((e) => e.because ?? "");
  assert.ok(stages.some((s) => /round 1 of 2: .* · cut at round 1, once its engineering task had started implement then check/.test(s)), "the stage says where the round is cut; the brief never does");
  const brief1 = JSON.parse(readFileSync(r.ctx.room.at("rounds", "1", "brief", "brief.json"), "utf8"));
  assert.ok(brief1.minutes > 4 && !/cut|interrupt/i.test(brief1.prompt), "the host is handed its whole round, and never told it will be cut");
  const rep = reportFor(r);
  assert.deepEqual([rep.rounds[0].cut, rep.diagnosis.finish[0].reason], [true, "cut where the case interrupts it, the way a crash ends a session: the next round carries on from there"]);
});

test("a case whose round was never cut has shown nothing carried across a crash: never verified, however good what it left", async (t) => {
  const w = worldOf(t, FILES);
  const r = await runOf(w, dockerDouble({ runner: ranAs(FIXED), inspect: inspectedAs(VIEW("COMPLETED")) }), { caseId: "CALC-E2E-007", repair: true, cutEveryMs: 20 });
  const out1 = docRead(r.ctx.room, "rounds/1/outcome.json");
  assert.deepEqual([out1.cut, out1.records.find((x) => x.id === "interrupted")?.ok], [false, false]);
  assert.equal(r.result.outcome, "FAIL", "a completed change that was never interrupted is not this case's PASS");
  assert.match(r.result.summary, /REPAIR_REJECTED|FAIL/);
});
