// A RUN'S CONTEXT: everything a benchmark run works with, made once when it is frozen and made again, from what it
// froze, when it is resumed -- never from what is in the developer's checkout by then. The source is frozen through
// read-only git; the case is copied into the run's room and pinned by digest; the subject becomes the checkout a runner
// is handed; the images are pinned by the ids the run resolved; the bench task is created through the task door. A
// resumed run is refused when what it froze no longer is what it froze.
//
//   frozenRun(h, o) -> ctx        resumedRun(h, runId) -> ctx        frozenIntact(ctx) -> boolean
import { cpSync, existsSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { Blocked, Refused } from "../../../src/errors.mjs";
import { shaBytes } from "../../../src/hash.mjs";
import { createProcess } from "../../../src/process/index.mjs";
import { docker } from "../../../src/runtime/isolation/docker.mjs";
import { createScratch } from "../../../src/runtime/sandbox/scratch.mjs";
import { realIo } from "../../../src/store/io.mjs";
import { madeCheckout } from "./checkout.mjs";
import { dockerClientEnv } from "./docker.mjs";
import { mutatedEntries, mutationFile } from "./mutations.mjs";
import { gitOwn } from "./git.mjs";
import { matchesAny } from "./paths.mjs";
import { caseOf, dirDigest } from "./suites.mjs";
import { recorder } from "./record.mjs";
import { docRead, docWritten, madeDir, newRunId, roomOf } from "./room.mjs";
import { frozen, HARNESS, subjectOf, treeDigestOf, whereAt } from "./freeze.mjs";

export const CREDENTIALS = ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"];

export const DEFAULT_HOST = "api.anthropic.com";

// ---- what is asked of this machine ------------------------------------------------------------------------------------

// Where Orbit's own commands are (`engine`) and which repository is measured (`root`): one checkout when a developer
// runs the benchmark, and kept apart so a harness test can measure a small repository of its own.
export const engineOf = (h) => h.engine ?? h.root;

// The task door, run from the measured repository's checkout -- the project its task belongs to.
const recorderOf = (h) => recorder({ cli: join(engineOf(h), "cli", "task.mjs"), cwd: h.root, env: h.taskEnv });

export const dockerDeps = (env, room) => ({ process: createProcess(), env, scratch: createScratch(room ? madeDir(room, "scratch", "env") : null, realIo()) });

const dockerInfo = (deps, format) => ((r) => (r.ok ? String(r.out).trim() : null))(deps.process.run("docker", ["info", "--format", format], { timeoutMs: 30000, env: dockerClientEnv(deps.env) }));

// The user every container runs as: this process's own, so what a container writes in a run's room is its owner's --
// or root inside a rootless engine, which IS this user outside it.
export const userOf = (deps) => (/rootless/.test(dockerInfo(deps, "{{json .SecurityOptions}}") ?? "") ? "0:0" : typeof process.getuid === "function" ? `${process.getuid()}:${process.getgid()}` : "1000:1000");

export const cpusetOf = (deps, cpus) => ((n) => `0-${Math.max(0, Math.min(Math.ceil(cpus), n || 1) - 1)}`)(Number(dockerInfo(deps, "{{.NCPU}}")));

const credentialNames = (env, asked) => (asked ? (CREDENTIALS.includes(asked) && env[asked] ? [asked] : []) : CREDENTIALS.filter((n) => env[n]).slice(0, 1)).concat(env.ANTHROPIC_BASE_URL ? ["ANTHROPIC_BASE_URL"] : []);

const hostsOf = (env) => [env.ANTHROPIC_BASE_URL ? new URL(env.ANTHROPIC_BASE_URL).hostname.toLowerCase() : DEFAULT_HOST];

// ---- the source, frozen -------------------------------------------------------------------------------------------------

// Uncommitted changes to what is measured, and no word on which tree: refused, never silently narrowed. Changes only to
// the harness itself leave the subject what it is.
export function modeOf(where, asked) {
  const dirty = where.dirty.filter((p) => !HARNESS.some((g) => p.startsWith(g.replace("/**", "/")) || p === g));
  if (asked) return asked;
  if (dirty.length) throw new Refused(`the working tree has uncommitted changes to what a benchmark measures (${dirty.slice(0, 5).join(", ")}${dirty.length > 5 ? ", …" : ""}) — say which tree to measure: --source=head (HEAD, without them) or --source=worktree (HEAD and them)`);
  return "head";
}

function subjectFor(c, variant, entries) {
  const mutations = c.variants[variant]?.mutations;
  const r = mutations ? mutatedEntries(entries, mutationFile(c.dir, mutations)) : { ok: true, entries, applied: [] };
  if (!r.ok) throw Object.assign(new Refused(`FIXTURE_DRIFT: the ${variant} variant's mutation ${r.drift.mutation} expects ${r.drift.expected} occurrence(s) in ${r.drift.file} and finds ${r.drift.found} — the source moved under the fault; this run would measure a tree without it, so it does not start`), { code: "FIXTURE_DRIFT", drift: r.drift });
  return r;
}

// A QA case's variant is its own: the defect it plants in its application. Naming another is refused, never followed.
function qaVariant(c, o) {
  if (o.variant && o.variant !== c.target.variant) throw new Refused(`${c.id} plants ${c.target.variant} in its application: a QA case's variant is its own, and --variant=${o.variant} names another`);
  return c.target.variant;
}

function sourceVariant(c, o) {
  const variant = o.variant ?? "real";
  if (!Object.hasOwn(c.variants, variant)) throw new Refused(`${c.id} has no variant ${variant} — it has ${Object.keys(c.variants).join(", ")}`);
  return variant;
}

// The coding host of a QA run is handed a plugin without what its case withholds (the ground truth, the reference
// designs), whose cli/autonomous-qa.mjs is the relay's client: the engine itself runs beside the controller.
export const PLUGIN_CLI = "cli/autonomous-qa.mjs";

const clientEntry = (h, e) => ((bytes) => ({ ...e, bytes, digest: shaBytes(bytes) }))(readFileSync(join(engineOf(h), "benchmark", "lib", "qa", "relay-client.mjs")));

const pluginEntries = (h, f) => f.subject.entries.filter((e) => !matchesAny(f.c.target.withheld, e.rel)).map((e) => (e.rel === PLUGIN_CLI ? clientEntry(h, e) : e));

function pluginMade(h, f) {
  const entries = pluginEntries(h, f);
  const made = madeCheckout(f.room.at("plugin"), entries, `${f.c.id} plugin`, h.env);
  return { files: made.files, commit: made.commit, digest: treeDigestOf(entries), withheld: f.c.target.withheld, relayed: PLUGIN_CLI };
}

// What each kind of case does beyond freezing the source: a source case plants its variant's mutations in the subject
// it measures; a QA case plants its variant in its APPLICATION later, through its engine, and makes the plugin its
// coding host is handed. Each says how many attempts its task may make.
const KIND_RUN = {
  source: { variant: sourceVariant, subject: (c, variant, entries) => subjectFor(c, variant, entries), extra: () => null, attempts: (c, config) => (config.repair ? config.rounds + 1 : 1) },
  qa: { variant: qaVariant, subject: (c, variant, entries) => ({ ok: true, entries, applied: [] }), extra: pluginMade, attempts: (c, config) => config.rounds },
};

const runningConfig = (o, c) => ({ seed: Number.isInteger(o.seed) ? o.seed : Math.floor(Math.random() * 2 ** 31), rounds: o.rounds ?? c.limits.rounds, minutes: o.minutes ?? c.limits.minutes, usd: o.usd ?? c.limits.usd, model: o.model ?? null, repair: o.repair === true, host: o.host ?? null });

const harnessDigest = (engine) => dirDigest(join(engine, "benchmark", "lib"));

function manifestOf(h, f) {
  return { schema: 1, run: f.runId, at: new Date().toISOString(), host: { node: process.version, platform: process.platform, docker: f.dockerVersion }, source: { repo: f.where.root, branch: f.where.branch, detached: f.where.detached, commit: f.where.commit, dirty: f.where.dirty, mode: f.mode, files: f.frozen.entries.length, digest: treeDigestOf(f.frozen.entries), skipped: f.frozen.skipped }, subject: { files: f.faulted.entries.length, digest: treeDigestOf(f.faulted.entries), clean: treeDigestOf(f.subject.entries), excluded: f.subject.skipped.map((s) => s.rel), faults: f.faulted.applied, commit: f.checkout.commit }, benchmark: { suite: f.c.suite.id, suiteVersion: f.c.suite.version, case: f.c.id, kind: f.c.kind, version: f.c.version, variant: f.variant, digest: f.caseDigest, harness: harnessDigest(engineOf(h)) }, ...(f.c.target ? { target: f.c.target, plugin: f.plugin } : {}), images: f.images, config: f.config, store: { base: h.storeBase, root: h.storeRoot } };
}

// ---- a new run --------------------------------------------------------------------------------------------------------

export function frozenRun(h, o) {
  const c = caseOf(h.root, o.caseId);
  const variant = KIND_RUN[c.kind].variant(c, o);
  const where = whereAt(h.root, h.env);
  const fr = frozen(where.root, modeOf(where, o.source), h.env);
  return made(h, { ...o, variant }, { c, where, mode: fr.mode, frozen: fr });
}

function made(h, o, f) {
  const subject = subjectOf(f.frozen.entries, HARNESS);
  const faulted = KIND_RUN[f.c.kind].subject(f.c, o.variant, subject.entries);
  const runId = newRunId(`${f.c.id}\u0000${o.variant}\u0000${treeDigestOf(faulted.entries)}`);
  const room = roomOf(h.storeRoot, runId);
  return recordedRun(h, o, { ...f, subject, faulted, runId, room });
}

function recordedRun(h, o, f) {
  cpSync(f.c.dir, f.room.at("frozen", "case"), { recursive: true });
  const checkout = madeCheckout(f.room.at("checkout"), f.faulted.entries, `${f.c.id} ${o.variant} subject`, h.env);
  const config = runningConfig(o, f.c);
  const manifest = manifestOf(h, { ...f, variant: o.variant, checkout, plugin: KIND_RUN[f.c.kind].extra(h, f), config, images: o.images, dockerVersion: o.dockerVersion, caseDigest: dirDigest(f.room.at("frozen", "case")) });
  return withTask(h, f.room, manifest, f.c);
}

function withTask(h, room, manifest, c) {
  const rec = recorderOf(h);
  const task = rec.create(`Benchmark ${c.id} ${c.version} (${manifest.benchmark.variant}${manifest.config.repair ? ", repair" : ""}) on ${manifest.source.branch ?? "detached"}@${manifest.source.commit.slice(0, 10)}, subject ${manifest.subject.digest.slice(0, 10)}`, { attempts: KIND_RUN[c.kind].attempts(c, manifest.config), actions: 60, minutes: manifest.config.minutes });
  docWritten(room, "manifest.json", { ...manifest, task });
  return contextOf(h, room, { ...manifest, task }, rec);
}

// ---- the context, the same for a new run and a resumed one ---------------------------------------------------------------

// The subject's files, read back from the checkout the run made (never from the developer's tree).
function baselineOf(checkoutDir, env) {
  const r = gitOwn(checkoutDir, ["ls-files", "-z", "-s"], env);
  if (!r.ok) throw new Blocked(`the run's checkout could not be listed: ${r.err}`);
  return String(r.out).split("\u0000").filter(Boolean).map((l) => /^(\d+) [0-9a-f]+ \d\t([\s\S]+)$/.exec(l)).filter(Boolean).map(([, mode, rel]) => entryAt(checkoutDir, mode, rel));
}

const MODES = { 100644: "file", 100755: "exec", 120000: "link" };

const entryAt = (dir, mode, rel) => ((bytes) => ({ rel, mode: MODES[mode] ?? "file", bytes, digest: shaBytes(bytes) }))(readFileSync(join(dir, rel)));

export function contextOf(h, room, manifest, rec) {
  const c = { ...JSON.parse(readFileSync(room.at("frozen", "case", "case.json"), "utf8")), dir: room.at("frozen", "case") };
  const deps = h.dockerDeps ? h.dockerDeps(room) : dockerDeps(h.env, room);
  const baseline = baselineOf(room.at("checkout"), h.env);
  const texts = new Map(baseline.map((e) => [e.rel, e.bytes]));
  return { run: { id: manifest.run }, room, manifest, case: c, frozenCase: c.dir, rec: rec ?? recorderOf(h), task: manifest.task, deps, dockerEnv: dockerClientEnv(h.env), env: h.env, storeBase: h.storeBase, repoRoot: h.root, images: manifest.images, user: userOf(deps), cpuset: cpusetOf(deps, c.limits.verifier?.cpus ?? 1), runnerCpuset: cpusetOf(deps, c.limits.runner.cpus), limits: { ...c.limits.verifier, rounds: manifest.config.rounds, usd: manifest.config.usd }, checkoutDir: room.at("checkout"), runnerStore: madeDir(room, "runner-store"), baseline, baselineDigest: treeDigestOf(baseline), baselineText: (rel) => texts.get(rel)?.toString("utf8") ?? null, probeFile: c.acceptance.probe ? join(c.dir, c.acceptance.probe) : null, engineDir: room.at("checkout"), pluginDir: room.at("plugin"), engineStore: room.at("engine"), allowedHosts: hostsOf(h.env), credentialNames: credentialNames(h.env, h.credential), caFile: h.caFile ? realpathSync(h.caFile) : null, model: manifest.config.model, repair: manifest.config.repair, host: manifest.config.host ?? null };
}

// The spec is imported from the run's FROZEN copy, and its cases made from the run's own seed.
export async function withSpec(ctx) {
  const spec = await import(pathToFileURL(join(ctx.frozenCase, ctx.case.acceptance.spec)).href);
  return { ...ctx, spec, cases: spec.cases(ctx.manifest.config.seed, ctx.case.acceptance.samples), imageEnv: docker.imageEnv(ctx.images.verifier, ctx.deps), invalid: selfTested(spec) };
}

const selfTested = (spec) => ((f) => (f.length ? { says: `the case's own reference model fails its self-test: ${f.join("; ")}` } : null))(typeof spec.selfTest === "function" ? spec.selfTest() : ["the spec has no self-test"]);

// What the run froze is still what it froze: the case it copied, and the subject it made.
export const frozenIntact = (ctx) => dirDigest(ctx.frozenCase) === ctx.manifest.benchmark.digest && ctx.baselineDigest === ctx.manifest.subject.digest;

export function resumedRun(h, runId) {
  const room = roomOf(h.storeRoot, runId);
  const manifest = docRead(room, "manifest.json");
  if (!manifest?.task || !existsSync(room.at("checkout"))) throw new Refused(`no benchmark run ${runId} is kept in ${room.dir}`);
  return contextOf(h, room, manifest);
}
