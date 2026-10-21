// The SECURITY AUDITOR's commands, as one table both the terminal (cli/security-audit.mjs) and
// Orbit Control read (ADR 0040), so the two can never disagree about what a catalog says.
//
// `p` is what the composition root binds: `io`, `rooms` (store.mjs securityRooms), `shippedDir` (the
// catalogs Orbit ships), `graph()` and `scopeDigest()` (the System Graph, or null), `results(args)`
// (the evidence, with `resultsSource` saying where it came from: "owner" only when an owner's record
// was read back, else "reported"), `now()` and `door`. Reading commands change nothing; ADOPT, ENABLE
// and MARK change a person's choices, and the store refuses them unless `door` is Control's.
import { Refused } from "../../errors.mjs";
import { CONTROL_ROLES } from "../obligations/contract.mjs";
import { applicabilityOf } from "./applicability.mjs";
import { assessmentFreshness, assessmentOf, obligationFreshness, obligationsInEffect } from "./assessment.mjs";
import { effectiveCatalogs, markOf } from "./catalog.mjs";
import { adoptCatalog, enableCatalogs, keepAssessment, layersFrom, markControl, readAssessment, readIndex, readProjectSecurity } from "./store.mjs";

const flag = (args, name) => (args.find((a) => a.startsWith(`--${name}=`)) ?? "").slice(name.length + 3) || null;

export function stateOf(p) {
  const layers = layersFrom(p.io, p.rooms, p.shippedDir);
  const project = readProjectSecurity(p.io, p.rooms);
  return { layers, project, effective: effectiveCatalogs(layers, project.settings) };
}

const listed = (c) => ({ catalog: c.catalog, version: c.version, title: c.title, digest: c.digest, controls: c.doc.controls.length, ...(c.doc.default === true ? { default: true } : {}) });

const indexOf = (p) => {
  try { return readIndex(p.io, p.rooms); }
  catch (e) { return { adopted: [], revision: null, unreadable: e.message }; }
};

function catalogsView(p) {
  const s = stateOf(p);
  const index = indexOf(p);
  const effective = { by: s.effective.by, catalogs: s.effective.catalogs.map((c) => ({ catalog: c.catalog, version: c.version, digest: c.digest, layer: c.layer, filter: c.filter, controls: c.controls.length })), missing: s.effective.missing };
  return { shipped: s.layers.catalogs.filter((c) => c.layer === "shipped").map(listed), adopted: s.layers.catalogs.filter((c) => c.layer === "adopted").map(listed), refused: s.layers.refused, index: { revision: index.revision, sources: index.adopted, unreadable: index.unreadable ?? null }, project: { available: s.project.project, revision: s.project.revision, enabled: s.project.settings.enabled, notApplicable: s.project.settings.notApplicable, effective } };
}

function applicabilityView(p) {
  const s = stateOf(p);
  const graph = p.graph();
  const rows = s.effective.catalogs.flatMap((e) => e.controls.map((c) => ({ catalog: e.catalog, control: c.id, group: c.group ?? null, level: c.level ?? null, applicability: applicabilityOf(c, graph, markOf(s.project.settings, e.catalog, c.id)) })));
  return { graph: { present: Boolean(graph), complete: graph?.complete === true, scopeDigest: p.scopeDigest() }, by: s.effective.by, rows, counts: rows.reduce((n, r) => ({ ...n, [r.applicability.state]: (n[r.applicability.state] ?? 0) + 1 }), {}) };
}

function planView(p) {
  const s = stateOf(p);
  const obligations = obligationsInEffect({ effective: s.effective, graph: p.graph(), settings: s.project.settings });
  return { by: s.effective.by, catalogs: s.effective.catalogs.map((c) => ({ catalog: c.catalog, version: c.version, digest: c.digest })), obligations: obligations.map((o) => ({ ...o, freshness: obligationFreshness(o, s.effective) })), missing: s.effective.missing };
}

// The evidence a result file may carry -- each a verification outcome for one control role of one
// control. Where it came from is the composition root's word, never the file's.
const RESULT_RULES = [
  (r) => (typeof r?.catalog === "string" && typeof r?.control === "string" ? [] : ["a result names its catalog and its control"]),
  (r) => (CONTROL_ROLES.includes(r?.role) ? [] : [`role is one of ${CONTROL_ROLES.join(", ")}`]),
  (r) => (r?.outcome === undefined || r?.outcome === null || /^[A-Z_]{3,40}$/.test(String(r.outcome)) ? [] : ["outcome is a verification outcome's id"]),
];

function evidenceOf(p, args) {
  const list = p.results(args);
  if (!Array.isArray(list)) throw new Refused("the results are a list of { catalog, control, role, outcome, … } — one per control role");
  const wrong = list.flatMap((r, i) => RESULT_RULES.flatMap((rule) => rule(r)).map((w) => `results[${i + 1}]: ${w}`));
  if (wrong.length) throw new Refused(`the results do not hold: ${wrong.slice(0, 8).join("; ")}`);
  return list.map((r) => ({ ...r, source: p.resultsSource }));
}

function assessed(p, args) {
  const s = stateOf(p);
  const snapshot = assessmentOf({ effective: s.effective, graph: p.graph(), settings: s.project.settings, results: evidenceOf(p, args), scopeDigest: p.scopeDigest() });
  const file = keepAssessment(p.io, p.rooms, snapshot);
  return { id: snapshot.id, kept: file, counts: snapshot.counts, findings: snapshot.findings.map((f) => ({ id: f.id, control: f.control, status: f.status })), catalogs: snapshot.catalogs, statement: snapshot.statement };
}

function reported(p, args) {
  const id = args.find((a) => !a.startsWith("--"));
  const snapshot = readAssessment(p.io, p.rooms, id);
  if (!snapshot) throw new Refused(`no assessment ${String(id ?? "").slice(0, 40)} is kept for this project — security-audit.mjs assess makes one`);
  return { snapshot, freshness: assessmentFreshness(snapshot, stateOf(p).effective, p.scopeDigest()) };
}

const writer = (p, args) => ({ door: p.door, revision: flag(args, "revision"), at: p.now() });

export const COMMANDS = {
  catalogs: { run: (p) => catalogsView(p), say: (r) => sayCatalogs(r) },
  applicability: { run: (p) => applicabilityView(p), say: (r) => sayApplicability(r) },
  plan: { run: (p) => planView(p), say: (r) => sayPlan(r) },
  assess: { run: (p, args) => assessed(p, args), say: (r) => sayAssessed(r) },
  report: { run: (p, args) => reported(p, args), say: (r) => sayReport(r) },
  adopt: { run: (p, args) => adoptCatalog(p.io, p.rooms, stateOf(p).layers, {}, writer(p, args)), say: () => "" },
  enable: { run: (p, args) => enableCatalogs(p.io, p.rooms, stateOf(p).layers, {}, writer(p, args)), say: () => "" },
  mark: { run: (p, args) => markControl(p.io, p.rooms, stateOf(p).layers, {}, writer(p, args)), say: () => "" },
};

// ── what a terminal prints ─────────────────────────────────────────────────

const pin = (c) => `${c.catalog} ${c.version} (${c.digest.slice(0, 12)})`;

function sayCatalogs(r) {
  const head = [`in effect (${r.project.effective.by === "default" ? "Orbit's default — this project enabled none" : "enabled for this project"}):`, ...r.project.effective.catalogs.map((c) => `  ${pin(c)}  ${c.controls} control(s)${c.filter ? `  filtered ${JSON.stringify(c.filter)}` : ""}`)];
  const missing = r.project.effective.missing.map((m) => `  MISSING ${m.catalog} (${m.digest.slice(0, 12)}): ${m.why}`);
  const known = [`shipped: ${r.shipped.map(pin).join(", ") || "none"}`, `adopted on this machine: ${r.adopted.map(pin).join(", ") || "none"}`, ...r.refused.map((x) => `REFUSED ${x.from}: ${x.problems.slice(0, 3).join("; ")}`)];
  return [...head, ...missing, ...known, `not applicable here, by a person: ${r.project.notApplicable.length}`, "A person adopts, enables and marks catalogs in Orbit Control (Security → Catalogs)."].join("\n");
}

const sayApplicability = (r) => [`graph: ${r.graph.present ? (r.graph.complete ? "complete for its scope" : "partial") : "none yet — every control is applicability-unknown"}`, ...r.rows.map((x) => `${x.applicability.state.padEnd(15)} ${x.catalog} ${x.control}  ${x.applicability.why}`), `counts: ${JSON.stringify(r.counts)}`].join("\n");

const sayPlan = (r) => [`${r.obligations.length} security obligation(s) from ${r.catalogs.map(pin).join(", ") || "no catalog"}:`, ...r.obligations.map((o) => `${o.id}  ${o.catalog} ${o.control} → ${o.shape} (${o.boundary}; controls ${o.controls.join(", ")})${o.freshness === "stale" ? "  STALE" : ""}`)].join("\n");

const sayAssessed = (r) => [`${r.id} kept: ${r.kept}`, `against ${r.catalogs.map(pin).join(", ")}`, `conclusions: ${JSON.stringify(r.counts)}`, ...r.findings.map((f) => `finding ${f.id} (${f.status}) on ${f.control}`), r.statement].join("\n");

function sayReport(r) {
  const s = r.snapshot;
  const rows = s.controls.map((c) => `${c.conclusion.padEnd(22)} ${c.catalog} ${c.control}  ${c.why}`);
  const findings = s.findings.map((f) => `FINDING ${f.id} ${f.status} — ${f.control}: ${f.impact}; confidence ${f.confidence}; reproducibility ${f.reproducibility}${f.needs.length ? `; to confirm it needs ${f.needs.join("; ")}` : ""}`);
  return [`${s.id} — ${r.freshness.state.toUpperCase()}${r.freshness.why.length ? `: ${r.freshness.why.join("; ")}` : ""}`, `against ${s.catalogs.map(pin).join(", ")}`, ...rows, ...findings, ...s.gaps.map((g) => `gap ${g.control}: ${g.gap}`), s.statement].join("\n");
}
