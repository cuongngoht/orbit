// THE ENGINE SIDE of a QA run: Orbit's own investigation engine, run from the run's FROZEN checkout beside the
// controller -- where Docker is -- over an application checkout assembled with one variant planted, in a store of the
// run's own. What a person does in Orbit Control is done here once, the way acceptance/run.mjs does it: the project
// seated and its system graph recorded, autonomous QA enabled with its tenancy contract, the sandbox policy (isolation
// required, the QA worker image, the writes a test may make on its own fixture), and each fingerprint the sandbox asks
// to be trusted trusted. Then the task's isolated sandbox is prepared and started, and one investigation opened on it.
// A coding host reaches none of this but through the relay; the scripted hosts of a control reach it the same way.
//
// A SESSION of a sessions run (0.5.0, ADR 0054) is an engine of its own over a checkout another session may have made:
// its own task -- so its own workspace and sandbox -- named by its key, and what its environment adds (a memory arm's
// switches). Its checkout is the one both sessions share: `head()` names the commit it stands at, and `movedTo(variant)`
// commits another variant of the application over it, the way a code change lands under what a session remembered.
//
//   engineFor(ctx, variant, dir, o = { task, env }) -> engine      engine.cli(name, argv, o) -> Promise<{ ok, … }>
//   engine.seated() · sandboxUp() -> { state, environment, because } · opened() -> inv · journal(inv) · sandboxDown()
//   engine.head() -> commit · movedTo(variant) -> commit
import { randomBytes } from "node:crypto";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { basename, dirname, join } from "node:path";
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
  return headOf(ctx, e);
}

const headOf = (ctx, e) => gitOwn(e.dir, ["rev-parse", "HEAD"], ctx.env).out.trim();

// Another variant of the application committed over the checkout as it stands: everything but its history replaced by
// the variant's tree, so the same repository -- the same project, its store and what it remembers -- moves under it. The
// variant is assembled BESIDE the checkout and laid over it: an assembly refuses a directory that is not empty, and the
// checkout keeps its `.git` (ORBIT-SES-003, which learns on the clean application, never reached its second session).
export async function movedTo(ctx, e, variant) {
  const beside = await assembledBeside(ctx, e, variant);
  laidOver(e.dir, beside);
  for (const a of [["add", "-A"], ["commit", "-q", "--no-verify", "--allow-empty", "-m", `${ctx.case.target.stack} ${variant}`]]) gitOwn(e.dir, a, ctx.env);
  return headOf(ctx, e);
}

async function assembledBeside(ctx, e, variant) {
  const dir = join(dirname(e.dir), `.${basename(e.dir)}-${variant}`);
  rmSync(dir, { recursive: true, force: true });
  await e.target.assembled(ctx.engineDir, ctx.case.target.stack, variant, dir);
  return dir;
}

// Everything of `dir` but its history, replaced by what `from` holds -- and `from` gone after.
function laidOver(dir, from) {
  for (const name of readdirSync(dir).filter((n) => n !== ".git")) rmSync(join(dir, name), { recursive: true, force: true });
  cpSync(from, dir, { recursive: true });
  rmSync(from, { recursive: true, force: true });
}

// The investigation's own minutes are the case's runner minutes -- the time the brief tells the host it has
// (round.mjs, flow.mjs roundMs) -- within the setting's own bound; left unset, its 20-minute default stopped a host that
// had been told it had two hours.
const minutesOf = (limits) => (Number.isInteger(limits?.runner?.minutes) ? [["limits.minutes", String(Math.min(240, limits.runner.minutes))]] : []);

export const settingsOf = (target, limits) => [["enabled", "true"], ["tenancy", JSON.stringify(target.tenancy)], ["limits.caseSeconds", "300"], ...minutesOf(limits)];

async function seated(ctx, e) {
  for (const [name, argv] of [["init.mjs", [e.dir]], ["storage.mjs", ["import", "--apply", "--replace"]], ["architecture.mjs", ["record", e.target.graph(ctx.engineDir, ctx.case.target.stack)]]]) await said(e.cli(name, argv), `${name} ${argv[0]}`);
  for (const [k, v] of settingsOf(e.target, ctx.case.limits)) await said(e.cli("autonomous-qa.mjs", ["settings", "set", `${k}=${v}`, "--human"]), `settings ${k}`);
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

// A release that cannot run -- an engine whose task never got a workspace refuses to bind a sandbox at all, and refuses
// it by throwing before any promise exists -- answers its error and never throws: a run that stopped part-way releases
// every engine's sandbox on its way out, and a release that threw there would hide the error that stopped the run.
export const sandboxDown = (ctx, e) => (e.rt ? Promise.resolve().then(() => e.rt.COMMANDS["sandbox-release"].run(sandboxOf(ctx, e), [])).catch((err) => ({ error: String(err?.message ?? err) })) : Promise.resolve({ released: "nothing was started" }));

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

export async function engineFor(ctx, variant, dir, o = {}) {
  const target = TARGETS[ctx.case.target.app];
  const e = { variant, dir, target, task: taskOf(ctx, o.task ?? variant), env: { ...engineEnv(ctx, target), ...(o.env ?? {}) }, rt: await runtimeOf(ctx.engineDir) };
  e.cli = cliOf(ctx, e);
  return Object.assign(e, { secrets: [e.env.ORBIT_SINK_TOKEN, e.env.ORBIT_TEST_HOOKS_TOKEN], assembled: () => assembled(ctx, e), seated: () => seated(ctx, e), sandboxUp: () => sandboxUp(ctx, e), opened: (environment) => opened(ctx, e, environment), journal: (inv) => journal(ctx, e, inv), sandboxDown: () => sandboxDown(ctx, e), head: async () => headOf(ctx, e), movedTo: (to) => movedTo(ctx, e, to) });
}
