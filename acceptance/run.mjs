#!/usr/bin/env node
// THE ACCEPTANCE RUN (doc §15): the example project, on each stack and in each variant whose defect
// is planted in its own TREE, taken through the whole loop by the engine's REAL commands -- and every
// generated test held to the ground truth (acceptance/truth.json).
//
//   node acceptance/run.mjs [--stack=invoice-a,invoice-b] [--variant=correct,no-dedupe,…] [--keep] [--json] [--record]
//
// For each stack and variant, from nothing: the stack assembled into a checkout of its own and
// committed; a store of its own; the project seated and its committed test data imported; the
// system graph recorded as reverse engineering would record it (acceptance/graph/); a task's
// workspace, and an ISOLATED sandbox prepared from it on Docker -- what a person does in Orbit
// Control done here, once, the way Control does it (the runtime's own settings and trust lists,
// through the runtime context); then the QA loop, every command a terminal would type: plan on the
// sandbox, derive the obligations, and for each one generate its design (acceptance/designs/ -- the
// host's proposal, scripted) and run the frozen version. What each came to is read off the
// investigation's journal and compared with the truth; the Security Auditor assesses the controls in
// effect from that same journal, and each control's conclusion is held to the truth too; the sandbox
// is released, nothing labelled is left on the machine, no secret the run was handed is in anything
// the store kept, and the checkout is exactly as it was committed.
//
// It needs Docker and the worker image (WORKER) on this machine; without them it says BLOCKED and
// exits 3. A mismatch is exit 1. `--record` keeps a receipt of a run that matched in
// docs/backend-acceptance.json (`acceptance`), keyed by the engine's tree.
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assemble } from "./projects/assemble.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const TRUTH = JSON.parse(readFileSync(join(ROOT, "acceptance", "truth.json"), "utf8"));
const WORKER = "node:22-alpine@sha256:c610fcdfb1d5b4740dd70c284ed3cb16bb857e0f7166196e36a5501df7a3aa32";
const TASK = "tsk-0123456789ab";
const WRITES = ["trigger", "create-resource", "consume", "publish", "control-workload", "advance-clock", "write", "delete-resource"];
const EGRESS = { host: "example.com", port: 443, address: "93.184.215.14" };
const STACK_ENV = { "invoice-a": { AMQP_USER: "invoice", AMQP_PASSWORD: "invoice-pass" }, "invoice-b": { NATS_USER: "invoice", NATS_PASSWORD: "invoice-pass" } };
const GIT_ENV = { GIT_AUTHOR_NAME: "acceptance", GIT_AUTHOR_EMAIL: "acceptance@orbit.invalid", GIT_COMMITTER_NAME: "acceptance", GIT_COMMITTER_EMAIL: "acceptance@orbit.invalid" };

const args = process.argv.slice(2);
const flag = (name) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const listOf = (name, all) => (flag(name) ? flag(name).split(",").map((s) => s.trim()).filter(Boolean) : all);

// ── the engine's real commands, as a terminal types them ───────────────────

const cli = (run, name, argv, input) => {
  const r = spawnSync(process.execPath, [join(ROOT, "cli", name), ...argv], { cwd: run.repo, env: run.env, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, timeout: 900_000 });
  return { code: r.status, out: r.stdout ?? "", err: r.stderr ?? "" };
};

const jsonOf = (text) => {
  try { return JSON.parse(text); } catch { return null; }
};

const said = (r, what) => {
  const j = jsonOf(r.out);
  if (j === null || r.code !== 0) throw new Error(`${what} answered ${r.code}: ${(r.err || r.out).trim().slice(0, 600)}`);
  return j;
};

function succeeded(run, name, argv) {
  const r = cli(run, name, argv);
  if (r.code !== 0) throw new Error(`${name} ${argv[0]} answered ${r.code}: ${(r.err || r.out).trim().slice(0, 400)}`);
  return r;
}

const git = (cwd, ...argv) => spawnSync("git", argv, { cwd, env: { ...process.env, ...GIT_ENV }, encoding: "utf8" });

// ── one stack, one variant ─────────────────────────────────────────────────

async function oneRun(stack, variant) {
  const base = realpathSync(mkdtempSync(join(tmpdir(), `orbit-accept-${stack}-${variant}-`)));
  const run = { stack, variant, base, repo: join(base, stack), env: envOf(stack, base), outcomes: {}, steps: [], volumesBefore: volumes() };
  try {
    checkout(run);
    seated(run);
    const rt = await sandboxUp(run);
    if (rt.state !== "READY") return { ...run, blocked: `the sandbox did not come up: ${JSON.stringify(rt.blocked ?? rt).slice(0, 400)}` };
    qaLoop(run);
    audited(run);
    return run;
  } finally {
    await sandboxDown(run);
    left(run);
    sentinels(run);
    builtRemoved(run);
    if (!args.includes("--keep")) rmSync(base, { recursive: true, force: true });
  }
}

function envOf(stack, base) {
  const secrets = { ORBIT_SINK_TOKEN: randomBytes(18).toString("hex"), ORBIT_TEST_HOOKS: "on", ORBIT_TEST_HOOKS_TOKEN: randomBytes(18).toString("hex") };
  const env = { ...process.env, ...STACK_ENV[stack], ...secrets, ORBIT_STORE_DIR: join(base, "store") };
  delete env.ORBIT_UI_TESTS;
  return env;
}

const componentEnv = (stack) => [...Object.keys(STACK_ENV[stack]), "ORBIT_SINK_TOKEN", "ORBIT_TEST_HOOKS", "ORBIT_TEST_HOOKS_TOKEN"];

function checkout(run) {
  assemble(run.stack, run.repo, { variant: run.variant });
  for (const a of [["init", "-q", "."], ["add", "-A"], ["commit", "-qm", `${run.stack} ${run.variant}`]]) git(run.repo, ...a);
  run.head = git(run.repo, "rev-parse", "HEAD").stdout.trim();
}

// The project seated in the store, its committed test data brought in by a person's explicit import, and the system
// graph recorded through the one door candidates go through.
function seated(run) {
  for (const [name, argv] of [["init.mjs", [run.repo]], ["storage.mjs", ["import", "--apply", "--replace"]], ["architecture.mjs", ["record", join(ROOT, "acceptance", "graph", `${run.stack}.jsonl`)]]]) succeeded(run, name, argv);
  for (const [k, v] of [["enabled", "true"], ["tenancy", JSON.stringify(tenancy())], ["limits.caseSeconds", "300"]]) cli(run, "autonomous-qa.mjs", ["settings", "set", `${k}=${v}`, "--human"]);
}

const tenancy = () => ({ claim: "tid", tenants: { A: "tenant-a", B: "tenant-b" }, identities: { "tenant-a-reader": ["A"], "tenant-b-reader": ["B"] }, resources: { "inv-a": { tenant: "A", marker: "canary-invoice-a", api: "/api/invoices/inv-a" } }, matrix: [{ identity: "tenant-b-reader", resource: "inv-a", operation: "read", expect: "denied" }] });

// ── the sandbox, as a person sets it up in Control ─────────────────────────

async function runtime() {
  const [{ bindRuntime, bindSandbox }, { createLocalClones }, { createWorkspaces }, { createProcess }, { COMMANDS }, { sandboxFilled }] = await Promise.all([
    import("../skills/orbit-runtime/bind.mjs"), import("../src/frontend/local-clones.mjs"), import("../src/orchestration/workspace.mjs"), import("../src/process/index.mjs"), import("../src/runtime/index.mjs"), import("../src/runtime/sandbox/policy.mjs"),
  ]);
  return { bindRuntime, bindSandbox, createLocalClones, createWorkspaces, createProcess, COMMANDS, sandboxFilled };
}

async function sandboxUp(run) {
  const r = (run.rt = await runtime());
  const person = () => r.bindRuntime({ pluginRoot: ROOT, env: run.env, cwd: run.repo });
  workspaced(run, r, person());
  policy(r, person(), run.stack);
  const ready = await preparedTrusting(run, r, person);
  if (ready.state === "READY") run.started = await r.COMMANDS["sandbox-start"].run(sandboxOf(run, r), ["--wait=240"]);
  return ready.state === "READY" ? await readyApp(run, r, ready) : ready;
}

const sandboxOf = (run, r) => r.bindSandbox({ pluginRoot: ROOT, env: run.env, cwd: run.repo, task: TASK });

function workspaced(run, r, first) {
  const trees = r.createLocalClones(run.repo, r.createProcess(), { noHooks: join(first.storeRoot, "workspaces", ".no-hooks"), env: { ...process.env, ...GIT_ENV } });
  const owner = r.createWorkspaces({ root: first.storeRoot, io: first.io, trees, now: () => new Date().toISOString() });
  if (!owner.found(TASK)) owner.prepare({ task: TASK, project: first.project.storeKey, checkout: first.checkout, baseRevision: trees.head() });
}

// What a person sets in Control's Runtime page: isolation required, the worker image, an egress address an attestation
// must fail to reach, the modes QA may run in, the kinds of effect a generated test may have on its own fixture, and the
// component's environment by NAME.
function policy(r, ctx, stack) {
  const s = ctx.readSettings();
  const sb = r.sandboxFilled(s.settings.sandbox);
  const sandbox = { ...sb, qa: { ...sb.qa, modes: ["observe", "fixture-write"], writes: WRITES }, isolation: { ...sb.isolation, mode: "required", provider: "docker", workerImage: WORKER, egress: EGRESS } };
  ctx.writeSettings({ next: { ...s.settings, components: { ...(s.settings.components ?? {}), "node:.": { ...(s.settings.components?.["node:."] ?? {}), env: componentEnv(stack) } }, sandbox }, revision: s.revision, by: "person" });
}

const TRUST_LISTS = [[/worker image/, "trustedWorkers"], [/topology/, "trustedTopologies"], [/adapter/, "trustedAdapters"]];

// Prepared, and each fingerprint it names trusted the way a person trusts it -- by the fingerprint it said, in the list
// it said it belongs to -- until it is READY or blocked by something a trust does not settle.
async function preparedTrusting(run, r, person) {
  for (let i = 0; i < 5; i++) {
    const out = await r.COMMANDS["sandbox-prepare"].run(sandboxOf(run, r), []);
    run.steps.push({ step: "sandbox-prepare", state: out.state, because: out.blocked?.because?.slice(0, 200) ?? null });
    if (out.state !== "BLOCKED" || !trusted(r, person(), out.blocked?.because)) return out;
  }
  return { state: "BLOCKED", blocked: { because: "it asked to be trusted more times than a topology has parts" } };
}

function trusted(r, ctx, because) {
  const fp = /fingerprint ([a-f0-9]{64})/.exec(String(because))?.[1];
  const list = TRUST_LISTS.find(([re]) => re.test(String(because)))?.[1];
  if (!fp || !list) return false;
  const s = ctx.readSettings();
  const sb = r.sandboxFilled(s.settings.sandbox);
  ctx.writeSettings({ next: { ...s.settings, sandbox: { ...sb, isolation: { ...sb.isolation, [list]: [...new Set([...sb.isolation[list], fp])] } } }, revision: s.revision, by: "person" });
  return true;
}

// Started is not ready: the start waited for each component's own readiness (its health, on its own network), and says
// which did not get there.
async function readyApp(run, r, prepared) {
  const started = run.started ?? {};
  const stuck = [...(started.blocked ?? []), ...(started.notReady ?? [])];
  return stuck.length ? { state: "BLOCKED", blocked: { because: stuck.map((x) => `${x.component}: ${x.because}`).join("; ") } } : { ...prepared, state: "READY" };
}

async function sandboxDown(run) {
  if (!run.rt) return;
  run.released = await run.rt.COMMANDS["sandbox-release"].run(sandboxOf(run, run.rt), []).catch((e) => ({ error: e.message }));
}

// What a run must leave: no container or network carrying its labels, no volume that was not there before it (a
// container's anonymous volumes leave with it), and the checkout exactly as it was committed.
function left(run) {
  const containers = lines(spawnSync("docker", ["ps", "-a", "--filter", "label=orbit.task", "--format", "{{.Names}}"], { encoding: "utf8" }).stdout);
  const networks = lines(spawnSync("docker", ["network", "ls", "--filter", "label=orbit.task", "--format", "{{.Name}}"], { encoding: "utf8" }).stdout);
  const dirty = existsSync(run.repo) ? git(run.repo, "status", "--porcelain", "--ignored").stdout.trim() : "";
  run.leftover = { containers, networks, volumes: volumes().filter((v) => !run.volumesBefore.includes(v)).slice(0, 10), checkout: dirty ? dirty.split("\n").slice(0, 10) : [] };
}

const lines = (text) => String(text ?? "").trim().split("\n").filter(Boolean);

const volumes = () => lines(spawnSync("docker", ["volume", "ls", "-q"], { encoding: "utf8" }).stdout);

// The harness's own hygiene, as a person cleaning up after it: the images its sandbox BUILT for this run's environment
// (labelled with it) are removed, so a machine that runs the acceptance many times does not keep every build.
function builtRemoved(run) {
  const env = run.started?.environment;
  const built = env ? lines(spawnSync("docker", ["image", "ls", "-q", "--filter", `label=orbit.env=${env}`], { encoding: "utf8" }).stdout) : [];
  if (built.length) spawnSync("docker", ["image", "rm", ...new Set(built)], { encoding: "utf8" });
}

// ── the QA loop, as a host drives it ───────────────────────────────────────

function qaLoop(run) {
  const begun = said(cli(run, "autonomous-qa.mjs", ["plan", "--objective=accept the invoice project", "--plan=invoice", `--sandbox=${environmentOf(run)}`, "--mode=fixture-write", "--json"]), "plan");
  run.investigation = begun.id;
  run.derived = said(cli(run, "autonomous-qa.mjs", ["derive", `--investigation=${run.investigation}`]), "derive");
  for (const shape of designOrder()) testedShape(run, shape);
  run.finished = jsonOf(cli(run, "autonomous-qa.mjs", ["finish", `--investigation=${run.investigation}`, "--why=the acceptance run tested every obligation it derived"]).out);
}

const environmentOf = (run) => run.started?.environment ?? null;

const designOrder = () => readdirSync(join(ROOT, "acceptance", "designs")).filter((f) => f.endsWith(".json")).map((f) => ({ shape: f.slice(0, -5), ...JSON.parse(readFileSync(join(ROOT, "acceptance", "designs", f), "utf8")) })).sort((a, b) => a.order - b.order);

function testedShape(run, d) {
  const ctx = said(cli(run, "autonomous-qa.mjs", ["context", `--investigation=${run.investigation}`]), "context");
  const owed = (ctx.frontier ?? []).find((o) => o.kind === "test-obligation" && o.template?.shape === d.shape);
  if (!owed) return void (run.outcomes[d.shape] = { outcome: "NOT_OWED", why: `no ${d.shape} obligation on the frontier` });
  const design = designFor(run, d, owed.template.obligation);
  const generated = stepped(run, ctx, owed.id, { kind: "generate", obligation: owed.template.obligation, design });
  const version = latestOf(run, "version", (x) => x.design === latestOf(run, "designed", (y) => y.obligation === owed.template.obligation)?.design)?.version;
  if (!version) return void (run.outcomes[d.shape] = { outcome: latestOf(run, "designed", (y) => y.obligation === owed.template.obligation)?.why?.split(" at ")[0] ?? "GENERATION_FAILED", why: generated.why ?? latestOf(run, "designed", (y) => y.obligation === owed.template.obligation)?.why });
  stepped(run, said(cli(run, "autonomous-qa.mjs", ["context", `--investigation=${run.investigation}`]), "context"), owed.id, { kind: "run-version", version });
  const evaluated = latestOf(run, "evaluated", (e) => e.obligation === owed.template.obligation);
  run.outcomes[d.shape] = { outcome: evaluated?.outcome ?? "NOT_RUN", rule: evaluated?.cause ?? null, execution: evaluated?.execution ?? null };
}

// The scripted proposal, made concrete for THIS run: its obligation, the component the stack is named for, and -- where
// a stack's clock decides how a period is made due -- the skeleton that stack's semantics allow.
function designFor(run, d, obligation) {
  const clock = TRUTH.stacks[run.stack].clock;
  const body = { ...d.design, obligation, ...(d["by-clock"] ? d["by-clock"][clock] : {}) };
  return JSON.parse(JSON.stringify(body).replaceAll("{{component}}", run.stack));
}

function stepped(run, ctx, target, action) {
  const decision = { schemaVersion: 1, decisionId: `acc-${randomBytes(6).toString("hex")}`, expectedRevision: ctx.position, target, action, hypothesis: "a generated test settles this obligation", reason: "it is owed on the frontier" };
  const r = cli(run, "autonomous-qa.mjs", ["step", `--investigation=${run.investigation}`], JSON.stringify(decision));
  run.steps.push({ step: action.kind, code: r.code, state: jsonOf(r.out)?.state ?? null, why: jsonOf(r.out)?.why ?? (r.code ? r.err.slice(0, 300) : null) });
  return jsonOf(r.out) ?? { why: r.err.slice(0, 300) };
}

// The journal, read as the engine wrote it -- the one place what happened is kept.
function journalOf(run) {
  const store = join(run.base, "store");
  const repoDir = readdirSync(store).find((d) => d.startsWith("repo-"));
  const file = join(store, repoDir, "autonomous-qa", "investigations", run.investigation, "journal.jsonl");
  return readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}

const latestOf = (run, kind, keep) => journalOf(run).filter((r) => r.kind === kind && keep(r)).at(-1) ?? null;

// ── the security audit, from the investigation's own record (group 5) ──────

// The Security Auditor's assessment of the controls in effect, from what each generated test came to as the
// investigation's journal holds it -- evidence read back from its owner -- and each control's conclusion, a finding
// with its status.
function audited(run) {
  const kept = said(cli(run, "security-audit.mjs", ["assess", `--investigation=${run.investigation}`, "--json"]), "security-audit assess");
  const report = said(cli(run, "security-audit.mjs", ["report", kept.id, `--investigation=${run.investigation}`, "--json"]), "security-audit report");
  run.security = Object.fromEntries((report.snapshot?.controls ?? []).map((c) => [c.control, c.conclusion === "finding" ? `finding:${findingOf(report, c)?.status ?? "unknown"}` : c.conclusion]));
  run.securityFresh = report.freshness?.state ?? null;
}

const findingOf = (report, c) => (report.snapshot?.findings ?? []).find((f) => f.control === c.control && f.catalog === c.catalog) ?? null;

// The secrets a run was handed, by value, must appear in nothing the store kept -- a journal, an artifact, a report, the
// evidence, a worker's room, a workspace (doc §15). The broker's credential is the project's own synthetic data, committed
// in its compose file, so it is not one of them.
function sentinels(run) {
  const values = [run.env.ORBIT_SINK_TOKEN, run.env.ORBIT_TEST_HOOKS_TOKEN];
  const store = join(run.base, "store");
  run.leaked = existsSync(store) ? filesUnder(store).filter((f) => ((text) => values.some((v) => text.includes(v)))(readFileSync(f, "latin1"))).map((f) => f.slice(run.base.length + 1)).slice(0, 10) : [];
}

const filesUnder = (dir) => readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name));

// ── held to the truth ──────────────────────────────────────────────────────

const expectedOf = (stack, variant, shape) => TRUTH.stacks[stack]?.variants?.[variant]?.[shape] ?? TRUTH.default;

const securityOf = (variant, control) => TRUTH.security.variants?.[variant]?.[control] ?? TRUTH.security.default[control];

function judged(run) {
  const tests = TRUTH.shapes.map((shape) => ({ shape, expected: expectedOf(run.stack, run.variant, shape), got: run.outcomes[shape]?.outcome ?? (run.blocked ? "BLOCKED" : "NOT_RUN"), rule: run.outcomes[shape]?.rule ?? null }));
  const controls = TRUTH.security.controls.map((control) => ({ shape: control, expected: securityOf(run.variant, control), got: run.security?.[control] ?? (run.blocked ? "BLOCKED" : "NOT_ASSESSED"), rule: null }));
  const rows = [...tests, ...controls];
  const clean = !run.leftover?.containers?.length && !run.leftover?.networks?.length && !run.leftover?.volumes?.length && !run.leftover?.checkout?.length && !run.leaked?.length;
  return { stack: run.stack, variant: run.variant, rows, matched: !run.blocked && clean && rows.every((r) => r.expected === r.got), blocked: run.blocked ?? null, leftover: { ...run.leftover, leaked: run.leaked ?? [] }, investigation: run.investigation ?? null };
}

function printed(results) {
  for (const r of results) {
    process.stdout.write(`${r.stack} ${r.variant}: ${r.matched ? "MATCHED" : r.blocked ? `BLOCKED — ${r.blocked}` : "MISMATCH"}\n`);
    for (const row of r.rows) process.stdout.write(`  ${row.expected === row.got ? "✓" : "✗"} ${row.shape.padEnd(30)} ${row.got.padEnd(20)}${row.expected === row.got ? "" : `expected ${row.expected}`}${row.rule ? `  (${row.rule})` : ""}\n`);
    if (r.leftover && (r.leftover.containers?.length || r.leftover.networks?.length || r.leftover.volumes?.length || r.leftover.checkout?.length || r.leftover.leaked?.length)) process.stdout.write(`  ✗ left behind: ${JSON.stringify(r.leftover)}\n`);
  }
}

function recorded(results) {
  const file = join(ROOT, "docs", "backend-acceptance.json");
  const doc = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { schema: 1, receipts: [] };
  const tree = spawnSync("git", ["rev-parse", "HEAD^{tree}"], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const entry = { at: new Date().toISOString(), engineTree: tree, worker: WORKER, runs: results.map((r) => ({ stack: r.stack, variant: r.variant, matched: r.matched, outcomes: Object.fromEntries(r.rows.map((x) => [x.shape, x.got])) })) };
  writeFileSync(file, `${JSON.stringify({ ...doc, acceptance: entry }, null, 2)}\n`);
}

function docker() {
  const info = spawnSync("docker", ["image", "inspect", WORKER], { encoding: "utf8" });
  return info.status === 0 ? null : `the worker image ${WORKER} is not on this machine (docker pull it), or Docker does not answer`;
}

async function main() {
  const missing = docker();
  if (missing) return void process.stdout.write(`BLOCKED ${missing}\n`, () => (process.exitCode = 3));
  const results = [];
  for (const stack of listOf("stack", Object.keys(TRUTH.stacks))) for (const variant of listOf("variant", Object.keys(TRUTH.stacks[stack].variants))) results.push(judged(await oneRun(stack, variant).catch((e) => ({ stack, variant, blocked: e.message.slice(0, 500), outcomes: {} }))));
  if (args.includes("--json")) process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
  printed(results);
  if (args.includes("--record") && results.every((r) => r.matched)) recorded(results);
  process.exitCode = results.every((r) => r.matched) ? 0 : results.some((r) => r.blocked) ? 3 : 1;
}

main().catch((e) => { process.stderr.write(`acceptance failed: ${e?.stack ?? e}\n`); process.exitCode = 3; });
