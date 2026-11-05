// THE COMMANDS of the benchmark, as a table: what each does with the harness it is handed (`h`: the repository root,
// this process's environment, the store) and how its answer is said. `run.mjs` is the composition root; nothing here
// reads the environment or the command line itself.
//
//   COMMANDS[name] = { run(h, args) -> result, say(result) -> text, exit?(result) -> code }
import { randomBytes } from "node:crypto";
import { cpSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Blocked, Refused } from "../../src/errors.mjs";
import { short } from "../../src/hash.mjs";
import { flag, has, words } from "../../src/learn/args.mjs";
import { docker } from "../../src/runtime/isolation/docker.mjs";
import { madeCheckout } from "./core/checkout.mjs";
import { contextOf, dockerDeps, engineOf, fixtureEntries, freshRoom, frozenRun, resumedRun, treeOf, userOf, variantEntries, withSpec } from "./core/context.mjs";
import { keptOr, plannedRuns, runOfControl } from "./core/controlset.mjs";
import { probedHost } from "./core/probe.mjs";
import { cleaned, leftovers, ranContainer, specFor } from "./core/docker.mjs";
import { candidateEntries, candidateFile, mutatedEntries, mutationFile } from "./core/mutations.mjs";
import { carried, EXIT, verificationSummary } from "./source/flow.mjs";
import { builtImage, imageDefs, imageIdOf, resolvedImages, ROLES } from "./core/images.mjs";
import { ARMS, armsOf, baselinePluginOf, caseOf, casesOf, dirDigest, suitesIn } from "./core/suites.mjs";
import { reportOf } from "./source/report.mjs";
import { carriedQa, withTruth } from "./qa/flow.mjs";
import { qaReportOf } from "./qa/report.mjs";
import { leaksMasked } from "./core/sentinel.mjs";
import { docRead, docWritten, newRunId, readRegular, roomOf, RUN_ID } from "./core/room.mjs";
import { frozen, HARNESS, subjectOf, whereAt } from "./core/freeze.mjs";
import { verified } from "./source/verify.mjs";
import { judgedRepair } from "./source/repairs.mjs";
import { BY_NAMES, metricsOf } from "./core/metrics.mjs";
import { DEFAULT_K } from "./core/rates.mjs";
import { overheadLines, ratesLines, reliabilityOf, sayReliability, toolsLines } from "./core/reliability.mjs";

const int = (v) => (v === undefined ? undefined : /^\d+$/.test(v) ? Number(v) : Number.NaN);

const num = (v) => (v === undefined ? undefined : Number(v));

function refusedWith(say) {
  throw new Refused(say);
}

const runIdOf = (args) => ((id) => (RUN_ID.test(String(id)) ? id : refusedWith("name the run: a bnr- id (node benchmark/run.mjs where lists them)")))(words(args)[0]);

// Docker as this command reaches it: the harness's own deps when it was handed some (a test's double), the machine's
// otherwise -- the same rule contextOf follows.
const depsOf = (h) => (h.dockerDeps ? h.dockerDeps(null) : dockerDeps(h.env, null));

function dockerUp(h, why) {
  const deps = depsOf(h);
  const up = docker.doctor(deps);
  if (!up.ok) throw new Blocked(`Docker does not answer here (${String(up.why ?? "").slice(0, 200)}): ${why}`);
  return { deps, version: up.version };
}

// ---- images and the machine ----------------------------------------------------------------------------------------------

const rolesAsked = (args) => ROLES.filter((r) => !ROLES.some((x) => has(args, x)) || has(args, r));

// A person's CA bundle, for a network that inspects TLS: named on the command line or by ORBIT_BENCHMARK_CA_FILE, and a
// regular file, or refused.
const caFileOf = (h) => ((f) => (!f ? null : readRegular(f, 1024 * 1024) ? f : refusedWith(`the CA file ${f} is not a readable regular file`)))(h.caFile);

function build(h, args) {
  const { deps } = dockerUp(h, "an image is built by Docker");
  return { images: rolesAsked(args).map((r) => builtImage(imageDefs(engineOf(h))[r], deps, has(args, "rebuild"), caFileOf(h))) };
}

const sayBuild = (r) => r.images.map((i) => `${i.role.padEnd(9)} ${i.reused ? "reused" : "built "}  ${i.tag}  ${i.id}`).join("\n");

const credentialsHere = (env) => ["ANTHROPIC_API_KEY", "CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_AUTH_TOKEN"].filter((n) => env[n]);

async function doctor(h, args) {
  const deps = depsOf(h);
  const up = docker.doctor(deps);
  const images = Object.fromEntries(ROLES.map((r) => [r, up.ok ? imageIdOf(imageDefs(engineOf(h))[r].tag, deps) : null]));
  return { docker: up.ok ? { version: up.version } : { missing: String(up.why ?? "") }, user: up.ok ? userOf(deps) : null, images, tags: Object.fromEntries(ROLES.map((r) => [r, imageDefs(engineOf(h))[r].tag])), credentials: credentialsHere(h.env), preflight: has(args, "preflight") ? await preflight(h, up, images) : null, host: has(args, "host") ? await hostChecked(h, deps, up, args) : null };
}

// `--host`: the runner image's Claude Code asked one question through the egress proxy (core/probe.mjs) -- only where
// Docker answers; a few cents of a credential's budget, said as the host reported it.
const hostChecked = (h, deps, up, args) => (up.ok ? probedHost(h, deps, flag(args, "model") ?? null) : { ok: false, code: "DOCKER", says: `Docker does not answer here: ${String(up.why ?? "").slice(0, 200)}` });

const sayPreflight = (p) => (!p ? [] : p.blocked ? [`preflight   BLOCKED — ${p.blocked}`] : [`preflight   ${p.holds ? "HOLDS" : "DOES NOT HOLD"} — clone ${p.clone?.exit === 0 ? "ok" : "failed"}; ${(p.checks ?? []).map((c) => `${c.argv} exit ${c.exit} in ${c.seconds}s`).join("; ")}; tree ${p.clean ? "left clean" : `left ${p.left?.length} path(s)`}`]);

const sayHost = (x) => (!x ? [] : [`host        ${x.ok ? "OK" : `BLOCKED ${x.code}`} — ${x.says}${x.costUsd !== null && x.costUsd !== undefined ? ` (reported ${x.costUsd} USD)` : ""}`]);

const sayDoctor = (r) => [`docker      ${r.docker.version ?? `BLOCKED — ${r.docker.missing}`}`, `user        ${r.user ?? "-"}`, ...ROLES.map((role) => `${role.padEnd(11)} ${r.images[role] ?? `not built (${r.tags[role]}) — node benchmark/run.mjs build`}`), `credential  ${r.credentials.length ? r.credentials.join(", ") : "none set (a repair round needs one, by name)"}`, ...sayPreflight(r.preflight), ...sayHost(r.host)].join("\n");

// Whether the subject's own declared checks can be held in the runner container at all: what a round's engineering
// task is held to, run here with no host, no network and no credential.
async function preflight(h, up, images) {
  if (!up.ok || !images.runner) return { blocked: !up.ok ? "Docker does not answer" : "the runner image is not built" };
  const room = roomOf(h.storeRoot, newRunId("preflight"));
  madeCheckout(room.at("checkout"), subjectOf(frozen(whereAt(treeOf(h), h.env).root, "head", h.env).entries, HARNESS).entries, "preflight subject", h.env);
  return preflightRan(h, room, images.runner);
}

async function preflightRan(h, room, image) {
  const deps = dockerDeps(h.env, room);
  const out = join(room.dir, "out");
  room.io.ensureDir(out);
  const r = await ranContainer(specFor("preflight", { id: room.id }, { image, user: userOf(deps), argv: ["node", "/bench/preflight.mjs"], mounts: [{ source: room.at("checkout"), target: "/work/repo", readOnly: true }, { source: out, target: "/work/out", readOnly: false }], env: { names: [], values: { HOME: "/tmp" } }, limits: { cpus: 2, memoryMb: 6144, pids: 2048 }, tmpMb: 2048 }), deps, { input: "", timeoutMs: 75 * 60000, attest: { network: "none", forbidden: [h.storeBase, h.root], pluginTarget: null, imageEnv: docker.imageEnv(image, deps) } });
  return { ...(safeJson(readRegular(join(out, "preflight.json"), 1024 * 1024)) ?? { blocked: r.refused ?? `the preflight container ended ${r.timedOut ? "at its deadline" : `with ${r.exit}`} and said nothing` }), evidence: room.dir };
}

function safeJson(buf) {
  try { return buf ? JSON.parse(buf.toString("utf8")) : null; }
  catch { return null; }
}

// ---- suites -----------------------------------------------------------------------------------------------------------------

// What a case is run on: a source case's variants, a QA case's application and the variant planted in it.
const VARIANTS_OF = { source: (c) => Object.keys(c.variants), qa: (c) => [`${c.target.stack} ${c.target.variant}`], engineering: (c) => Object.keys(c.variants).map((v) => `${c.fixture}:${v}`) };

const listed = (c) => ({ id: c.id, kind: c.kind, version: c.version, title: c.title, variants: VARIANTS_OF[c.kind](c), controls: [...c.controls.map((k) => `${k.id}:${k.expect}`), ...(c.repairs ?? []).map((r) => `${r.id}(${r.through}):${r.expect}`)], baseline: c.baseline ?? null, arms: armsOf(c), ...(armsOf(c).includes("baseline") ? { baselinePlugin: baselinePluginOf(c) } : {}) });

const list = (h) => ({ suites: suitesIn(h.root).map((p) => ({ id: p.id, version: p.version, title: p.title, cases: casesOf(h.root, p.id).map(listed) })) });

const armsSaid = (c) => (c.arms.length > 1 || c.arms[0] !== "release" ? `  arms ${c.arms.join(", ")}${c.baselinePlugin ? ` (baseline ${c.baselinePlugin})` : ""}` : "");

const sayList = (r) => r.suites.flatMap((p) => [`${p.id} ${p.version} — ${p.title}`, ...p.cases.map((c) => `  ${c.id} ${c.version}  ${c.kind.padEnd(11)}  ${c.kind === "source" ? "variants" : "on"} ${c.variants.join(", ")}  controls ${c.controls.join(", ")}${armsSaid(c)}\n    ${c.title}`)]).join("\n");

// ---- a run --------------------------------------------------------------------------------------------------------------------

// The one host a person may name on the command line: their own session (`session:<label>`). A scripted host is a
// control's, run by `controls`; a coding host is the default.
const hostOption = (v) => (v === undefined || /^session:[a-z0-9-]{1,40}$/.test(v) ? v : refusedWith(`--host takes session:<label> (lower-case letters, digits, dashes), not ${v}`));

// A caller's own names for what it starts: the run's id (a release ship names the room before it dispatches, so it can
// read the run back however it ends) and the task that started it (`parent`, shown by Orbit Live and Mission Control).
const TASK_ID = /^tsk-[a-f0-9]{12}$/;

const shaped = (name, re, says) => (v) => (v === undefined || re.test(v) ? v : refusedWith(`--${name} is ${says}, not ${v}`));

const runIdOption = shaped("run-id", RUN_ID, "bnr- and 12 hex characters");

export const parentOption = shaped("parent", TASK_ID, "a task's id: tsk- and 12 hex characters");

// Which arm a run hands its host (0.5.0, B23): one of ARMS, or `all` -- every arm the case declares, one after another.
const armOption = (v) => (v === undefined || [...ARMS, "all"].includes(v) ? v : refusedWith(`--arm is one of ${[...ARMS, "all"].join(", ")}, not ${v}`));

const optionsOf = (args) => ({ host: hostOption(flag(args, "host")), variant: flag(args, "variant"), repair: has(args, "repair"), source: flag(args, "source"), seed: int(flag(args, "seed")), model: flag(args, "model"), rounds: int(flag(args, "rounds")), minutes: int(flag(args, "minutes")), usd: num(flag(args, "usd")), runId: runIdOption(flag(args, "run-id")), parent: parentOption(flag(args, "parent")), repeat: int(flag(args, "repeat")), arm: armOption(flag(args, "arm")) });

// What a command may ask, as data: each option's lowest and highest value. `repeat` (0.5.0) is how many runs of one case
// one command starts -- enough for a rate over five runs and some to spare, never an open-ended loop of paid rounds.
export const BOUNDS = [["seed", 0, 2 ** 31 - 1], ["rounds", 1, 5], ["minutes", 10, 600], ["usd", 0, 200], ["repeat", 1, 10], ["k", 1, 10]];

const checked = (o) => ((bad) => (bad.length ? refusedWith(`out of bounds: ${bad.map(([k, lo, hi]) => `--${k} is ${lo}..${hi}`).join(", ")}`) : o))(BOUNDS.filter(([k, lo, hi]) => o[k] !== undefined && !(o[k] >= lo && o[k] <= hi)));

const SOURCE = ["head", "worktree", undefined];

const sourceChecked = (o) => (SOURCE.includes(o.source) ? o : refusedWith("--source is head or worktree"));

// A run like an earlier one: its case, variant, repair, source mode, seed, model and limits -- and the image ids it used,
// when they are still here. A new run, under a new id; the earlier one is never touched.
function likeOf(h, id) {
  const m = docRead(roomOf(h.storeRoot, id), "manifest.json");
  if (!m?.benchmark?.variant) throw new Refused(`no benchmark run ${id} is kept here to run again`);
  return { caseId: m.benchmark.case, variant: m.benchmark.variant, repair: m.config.repair, host: m.config.host ?? undefined, source: m.source.mode, seed: m.config.seed, model: m.config.model, rounds: m.config.rounds, minutes: m.config.minutes, usd: m.config.usd, arm: m.config.arm ?? undefined, preferImages: m.images, like: id };
}

// What each kind of case runs with: the images it needs, how its context is completed, how it is carried to its end,
// and how it is reported. A QA run's host is a coding host, unless a control names one of its scripted hosts.
const KIND = {
  source: { need: (o) => ["verifier", ...(o.repair ? ["runner"] : [])], completed: (ctx) => withSpec(ctx), carried: (ctx) => carried(ctx), reportOf, host: (o) => o.host ?? null },
  qa: { need: (o) => ["qa-worker", ...(o.host === "coding-host" ? ["runner", "verifier"] : [])], completed: async (ctx) => withTruth(ctx), carried: (ctx) => carriedQa(ctx), reportOf: qaReportOf, host: (o) => o.host ?? "coding-host" },
  engineering: { need: () => ["verifier", "runner"], completed: (ctx) => withSpec(ctx), carried: (ctx) => carried(ctx), reportOf, host: (o) => o.host ?? null, attempts: true },
};

const kindOfRun = (manifest) => KIND[manifest?.benchmark?.kind ?? "source"];

async function oneRun(h, o) {
  const { deps, version } = dockerUp(h, "a benchmark runs in containers");
  const kind = KIND[caseOf(h.root, o.caseId).kind];
  const asked = { ...o, host: kind.host(o), repair: o.repair === true || kind.attempts === true };
  const images = resolvedImages(imageDefs(engineOf(h)), deps, { need: kind.need(asked), prefer: o.preferImages });
  return finished(await kind.completed(frozenRun(h, { ...asked, images, dockerVersion: version })), kind);
}

// What a run leaves when it ends: its evidence, never its scratch trees when its case says so, never a container or a
// network carrying its label, and never the credential it handed the runner -- whatever it came to.
function tidied(ctx) {
  if (ctx.case.cleanup.scratch === "after-run") rmSync(ctx.room.at("scratch"), { recursive: true, force: true });
  const left = cleaned(ctx.run.id, ctx.deps);
  return { ...left, leaks: leaksNamed(ctx) };
}

// The secrets a run handed out: the coding host's credential, and the tokens a QA run's application was given.
const handedValues = (ctx) => [...ctx.credentialNames.filter((n) => n !== "ANTHROPIC_BASE_URL").map((n) => ctx.env[n]), ...(ctx.secretValues ?? [])];

// Every file the sentinel ever masked in this run's room, a resumed run's beside the first's.
function leaksNamed(ctx) {
  const leaks = leaksMasked(ctx.room.dir, handedValues(ctx));
  if (leaks.length) docWritten(ctx.room, "leaks.json", { at: new Date().toISOString(), says: "the credential handed to the runner was found in these files of the run's room, and masked", files: [...(docRead(ctx.room, "leaks.json")?.files ?? []), ...leaks] });
  return leaks;
}

// A run that threw still leaves no container or network of its own running; `resume` reads back what it was doing.
const thrownTidied = (ctx, e) => {
  tidied(ctx);
  throw e;
};

async function finished(ctx, kind) {
  const result = await kind.carried(ctx).catch((e) => thrownTidied(ctx, e));
  const left = tidied(ctx);
  const rep = reportWritten(ctx.room, ctx.manifest, ctx.rec.show(ctx.task), eventsOf(ctx.rec, ctx.task));
  return { run: ctx.run.id, task: ctx.task, case: ctx.case.id, variant: ctx.manifest.benchmark.variant, arm: ctx.manifest.config.arm ?? "release", ...(ctx.manifest.config.repeat ? { repeat: ctx.manifest.config.repeat } : {}), ...result, report: ctx.room.at("report.md"), evidence: ctx.room.dir, axes: rep.json.axes, leaks: rep.json.leaks, leftBehind: left.clean ? null : left };
}

// ---- repeated runs (0.5.0, B2): one PASS is not a rate --------------------------------------------------------------------

// N runs of one case, each its own room and task, named as one repeat GROUP in each manifest (`config.repeat`: the
// group's id, which run this is, how many were asked) -- or, with no --repeat, the one run it always was. A run that is
// blocked or refused is its own row, and the repeats after it still run.
const groupIdOf = (o) => `rpt-${short(`${o.caseId}\u0000${Date.now()}\u0000${randomBytes(6).toString("hex")}`, 12)}`;

function repeated(h, o) {
  if (o.repeat === undefined) return oneRun(h, o);
  if (o.runId && o.repeat > 1) refusedWith("--run-id names one run, and --repeat starts one run per repeat");
  return repeatsOf(h, o, groupIdOf(o));
}

async function repeatsOf(h, o, group) {
  const runs = [];
  for (let i = 1; i <= o.repeat; i++) runs.push(await oneRun(h, { ...o, group: { id: group, index: i, of: o.repeat } }).catch(failedRun({ id: o.caseId })));
  return { case: o.caseId, repeat: { group, of: o.repeat }, runs, exit: Math.max(...runs.map((r) => r.exit ?? 4)) };
}

// The rows a suite's case adds: one run, or each of its repeats and arms.
const caseRows = (r) => (Array.isArray(r.runs) ? r.runs : [r]);

const repeatChecked = (o) => (checked({ repeat: o.repeat }), o);

// ---- arms (0.5.0, B23): the same case, the same model and limits, a different plugin ----------------------------------

// The one arm asked -- or, with --arm=all, every arm the case declares, one after another (each repeated, when asked).
async function armed(h, o) {
  if (o.arm !== "all") return repeated(h, o);
  const runs = [];
  for (const arm of armsOf(caseOf(h.root, o.caseId))) runs.push(...caseRows(await repeated(h, { ...o, arm }).catch(failedRun({ id: o.caseId }))));
  return { case: o.caseId, arms: armsOf(caseOf(h.root, o.caseId)), runs, exit: Math.max(...runs.map((r) => r.exit ?? 4)) };
}

function runCmd(h, args) {
  if (flag(args, "like")) return repeated(h, repeatChecked({ ...likeOf(h, flag(args, "like")), repeat: int(flag(args, "repeat")) }));
  if (flag(args, "suite") && flag(args, "run-id")) refusedWith("--run-id names one run, and --suite starts one run per case");
  if (flag(args, "suite")) return suiteRun(h, args);
  const caseId = words(args)[0] ?? refusedWith("name the case to run (node benchmark/run.mjs list), or --suite=<suite>");
  return armed(h, sourceChecked(checked({ ...optionsOf(args), caseId })));
}

// A suite's run of one case: the variant asked when the case has it, its real one otherwise -- and a QA case's own.
const suiteVariant = (c, asked) => (c.kind === "qa" ? undefined : c.kind === "source" && asked && Object.hasOwn(c.variants, asked) ? asked : "real");

const suiteOptions = (args, c) => ((o) => ({ ...o, caseId: c.id, variant: suiteVariant(c, o.variant) }))(sourceChecked(checked(optionsOf(args))));

const failedRun = (c) => (e) => ({ case: c.id, outcome: e instanceof Blocked ? "BLOCKED" : "REFUSED", exit: e instanceof Blocked ? 3 : 2, summary: e.message });

async function suiteRun(h, args) {
  const cases = casesOf(h.root, flag(args, "suite"));
  if (!cases.length) throw new Refused(`no suite ${flag(args, "suite")} holds a case`);
  const runs = [];
  for (const c of cases) runs.push(...caseRows(await armed(h, suiteOptions(args, c)).catch(failedRun(c))));
  return { suite: flag(args, "suite"), runs, exit: Math.max(...runs.map((r) => r.exit ?? 4)) };
}

const repeatSaid = (r) => `${r.arm && r.arm !== "release" ? ` (arm ${r.arm})` : ""}${r.repeat?.id ? ` (repeat ${r.repeat.index}/${r.repeat.of}, ${r.repeat.id})` : ""}`;

const sayOne = (r) => [`${r.case ?? "?"} ${r.variant ?? ""} ${r.run ?? ""}${repeatSaid(r)}: ${r.outcome} (exit ${r.exit})`, `  ${r.summary ?? ""}`, ...(r.leaks?.length ? [`  LEAK      the credential was found in ${r.leaks.length} file(s) of the run's room, and masked (leaks.json)`] : []), ...(r.report ? [`  report    ${r.report}`, `  evidence  ${r.evidence}`, `  task      ${r.task} (node cli/task.mjs show ${r.task})`] : [])].join("\n");

const sayRun = (r) => (r.runs ? r.runs.map(sayOne).join("\n") : sayOne(r));

// ---- a run, afterwards ----------------------------------------------------------------------------------------------------

const stepsFor = (room, view) => Object.fromEntries((view.actions ?? []).map((a) => [a.id, docRead(room, `steps/${a.id}.json`)]).filter(([, d]) => d));

// The run task's own events, for what a person did to the run -- or nothing, when they cannot be read.
const eventsOf = (rec, task) => {
  try { return rec.events(task).events ?? null; }
  catch { return null; }
};

function reportWritten(room, manifest, view, events = null) {
  const rep = kindOfRun(manifest).reportOf(room, manifest, view, stepsFor(room, view), docRead(room, "ending.json"), docRead(room, "leaks.json"), events);
  docWritten(room, "report.json", rep.json);
  room.io.write(room.at("report.md"), rep.md);
  return rep;
}

const kept = (h, args) => ((ctx) => ({ ctx, view: ctx.rec.show(ctx.task) }))(resumedRun(h, runIdOf(args)));

function report(h, args) {
  const { ctx, view } = kept(h, args);
  return { ...reportWritten(ctx.room, ctx.manifest, view, eventsOf(ctx.rec, ctx.task)), path: ctx.room.at("report.md") };
}

function status(h, args) {
  const { ctx, view } = kept(h, args);
  return { run: ctx.run.id, task: ctx.task, case: ctx.manifest.benchmark.case, variant: ctx.manifest.benchmark.variant, repair: ctx.manifest.config.repair, arm: ctx.manifest.config.arm ?? "release", repeat: ctx.manifest.config.repeat ?? null, lifecycle: view.lifecycle, stage: view.stage, stopReason: view.stopReason, attempts: (view.attempts ?? []).map((a) => `${a.id}:${a.cause}:${a.outcome ?? "open"}${a.failureSignature ? `:${a.failureSignature}` : ""}`), budget: view.budget, running: (view.actions ?? []).filter((a) => a.state === "running").map((a) => `${a.id} ${a.type}`), ending: docRead(ctx.room, "ending.json"), evidence: ctx.room.dir };
}

const sayStatus = (r) => [`RUN        ${r.run} — ${r.case} (${r.variant}${r.repair ? ", repair" : ""}${r.arm !== "release" ? `, arm ${r.arm}` : ""})${r.repeat ? ` · repeat ${r.repeat.index}/${r.repeat.of} of ${r.repeat.id}` : ""}`, `TASK       ${r.task}: ${r.lifecycle} · ${r.stage ?? "no stage"}${r.stopReason ? ` · ${r.stopReason}` : ""}`, `ATTEMPTS   ${r.attempts.join("  ") || "none"}`, `BUDGET     attempts ${r.budget.attempts.spent}/${r.budget.attempts.limit} · actions ${r.budget.actions.spent}/${r.budget.actions.limit} · minutes ${r.budget.minutes.spent}/${r.budget.minutes.limit ?? "-"}`, ...(r.running.length ? [`RUNNING    ${r.running.join(", ")}`] : []), `OUTCOME    ${r.ending ? `${r.ending.outcome} — ${r.ending.summary}` : "not decided yet"}`, `EVIDENCE   ${r.evidence}`].join("\n");

// A run carried on from its room -- or a control set from its own (core/controlset.mjs), whatever kind of case it holds.
async function resume(h, args) {
  const room = roomOf(h.storeRoot, runIdOf(args));
  const m = docRead(room, "manifest.json");
  return m?.kind === "controls" ? controlsResumed(h, room, m) : runResumed(h, args);
}

async function runResumed(h, args) {
  const first = resumedRun(h, runIdOf(args));
  const kind = kindOfRun(first.manifest);
  const { deps } = dockerUp(h, "a resumed run goes on in containers too");
  resolvedImages(imageDefs(engineOf(h)), deps, { need: kind.need({ repair: first.repair, host: first.host }), prefer: first.images });
  return finished(await kind.completed(first), kind);
}

const cleanedHere = (room, deps) => (docker.doctor(deps).ok ? { ...cleaned(room.id, deps), left: leftovers(room.id, deps) } : { containers: [], networks: [], clean: true, left: null, skipped: "Docker does not answer: nothing of this run can be running" });

// What every room a cleanup reaches left, as one answer: a run's own, or a control set's and every run it planned.
const mergedClean = (xs) => ({ containers: xs.flatMap((x) => x.containers), networks: xs.flatMap((x) => x.networks), clean: xs.every((x) => x.clean), left: xs.every((x) => x.left) ? { containers: xs.flatMap((x) => x.left.containers), networks: xs.flatMap((x) => x.left.networks) } : null, ...(xs.find((x) => x.skipped) ? { skipped: xs.find((x) => x.skipped).skipped } : {}) });

// A control set is cleaned with every run it planned for a control (an engine repair control, a QA control), each by
// its own label: a person who stopped the set mid-control leaves no container of that control running.
const cleanedRooms = (h, room, deps) => mergedClean([room, ...plannedRuns(room).map((r) => roomOf(h.storeRoot, r))].map((x) => cleanedHere(x, deps)));

function cleanup(h, args) {
  const room = roomOf(h.storeRoot, runIdOf(args));
  const done = cleanedRooms(h, room, dockerDeps(h.env, null));
  if (has(args, "scratch")) rmSync(room.at("scratch"), { recursive: true, force: true });
  return { run: room.id, ...done, scratch: has(args, "scratch") ? "removed" : "kept" };
}

const sayCleanup = (r) => [`RUN        ${r.run}`, `REMOVED    ${r.containers.filter((c) => c.removed).length} container(s), ${r.networks.filter((n) => n.ok).length} network(s); scratch ${r.scratch}`, `LEFT       ${r.left ? `${r.left.containers.length} container(s), ${r.left.networks.length} network(s) carrying this run's label` : r.skipped}`].join("\n");

function safeList(dir) {
  try { return readdirSync(dir); }
  catch { return []; }
}

const runRow = (h, n) => ((m) => ({ run: n, case: m?.benchmark?.case ?? m?.kind ?? "?", variant: m?.benchmark?.variant ?? m?.kind ?? "", at: m?.at ?? null }))(docRead(roomOf(h.storeRoot, n), "manifest.json"));

const where = (h) => ({ store: h.storeRoot, benchmark: join(h.storeRoot, "benchmark"), runs: safeList(join(h.storeRoot, "benchmark")).filter((n) => RUN_ID.test(n)).map((n) => runRow(h, n)) });

const sayWhere = (r) => [`BENCHMARK  ${r.benchmark}`, ...r.runs.map((x) => `  ${x.run}  ${x.case} ${x.variant}  ${x.at ?? ""}`)].join("\n");

// ---- metrics: what the runs kept, folded ------------------------------------------------------------------------------------

// How many runs a fold reads, newest first: enough for a picture, bounded however many a machine keeps.
export const MAX_RUNS = 500;

const keptRun = (h, n) => ((room) => ({ manifest: docRead(room, "manifest.json"), ending: docRead(room, "ending.json"), report: docRead(room, "report.json"), controls: docRead(room, "controls.json") }))(roomOf(h.storeRoot, n));

// A source revision named by its commit, or the start of one (`--revision`, 0.5.0): the runs that froze it.
const revisionOf = (args) => ((v) => (v === undefined || /^[0-9a-f]{4,64}$/.test(v) ? v : refusedWith(`--revision is a commit id, or the start of one, not ${v}`)))(flag(args, "revision"));

const inScope = (args) => (r) => (!flag(args, "suite") || r.manifest.benchmark?.suite === flag(args, "suite")) && (!flag(args, "case") || r.manifest.benchmark?.case === flag(args, "case")) && (!flag(args, "since") || String(r.manifest.at ?? "") >= flag(args, "since")) && (!revisionOf(args) || String(r.manifest.source?.commit ?? "").startsWith(revisionOf(args)));

const SCOPES = ["revision", "suite", "case", "since"];

const scopeSaid = (args) => SCOPES.filter((k) => flag(args, k)).map((k) => `${k} ${flag(args, k)}`).join(", ") || "every run kept";

// Rooms that hold no run of a case: a control set's (its rows are the verifier's own metric) and a host probe's.
const NOT_RUNS = ["controls", "probe"];

const controlRows = (kept) => kept.filter((r) => r.manifest.kind === "controls" && r.controls).flatMap((r) => r.controls.rows.map((row) => ({ ...row, case: r.controls.case })));

// The kept rooms in scope, newest first, bounded: what `metrics` and `reliability` both fold.
const scopedRuns = (h, args) => (revisionOf(args), safeList(join(h.storeRoot, "benchmark"))).filter((n) => RUN_ID.test(n)).map((n) => keptRun(h, n)).filter((r) => r.manifest).filter(inScope(args)).sort((a, b) => String(b.manifest.at ?? "").localeCompare(String(a.manifest.at ?? ""))).slice(0, MAX_RUNS);

const casesOnly = (scoped) => scoped.filter((r) => !NOT_RUNS.includes(r.manifest.kind));

// What `--by` breaks the runs down by -- revision, model, arm, comma-separated -- and k of pass@k (bounded in BOUNDS).
const byOption = (v) => ((names) => (names.every((n) => BY_NAMES.includes(n)) ? names : refusedWith(`--by is any of ${BY_NAMES.join(", ")}, comma-separated, not ${v}`)))(v === undefined ? [] : String(v).split(","));

const kOf = (args) => checked({ k: int(flag(args, "k")) }).k;

function metrics(h, args) {
  const scoped = scopedRuns(h, args);
  return { store: join(h.storeRoot, "benchmark"), ...metricsOf(casesOnly(scoped), { scope: scopeSaid(args), controls: controlRows(scoped), by: byOption(flag(args, "by")), k: kOf(args) }) };
}

// THE RELIABILITY REPORT (0.5.0): rates, tool-call failures and arms, from the kept rooms in scope -- printed, never
// written: a release ship writes it next to its evidence.json.
const reliability = (h, args) => reliabilityOf(casesOnly(scopedRuns(h, args)), { scope: Object.fromEntries(SCOPES.map((k) => [k, flag(args, k) ?? null]).concat([["k", kOf(args) ?? DEFAULT_K]])), store: join(h.storeRoot, "benchmark"), at: new Date().toISOString(), k: kOf(args) });

const cell = (m) => `${String(m.value).padEnd(8)} ${`${Math.round(m.numerator * 100) / 100}/${m.denominator}`.padEnd(12)}${Object.entries(m.excluded ?? {}).filter(([, n]) => n).map(([k, n]) => ` ${k} ${n}`).join("")}`;

const basisLines = (r, basis) => (r.runs.byBasis[basis] ? [`${basis.toUpperCase()} (${r.runs.byBasis[basis]} run(s))`, ...Object.entries(r.bases[basis]).map(([id, m]) => `  ${id.padEnd(26)} ${cell(m)}`)] : []);

const historyLines = (r) => (r.history ? ["HISTORY BY REVISION", ...r.history.map((x) => `  ${x.case} ${x.variant} (${x.basis}): ${x.commits.map((c) => `${c.commit ?? "?"} ${c.outcome}`).join(" → ")}`)] : []);

// A breakdown `--by` asked for: every metric again per model or per arm, each basis still apart.
const splitLines = (title, name, groups) => (groups ? [title, ...groups.flatMap((g) => [`  ${g[name]} (${g.runs} run(s))`, ...Object.entries(g.bases).filter(([, ms]) => Object.values(ms).some((m) => m.runs)).flatMap(([b, ms]) => Object.entries(ms).filter(([, m]) => m.value !== "unknown").map(([id, m]) => `    ${b.padEnd(12)} ${id.padEnd(26)} ${cell(m)}`))])] : []);

const sayMetrics = (r) => [`METRICS    ${r.scope} — ${r.runs.total} run(s) in ${r.store}`, ...["coding-host", "session", "scripted", "none"].flatMap((b) => basisLines(r, b)), `REPRODUCIBILITY ${cell(r.reproducibility)}${r.reproducibility.unstable.length ? ` — unstable: ${r.reproducibility.unstable.map((u) => `${u.case} ${u.variant}`).join(", ")}` : ""}`, `VERIFIER CONTROLS ${cell(r.verifier)}${r.verifier.missed.length ? ` — missed: ${r.verifier.missed.join("; ")}` : ""}`, ...ratesLines(r.reliability), ...toolsLines(r.tools), ...overheadLines(r.overhead), ...historyLines(r), ...splitLines("BY MODEL", "model", r.byModel), ...splitLines("BY ARM", "arm", r.byArm), "A scripted host's numbers are conformance, never autonomy; a value of unknown has nothing to stand on."].join("\n");

// ---- the controls: does the verifier fail what it must and pass what it must, in its own containers -------------------------

const NO_RECORD = { show: () => ({}) };

// What a case's controls run over: Orbit's source for a source case, the CLEAN fixture for an engineering case -- every
// control names the variant it lays over that.
const CONTROL_BASE = { source: (c, fr) => subjectOf(fr.entries, HARNESS).entries, engineering: (c, fr) => fixtureEntries(c, fr.entries) };

// What a control set was asked with, kept in its room's manifest so a resume asks the very same controls of the very
// same tree: which control (--only), whether the engine-carried ones run (--skip-engine), the task that started it
// (--parent), which tree of the checkout a QA control freezes (--source), and the room's own name (--run-id: a release
// ship names it before the set starts, so a restart never loses which room to carry on).
const controlOptions = (args) => ({ runId: runIdOption(flag(args, "run-id")) ?? null, only: flag(args, "only") ?? null, skipEngine: has(args, "skip-engine"), parent: parentOption(flag(args, "parent")) ?? null, source: flag(args, "source") ?? null });

const setRoom = (h, c, o) => freshRoom(h, o.runId ?? newRunId(`${c.id}\u0000controls`));

// A control set's manifest: the tree it measured by its path (a resume measures that tree again), the case and its
// digest, what it was asked.
const setManifest = (room, c, where0, o, more) => ({ schema: 1, kind: "controls", run: room.id, task: null, at: new Date().toISOString(), source: { repo: where0.root, branch: where0.branch, commit: where0.commit, mode: more.mode }, benchmark: { case: c.id, kind: c.kind, version: c.version, variant: "real", digest: more.digest }, subject: { digest: null }, images: more.images ?? null, config: { seed: 20240607, rounds: 1, usd: 0, model: null, repair: false, minutes: 60, asked: o } });

function controlsRoom(h, c, images, o) {
  const room = setRoom(h, c, o);
  const where0 = whereAt(treeOf(h), h.env);
  cpSync(c.dir, room.at("frozen", "case"), { recursive: true });
  madeCheckout(room.at("checkout"), CONTROL_BASE[c.kind](c, frozen(where0.root, "head", h.env)), `${c.id} controls subject`, h.env, { plugin: c.kind === "source" });
  return { room, manifest: setManifest(room, c, where0, o, { mode: "head", digest: dirDigest(room.at("frozen", "case")), images }) };
}

async function controls(h, args) {
  const c = caseOf(h.root, words(args)[0] ?? refusedWith("name the case whose controls to run"));
  return (c.kind === "qa" ? qaControls : sourceControls)(h, c, controlOptions(args));
}

// The controls asked for: every one the case declares, or the one --only names.
const only = (list, o) => list.filter((x) => !o.only || x.id === o.only);

// The engine-carried controls run a whole repair round each (Orbit's own test suite, in the runner); --skip-engine
// leaves them out, for the quick tier that proves the verifier and the judge alone.
const engineRepairs = (c, o) => (o.skipEngine ? [] : only((c.repairs ?? []).filter((r) => r.through === "engine"), o));

const judgeRepairs = (c, o) => only((c.repairs ?? []).filter((r) => r.through === "judge"), o);

const verifierNeeds = (c, o) => ["verifier", ...(engineRepairs(c, o).length ? ["runner"] : [])];

async function sourceControls(h, c, o) {
  const { deps } = dockerUp(h, "the controls run the verifier's own containers");
  const made = controlsRoom(h, c, resolvedImages(imageDefs(engineOf(h)), deps, { need: verifierNeeds(c, o) }), o);
  docWritten(made.room, "manifest.json", made.manifest);
  return controlsRan(await withSpec(contextOf(h, made.room, made.manifest, NO_RECORD)), c, h, o);
}

// What a control's own file does to its variant: a source case's mutations, or an engineering case's definition (the
// edits a candidate would make, files it brings and files it deletes).
const CONTROL_FILES = { engineering: (dir, rel, entries) => candidateEntries(entries, candidateFile(dir, rel)) };

const controlFiled = (ctx, c, k, entries) => (CONTROL_FILES[c.kind] ?? ((dir, rel, e) => mutatedEntries(e, mutationFile(dir, rel))))(ctx.frozenCase, k.file, entries);

// A control that no longer applies to this source is THAT control's row -- DRIFTED, saying what moved -- never an
// aborted command: the controls that do apply still run, and the command says REFUSED (exit 2) when any drifted.
function entriesFor(ctx, c, k) {
  const v = variantEntries({ ...c, dir: ctx.frozenCase }, k.variant, ctx.baseline);
  const m = v.ok && k.file ? controlFiled(ctx, c, k, v.entries) : v;
  return m.ok ? { entries: m.entries } : { drift: `FIXTURE_DRIFT: control ${k.id} does not apply to this source (${m.drift.mutation} in ${m.drift.file})` };
}

const driftedRow = (k, says, more = {}) => ({ id: k.id, kind: "verifier", variant: k.variant, expect: k.expect, got: "DRIFTED", matched: false, summary: says, ...more });

async function oneControl(ctx, c, k) {
  const e = entriesFor(ctx, c, k);
  if (e.drift) return driftedRow(k, e.drift);
  const v = await verified(ctx, `control-${k.id}`, e.entries, {});
  const got = !v.complete ? "INCOMPLETE" : v.failures.length ? "FAIL" : "PASS";
  return { id: k.id, kind: "verifier", variant: k.variant, expect: k.expect, got, matched: got === k.expect, summary: verificationSummary(v), digest: v.digest, attested: v.hidden.attested.every((r) => r.ok) };
}

// A judge control whose candidate or variant no longer applies is its own DRIFTED row too.
const judgedOrDrifted = (ctx, c, r, cache) => judgedRepair(ctx, c, r, cache).catch((e) => (e.code === "FIXTURE_DRIFT" ? driftedRow(r, e.message, { kind: "candidate", through: "judge" }) : rethrownError(e)));

function rethrownError(e) {
  throw e;
}

// A control carried by a whole run of its own: the run its record planned -- read back when it ended, carried on when
// its room was kept, started under an id planned first otherwise (core/controlset.mjs RUN_OF). A resumed set never
// starts a second run for one control.
const controlRun = (h, set, id, start) => runOfControl({ set, id, storeRoot: h.storeRoot, resume: (run) => runResumed(h, [run]), start, newRun: () => newRunId(`${set.id}\u0000${id}`) });

const failedControl = (e) => ({ outcome: e instanceof Blocked ? "BLOCKED" : "REFUSED", summary: e.message });

// A repair control carried through Orbit's ENGINE: a whole run with --repair whose host is the scripted one, driving
// Orbit's real engineering loop in the runner with the edits its definition names -- no model, no network.
async function engineControl(h, set, c, r, o) {
  const got = await controlRun(h, set, r.id, (runId) => oneRun(h, { caseId: c.id, variant: r.variant, repair: true, host: `scripted:${r.id}`, source: "head", parent: o.parent ?? undefined, runId })).catch(failedControl);
  return { id: r.id, kind: "scripted-host", through: "engine", expect: r.expect, got: got.outcome, matched: got.outcome === r.expect, summary: got.summary ?? "", run: got.run ?? null };
}

async function rowsOf(list, one) {
  const rows = [];
  for (const x of list) rows.push(await one(x));
  return rows;
}

// Every control of a source case, in its own order: what the verifier must pass and fail, what the judge must pass and
// refuse of a candidate, and what a scripted host carried through the engine must come to -- each kept in the set's room
// as it ends, so a resumed set runs only what it had not decided. A verifier whose own reference model fails its
// self-test proves nothing, so none of its controls is run.
async function controlsRan(ctx, c, h, o) {
  if (ctx.invalid) return { case: c.id, run: ctx.run.id, rows: [], verifierDefect: ctx.invalid.says, exit: 2 };
  const cache = {};
  const rows = [...(await rowsOf(only(c.controls, o), (k) => keptOr(ctx.room, k, () => oneControl(ctx, c, k)))), ...(await rowsOf(judgeRepairs(c, o), (r) => keptOr(ctx.room, r, () => judgedOrDrifted(ctx, c, r, cache)))), ...(await rowsOf(engineRepairs(c, o), (r) => keptOr(ctx.room, r, () => engineControl(h, ctx.room, c, r, o))))];
  docWritten(ctx.room, "controls.json", { case: c.id, rows });
  return { case: c.id, run: ctx.run.id, rows, exit: controlsExit(rows) };
}

// REFUSED when any control no longer applies to this source (FIXTURE_DRIFT); otherwise every row matched, or not.
const controlsExit = (rows) => (rows.some((r) => r.got === "DRIFTED") ? 2 : rows.length && rows.every((r) => r.matched) ? 0 : 1);

// A QA case's controls: a whole run each, driven by one of its scripted hosts, its verdict held to what it must be --
// the set kept in a room of its own, as a source case's is.
function qaControlsRoom(h, c, o) {
  const room = setRoom(h, c, o);
  docWritten(room, "manifest.json", setManifest(room, c, whereAt(treeOf(h), h.env), o, { mode: o.source ?? "head", digest: dirDigest(c.dir) }));
  return room;
}

const qaControls = (h, c, o) => qaControlsRan(h, c, qaControlsRoom(h, c, o), o);

async function qaControl(h, set, c, k, o) {
  const r = await controlRun(h, set, k.id, (runId) => oneRun(h, { caseId: c.id, host: k.host, source: o.source ?? "head", parent: o.parent ?? undefined, runId }));
  return { id: k.id, host: k.host, expect: k.expect, got: r.outcome, matched: r.outcome === k.expect, summary: r.summary ?? "", run: r.run };
}

async function qaControlsRan(h, c, room, o) {
  const rows = await rowsOf(only(c.controls, o), (k) => keptOr(room, k, () => qaControl(h, room, c, k, o)));
  docWritten(room, "controls.json", { case: c.id, rows });
  return { case: c.id, run: room.id, rows, exit: controlsExit(rows) };
}

// ---- a control set, carried on -------------------------------------------------------------------------------------------

// A control set carried on from its room (`resume <bnr-…>`): what it was asked, on the tree it measured -- every control
// it kept stays as it was, the rest run, and a control's own run is carried on when its record planned one. A set whose
// case moved since it began is refused: what it kept was about another case.
const unkept = (room) => refusedWith(`the control set ${room.id} keeps no options to be carried on with: run its controls again`);

const controlsResumed = (h, room, m) => (m.config?.asked ? (m.benchmark?.kind === "qa" ? qaResumed : sourceResumed)({ ...h, tree: m.source?.repo ?? h.tree }, room, m) : unkept(room));

const intactSet = (ctx) => (dirDigest(ctx.frozenCase) === ctx.manifest.benchmark.digest ? ctx : refusedWith(`the control set ${ctx.run.id} froze a case that changed since it began: run its controls again`));

async function sourceResumed(h, room, m) {
  const { deps } = dockerUp(h, "a control set goes on in the verifier's containers");
  const ctx = intactSet(await withSpec(contextOf(h, room, m, NO_RECORD)));
  resolvedImages(imageDefs(engineOf(h)), deps, { need: verifierNeeds(ctx.case, m.config.asked), prefer: m.images });
  return controlsRan(ctx, ctx.case, h, m.config.asked);
}

const qaResumed = (h, room, m) => ((c) => (dirDigest(c.dir) === m.benchmark.digest ? qaControlsRan(h, c, room, m.config.asked) : refusedWith(`${c.id} changed since the control set ${room.id} began: run its controls again`)))(caseOf(h.root, m.benchmark.case));

const rejectsSay = (x) => (x.missing?.length ? ` · NOT refused by ${x.missing.join(", ")}` : x.rejects?.length ? ` · refused by ${x.rejects.join(", ")}` : "");

const sayControls = (r) => [`CONTROLS   ${r.case} (${r.run})`, ...(r.verifierDefect ? [`  VERIFIER_DEFECT — ${r.verifierDefect}: no control was run`] : []), ...r.rows.map((x) => `  ${x.matched ? "✓" : "✗"} ${x.id.padEnd(20)} ${String(x.kind ?? "host").padEnd(13)} expected ${x.expect.padEnd(17)} got ${String(x.got).padEnd(17)} ${x.summary}${rejectsSay(x)}`)].join("\n");

export const COMMANDS = {
  build: { run: build, say: sayBuild },
  list: { run: list, say: sayList },
  doctor: { run: doctor, say: sayDoctor },
  run: { run: runCmd, say: sayRun, exit: (r) => r.exit ?? EXIT[r.outcome] ?? 4 },
  status: { run: status, say: sayStatus },
  report: { run: report, say: (r) => r.md },
  resume: { run: resume, say: sayRun, exit: (r) => r.exit ?? 4 },
  controls: { run: controls, say: sayControls, exit: (r) => r.exit },
  cleanup: { run: cleanup, say: sayCleanup },
  metrics: { run: metrics, say: sayMetrics },
  reliability: { run: reliability, say: sayReliability },
  where: { run: where, say: sayWhere },
};
