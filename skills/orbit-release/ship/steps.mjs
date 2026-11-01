// THE SHIP'S STEPS: what each row of NEXT does -- one action through the task's door, its document in the ship's room
// written before it runs and replaced whole once it settles -- and the loop that asks NEXT again after every step. A
// step never decides what comes next; NEXT does, from the journal. Only the steps that END a ship return a result.
//
//   driven(ctx) -> result        STEPS        preflightFacts(ctx) -> facts
//   result: { ship, task, outcome, exit, summary, evidence?, delivery? }
//   exit: 0 SHIPPABLE · 2 NOT_SHIPPABLE · 3 BLOCKED (resumable) · 4 a person held it
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sha } from "../../../src/hash.mjs";
import { GATES, report, shippable } from "../gates.mjs";
import { built } from "./artifact.mjs";
import { begun, carriedOn, dispatched, iso, settledAct } from "./dispatch.mjs";
import { evidenceOf } from "./evidence.mjs";
import { diags, factsOf, nextOf, repairIn } from "./machine.mjs";
import { catalogDrift, matchesAny, rowsOf } from "./policy.mjs";
import { hostOf, preflightOf } from "./preflight.mjs";
import { docRead, docWritten, jsonAtFile } from "./room.mjs";
import { delivered, integrated, prepared, pristine } from "./workspace.mjs";

const short = (c) => String(c ?? "").slice(0, 12);

function staged(ctx, f, stage, because) {
  if (f.view.stage !== stage) ctx.door.stage(ctx.task, stage, because);
  ctx.print?.(`${because}`);
}

// ---- how a ship ends ----------------------------------------------------------------------------------------------------

// The ending is written into the room before the journal is told, as a run's is: a person reads it, and `--status` and
// `--evidence` say it.
function ended(ctx, e) {
  docWritten(ctx.room, "ending.json", { ...e, at: iso(ctx) });
  return { ship: ctx.ship.id, task: ctx.task, room: ctx.room.dir, ...e };
}

const failSignature = (f) => sha([...f.rows.values()].filter((r) => r.v.state !== "HELD").map((r) => `${r.row.id}:${r.v.code}`).sort().join("\n")).slice(0, 12);

function closeAttempt(ctx, f, outcome) {
  if (f.open) ctx.door.attemptComplete(ctx.task, outcome, outcome === "failed" ? failSignature(f) : undefined);
}

// Why a ship stops, said once: the first thing NEXT saw that keeps it from shipping.
const STOP_REASONS = [
  { when: (f) => f.cycle && f.cycle.artifact.refused.length > 0, says: (f) => `the release artifact is one a host refuses: ${f.cycle.artifact.refused.join("; ")}` },
  { when: (f) => f.gates && !f.gates.ok, says: (f) => `the definition of done does not hold on ${short(f.cycle.commit)}: ${f.gates.rows.filter((g) => !g.ok).map((g) => `${g.name} — ${g.detail}`).join("; ")}` },
  { when: (f) => diags(f, "STOP").length > 0, says: (f) => diags(f, "STOP").map((r) => r.diag.says).join(" · ") },
  { when: (f) => Boolean(repairIn(f, "SPENT")), says: (f) => `${repairIn(f, "SPENT").case}: no repair attempt is left (${f.limits.repairAttempts}) and none was verified` },
  { when: () => true, says: () => "nothing the ship knows how to go on with" },
];

const BLOCK_REASONS = [
  { when: (f) => f.host && !f.host.ok, says: (f) => `${f.host.code}: ${f.host.says}`, needs: () => "environment" },
  { when: (f) => diags(f, "HELD").length > 0, says: (f) => `${diags(f, "HELD").map((r) => r.row.id).join(", ")}: a person holds the benchmark run in Orbit Control -- resume it there, then resume the ship`, needs: () => "person" },
  { when: (f) => diags(f, "BLOCK").length > 0, says: (f) => diags(f, "BLOCK").map((r) => r.diag.says).join(" · "), needs: () => "environment" },
  { when: (f) => Boolean(repairIn(f, "BLOCKED")), says: (f) => `${repairIn(f, "BLOCKED").case}: the repair could not run -- ${repairIn(f, "BLOCKED").last.settled.verdict.says}`, needs: () => "environment" },
  { when: () => true, says: (f, ctx) => ctx.blockedBy ?? "the environment", needs: () => "environment" },
];

const said = (table, f, ctx) => table.find((r) => r.when(f, ctx));

function stopped(ctx, f) {
  const says = said(STOP_REASONS, f, ctx).says(f, ctx);
  closeAttempt(ctx, f, "failed");
  ctx.door.fail(ctx.task, "VERIFICATION_FAILED", `NOT SHIPPABLE: ${says}`);
  return ended(ctx, { outcome: "NOT_SHIPPABLE", exit: 2, summary: says });
}

function blocked(ctx, f, row = said(BLOCK_REASONS, f, ctx)) {
  const says = row.says(f, ctx);
  ctx.door.block(ctx.task, "ENVIRONMENT_BLOCKED", row.needs(), `BLOCKED: ${says}`);
  return ended(ctx, { outcome: "BLOCKED", exit: 3, summary: says, needs: row.needs() });
}

function budget(ctx, f) {
  const says = f.spent.minutes >= f.limits.minutes ? `${f.spent.minutes} of ${f.limits.minutes} minutes spent` : f.limits.usd - f.spent.usd < 1 ? `${f.spent.usd} of ${f.limits.usd} USD spent` : `${f.attempts} of ${f.limits.cycles} cycles run`;
  ctx.door.block(ctx.task, "BUDGET_EXHAUSTED", "person", `BUDGET_EXHAUSTED: ${says} -- the evidence is kept; ship.mjs --resume=${ctx.ship.id} with a higher limit goes on`);
  return ended(ctx, { outcome: "BUDGET_EXHAUSTED", exit: 3, summary: says, needs: "person" });
}

function noProgress(ctx, f) {
  const r = repairIn(f, "NO_PROGRESS");
  closeAttempt(ctx, f, "failed");
  ctx.door.fail(ctx.task, "NO_PROGRESS", `NO_PROGRESS: ${r.case} fails as it failed before`);
  return ended(ctx, { outcome: "NO_PROGRESS", exit: 2, summary: `${r.case} fails exactly as it failed before, after ${r.attempts} repair attempt(s) and what was integrated` });
}

const held = (ctx, f) => ({ ship: ctx.ship.id, task: ctx.task, room: ctx.room.dir, outcome: f.view.lifecycle, exit: 4, summary: f.view.lifecycle === "PAUSED" ? `a person paused the ship: resume it in Orbit Control, then node skills/orbit-release/ship.mjs --resume=${ctx.ship.id}` : "a person cancelled the ship" });

const endedAlready = (ctx, f) => ({ ship: ctx.ship.id, task: ctx.task, room: ctx.room.dir, ...(docRead(ctx.room, "ending.json") ?? { outcome: f.view.lifecycle, exit: 4, summary: f.view.lifecycle }) });

// ---- preflight and the workspace ----------------------------------------------------------------------------------------

// What PREFLIGHT is asked over: the checkout's own git (which protected path has uncommitted changes), the
// benchmark's list and doctor, and which credential NAMES are set -- never a value.
export async function preflightFacts(ctx) {
  const listed = await ctx.world.bench(["list"], {});
  const doctor = await ctx.world.bench(["doctor"], {});
  const dirty = String(ctx.world.git(ctx.root, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]).out ?? "").split("\u0000").filter(Boolean).map((l) => l.slice(3));
  return { harness: existsSync(join(ctx.root, "benchmark", "run.mjs")), node: Number(process.versions.node.split(".")[0]), protectedDirty: dirty.filter((p) => matchesAny(ctx.policy.protected, p)), listed: listed.json ?? null, listErr: listed.err, drift: listed.json ? catalogDrift(ctx.policy, listed.json) : [], doctor: doctor.json, env: ctx.env, policy: ctx.policy };
}

// The catalog a held preflight read, as the rows every cycle runs and each case's own declaration (its limits, its
// baseline, what it calls repairable, its scope) -- read from the case's file, never imported.
function catalogued(ctx, facts) {
  ctx.rows = rowsOf(ctx.policy, facts.listed);
  ctx.cases = new Map((facts.listed?.suites ?? []).flatMap((s) => s.cases.map((c) => [c.id, jsonAtFile(join(ctx.root, "benchmark", "suites", s.id, c.id.toLowerCase(), "case.json"))])));
  ctx.preflighted = true;
  return null;
}

async function preflight(ctx, f) {
  staged(ctx, f, "ENVIRONMENT", "PREFLIGHT  Docker, the harness, the catalog, the coding host's credential by name");
  const act = begun(ctx, "release.preflight", "preflight: Docker, harness, catalog, credential", {});
  return preflightSettled(ctx, act, await ctx.preflightFacts(ctx));
}

function preflightSettled(ctx, act, facts) {
  const p = preflightOf(facts);
  settledAct(ctx, act, {}, p, { outcome: p.ok ? "succeeded" : "failed", summary: `${p.code}: ${p.says}` });
  return p.ok ? catalogued(ctx, facts) : preflightBlocked(ctx, p);
}

function preflightBlocked(ctx, p) {
  ctx.door.block(ctx.task, "ENVIRONMENT_BLOCKED", p.state === "REFUSED" ? "person" : "environment", `${p.code}: ${p.says}`);
  return ended(ctx, { outcome: p.state, code: p.code, exit: p.state === "REFUSED" ? 2 : 3, summary: p.says });
}

function workspace(ctx, f) {
  staged(ctx, f, "WORKSPACE", `WORKSPACE  the ship's own workspace at ${short(ctx.manifest.start.commit)}, in the machine store`);
  const act = begun(ctx, "release.workspace", "the release workspace, a clone in the machine store", {});
  const w = prepared(ctx.world, ctx.ship);
  settledAct(ctx, act, {}, { path: w.path, id: w.id, baseRevision: w.baseRevision }, { outcome: "succeeded", summary: `workspace ${w.id} at ${short(w.baseRevision)}` });
  return null;
}

// ---- a cycle -----------------------------------------------------------------------------------------------------------

function cycle(ctx, f) {
  ctx.door.attemptStart(ctx.task, f.attempts === 0 ? "fresh" : "retest");
  staged(ctx, f, "BUILDING", `${f.attempts === 0 ? "BUILD" : "REBUILD"}  cycle ${f.attempts + 1} on ${short(f.current.commit)}: the release artifact and every benchmark image, fresh`);
  return null;
}

// A release commit's own checkout: from the person's checkout for the commit the ship began from, else from the
// delivery the integration made it in.
const sourceOf = (ctx, commit) => (commit === ctx.manifest.start.commit ? ctx.root : ctx.deliveryDir);

const treeIdOf = (ctx, tree) => String(ctx.world.git(tree, ["rev-parse", "HEAD^{tree}"]).out ?? "").trim();

async function build(ctx, f) {
  const commit = f.current.commit;
  const act = begun(ctx, "release.build", `${f.attempts > 1 ? "rebuild" : "build"} ${short(commit)}: artifact and images`, { attempt: f.open.id, commit });
  const tree = f.current.tree ?? pristine(ctx.world, ctx.room, commit, sourceOf(ctx, commit));
  const artifact = built(ctx.world, ctx.room, tree, commit);
  return builtImages(ctx, f, { act, commit, tree, artifact, images: await ctx.world.bench(["build", "--rebuild", ...(ctx.options.caFile ? [`--ca-file=${ctx.options.caFile}`] : [])], {}) });
}

function builtImages(ctx, f, b) {
  const ok = b.images.code === 0 && Boolean(b.images.json?.images);
  ctx.door.receipt(ctx.task, { domain: "check", ref: `artifact-${b.artifact.sha256.slice(0, 12)}`, outcome: b.artifact.refused.length ? "REFUSED" : "BUILT", summary: `${b.artifact.file} sha256 ${b.artifact.sha256}`, action: b.act });
  settledAct(ctx, b.act, { attempt: f.open.id, commit: b.commit }, { attempt: f.open.id, n: f.attempts, commit: b.commit, tree: b.tree, treeId: treeIdOf(ctx, b.tree), artifact: b.artifact, images: b.images.json?.images ?? null, ok }, { outcome: ok ? "succeeded" : "failed", receipt: `check:artifact-${b.artifact.sha256.slice(0, 12)}`, summary: ok ? `artifact ${b.artifact.sha256.slice(0, 12)}, ${b.images.json.images.length} image(s) rebuilt` : `the images could not be built: ${b.images.err ?? "no answer"}` });
  return ok ? null : blocked(ctx, f, { says: () => `the benchmark images could not be built: ${b.images.err ?? "no answer"}`, needs: () => "environment" });
}

async function host(ctx, f) {
  const act = begun(ctx, "release.host", "the coding host: the runner image's Claude Code, asked one question", { attempt: f.open.id });
  const r = await ctx.world.bench(["doctor", "--host", ...(ctx.options.model ? [`--model=${ctx.options.model}`] : []), ...(ctx.options.credential ? [`--credential=${ctx.options.credential}`] : []), ...(ctx.options.caFile ? [`--ca-file=${ctx.options.caFile}`] : [])], {});
  const h = hostOf(r.json?.host ?? null);
  settledAct(ctx, act, { attempt: f.open.id }, { attempt: f.open.id, ...h, probe: r.json?.host ?? null, cost: { usd: r.json?.host?.costUsd ?? 0, basis: "REPORTED" } }, { outcome: h.ok ? "succeeded" : "failed", summary: `${h.code}: ${h.says}` });
  return null;
}

function gates(ctx, f) {
  staged(ctx, f, f.attempts > 1 ? "REGRESSION" : "TESTING", `${f.attempts > 1 ? "FULL_RETEST" : "BENCHMARK"}  cycle ${f.attempts} on ${short(f.cycle.commit)}: the definition of done, then every row of the catalog`);
  const act = begun(ctx, "release.gates", `the definition of done on ${short(f.cycle.commit)}`, { attempt: f.open.id });
  const rows = report(ctx.world.gatesAt(f.cycle.tree), GATES);
  settledAct(ctx, act, { attempt: f.open.id }, { attempt: f.open.id, ok: shippable(rows), rows }, { outcome: shippable(rows) ? "succeeded" : "failed", summary: `${rows.filter((r) => r.ok).length}/${rows.length} gates held` });
  return null;
}

// What a model-carried row may spend: the case's own cap, never more than the ship has left.
const usdFor = (ctx, f, row) => (row.run === "verify" || row.run === "controls" ? 0 : Math.min(ctx.cases.get(row.case)?.limits?.usd ?? 20, Math.max(1, Math.floor((f.limits.usd - f.spent.usd) * 100) / 100)));

async function row(ctx, f) {
  const r = f.pending;
  ctx.print?.(`  ${r.id.padEnd(30)} ${r.run}${r.autonomous ? " (Claude Code)" : ""} on ${short(f.cycle.commit)} …`);
  const done = await dispatched(ctx, f, r, { kind: "row", tree: f.cycle.tree, commit: f.cycle.commit, usd: usdFor(ctx, f, r), label: `${r.id} on ${short(f.cycle.commit)}` });
  ctx.print?.(done.settled ? `  ${r.id.padEnd(30)} ${done.verdict.state} — ${done.verdict.says}` : `  ${r.id.padEnd(30)} held by a person: carried on by resume`);
  return null;
}

// ---- repair ------------------------------------------------------------------------------------------------------------

// DIAGNOSE said repairable; the ship says so in its journal once (DIAGNOSING), then repairs (FIXING).
function repairStaged(ctx, f) {
  if (f.view.stage !== "FIXING") ctx.door.decide(ctx.task, { observed: `${diags(f, "REPAIR").length} row(s) fail on the real source`, hypothesis: `${diags(f, "REPAIR").map((x) => `${x.row.case} (${x.v.cause})`).join(", ")}: repairable, as each case declares`, next: "repair" });
  staged(ctx, f, "FIXING", `DIAGNOSE  ${diags(f, "REPAIR").map((x) => x.row.case).join(", ")}: repairable on the real source -- REPAIR through the benchmark's own repair path, Claude Code in the runner`);
}

// A repair runs on the NEWEST release commit: a case repaired after another is repaired on top of it.
const newestTree = (f) => (f.current.commit === f.cycle.commit ? f.cycle.tree : f.current.tree);

async function repair(ctx, f) {
  const r = repairIn(f, "TO_REPAIR");
  repairStaged(ctx, f);
  const done = await dispatched(ctx, f, r.row, { kind: "repair", tree: newestTree(f), commit: f.current.commit, workspace: f.workspace.path, usd: usdFor(ctx, f, { ...r.row, run: "repair" }), label: `${r.case}: repair ${r.attempts + 1} on ${short(f.current.commit)}` });
  ctx.print?.(done.settled ? `  ${r.case.padEnd(30)} repair ${done.verdict.state} — ${done.verdict.says}` : `  ${r.case.padEnd(30)} repair held by a person`);
  return null;
}

function integrate(ctx, f) {
  const r = repairIn(f, "VERIFIED");
  staged(ctx, f, "REVIEWING", `INTEGRATE  ${r.case}: the independently verified patch into the ship's own workspace (never your checkout)`);
  const act = begun(ctx, "release.integrate", `${r.case}: the verified patch, into the release workspace`, { attempt: f.open.id, case: r.case });
  const commit = integrated(ctx.world, ctx.ship, f.workspace.path, r.last.settled.patch.file, `release(ship): ${r.case} repaired through the benchmark (${r.last.settled.verdict.run}), verified independently\n\nShip ${ctx.ship.id}.`);
  return integratedAt(ctx, f, { act, r, commit, tree: pristine(ctx.world, ctx.room, commit, ctx.deliveryDir) });
}

function integratedAt(ctx, f, x) {
  for (const t of x.r.last.settled.verdict.touched ?? []) ctx.door.file(ctx.task, { path: t.path, change: t.existed ? "modified" : "added" });
  ctx.door.receipt(ctx.task, { domain: "commit", ref: x.commit, outcome: "COMMITTED", summary: `the release commit with ${x.r.case}'s verified repair, in the ship's own workspace`, action: x.act });
  settledAct(ctx, x.act, { attempt: f.open.id, case: x.r.case }, { attempt: f.open.id, case: x.r.case, commit: x.commit, tree: x.tree, run: x.r.last.settled.verdict.run, patchDigest: x.r.last.settled.patch.digest, paths: (x.r.last.settled.verdict.touched ?? []).map((t) => t.path) }, { outcome: "succeeded", receipt: `commit:${x.commit}`, summary: `${x.r.case} integrated: ${short(x.commit)}` });
  return null;
}

function close(ctx, f) {
  closeAttempt(ctx, f, "failed");
  ctx.print?.(`REBUILD  every repair of cycle ${f.attempts} is integrated: the evidence of ${short(f.cycle.commit)} is invalid; the next cycle is a full retest of ${short(f.current.commit)}`);
  return null;
}

// ---- shippable ---------------------------------------------------------------------------------------------------------

function ship(ctx, f) {
  const act = begun(ctx, "release.evidence", `SHIPPABLE: the evidence for ${short(f.cycle.commit)}`, { attempt: f.open.id });
  const delivery = f.cycle.commit !== ctx.manifest.start.commit ? delivered(ctx.world, ctx.room, f.cycle.tree, ctx.manifest.start.commit) : null;
  const ev = evidenceOf(ctx, f, delivery);
  docWritten(ctx.room, "evidence.json", ev);
  return shipped(ctx, f, { act, ev, delivery });
}

function shipped(ctx, f, s) {
  ctx.door.receipt(ctx.task, { domain: "check", ref: `evidence-${sha(JSON.stringify(s.ev)).slice(0, 12)}`, outcome: "SHIPPABLE", summary: `${ctx.room.at("evidence.json")}`, action: s.act });
  settledAct(ctx, s.act, { attempt: f.open.id }, { attempt: f.open.id, evidence: ctx.room.at("evidence.json"), ok: true }, { outcome: "succeeded", receipt: `check:evidence-${sha(JSON.stringify(s.ev)).slice(0, 12)}`, summary: `SHIPPABLE ${short(f.cycle.commit)}` });
  closeAttempt(ctx, f, "succeeded");
  ctx.door.complete(ctx.task, `SHIPPABLE: ${short(f.cycle.commit)}, ${s.ev.rows.length} rows held, artifact ${s.ev.artifact.sha256.slice(0, 12)}${s.delivery ? ` -- repairs to apply: ${s.delivery.patch}` : ""}`);
  return ended(ctx, { outcome: "SHIPPABLE", exit: 0, summary: `every row of the catalog held on ${short(f.cycle.commit)}${s.delivery ? ", with repairs this ship integrated -- apply them to your branch" : ""}`, evidence: ctx.room.at("evidence.json"), delivery: s.delivery });
}

// ---- reconcile ---------------------------------------------------------------------------------------------------------

async function reconcile(ctx, f) {
  for (const x of f.running) await carriedOn(ctx, f, x);
  return null;
}

// ---- the table and the loop ----------------------------------------------------------------------------------------------

export const STEPS = { END: endedAlready, HELD: held, RECONCILE: reconcile, PREFLIGHT: preflight, WORKSPACE: workspace, BUDGET: budget, CLOSE: close, CYCLE: cycle, BUILD: build, HOST: host, GATES: gates, ROW: row, REPAIR: repair, INTEGRATE: integrate, SHIP: ship, STOP: stopped, BLOCK: blocked, NO_PROGRESS: noProgress };

async function stepped(ctx) {
  const f = factsOf(ctx, ctx.door.show(ctx.task));
  const n = nextOf(f, ctx);
  ctx.trail?.push(n.id);
  return STEPS[n.step](ctx, f);
}

export async function driven(ctx) {
  for (let done = null; ; ) if ((done = await stepped(ctx))) return done;
}
