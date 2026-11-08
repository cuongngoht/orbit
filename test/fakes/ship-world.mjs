// A WORLD for the release ship's tests (skills/orbit-release/ship/): a primary checkout of its own (a git repository
// with a tiny benchmark catalog and one defect planted in its source), a store of its own, the REAL git, the REAL
// release workspace (src/orchestration/workspace.mjs + src/frontend/local-clones.mjs), an in-memory TASK DOOR that holds
// the rules the real one holds where a ship could break them (a receipt must be linked before an action closes on it,
// proven verification rows need one, nothing starts on an ended or paused task), and a BENCHMARK DOUBLE that writes
// the rooms the real benchmark writes and JUDGES THE TREE IT IS POINTED AT -- so a repair that really changes the
// source really passes, and a patch is a real patch `git apply` applies. Nothing here reaches Docker or a network.
//
//   shipWorldOf(t, o) -> { world, repo, store, door, calls, play }      fakeDoor() · POLICY · CASES
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { Refused } from "../../src/errors.mjs";
import { doorOf } from "../../skills/orbit-release/ship/door.mjs";
import { gitPort, workspacesOf } from "../../skills/orbit-release/ship/ports.mjs";
import { repositoryPaths } from "../../src/project/repository.mjs";
import { sealed } from "../home.mjs";

export const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@orbit.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@orbit.invalid" };

const BOUNDS = { minutes: [1, 10080], usd: [0, 2000], cycles: [1, 6], repairAttempts: [1, 5], flakyRetries: [0, 3], autonomousRetries: [0, 3] };

export const POLICY = {
  schema: 1,
  host: { cli: "claude-code", basis: "coding-host", endpoints: ["api.anthropic.com"] },
  requirements: {
    source: [{ id: "real", kind: "verify", variant: "real", expect: ["PASS"] }, { id: "controls", kind: "controls" }],
    qa: [{ id: "controls", kind: "controls" }, { id: "autonomous", kind: "autonomous", expect: ["PASS"] }],
    engineering: [{ id: "controls", kind: "controls" }, { id: "autonomous", kind: "autonomous", variant: "real", expect: ["PASS"] }],
  },
  extra: [{ case: "CALC-001", id: "self-healing", kind: "autonomous", variant: "controlled-fault", repair: true, expect: ["REPAIRED_VERIFIED"] }],
  catalog: { fixture: ["CALC-001", "CALC-002", "QA-001"] },
  limits: { minutes: 600, usd: 100, cycles: 3, repairAttempts: 2, flakyRetries: 1, autonomousRetries: 0 },
  bounds: BOUNDS,
  protected: ["benchmark/**", "test/benchmark-*", "skills/orbit-release/**", ".github/**", "package.json"],
  optional: [],
};

const sourceCase = (id, baseline) => ({ schema: 1, kind: "source", id, version: "1.0.0", baseline, measures: { kind: "correctness", repairable: ["ORBIT_SOURCE_DEFECT"] }, scope: { allow: ["src/calc.mjs", "test/*.test.mjs"], deny: [] }, limits: { usd: 5, rounds: 2 }, variants: { real: {}, "controlled-fault": {} } });

export const CASES = { "CALC-001": sourceCase("CALC-001", "PASS"), "CALC-002": sourceCase("CALC-002", "FAIL"), "QA-001": { schema: 1, kind: "qa", id: "QA-001", version: "1.0.0", limits: { usd: 5 } } };

const LISTED = { suites: [{ id: "fixture", version: "1.0.0", title: "a calculator", cases: [{ id: "CALC-001", kind: "source", variants: ["real", "controlled-fault"], controls: [] }, { id: "CALC-002", kind: "source", variants: ["real"], controls: [] }, { id: "QA-001", kind: "qa", variants: ["invoice correct"], controls: [] }] }] };

const FILES = {
  "package.json": '{ "name": "orbit", "version": "9.9.9", "private": true, "type": "module" }\n',
  ".claude-plugin/plugin.json": '{ "name": "orbit" }\n',
  ".gitattributes": "/benchmark/** export-ignore\n",
  "benchmark/run.mjs": "// the harness, played by the test's double\n",
  "src/calc.mjs": "export const add = (a, b) => a - b;\n",
  "test/calc.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds", () => assert.equal(add(1, 1), add(1, 1)));\n',
  ...Object.fromEntries(Object.entries(CASES).map(([id, c]) => [`benchmark/suites/fixture/${id.toLowerCase()}/case.json`, `${JSON.stringify(c, null, 2)}\n`])),
};

const git = (cwd, ...a) => execFileSync("git", a, { cwd, env: sealed(GIT_ENV), encoding: "utf8" }).trim();

export function repoOf(base, files = FILES) {
  const repo = join(base, "orbit");
  for (const [rel, text] of Object.entries(files)) (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));
  for (const a of [["init", "-q"], ["add", "-A"], ["commit", "-qm", "the source a ship starts from"]]) execFileSync("git", a, { cwd: repo, env: sealed(GIT_ENV) });
  return repo;
}

// ---- the task door, in memory ------------------------------------------------------------------------------------------

const TERMINAL = ["CANCELLED", "COMPLETED", "FAILED"];

const lifecycleOf = (t) => (t.cancelled ? "CANCELLED" : t.completed ? "COMPLETED" : t.failed ? "FAILED" : t.paused ? "PAUSED" : t.blocked ? "BLOCKED" : !t.stage && !t.attempts.length ? "QUEUED" : "EXECUTING");

const viewOf = (t) => ({ task: { id: t.id, provider: t.provider, parent: t.parent ?? null }, lifecycle: lifecycleOf(t), terminal: TERMINAL.includes(lifecycleOf(t)), stage: t.stage ?? null, stopReason: t.stop ?? null, attempts: t.attempts.map((a) => ({ ...a })), actions: t.actions.map((a) => ({ ...a })), receipts: t.receipts.map((r) => ({ ...r })), verification: t.verifications.map((v) => ({ ...v })), files: t.files.map((f) => ({ ...f })), budget: { attempts: { spent: t.attempts.length, limit: t.budget?.attempts ?? null } } });

export function fakeDoor() {
  const tasks = new Map();
  const T = (id) => tasks.get(id) ?? refuse(`no task ${id}`);
  const startable = (t) => (TERMINAL.includes(lifecycleOf(t)) || t.paused ? refuse(`PHASE: ${t.id} is ${lifecycleOf(t)}`) : t);
  const linked = (t, key) => t.receipts.some((r) => `${r.domain}:${r.ref}` === key);
  return {
    tasks,
    create: (objective, budget, more = {}) => ((id) => (tasks.set(id, { id, objective, provider: more.provider ?? "release", parent: more.parent ?? null, budget, attempts: [], actions: [], receipts: [], verifications: [], files: [], decisions: [] }), id))(`tsk-${(tasks.size + 1).toString(16).padStart(12, "0")}`),
    stage: (t, s) => (startable(T(t)).stage = s),
    attemptStart: (t, cause) => startable(T(t)).attempts.push({ id: `att-${T(t).attempts.length + 1}`, cause, outcome: null }),
    attemptComplete: (t, outcome, signature) => Object.assign(T(t).attempts.at(-1), { outcome, failureSignature: signature ?? null }),
    actStart: (t, type, label) => ((task) => ((id) => (task.actions.push({ id, type, label, state: "running" }), id))(`act-${task.actions.length + 1}`))(startable(T(t))),
    actComplete: (t, act, outcome, receipt, summary) => (receipt && !linked(T(t), receipt) ? refuse(`RECEIPT_UNKNOWN: ${receipt}`) : Object.assign(T(t).actions.find((a) => a.id === act), { state: outcome, receipt, summary })),
    actFail: (t, act, reason) => Object.assign(T(t).actions.find((a) => a.id === act), { state: "error", reason }),
    receipt: (t, r) => T(t).receipts.push({ ...r }),
    file: (t, f) => T(t).files.push({ ...f }),
    verification: (t, v) => (["satisfied", "violated"].includes(v.state) && !linked(T(t), v.evidence) ? refuse(`NO_RECEIPT: ${v.subject}`) : T(t).verifications.push({ ...v })),
    decide: (t, d) => T(t).decisions.push({ ...d }),
    complete: (t, summary) => (T(t).completed = summary),
    fail: (t, stop, because) => Object.assign(T(t), { failed: because, stop }),
    block: (t, stop, needs, because) => Object.assign(T(t), { blocked: because, stop, needs }),
    unblock: (t) => Object.assign(T(t), { blocked: null, stop: null }),
    show: (t) => viewOf(T(t)),
    pause: (t) => (T(t).paused = true),
    resume: (t) => (T(t).paused = false),
    cancel: (t) => (T(t).cancelled = true),
  };
}

function refuse(says) {
  throw new Refused(says);
}

// ---- the benchmark, played -------------------------------------------------------------------------------------------------

const flagOf = (args, name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const docAt = (dir, rel, value) => (mkdirSync(dirname(join(dir, rel)), { recursive: true }), writeFileSync(join(dir, rel), `${JSON.stringify(value, null, 2)}\n`));

// The verifier of the double: a tree whose add() adds holds the calculator's cases; one that subtracts does not.
export const adds = (tree) => readFileSync(join(tree, "src", "calc.mjs"), "utf8").includes("a + b");

const SOURCE_FAIL = { outcome: "FAIL", cause: "ORBIT_SOURCE_DEFECT", class: "ORBIT_SOURCE_DEFECT", summary: "FAIL (ORBIT_SOURCE_DEFECT) — add() subtracts" };

// What each run comes to, by default -- a scenario replaces any of these.
export const DEFAULT_PLAY = {
  verify: (c, tree) => (c === "CALC-002" && !adds(tree) ? SOURCE_FAIL : { outcome: "PASS", summary: "PASS — every hidden check held" }),
  autonomous: () => ({ outcome: "PASS", summary: "PASS — the investigation found what was planted", host: { version: "2.1.314", model: "claude-test", costUsd: 1.25 } }),
  selfHealing: () => ({ outcome: "REPAIRED_VERIFIED", summary: "REPAIRED_VERIFIED — the planted fault repaired", host: { version: "2.1.314", model: "claude-test", costUsd: 0.75 } }),
  repair: (c, tree) => (adds(tree) ? { outcome: "PASS", summary: "PASS — nothing to repair" } : { outcome: "REPAIRED_VERIFIED", summary: "REPAIRED_VERIFIED — the candidate passes the hidden checks and the gates", host: { version: "2.1.314", model: "claude-test", costUsd: 2.5 }, patch: { "src/calc.mjs": "export const add = (a, b) => a + b;\n", "test/calc-regression.test.mjs": 'import assert from "node:assert/strict";\nimport { test } from "node:test";\nimport { add } from "../src/calc.mjs";\ntest("adds, again", () => assert.equal(add(2, 2), 4));\n' } }),
  controls: (c, tree) => (c === "CALC-002" && adds(tree) ? [{ id: "known-good", variant: "real", expect: "PASS", got: "DRIFTED", matched: false }, { id: "allow-all", variant: "real", expect: "FAIL", got: "FAIL", matched: true }] : [{ id: "planted", variant: "controlled-fault", expect: "FAIL", got: "FAIL", matched: true }, { id: "allow-all", variant: "real", expect: "FAIL", got: "FAIL", matched: true }]),
  basis: () => "coding-host",
  harness: () => "harness-1",
};

// A real patch, as the benchmark writes one: git's own diff of the two sides, a/ and b/.
function patchOf(base, tree, files) {
  const dir = mkdtempSync(join(base, "patch-"));
  const parts = Object.entries(files).map(([rel, text]) => sidesDiff(dir, tree, rel, text));
  return parts.join("");
}

function sidesDiff(dir, tree, rel, text) {
  const before = existsSync(join(tree, rel)) ? readFileSync(join(tree, rel), "utf8") : null;
  if (before !== null) (mkdirSync(dirname(join(dir, "a", rel)), { recursive: true }), writeFileSync(join(dir, "a", rel), before));
  mkdirSync(dirname(join(dir, "b", rel)), { recursive: true });
  writeFileSync(join(dir, "b", rel), text);
  // Forward slashes on every platform: a backslash in a path git prints would be part of the file's name to `git apply`.
  return spawnSync("git", ["diff", "--no-index", "--no-color", "--no-prefix", before === null ? "/dev/null" : `a/${rel}`, `b/${rel}`], { cwd: dir, encoding: "utf8" }).stdout;
}

const ROW_KIND = (args) => (args.includes("--repair") ? (flagOf(args, "variant") === "controlled-fault" ? "selfHealing" : "repair") : null);

function runKind(play, c, args) {
  if (ROW_KIND(args)) return ROW_KIND(args);
  return CASES[c]?.kind === "source" ? "verify" : "autonomous";
}

// One run's room, as the benchmark leaves it: manifest, ending, report -- and, for a verified repair, verified.json and
// the candidate patch.
function ranRoom(w, args, kind) {
  const c = args[1];
  const run = flagOf(args, "run-id");
  const tree = flagOf(args, "tree");
  const said = w.play[kind](c, tree, args);
  const dir = join(w.store, "benchmark", run);
  const commit = git(tree, "rev-parse", "HEAD");
  const child = `tsk-${randomBytes(6).toString("hex")}`;
  docAt(dir, "manifest.json", { schema: 1, run, task: child, at: new Date(w.clock.now - 60000).toISOString(), source: { repo: tree, commit, digest: `d-${git(tree, "rev-parse", "HEAD^{tree}")}` }, benchmark: { case: c, kind: CASES[c].kind, variant: flagOf(args, "variant") ?? "real", digest: `case-${c}`, harness: w.play.harness(c) }, images: { claudeCode: "2.1.314" }, config: { repair: args.includes("--repair") || CASES[c].kind !== "source", host: CASES[c].kind === "qa" ? "coding-host" : null, model: flagOf(args, "model") ?? null, effort: effortRan(w, c, args) } });
  return { c, run, tree, said, dir, kind };
}

// The effort a run's manifest says its host ran at: the one it was asked (`--effort`, as the benchmark records it) --
// or, where a scenario says so (`play.effortOf`), another.
const effortRan = (w, c, args) => (w.play.effortOf ? w.play.effortOf(c, args) : flagOf(args, "effort") ?? null);

// The rounds a run's report says, as the benchmark's reports say them: a round its host ended, with what the host
// reported -- or, for a round a restart interrupted and the run's resume read back (`interrupted`), no host at all.
const roundsSaid = (said) => said.rounds ?? (said.interrupted ? [{ interrupted: true, host: null }] : said.host ? [{ host: { started: true, ...said.host } }] : []);

// A QA run's report names its ONE round (`round`); a source or engineering run's, every round (`rounds`).
const roundsOf = (c, said) => (CASES[c]?.kind === "qa" ? { round: roundsSaid(said)[0] ?? null } : { rounds: roundsSaid(said) });

function ended(w, r) {
  const basis = r.kind === "verify" ? "none" : w.play.basis(r.c, r.kind);
  docAt(r.dir, "report.json", { schema: 1, run: r.run, hostBasis: basis, ...roundsOf(r.c, r.said), totals: { costUsd: r.said.host?.costUsd ?? null }, attempts: [{ signature: r.said.signature ?? (["PASS", "REPAIRED_VERIFIED"].includes(r.said.outcome) ? null : "aaaaaaaaaaaa") }], leaks: r.said.leaks ?? [], diagnosis: r.said.diagnosis ?? null });
  if (r.said.patch) verifiedWritten(w, r);
  docAt(r.dir, "ending.json", { end: "complete", outcome: r.said.outcome, cause: r.said.cause ?? null, class: r.said.class ?? null, summary: r.said.summary, at: new Date(w.clock.now).toISOString() });
  return { code: { PASS: 0, REPAIRED_VERIFIED: 0, BLOCKED: 3, BENCHMARK_INVALID: 2 }[r.said.outcome] ?? 1, json: { run: r.run, case: r.c, outcome: r.said.outcome, exit: 0, summary: r.said.summary }, err: null, stopped: false };
}

function verifiedWritten(w, r) {
  const patch = r.said.patchText ?? patchOf(w.base, r.tree, r.said.patch);
  writeFileSync(join(r.dir, "candidate.patch"), patch);
  docAt(r.dir, "verified.json", { schema: 1, run: r.said.verifiedRun ?? r.run, case: { id: r.c }, variant: "real", source: { commit: git(r.tree, "rev-parse", "HEAD") }, host: { basis: w.play.basis(r.c, r.kind), model: "claude-test" }, candidate: { patch: join(r.dir, "candidate.patch"), patchDigest: r.said.patchDigest ?? sha256Text(patch) } });
}

const sha256Text = (text) => execFileSync(process.execPath, ["-e", "process.stdout.write(require('crypto').createHash('sha256').update(require('fs').readFileSync(0,'utf8')).digest('hex'))"], { input: text, encoding: "utf8" });

async function run(w, args, o) {
  const r = ranRoom(w, args, runKind(w.play, args[1], args));
  w.calls.push({ verb: "run", case: r.c, kind: r.kind, run: r.run, tree: r.tree, commit: git(r.tree, "rev-parse", "HEAD"), args });
  if (w.play.during) await w.play.during(w, r, o);
  if (o.watch && o.watch() === "stop") return { code: null, json: null, err: null, stopped: true };
  return r.said.dies ? crashed(r) : r.said.diesAfterEnding ? endedThenCrashed(w, r) : ended(w, r);
}

function crashed() {
  throw new Error("the ship's process died here, mid-run");
}

// A restart after a run's ending and before its report: the benchmark writes its ending, then tidies (the leak scan of
// the room among it), and writes its report last.
function endedThenCrashed(w, r) {
  docAt(r.dir, "ending.json", { end: "complete", outcome: r.said.outcome, cause: null, class: null, summary: r.said.summary, at: new Date(w.clock.now).toISOString() });
  return crashed(r);
}

// A control set, as the benchmark keeps one: its room named by --run-id (refused when kept already) and its manifest
// written before any control runs, so a set a restart cut short (`controlsDie`) is carried on by `resume`.
function controls(w, args) {
  const c = args[1];
  const tree = flagOf(args, "tree");
  const run = flagOf(args, "run-id") ?? `bnr-${(w.n += 1).toString(16).padStart(12, "0")}`;
  if (existsSync(join(w.store, "benchmark", run))) return { code: 2, json: null, err: `a run ${run} is already kept`, stopped: false };
  return controlsBegun(w, c, tree, run);
}

function controlsBegun(w, c, tree, run) {
  docAt(join(w.store, "benchmark", run), "manifest.json", { schema: 1, kind: "controls", run, source: { repo: tree, commit: git(tree, "rev-parse", "HEAD"), mode: "head" }, benchmark: { case: c, kind: CASES[c].kind, digest: `case-${c}` }, config: { asked: { runId: run } } });
  w.calls.push({ verb: "controls", case: c, commit: git(tree, "rev-parse", "HEAD"), run });
  return w.play.controlsDie?.(c) ? crashed() : controlsAnswered(w, c, tree, run);
}

function controlsAnswered(w, c, tree, run) {
  const rows = w.play.controls(c, tree);
  docAt(join(w.store, "benchmark", run), "controls.json", { case: c, rows });
  return { code: rows.some((k) => k.got === "DRIFTED") ? 2 : rows.every((k) => k.matched) ? 0 : 1, json: { case: c, run, rows, exit: 0 }, err: null, stopped: false };
}

// A run carried on by `resume` -- `during` sees it as it sees a run (`resumed: true`), so a scenario can look at the
// ship while a run is read back.
async function resumed(w, args) {
  const dir = join(w.store, "benchmark", args[1]);
  const m = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  w.calls.push({ verb: "resume", run: args[1] });
  if (m.kind === "controls") return controlsAnswered(w, m.benchmark.case, m.source.repo, args[1]);
  const kind = m.config.repair && m.benchmark.kind === "source" ? (m.benchmark.variant === "controlled-fault" ? "selfHealing" : "repair") : CASES[m.benchmark.case].kind === "source" ? "verify" : "autonomous";
  const r = { c: m.benchmark.case, run: args[1], tree: m.source.repo, said: { ...w.play[kind](m.benchmark.case, m.source.repo), dies: false, diesAfterEnding: false }, dir, kind, resumed: true };
  if (w.play.during) await w.play.during(w, r, {});
  return ended(w, r);
}

const VERBS = {
  list: () => ({ code: 0, json: LISTED, err: null }),
  doctor: (w, args) => (w.calls.push({ verb: "doctor", args }), { code: 0, json: { docker: w.play.docker === false ? { missing: "no daemon" } : { version: "27.0.0" }, credentials: ["ANTHROPIC_API_KEY"], host: args.includes("--host") ? w.play.host ?? { ok: true, code: "OK", says: "Claude Code 2.1.314 answered", image: "2.1.314", reported: "2.1.314", model: "claude-test", costUsd: 0.01 } : null }, err: null }),
  reliability: (w, args) => (w.calls.push({ verb: "reliability", args }), w.play.reliability ? w.play.reliability(args) : { code: 0, json: { schema: 1, kind: "orbit.benchmark.reliability/v1", scope: { revision: flagOf(args, "revision") ?? null }, runs: { total: 1 } }, err: null }),
  build: (w) => (w.play.images === false ? { code: 3, json: null, err: "the runner image could not be built" } : { code: 0, json: { images: [{ role: "verifier", id: "sha256:v" }, { role: "runner", id: "sha256:r" }, { role: "qa-worker", id: "sha256:q" }] }, err: null }),
  run: (w, args, o) => run(w, args, o),
  controls: (w, args) => controls(w, args),
  resume: (w, args) => resumed(w, args),
  cleanup: (w, args) => (w.calls.push({ verb: "cleanup", run: args[1] }), { code: 0, json: {}, err: null }),
};

// The gates, played: every one holds, unless a scenario says which output a gate gets.
const GATE_OK = { "--test": "# tests 9\n# pass 9\n# fail 0", "cli/check-five-lines.mjs": "0 finding(s): 0 error(s), 0 warning(s)", "cli/query.mjs": "3 screens", "cli/plan-check.mjs": "1 plan(s), 0 error(s), 0 advisory", "cli/schema.mjs": "{}", "skills/orbit-release/frontmatter.mjs": "ok" };

const gateAsked = (args) => (args[0] === "-e" ? (args[1].includes("existsSync") ? "archive" : "version") : args[0] === "--test" && args[1]?.includes("no-compat") ? "no-compat" : args[0]);

const gateOut = (over) => (args) => ({ ...GATE_OK, archive: "ok", version: "9.9.9 9.9.9 9.9.9 9.9.9 9.9.9", "no-compat": "# tests 1\n# pass 1\n# fail 0", ...over })[gateAsked(args)] ?? "";

// With `realDoor`, the journal goes through the REAL task door (node cli/task.mjs) in a store of the world's own, and
// the ship's room, workspace and the benchmark's rooms sit in that project's store root, as they do on a machine.
const DOOR_CLI = join(import.meta.dirname, "..", "..", "cli", "task.mjs");

const realStore = (base, repo) => ((env) => ({ env, store: repositoryPaths(repo, env).storeRoot }))(sealed({ ...GIT_ENV, ORBIT_STORE_DIR: join(base, "store"), ORBIT_TRACE: "off" }));

export function shipWorldOf(t, o = {}) {
  const base = mkdtempSync(join(tmpdir(), "orbit-ship-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = repoOf(base, { ...FILES, ...(o.files ?? {}) });
  const real = o.realDoor ? realStore(base, repo) : null;
  const store = real?.store ?? join(base, "store", "repo-test");
  const door = real ? doorOf({ cli: DOOR_CLI, cwd: repo, env: real.env }) : fakeDoor();
  const w = { base, repo, store, door, calls: [], n: 0, clock: { now: Date.parse("2026-11-01T12:00:00.000Z") }, play: { ...DEFAULT_PLAY, ...(o.play ?? {}) } };
  const world = { root: repo, env: sealed({ ...GIT_ENV, ANTHROPIC_API_KEY: "test-only-not-a-key", ...(o.env ?? {}) }), now: () => w.clock.now, storeRoot: store, project: { key: "repo-test", checkoutId: "c".repeat(64) }, policy: o.policy ?? POLICY, door, bench: async (args, opts = {}) => VERBS[args[0]](w, args, opts), git: gitPort(join(base, "no-hooks"), sealed(GIT_ENV)), gatesAt: () => (args) => ({ out: gateOut(o.gates ?? {})(args), code: 0, read: () => "{}" }), workspaces: workspacesOf(repo, store, sealed(GIT_ENV)), print: null, everyMs: 1, optional: [] };
  return { ...w, world };
}

export const headOf = (repo) => git(repo, "rev-parse", "HEAD");

export const statusOf = (repo) => git(repo, "status", "--porcelain");

export const refsOf = (repo) => git(repo, "for-each-ref", "--format=%(refname) %(objectname)");
