// THE ENGINE SIDE of a QA run: Orbit's own investigation engine, run from the run's FROZEN checkout beside the
// controller -- where Docker is -- over an application checkout assembled with one variant planted, in a store of the
// run's own. What a person does in Orbit Control is done here once, the way acceptance/run.mjs does it: the project
// seated and its system graph recorded, autonomous QA enabled with its tenancy contract, the sandbox policy (isolation
// required, the QA worker image, the writes a test may make on its own fixture), and each fingerprint the sandbox asks
// to be trusted trusted. Then the task's isolated sandbox is prepared and started, and one investigation opened on it.
// A coding host reaches none of this but through the relay; the scripted hosts of a control reach it the same way.
//
//   engineFor(ctx, variant) -> engine      engine.cli(name, argv, o) -> Promise<{ ok, status, out, err, timedOut }>
//   engine.seated() · sandboxUp() -> { state, environment, because } · opened() -> inv · journal(inv) · sandboxDown()
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { sha } from "../../../src/hash.mjs";
import { gitOwn } from "../core/git.mjs";
import { TARGETS } from "./invoice.mjs";

const OUTPUT = 32 * 1024 * 1024;

// What the engine is run with: this machine's environment for Docker and git, without a model's credential or a
// ui-tests override, in the run's own store -- and the application's per-run tokens, made here and kept nowhere.
const engineEnv = (ctx, target) => ({ ...withoutCredentials(ctx), ...target.stackEnv(ctx.case.target.stack), ORBIT_STORE_DIR: ctx.engineStore, ORBIT_SINK_TOKEN: randomBytes(18).toString("hex"), ORBIT_TEST_HOOKS: "on", ORBIT_TEST_HOOKS_TOKEN: randomBytes(18).toString("hex") });

const withoutCredentials = (ctx) => Object.fromEntries(Object.entries(ctx.env).filter(([k]) => k !== "ORBIT_UI_TESTS" && !ctx.credentialNames.includes(k) && !/^ANTHROPIC_|^CLAUDE_CODE_OAUTH/.test(k)));

const taskOf = (ctx, variant) => `tsk-${sha(`${ctx.run.id}\u0000${variant}`).slice(0, 12)}`;

// The engine's own CLI, as a terminal types it, from the frozen checkout and in the application's checkout.
const cliOf = (ctx, e) => (name, argv, o = {}) => ctx.deps.process.runAsync(process.execPath, [join(ctx.engineDir, "cli", name), ...argv], { cwd: e.dir, env: e.env, input: o.input ?? "", timeoutMs: (o.seconds ?? 300) * 1000, maxBuffer: OUTPUT });

const said = async (r, what) => {
  const got = await r;
  if (!got.ok) throw new Error(`${what}: ${String(got.err || got.error || got.out).trim().split("\n").at(-1)?.slice(0, 400)}`);
  return got.out;
};

// ---- the application, assembled and seated --------------------------------------------------------------------------

async function assembled(ctx, e) {
  await e.target.assembled(ctx.engineDir, ctx.case.target.stack, e.variant, e.dir);
  for (const a of [["init", "-q", "--initial-branch=main"], ["add", "-A"], ["commit", "-q", "--no-verify", "-m", `${ctx.case.target.stack} ${e.variant}`]]) gitOwn(e.dir, a, ctx.env);
  return gitOwn(e.dir, ["rev-parse", "HEAD"], ctx.env).out.trim();
}

const settingsOf = (target) => [["enabled", "true"], ["tenancy", JSON.stringify(target.tenancy)], ["limits.caseSeconds", "300"]];

async function seated(ctx, e) {
  for (const [name, argv] of [["init.mjs", [e.dir]], ["storage.mjs", ["import", "--apply", "--replace"]], ["architecture.mjs", ["record", e.target.graph(ctx.engineDir, ctx.case.target.stack)]]]) await said(e.cli(name, argv), `${name} ${argv[0]}`);
  for (const [k, v] of settingsOf(e.target)) await said(e.cli("autonomous-qa.mjs", ["settings", "set", `${k}=${v}`, "--human"]), `settings ${k}`);
  return e;
}

// ---- the sandbox, as a person sets it up in Control ------------------------------------------------------------------

const RUNTIME = ["skills/orbit-runtime/bind.mjs", "src/frontend/local-clones.mjs", "src/orchestration/workspace.mjs", "src/process/index.mjs", "src/runtime/index.mjs", "src/runtime/sandbox/policy.mjs"];

async function runtimeOf(engineDir) {
  const [bind, clones, workspaces, proc, runtime, policy] = await Promise.all(RUNTIME.map((rel) => import(pathToFileURL(join(engineDir, rel)).href)));
  return { bindRuntime: bind.bindRuntime, bindSandbox: bind.bindSandbox, createLocalClones: clones.createLocalClones, createWorkspaces: workspaces.createWorkspaces, createProcess: proc.createProcess, COMMANDS: runtime.COMMANDS, sandboxFilled: policy.sandboxFilled };
}

const personOf = (ctx, e) => e.rt.bindRuntime({ pluginRoot: ctx.engineDir, env: e.env, cwd: e.dir });

const sandboxOf = (ctx, e) => e.rt.bindSandbox({ pluginRoot: ctx.engineDir, env: e.env, cwd: e.dir, task: e.task });

function workspaced(ctx, e) {
  const p = personOf(ctx, e);
  const trees = e.rt.createLocalClones(e.dir, e.rt.createProcess(), { noHooks: join(p.storeRoot, "workspaces", ".no-hooks"), env: e.env });
  const owner = e.rt.createWorkspaces({ root: p.storeRoot, io: p.io, trees, now: () => new Date().toISOString() });
  if (!owner.found(e.task)) owner.prepare({ task: e.task, project: p.project.storeKey, checkout: p.checkout, baseRevision: trees.head() });
}

// What a person sets in Control's Runtime page: isolation required, the QA worker image, an egress address an
// attestation must fail to reach, the modes QA may run in, the writes a test may make on its own fixture, and the
// component's environment by NAME.
function policied(ctx, e) {
  const p = personOf(ctx, e);
  const s = p.readSettings();
  const sb = e.rt.sandboxFilled(s.settings.sandbox);
  const sandbox = { ...sb, qa: { ...sb.qa, modes: ["observe", "fixture-write"], writes: e.target.writes }, isolation: { ...sb.isolation, mode: "required", provider: "docker", workerImage: ctx.images.qaWorker, egress: e.target.egress } };
  p.writeSettings({ next: { ...s.settings, components: { ...(s.settings.components ?? {}), "node:.": { ...(s.settings.components?.["node:."] ?? {}), env: e.target.componentEnv(ctx.case.target.stack) } }, sandbox }, revision: s.revision, by: "person" });
}

const TRUST_LISTS = [[/worker image/, "trustedWorkers"], [/topology/, "trustedTopologies"], [/adapter/, "trustedAdapters"]];

// A fingerprint the sandbox asked to be trusted, trusted the way a person trusts it -- in the list it said it belongs to.
function trusted(ctx, e, because) {
  const fp = /fingerprint ([a-f0-9]{64})/.exec(String(because))?.[1];
  const list = TRUST_LISTS.find(([re]) => re.test(String(because)))?.[1];
  if (!fp || !list) return false;
  return trustedIn(personOf(ctx, e), e.rt, list, fp);
}

function trustedIn(p, rt, list, fp) {
  const s = p.readSettings();
  const sb = rt.sandboxFilled(s.settings.sandbox);
  p.writeSettings({ next: { ...s.settings, sandbox: { ...sb, isolation: { ...sb.isolation, [list]: [...new Set([...sb.isolation[list], fp])] } } }, revision: s.revision, by: "person" });
  return true;
}

async function prepared(ctx, e) {
  for (let i = 0; i < 5; i++) {
    const out = await e.rt.COMMANDS["sandbox-prepare"].run(sandboxOf(ctx, e), []);
    if (out.state !== "BLOCKED" || !trusted(ctx, e, out.blocked?.because)) return out;
  }
  return { state: "BLOCKED", blocked: { because: "it asked to be trusted more times than a topology has parts" } };
}

// Started is not ready: the start waits for each component's own readiness, and says which did not get there.
const readyOf = (started) => ((stuck) => (stuck.length ? { state: "BLOCKED", because: stuck.map((x) => `${x.component}: ${x.because}`).join("; ") } : { state: "READY", environment: started.environment }))([...(started.blocked ?? []), ...(started.notReady ?? [])]);

async function sandboxUp(ctx, e) {
  workspaced(ctx, e);
  policied(ctx, e);
  const ready = await prepared(ctx, e);
  if (ready.state !== "READY") return { state: "BLOCKED", because: String(ready.blocked?.because ?? JSON.stringify(ready)).slice(0, 600) };
  return readyOf((e.started = await e.rt.COMMANDS["sandbox-start"].run(sandboxOf(ctx, e), ["--wait=240"])));
}

const sandboxDown = (ctx, e) => (e.rt ? e.rt.COMMANDS["sandbox-release"].run(sandboxOf(ctx, e), []).catch((err) => ({ error: String(err?.message ?? err) })) : Promise.resolve({ released: "nothing was started" }));

// ---- the investigation ---------------------------------------------------------------------------------------------

const objectiveFor = (ctx, e) => `${e.target.objective} (benchmark ${ctx.case.id})`;

async function opened(ctx, e, environment) {
  const begun = JSON.parse(await said(e.cli("autonomous-qa.mjs", ["plan", `--objective=${objectiveFor(ctx, e)}`, `--plan=${ctx.case.target.plan}`, `--sandbox=${environment}`, `--mode=${ctx.case.target.mode}`, "--json"]), "plan"));
  await said(e.cli("autonomous-qa.mjs", ["derive", `--investigation=${begun.id}`], { seconds: ctx.case.limits.engine.callSeconds }), "derive");
  return begun.id;
}

// The investigation's journal, read as the engine wrote it -- the one place what happened is kept.
const journalFile = (ctx, e, inv) => join(personOf(ctx, e).storeRoot, "autonomous-qa", "investigations", inv, "journal.jsonl");

const journal = (ctx, e, inv) => ((f) => (existsSync(f) ? readFileSync(f, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []))(journalFile(ctx, e, inv));

// ---- one variant's engine -------------------------------------------------------------------------------------------

export async function engineFor(ctx, variant, dir) {
  const target = TARGETS[ctx.case.target.app];
  const e = { variant, dir, target, task: taskOf(ctx, variant), env: engineEnv(ctx, target), rt: await runtimeOf(ctx.engineDir) };
  e.cli = cliOf(ctx, e);
  return Object.assign(e, { secrets: [e.env.ORBIT_SINK_TOKEN, e.env.ORBIT_TEST_HOOKS_TOKEN], assembled: () => assembled(ctx, e), seated: () => seated(ctx, e), sandboxUp: () => sandboxUp(ctx, e), opened: (environment) => opened(ctx, e, environment), journal: (inv) => journal(ctx, e, inv), sandboxDown: () => sandboxDown(ctx, e) });
}
