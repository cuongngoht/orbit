// THE COMMANDS of the benchmark, as a table: what each does with the harness it is handed (`h`: the repository root,
// this process's environment, the store) and how its answer is said. `run.mjs` is the composition root; nothing here
// reads the environment or the command line itself.
//
//   COMMANDS[name] = { run(h, args) -> result, say(result) -> text, exit?(result) -> code }
import { cpSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { Blocked, Refused } from "../../src/errors.mjs";
import { flag, has, words } from "../../src/learn/args.mjs";
import { docker } from "../../src/runtime/isolation/docker.mjs";
import { HARNESS } from "./candidate.mjs";
import { madeCheckout } from "./checkout.mjs";
import { contextOf, dockerDeps, engineOf, frozenRun, resumedRun, userOf, withSpec } from "./context.mjs";
import { cleaned, leftovers, ranContainer, specFor } from "./docker.mjs";
import { mutatedEntries, mutationFile } from "./faults.mjs";
import { carried, EXIT, verificationSummary } from "./flow.mjs";
import { builtImage, imageDefs, imageIdOf, resolvedImages, ROLES } from "./images.mjs";
import { caseOf, casesOf, dirDigest, packsIn } from "./packs.mjs";
import { reportOf } from "./report.mjs";
import { leaksMasked } from "./sentinel.mjs";
import { docRead, docWritten, newRunId, readRegular, roomOf, RUN_ID } from "./room.mjs";
import { frozen, subjectOf, whereAt } from "./source.mjs";
import { verified } from "./verify.mjs";

const int = (v) => (v === undefined ? undefined : /^\d+$/.test(v) ? Number(v) : Number.NaN);

const num = (v) => (v === undefined ? undefined : Number(v));

function refusedWith(say) {
  throw new Refused(say);
}

const runIdOf = (args) => ((id) => (RUN_ID.test(String(id)) ? id : refusedWith("name the run: a bnr- id (node benchmark/run.mjs where lists them)")))(words(args)[0]);

function dockerUp(h, why) {
  const deps = dockerDeps(h.env, null);
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
  const deps = dockerDeps(h.env, null);
  const up = docker.doctor(deps);
  const images = Object.fromEntries(ROLES.map((r) => [r, up.ok ? imageIdOf(imageDefs(engineOf(h))[r].tag, deps) : null]));
  return { docker: up.ok ? { version: up.version } : { missing: String(up.why ?? "") }, user: up.ok ? userOf(deps) : null, images, tags: Object.fromEntries(ROLES.map((r) => [r, imageDefs(engineOf(h))[r].tag])), credentials: credentialsHere(h.env), preflight: has(args, "preflight") ? await preflight(h, up, images) : null };
}

const sayPreflight = (p) => (!p ? [] : p.blocked ? [`preflight   BLOCKED — ${p.blocked}`] : [`preflight   ${p.holds ? "HOLDS" : "DOES NOT HOLD"} — clone ${p.clone?.exit === 0 ? "ok" : "failed"}; ${(p.checks ?? []).map((c) => `${c.argv} exit ${c.exit} in ${c.seconds}s`).join("; ")}; tree ${p.clean ? "left clean" : `left ${p.left?.length} path(s)`}`]);

const sayDoctor = (r) => [`docker      ${r.docker.version ?? `BLOCKED — ${r.docker.missing}`}`, `user        ${r.user ?? "-"}`, ...ROLES.map((role) => `${role.padEnd(11)} ${r.images[role] ?? `not built (${r.tags[role]}) — node benchmark/run.mjs build`}`), `credential  ${r.credentials.length ? r.credentials.join(", ") : "none set (a repair round needs one, by name)"}`, ...sayPreflight(r.preflight)].join("\n");

// Whether the subject's own declared checks can be held in the runner container at all: what a round's engineering
// task is held to, run here with no host, no network and no credential.
async function preflight(h, up, images) {
  if (!up.ok || !images.runner) return { blocked: !up.ok ? "Docker does not answer" : "the runner image is not built" };
  const room = roomOf(h.storeRoot, newRunId("preflight"));
  madeCheckout(room.at("checkout"), subjectOf(frozen(whereAt(h.root, h.env).root, "head", h.env).entries, HARNESS).entries, "preflight subject", h.env);
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

// ---- packs ------------------------------------------------------------------------------------------------------------------

const list = (h) => ({ packs: packsIn(h.root).map((p) => ({ id: p.id, version: p.version, title: p.title, cases: casesOf(h.root, p.id).map((c) => ({ id: c.id, version: c.version, title: c.title, variants: Object.keys(c.variants), controls: c.controls.map((k) => `${k.id}:${k.expect}`) })) })) });

const sayList = (r) => r.packs.flatMap((p) => [`${p.id} ${p.version} — ${p.title}`, ...p.cases.map((c) => `  ${c.id} ${c.version}  variants ${c.variants.join(", ")}  controls ${c.controls.join(", ")}\n    ${c.title}`)]).join("\n");

// ---- a run --------------------------------------------------------------------------------------------------------------------

const optionsOf = (args) => ({ variant: flag(args, "variant") ?? "real", repair: has(args, "repair"), source: flag(args, "source"), seed: int(flag(args, "seed")), model: flag(args, "model"), rounds: int(flag(args, "rounds")), minutes: int(flag(args, "minutes")), usd: num(flag(args, "usd")) });

const BOUNDS = [["seed", 0, 2 ** 31 - 1], ["rounds", 1, 5], ["minutes", 10, 600], ["usd", 0, 200]];

const checked = (o) => ((bad) => (bad.length ? refusedWith(`out of bounds: ${bad.map(([k, lo, hi]) => `--${k} is ${lo}..${hi}`).join(", ")}`) : o))(BOUNDS.filter(([k, lo, hi]) => o[k] !== undefined && !(o[k] >= lo && o[k] <= hi)));

const SOURCE = ["head", "worktree", undefined];

const sourceChecked = (o) => (SOURCE.includes(o.source) ? o : refusedWith("--source is head or worktree"));

// A run like an earlier one: its case, variant, repair, source mode, seed, model and limits -- and the image ids it used,
// when they are still here. A new run, under a new id; the earlier one is never touched.
function likeOf(h, id) {
  const m = docRead(roomOf(h.storeRoot, id), "manifest.json");
  if (!m?.benchmark?.variant) throw new Refused(`no benchmark run ${id} is kept here to run again`);
  return { caseId: m.benchmark.case, variant: m.benchmark.variant, repair: m.config.repair, source: m.source.mode, seed: m.config.seed, model: m.config.model, rounds: m.config.rounds, minutes: m.config.minutes, usd: m.config.usd, preferImages: m.images, like: id };
}

async function oneRun(h, o) {
  const { deps, version } = dockerUp(h, "a benchmark runs every verification in a container");
  const images = resolvedImages(imageDefs(engineOf(h)), deps, { needRunner: o.repair, prefer: o.preferImages });
  return finished(await withSpec(frozenRun(h, { ...o, images, dockerVersion: version })));
}

// What a run leaves when it ends: its evidence, never its scratch trees when its case says so, never a container or a
// network carrying its label, and never the credential it handed the runner -- whatever it came to.
function tidied(ctx) {
  if (ctx.case.cleanup.scratch === "after-run") rmSync(ctx.room.at("scratch"), { recursive: true, force: true });
  const left = cleaned(ctx.run.id, ctx.deps);
  return { ...left, leaks: leaksNamed(ctx) };
}

const handedValues = (ctx) => ctx.credentialNames.filter((n) => n !== "ANTHROPIC_BASE_URL").map((n) => ctx.env[n]);

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

async function finished(ctx) {
  const result = await carried(ctx).catch((e) => thrownTidied(ctx, e));
  const left = tidied(ctx);
  const rep = reportWritten(ctx.room, ctx.manifest, ctx.rec.show(ctx.task));
  return { run: ctx.run.id, task: ctx.task, case: ctx.case.id, variant: ctx.manifest.benchmark.variant, ...result, report: ctx.room.at("report.md"), evidence: ctx.room.dir, axes: rep.json.axes, leaks: rep.json.leaks, leftBehind: left.clean ? null : left };
}

function runCmd(h, args) {
  if (flag(args, "like")) return oneRun(h, likeOf(h, flag(args, "like")));
  if (flag(args, "suite")) return suiteRun(h, args);
  const caseId = words(args)[0] ?? refusedWith("name the case to run (node benchmark/run.mjs list), or --suite=<pack>");
  return oneRun(h, sourceChecked(checked({ ...optionsOf(args), caseId })));
}

const suiteOptions = (args, c) => ((o) => ({ ...o, caseId: c.id, variant: Object.hasOwn(c.variants, o.variant) ? o.variant : "real" }))(sourceChecked(checked(optionsOf(args))));

const failedRun = (c) => (e) => ({ case: c.id, outcome: e instanceof Blocked ? "BLOCKED" : "REFUSED", exit: e instanceof Blocked ? 3 : 2, summary: e.message });

async function suiteRun(h, args) {
  const cases = casesOf(h.root, flag(args, "suite"));
  if (!cases.length) throw new Refused(`no pack ${flag(args, "suite")} holds a case`);
  const runs = [];
  for (const c of cases) runs.push(await oneRun(h, suiteOptions(args, c)).catch(failedRun(c)));
  return { suite: flag(args, "suite"), runs, exit: Math.max(...runs.map((r) => r.exit ?? 4)) };
}

const sayOne = (r) => [`${r.case ?? "?"} ${r.variant ?? ""} ${r.run ?? ""}: ${r.outcome} (exit ${r.exit})`, `  ${r.summary ?? ""}`, ...(r.leaks?.length ? [`  LEAK      the credential was found in ${r.leaks.length} file(s) of the run's room, and masked (leaks.json)`] : []), ...(r.report ? [`  report    ${r.report}`, `  evidence  ${r.evidence}`, `  task      ${r.task} (node cli/task.mjs show ${r.task})`] : [])].join("\n");

const sayRun = (r) => (r.runs ? r.runs.map(sayOne).join("\n") : sayOne(r));

// ---- a run, afterwards ----------------------------------------------------------------------------------------------------

const stepsFor = (room, view) => Object.fromEntries((view.actions ?? []).map((a) => [a.id, docRead(room, `steps/${a.id}.json`)]).filter(([, d]) => d));

function reportWritten(room, manifest, view) {
  const rep = reportOf(room, manifest, view, stepsFor(room, view), docRead(room, "ending.json"), docRead(room, "leaks.json"));
  docWritten(room, "report.json", rep.json);
  room.io.write(room.at("report.md"), rep.md);
  return rep;
}

const kept = (h, args) => ((ctx) => ({ ctx, view: ctx.rec.show(ctx.task) }))(resumedRun(h, runIdOf(args)));

function report(h, args) {
  const { ctx, view } = kept(h, args);
  return { ...reportWritten(ctx.room, ctx.manifest, view), path: ctx.room.at("report.md") };
}

function status(h, args) {
  const { ctx, view } = kept(h, args);
  return { run: ctx.run.id, task: ctx.task, case: ctx.manifest.benchmark.case, variant: ctx.manifest.benchmark.variant, repair: ctx.manifest.config.repair, lifecycle: view.lifecycle, stage: view.stage, stopReason: view.stopReason, attempts: (view.attempts ?? []).map((a) => `${a.id}:${a.cause}:${a.outcome ?? "open"}${a.failureSignature ? `:${a.failureSignature}` : ""}`), budget: view.budget, running: (view.actions ?? []).filter((a) => a.state === "running").map((a) => `${a.id} ${a.type}`), ending: docRead(ctx.room, "ending.json"), evidence: ctx.room.dir };
}

const sayStatus = (r) => [`RUN        ${r.run} — ${r.case} (${r.variant}${r.repair ? ", repair" : ""})`, `TASK       ${r.task}: ${r.lifecycle} · ${r.stage ?? "no stage"}${r.stopReason ? ` · ${r.stopReason}` : ""}`, `ATTEMPTS   ${r.attempts.join("  ") || "none"}`, `BUDGET     attempts ${r.budget.attempts.spent}/${r.budget.attempts.limit} · actions ${r.budget.actions.spent}/${r.budget.actions.limit} · minutes ${r.budget.minutes.spent}/${r.budget.minutes.limit ?? "-"}`, ...(r.running.length ? [`RUNNING    ${r.running.join(", ")}`] : []), `OUTCOME    ${r.ending ? `${r.ending.outcome} — ${r.ending.summary}` : "not decided yet"}`, `EVIDENCE   ${r.evidence}`].join("\n");

async function resume(h, args) {
  const ctx = await withSpec(resumedRun(h, runIdOf(args)));
  const { deps } = dockerUp(h, "a resumed run verifies in containers too");
  resolvedImages(imageDefs(engineOf(h)), deps, { needRunner: ctx.repair, prefer: ctx.images });
  return finished(ctx);
}

const cleanedHere = (room, deps) => (docker.doctor(deps).ok ? { ...cleaned(room.id, deps), left: leftovers(room.id, deps) } : { containers: [], networks: [], clean: true, left: null, skipped: "Docker does not answer: nothing of this run can be running" });

function cleanup(h, args) {
  const room = roomOf(h.storeRoot, runIdOf(args));
  const done = cleanedHere(room, dockerDeps(h.env, null));
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

// ---- the controls: does the verifier fail what it must and pass what it must, in its own containers -------------------------

const NO_RECORD = { show: () => ({}) };

function controlsRoom(h, c, images) {
  const room = roomOf(h.storeRoot, newRunId(`${c.id}\u0000controls`));
  const where0 = whereAt(h.root, h.env);
  cpSync(c.dir, room.at("frozen", "case"), { recursive: true });
  madeCheckout(room.at("checkout"), subjectOf(frozen(where0.root, "head", h.env).entries, HARNESS).entries, `${c.id} controls subject`, h.env);
  return { room, manifest: { schema: 1, kind: "controls", run: room.id, task: null, at: new Date().toISOString(), source: { branch: where0.branch, commit: where0.commit, mode: "head" }, benchmark: { case: c.id, version: c.version, variant: "real", digest: dirDigest(room.at("frozen", "case")) }, subject: { digest: null }, images, config: { seed: 20240607, rounds: 1, usd: 0, model: null, repair: false, minutes: 60 } } };
}

async function controls(h, args) {
  const c = caseOf(h.root, words(args)[0] ?? refusedWith("name the case whose controls to run"));
  const { deps } = dockerUp(h, "the controls run the verifier's own containers");
  const made = controlsRoom(h, c, resolvedImages(imageDefs(engineOf(h)), deps, {}));
  docWritten(made.room, "manifest.json", made.manifest);
  return controlsRan(await withSpec(contextOf(h, made.room, made.manifest, NO_RECORD)), c);
}

function entriesFor(ctx, c, k) {
  const faults = c.variants[k.variant]?.faults;
  const v = faults ? mutatedEntries(ctx.baseline, mutationFile(ctx.frozenCase, faults)) : { ok: true, entries: ctx.baseline };
  const m = v.ok && k.file ? mutatedEntries(v.entries, mutationFile(ctx.frozenCase, k.file)) : v;
  return m.ok ? m.entries : refusedWith(`FIXTURE_DRIFT: control ${k.id} does not apply to this source (${m.drift.mutation} in ${m.drift.file})`);
}

async function oneControl(ctx, c, k) {
  const v = await verified(ctx, `control-${k.id}`, entriesFor(ctx, c, k), {});
  const got = !v.complete ? "INCOMPLETE" : v.failures.length ? "FAIL" : "PASS";
  return { id: k.id, variant: k.variant, expect: k.expect, got, matched: got === k.expect, summary: verificationSummary(v), digest: v.digest, attested: v.hidden.attested.every((r) => r.ok) };
}

async function controlsRan(ctx, c) {
  const rows = [];
  for (const k of c.controls) rows.push(await oneControl(ctx, c, k));
  docWritten(ctx.room, "controls.json", { case: c.id, rows });
  return { case: c.id, run: ctx.run.id, rows, exit: rows.every((r) => r.matched) ? 0 : 1 };
}

const sayControls = (r) => [`CONTROLS   ${r.case} (${r.run})`, ...r.rows.map((x) => `  ${x.matched ? "✓" : "✗"} ${x.id.padEnd(12)} expected ${x.expect.padEnd(5)} got ${x.got.padEnd(10)} ${x.summary}`)].join("\n");

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
  where: { run: where, say: sayWhere },
};
