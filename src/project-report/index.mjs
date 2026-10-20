// A PROJECT REPORT, end to end:
//
//   run     window -> collect once (full pagination) -> freeze the snapshot ->
//           render it
//   render  a snapshot already frozen -> the parts, in order -> one page.
//           Calls no source: a report rendered again, after an extension was
//           added, is the same collection with one more section
//   plan    what a run WOULD do -- window, connection, runtime, which parts run
//           and which do not, and why -- touching nothing
//
// Everything a run keeps is in the project's report room in the machine store;
// the one file written elsewhere is the page, and its exports beside it.
//
// rctx is bound by a composition root (cli/project-report.mjs):
//   { project { name, key, root }, room, io, settings, connection, python,
//     extensions { parts, states, contested, refused, drafts }, pack, engine,
//     env, reportsDir, ignored(path) }
// deps: { sources, secrets, fetch, process, nowMs, entropy, log }
import { join } from "node:path";
import { Blocked } from "../errors.mjs";
import { safeName } from "../project/paths.mjs";
import { assemble } from "./assemble.mjs";
import { baselineOf } from "./baseline.mjs";
import { collect } from "./collect.mjs";
import { compose } from "./compose.mjs";
import { computeParts } from "./compute.mjs";
import { prune } from "./retention.mjs";
import { addRender, history, lastGoodRender, nextRender, readRun, writeRun } from "./runs.mjs";
import { freeze, readSnapshot, snapshotFile } from "./snapshot.mjs";
import { kitDigest, stageParts } from "./stage.mjs";
import { newRunId, runIds } from "./store.mjs";
import { periodOf } from "./window.mjs";

export const COMPUTE_PHASES = ["transform", "metric", "section", "exporter", "workflow"];

export async function runReport(rctx, request, deps) {
  const { window, runId } = begun(rctx, request, deps);
  const collected = await collect(collectContext(rctx, runId, window), deps);
  kept(rctx, runId, collected);
  return renderRun(rctx, runId, deps);
}

// Nothing is collected that could not then be computed: without a runtime for
// the standard parts a run stops before it asks the source anything.
function begun(rctx, request, deps) {
  runnable(rctx);
  return { window: periodOf(request, { now: deps.nowMs(), tz: rctx.settings.timezone, months: rctx.settings.period?.months }), runId: newRunId(deps.nowMs(), deps.entropy()) };
}

function runnable(rctx) {
  if (!rctx.python) throw new Blocked(`no Python ${rctx.pack.pythonRequires ?? ">=3.11"} is available for the report's computations — install it in Orbit Control → Tools → Python (a private copy, shared by every project; nothing on this machine's PATH changes), or set ORBIT_PYTHON to one you already have`);
}

function collectContext(rctx, runId, window) {
  const staged = stageParts(candidatesOf(rctx), rctx.extensions.states, join(rctx.room.run(runId), "collect", "stage"), rctx.io);
  const kit = kitDigest(rctx.pack.kitDir, rctx.io);
  return { ...rctx, root: rctx.project.root, runId, window, parts: staged.parts, facts: factsOf(rctx, staged, []), entryOf: staged.entryOf, settingsOf: settingsOf(rctx), kitChanged: () => kitDigest(rctx.pack.kitDir, rctx.io) !== kit };
}

function kept(rctx, runId, collected) {
  freeze({ room: rctx.room, io: rctx.io, id: runId, snapshot: collected.snapshot, raw: collected.raw, secrets: collected.secrets });
  const s = collected.snapshot;
  return writeRun(rctx.room, rctx.io, { runId, createdAt: s.run.createdAt, project: s.project, source: s.source, identity: s.source.identity, window: s.window, completeness: statusesOf(s.completeness), collectors: s.parts, renders: [] });
}

const statusesOf = (c) => Object.fromEntries(Object.entries(c ?? {}).map(([k, v]) => [k, { status: v.status, reason: v.reason ?? null, items: v.items ?? null }]));

// ---- render ------------------------------------------------------------------

export async function renderRun(rctx, runId, deps) {
  const snapshot = (runnable(rctx), readSnapshot(rctx.room, rctx.io, runId));
  const unit = renderUnit(rctx, runId, nextRender(rctx.room, rctx.io, runId), snapshot);
  const plan = compose(unit.parts, factsOf(rctx, unit, baseOf(snapshot)));
  const state = await computeParts(plan.run, unit, partDeps(rctx, deps));
  return finished(rctx, { runId, snapshot, unit, plan, state }, deps);
}

function renderUnit(rctx, runId, n, snapshot) {
  const dir = rctx.room.render(runId, n);
  const staged = stageParts(candidatesOf(rctx), rctx.extensions.states, join(dir, "stage"), rctx.io);
  const kit = kitDigest(rctx.pack.kitDir, rctx.io);
  return { ...staged, n, dir, kit, runId, snapshot, snapshotFile: snapshotFile(rctx.room, runId), settingsOf: settingsOf(rctx), kitChanged: () => kitDigest(rctx.pack.kitDir, rctx.io) !== kit };
}

const candidatesOf = (rctx) => [...rctx.pack.parts, ...rctx.extensions.parts.map((p) => ({ ...p, source: "store" }))];

// What composition is decided over. An extension's fingerprint is the one its
// STAGED copy earned (src/project-report/stage.mjs), never the store's word.
function factsOf(rctx, staged, base) {
  const extensions = Object.fromEntries(Object.entries(rctx.extensions.states).map(([id, s]) => [id, { status: s.status, fingerprint: staged.extensions?.[id]?.fingerprint ?? "absent" }]));
  return { provider: rctx.settings.provider, base: [...base, ...(rctx.settings.docs?.path ? ["report.docs"] : [])], runtimes: rctx.python ? { python: { version: rctx.python.version } } : {}, extensions, contested: rctx.extensions.contested ?? [], settings: rctx.settings, phases: COMPUTE_PHASES, sections: rctx.pack.sections };
}

// What a snapshot offers a part: every collection it has a word about.
const baseOf = (snapshot) => [...new Set([...Object.keys(snapshot.completeness ?? {}), ...Object.keys(snapshot.collections ?? {})])].map((n) => `report.collection.${n}`);

// A part is handed the project's mapping and assumptions, and its own config.
const settingsOf = (rctx) => (part) => ({ mapping: rctx.settings.mapping ?? {}, assumptions: rctx.settings.assumptions ?? {}, part: rctx.settings.parts?.[part.id]?.config ?? {} });

const partDeps = (rctx, deps) => ({ process: deps.process, python: rctx.python?.file, shim: rctx.pack.shim, env: rctx.env, io: rctx.io, secrets: [], nowMs: deps.nowMs });

// ---- finishing: assemble, render, publish, record ---------------------------------

async function finished(rctx, r, deps) {
  const input = inputOf(rctx, r, deps);
  const published = publish(rctx, r, rctx.pack.render(input), r.state.results);
  const line = renderLine(rctx, r, input, published, deps);
  addRender(rctx.room, rctx.io, r.runId, line);
  return { runId: r.runId, ...line, window: r.snapshot.window, completeness: r.snapshot.completeness, pruned: prune(rctx.room, rctx.io, runIds(rctx.room, rctx.io), { keep: rctx.settings.retention ?? 20, protect: [r.runId, input.baseline?.previous?.runId].filter(Boolean) }) };
}

function inputOf(rctx, r, deps) {
  const assembled = assemble(r.state.results, r.plan, { createdFor: Object.fromEntries(Object.entries(rctx.extensions.states).map(([id, s]) => [id, s.createdFor ?? null])) });
  const baseline = baselineOf({ runId: r.runId, identity: r.snapshot.source.identity, window: r.snapshot.window, metrics: assembled.metrics }, history(rctx.room, rctx.io).map((rec) => ({ ...rec, render: lastGoodRender(rec) })));
  return { project: { name: rctx.project.name, key: rctx.project.key }, snapshot: r.snapshot, ...assembled, baseline, sections: rctx.pack.sections, sectionsEnabled: rctx.settings.sections ?? {}, drafts: rctx.extensions.drafts ?? [], refused: rctx.extensions.refused ?? [], runId: r.runId, render: r.unit.n, engine: rctx.engine, kit: rctx.pack.kitVersion, generatedAt: new Date(deps.nowMs()).toISOString(), providerLabel: rctx.pack.providers.find((p) => p.id === r.snapshot.source.provider)?.label };
}

// The page into the render's own directory, and a copy where the project reads
// its reports -- with each exporter's files beside it, prefixed by its name.
// The copy outside the store goes through `outputIo`: the store's own io is
// held inside the store, and a report is the one thing that leaves it.
function publish(rctx, r, page, results) {
  rctx.io.write(join(r.unit.dir, "report.html"), page);
  const out = rctx.settings.output?.dir ?? join(rctx.reportsDir, "project-reports");
  const base = `${safeName(rctx.project.name)}-${r.snapshot.window.from ?? "start"}_${r.snapshot.window.to}-${r.runId}${r.unit.n > 1 ? `-r${r.unit.n}` : ""}`;
  const report = (rctx.outputIo ?? rctx.io).write(join(out, `${base}.html`), page);
  return { report, exports: results.flatMap((x) => x.outcome.exports ?? []).map((e) => copiedExport(rctx.outputIo ?? rctx.io, e, join(out, `${base}.${e.name}`))), warning: rctx.ignored?.(report) === false ? `${report} is inside the repository and not ignored by Git; it holds the project's data -- keep it out of commits` : null };
}

function copiedExport(io, e, to) {
  io.copy(e.file, to);
  return to;
}

// RENDER STATUS: failed when the standard model is missing, degraded when any
// part failed or any collection is less than complete, else ok.
const STATUS = [
  { when: (input) => Boolean(input.modelProblem), is: "failed" },
  { when: (input, r) => r.state.results.some((x) => !x.outcome.ok && x.outcome.status !== "unavailable") || Object.values(r.snapshot.completeness ?? {}).some((c) => !["complete", "not-configured"].includes(c.status)), is: "degraded" },
  { when: () => true, is: "ok" },
];

function renderLine(rctx, r, input, published, deps) {
  const status = STATUS.find((s) => s.when(input, r)).is;
  return { n: r.unit.n, at: new Date(deps.nowMs()).toISOString(), status, parts: input.parts, skipped: input.skipped, extensions: Object.entries(r.unit.extensions).map(([id, e]) => ({ id, digest: e.digest, fingerprint: e.fingerprint })), metrics: input.metrics.map(metricLine), baseline: input.baseline?.previous?.runId ?? null, report: published.report, exports: published.exports, warning: published.warning, engine: rctx.engine, kit: rctx.pack.kitVersion, kitDigest: r.unit.kit };
}

const metricLine = (m) => ({ id: m.id, version: m.version, label: m.label, unit: m.unit, value: typeof m.value === "number" ? m.value : null, compare: m.compare ?? "rate", direction: m.direction ?? null });

// ---- plan: what a run would do, touching nothing -------------------------------

export function planReport(rctx, request, deps) {
  const window = periodOf(request, { now: deps.nowMs(), tz: rctx.settings.timezone, months: rctx.settings.period?.months });
  const facts = factsOf(rctx, { extensions: planned(rctx) }, []);
  const collectors = compose(candidatesOf(rctx).filter((p) => p.kind === "collector"), { ...facts, phases: ["collector"], base: [...facts.base, ...(rctx.connection ? ["source.read"] : [])] });
  const computed = compose(candidatesOf(rctx), { ...facts, base: collectors.run.flatMap((p) => p.provides ?? []) });
  return { window, provider: rctx.settings.provider, connection: rctx.connection?.id ?? null, python: rctx.python, collectors, computed };
}

// A plan does not copy anything, so it reads each extension's state off the
// store itself -- the run judges the copy again.
const planned = (rctx) => Object.fromEntries(Object.entries(rctx.extensions.states).map(([id, s]) => [id, { fingerprint: s.fingerprint ?? "absent" }]));

// ---- status ---------------------------------------------------------------------

export function reportStatus(rctx) {
  const runs = history(rctx.room, rctx.io);
  return { project: rctx.project, provider: rctx.settings.provider, connection: rctx.connection?.id ?? null, python: rctx.python, runs: runs.map(runLine), latest: runs[0] ? readRun(rctx.room, rctx.io, runs[0].runId) : null };
}

const runLine = (r) => ({ runId: r.runId, window: r.window ? { from: r.window.from, to: r.window.to, cutoff: r.window.cutoff, mode: r.window.mode } : null, renders: (r.renders ?? []).length, status: [...(r.renders ?? [])].sort((a, b) => b.n - a.n)[0]?.status ?? (r.unreadable ? "unreadable" : "collected"), report: [...(r.renders ?? [])].sort((a, b) => b.n - a.n)[0]?.report ?? null });
