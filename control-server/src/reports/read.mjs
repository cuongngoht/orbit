// PO Reports, read: the overview, the settings form's data, and every part a
// report could run -- standard and the project's own -- with where it came
// from, what it needs and provides, whether it is switched on, whether its
// files are the ones that were verified, and what it did the last time.
//
// Reading runs nothing: no source is asked, no part is started, and a Python is
// only asked its version. There is no route that runs a report -- a report runs
// from the skill or the CLI.
import { latestRender, planReport, readRun, registeredState, reportStatus, standardSections, versionsOf } from "../core.mjs";
import { providersView } from "../connections/providers.mjs";
import { NOT_IN_CHECKOUT, inCheckout, reportOf } from "./project.mjs";

const unavailable = () => ({ available: false, why: NOT_IN_CHECKOUT });

export async function reportsOverview(ctx) {
  if (!inCheckout(ctx)) return unavailable();
  const b = await reportOf(ctx);
  const status = reportStatus(b.rctx);
  return { available: true, project: { name: b.rctx.project.name, root: b.rctx.project.root, initialized: b.rctx.project.initialized }, provider: b.rctx.settings.provider, connection: b.rctx.connection ? b.connections.get(b.rctx.connection.id) : null, connectionMissing: Boolean(b.rctx.settings.connection && !b.rctx.connection), python: pythonOf(b.rctx), revision: b.rctx.revision, output: b.rctx.settings.output?.dir ?? `${b.rctx.reportsDir}/project-reports`, runs: status.runs.slice(0, 20), latest: latestOf(status.latest) };
}

const pythonOf = (rctx) => (rctx.python ? { ready: true, version: rctx.python.version, from: rctx.python.from } : { ready: false, reason: rctx.pythonProblem?.reason ?? "no Python 3.11 or newer was found" });

// The newest run, as far as a page needs it: its window, what was collected
// and how completely, and what its newest render ran.
function latestOf(record) {
  if (!record) return null;
  const render = latestRender(record);
  return { runId: record.runId, window: record.window, completeness: record.completeness, render: render ? { n: render.n, at: render.at, status: render.status, parts: render.parts, skipped: render.skipped, report: render.report, warning: render.warning ?? null } : null };
}

export async function reportSettings(ctx) {
  if (!inCheckout(ctx)) return unavailable();
  const b = await reportOf(ctx);
  return { available: true, settings: b.rctx.settings, revision: b.rctx.revision, exists: b.rctx.settingsExist, providers: providersView(), sections: standardSections(), connections: b.connections.list(), machineTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
}

export async function reportParts(ctx) {
  if (!inCheckout(ctx)) return unavailable();
  const b = await reportOf(ctx);
  const plan = planReport(b.rctx, {}, b.deps);
  const last = lastLines(b);
  return { available: true, revision: b.rctx.revision, standard: b.rctx.pack.parts.map((p) => partRow(p, b, last)), project: b.rctx.extensions.parts.map((p) => storeRow(ctx, p, b, last)), refused: b.rctx.extensions.refused, contested: b.rctx.extensions.contested, would: { run: [...plan.collectors.run, ...plan.computed.run].map((p) => p.id), skipped: [...plan.collectors.skipped, ...plan.computed.skipped] } };
}

// What each part did in the newest render of the newest run.
function lastLines(b) {
  const newest = reportStatus(b.rctx).runs[0];
  const render = newest ? latestRender(readRun(b.rctx.room, b.rctx.io, newest.runId)) : null;
  return new Map((render?.parts ?? []).map((p) => [p.id, { status: p.status, error: p.error ?? null, errorKind: p.errorKind ?? null, at: render.at, runId: newest.runId }]));
}

const partRow = (p, b, last) => ({ id: p.id, version: p.version, kind: p.kind, source: "builtin", from: "orbit", doc: p.doc, provides: p.provides ?? [], needs: p.needs ?? [], provider: p.provider ?? null, metrics: (p.metrics ?? []).length, enabled: b.rctx.settings.parts?.[p.id]?.enabled !== false, last: last.get(p.id) ?? null });

function storeRow(ctx, p, b, last) {
  const state = b.rctx.extensions.states[p.from] ?? {};
  const kept = { ...partRow(p, b, last), source: "store", from: p.from, replaces: p.replaces ?? null, approved: b.rctx.settings.parts?.[p.id]?.replace === true, basedOn: p.basedOn ?? [], section: p.section ?? null };
  return { ...kept, extension: { id: p.from, version: state.version ?? null, status: state.status ?? null, createdFor: state.createdFor ?? null, fingerprint: state.dir ? registeredState(state.dir, b.rctx.io).state : "absent", versions: versionsOf({ store: () => b.rctx.store.root }, p.from, b.rctx.io).map((v) => ({ name: v.name, version: v.version ?? null, at: v.at ?? null })) } };
}
