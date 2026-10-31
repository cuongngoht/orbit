// The QA benchmark's controller, carried end to end over a small repository of its own (one QA case, two test shapes,
// one planted) through an ENGINE DOUBLE: an investigation kept in memory, whose generated tests come out the way the
// application would answer them -- contradicted where the variant planted its defect, or wherever a design reads back a
// record nothing writes. The scripted hosts, the relay's admission, the judge and the task door are the real ones.
// What it proves is the flow: a reference host passes and its contradiction is confirmed on the clean application; an
// idle host and a false alarm fail; a round interrupted after its work is read back and never sent again; a sandbox
// that never comes up blocks the run and is released; and a coding host with no credential sets nothing up.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { frozenRun, resumedRun } from "../benchmark/lib/core/context.mjs";
import { carriedQa, withTruth } from "../benchmark/lib/qa/flow.mjs";
import { sealed } from "./home.mjs";

const ROOT = join(import.meta.dirname, "..");

const SHAPES = ["response-conforms", "persisted-after-write"];

const CASE = { schema: 1, kind: "qa", id: "FIX-QA-001", version: "1.0.0", title: "a create the page confirms is never stored", goal: "the planted defect is found", measures: { kind: "detection", capability: "qa.autonomous" }, target: { app: "invoice", stack: "invoice-a", variant: "toast-without-persistence", clean: "correct", plan: "invoice", mode: "fixture-write", withheld: ["acceptance/**"] }, request: "request.md", acceptance: { owner: "verifier", truth: "verifier/truth.json", minCoverage: 0 }, limits: { rounds: 1, minutes: 120, usd: 5, runner: { cpus: 1, memoryMb: 512, pids: 64, minutes: 30, outputMb: 1 }, engine: { stepSeconds: 60, callSeconds: 30 } }, artifacts: ["report"], cleanup: { containers: "run-label", networks: "run-label", sandbox: "release", scratch: "keep" }, controls: [] };

const TRUTH = { schema: 1, from: { file: "acceptance/truth.json", stack: "invoice-a", variant: "toast-without-persistence" }, default: "SATISFIED", shapes: SHAPES, expect: { "persisted-after-write": "CONTRADICTED" } };

const FILES = {
  "src/app.mjs": "export const app = 1;\n",
  "benchmark/suites/fixture/suite.json": JSON.stringify({ schema: 1, id: "fixture", version: "1.0.0", title: "a QA fixture", cases: ["FIX-QA-001"] }),
  "benchmark/suites/fixture/fix-qa-001/case.json": JSON.stringify(CASE, null, 2),
  "benchmark/suites/fixture/fix-qa-001/request.md": "Find the defects.\n",
  "benchmark/suites/fixture/fix-qa-001/verifier/truth.json": JSON.stringify(TRUTH),
};

const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@orbit.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@orbit.invalid" };

function world(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-bench-qa-flow-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "app");
  for (const [rel, text] of Object.entries(FILES)) (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));
  for (const a of [["init", "-q"], ["add", "-A"], ["commit", "-qm", "app"]]) spawnSync("git", a, { cwd: repo, env: sealed(GIT_ENV) });
  const env = sealed({ ...GIT_ENV, ORBIT_STORE_DIR: join(base, "store") });
  const storeRoot = JSON.parse(spawnSync(process.execPath, [join(ROOT, "cli", "query.mjs"), "storage", "--json"], { cwd: repo, env, encoding: "utf8" }).stdout).storeRoot;
  return { base, repo, env, storeRoot, journals: {}, steps: [], engines: [], down: [] };
}

// ---- the engine double -------------------------------------------------------------------------------------------------

const NEVER = "${FIXTURE} never written";

const DESIGNS = [{ shape: "response-conforms", order: 1, design: { skeleton: { steps: [{ do: "call", capability: "orbit.http.read", input: { path: "/invoices/inv-a" } }] } } }, { shape: "persisted-after-write", order: 2, design: { skeleton: { steps: [{ do: "call", capability: "orbit.state.read", input: { stateRef: "invoices", request: { key: "${FIXTURE} invoice" } } }] } } }];

const readsNothing = (design) => JSON.stringify(design ?? {}).includes(NEVER);

// What the application answers: a design that reads back a record nothing writes is contradicted anywhere; otherwise
// only the planted variant contradicts the planted shape.
const answer = (w, variant, shape, design) => (readsNothing(design) || (variant === CASE.target.variant && TRUTH.expect[shape] === "CONTRADICTED") ? "CONTRADICTED" : "SATISFIED");

const json = (v) => ({ ok: true, status: 0, out: `${JSON.stringify(v)}\n`, err: "" });

const evaluatedShapes = (lines) => new Set(lines.filter((l) => l.kind === "evaluated").map((l) => l.obligation.slice(4)));

const contextOf = (lines) => json({ position: lines.length, frontier: SHAPES.filter((s) => !evaluatedShapes(lines).has(s)).map((s) => ({ id: `obl-${s}`, kind: "test-obligation", template: { shape: s, obligation: `tob-${s}` } })) });

function generated(lines, d) {
  const n = lines.length;
  lines.push({ kind: "decision", id: d.decisionId, action: d.action }, { kind: "designed", obligation: d.action.obligation, design: `tds-${n}`, state: "designed" }, { kind: "version", design: `tds-${n}`, version: `gen-${d.action.obligation}@${String(n).padStart(16, "0")}` });
  return json({ state: "done" });
}

function ran(w, variant, lines, d) {
  const v = lines.find((l) => l.kind === "version" && l.version === d.action.version);
  const design = lines.filter((l) => l.kind === "decision" && l.action.kind === "generate" && l.action.obligation === `tob-${d.action.version.split("@")[0].slice(8)}`).at(-1)?.action.design;
  lines.push({ kind: "decision", id: d.decisionId, action: d.action }, { kind: "evaluated", obligation: lines.find((l) => l.kind === "designed" && l.design === v.design).obligation, outcome: answer(w, variant, d.action.version.split("@")[0].slice(8), design), execution: `exe-${d.action.version.split("@")[1]}-1` });
  return json({ state: "done" });
}

function stepped(w, variant, lines, input) {
  const d = JSON.parse(input);
  w.steps.push({ variant, kind: d.action.kind });
  return d.action.kind === "generate" ? generated(lines, d) : ran(w, variant, lines, d);
}

const CLI = { context: (w, v, lines) => contextOf(lines), step: (w, v, lines, o) => stepped(w, v, lines, o.input) };

const cliOf = (w, variant) => async (name, argv, o = {}) => (w.dies?.(variant, argv[0]), (CLI[argv[0]] ?? (() => json({ ok: true })))(w, variant, (w.journals[variant] ??= []), o));

function opened(w, variant) {
  (w.journals[variant] ??= []).push(...SHAPES.map((s) => ({ kind: "obligation", obligation: `tob-${s}`, shape: s })));
  return `inv-double-${variant.slice(0, 8)}`;
}

const engineDouble = (w) => async (ctx, variant, dir) => {
  const e = { variant, dir, task: `tsk-${variant.length.toString(16).padStart(12, "0")}`, env: {}, secrets: [`double-token-${variant}`], target: { designs: () => DESIGNS, clock: () => "live", falseAlarm: { shape: "persisted-after-write" } }, cli: cliOf(w, variant), journal: () => w.journals[variant] ?? [] };
  w.engines.push(variant);
  return Object.assign(e, { assembled: async () => (mkdirSync(dir, { recursive: true }), "commit-double"), seated: async () => e, sandboxUp: async () => w.up?.(variant) ?? { state: "READY", environment: `env-${variant.slice(0, 8)}` }, opened: async () => opened(w, variant), sandboxDown: async () => (w.down.push(variant), { released: true }) });
};

const dockerDouble = () => ({ process: { run: (file, a) => ({ ok: true, out: a[0] === "info" ? (a.includes("{{.NCPU}}") ? "4" : "[]") : "" }) }, env: {}, scratch: { write: () => "/dev/null", remove: () => null } });

const harness = (w) => ({ root: w.repo, engine: ROOT, env: w.env, taskEnv: w.env, credential: null, caFile: null, storeRoot: w.storeRoot, storeBase: dirname(w.storeRoot), dockerDeps: dockerDouble });

async function runOf(w, host) {
  const ctx = { ...(await withTruth(frozenRun(harness(w), { caseId: "FIX-QA-001", host, source: "head", images: { qaWorker: `sha256:${"c".repeat(64)}` }, dockerVersion: "double" }))), engineFor: engineDouble(w) };
  return { ctx, result: await carriedQa(ctx), view: ctx.rec.show(ctx.task) };
}

const types = (view) => view.actions.map((a) => `${a.type}:${a.state}`);

// ---- what the flow does ----------------------------------------------------------------------------------------------

test("a reference host passes: its contradiction confirmed on the clean application, both sandboxes released", async (t) => {
  const w = world(t);
  const r = await runOf(w, "reference");
  assert.deepEqual([r.result.outcome, r.result.exit, r.view.lifecycle], ["PASS", 0, "COMPLETED"]);
  assert.deepEqual(types(r.view), ["benchmark.target:succeeded", "benchmark.qa:succeeded", "benchmark.readback:succeeded", "benchmark.confirm:succeeded"]);
  assert.deepEqual(w.steps.filter((s) => s.variant === "correct").map((s) => s.kind), ["generate", "run-version"], "only the contradiction is replayed on the clean application");
  assert.deepEqual([...new Set(w.down)].sort(), ["correct", "toast-without-persistence"]);
  assert.deepEqual(r.view.verification.map((v) => [v.subject, v.state]).sort(), [["qa.persisted-after-write", "satisfied"], ["qa.response-conforms", "satisfied"]]);
  assert.ok(r.view.receipts.some((x) => x.key === "investigation:inv-double-toast-wi"));
});

test("an idle host fails: a planted defect nobody tested is missed, never passed", async (t) => {
  const r = await runOf(world(t), "idle");
  assert.deepEqual([r.result.outcome, r.result.exit], ["FAIL", 1]);
  assert.match(r.result.summary, /a planted defect was not found · found 0\/1/);
  assert.ok(!types(r.view).some((x) => x.startsWith("benchmark.confirm")), "nothing to confirm");
});

test("a false alarm fails: the design that contradicted the planted application contradicts the clean one too", async (t) => {
  const r = await runOf(world(t), "false-alarm");
  assert.deepEqual([r.result.outcome, r.result.exit], ["FAIL", 1]);
  assert.match(r.result.summary, /false alarm/);
});

test("a host's round interrupted after its work is read back and judged, never sent again", async (t) => {
  const w = world(t);
  w.dies = (variant, sub) => {
    if (variant === CASE.target.variant && sub === "finish" && !w.died) throw Object.assign(new Error("the controller died here"), (w.died = true));
  };
  await assert.rejects(runOf(w, "reference"), /died here/);
  assert.ok(w.down.includes(CASE.target.variant), "a run that stopped part-way leaves no sandbox of its own up");
  const before = w.steps.length;
  const runId = readdirSync(join(w.storeRoot, "benchmark")).find((n) => n.startsWith("bnr-"));
  const ctx = { ...(await withTruth(resumedRun(harness(w), runId))), engineFor: engineDouble(w) };
  const result = await carriedQa(ctx);
  const view = ctx.rec.show(ctx.task);
  assert.ok(view.actions.some((a) => a.type === "benchmark.qa" && a.state === "error" && /never sent again/.test(a.reason ?? "")));
  assert.deepEqual(w.steps.slice(before).filter((s) => s.variant === CASE.target.variant), [], "the planted investigation is never asked for a step again");
  assert.equal(result.outcome, "PASS", "what the round left is the verdict's to judge");
});

test("a sandbox that never comes up blocks the run, and what it started is released", async (t) => {
  const w = world(t);
  w.up = () => ({ state: "BLOCKED", because: "invoice-a: it never answered its health check" });
  const r = await runOf(w, "reference");
  assert.deepEqual([r.result.outcome, r.result.exit, r.view.lifecycle], ["BLOCKED", 3, "BLOCKED"]);
  assert.match(r.result.summary, /never answered its health check/);
  assert.ok(w.down.includes(CASE.target.variant));
  assert.ok(!types(r.view).some((x) => x.startsWith("benchmark.qa")));
});

test("a coding host with no credential sets nothing up: the run is blocked before an application is assembled", async (t) => {
  const w = world(t);
  const r = await runOf(w, "coding-host");
  assert.deepEqual([r.result.outcome, r.result.exit], ["BLOCKED", 3]);
  assert.match(r.result.summary, /CREDENTIALS/);
  assert.deepEqual(w.engines, []);
});
