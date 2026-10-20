// What the renderer is handed: the frozen snapshot, and what each part that ran
// produced -- gathered here, and nothing computed. A number the page shows was
// computed by a part from the snapshot; this file only decides where it goes.
//
// The standard model and forecast come from whichever part PROVIDES them (a
// replacement a person approved included). Every extension part becomes one
// extension section: its own blocks when it drew them, else its declared
// metrics as tiles and tables -- labelled with the part, its version and where
// it came from, and when it failed, the failure and nothing else.
export const MODEL = "report.model";
export const FORECAST = "report.forecast";

// results: [{ part, outcome }] · composition: { skipped, notes } · extras: { createdFor: {extId: text} }
export function assemble(results, composition, extras = {}) {
  const model = providing(results, MODEL);
  return { model: model?.outcome.ok ? model.outcome.outputs.model : null, modelProblem: problemOf(model), metrics: results.flatMap((r) => (r.outcome.ok ? r.outcome.outputs.metrics ?? [] : [])), forecast: forecastOf(results), extensions: results.filter(isExtensionSection).map((r) => sectionOf(r, extras)), parts: results.map(partLine), skipped: composition.skipped ?? [], notes: [...(composition.notes ?? []), ...results.flatMap(notesOf)] };
}

const providing = (results, what) => results.find((r) => (r.part.provides ?? []).includes(what)) ?? null;

function problemOf(result) {
  if (!result) return "no part providing the standard model ran";
  return result.outcome.ok ? null : `the standard metrics did not run (${result.outcome.error ?? result.outcome.status}); the data coverage section says what was collected`;
}

function forecastOf(results) {
  const found = providing(results, FORECAST);
  if (!found) return null;
  return found.outcome.ok ? found.outcome.outputs.forecast ?? null : { status: "none", reason: `the forecast part did not run: ${found.outcome.error ?? (found.outcome.notes ?? []).join(" ")}` };
}

const isExtensionSection = (r) => r.part.source === "store" && ["metric", "section"].includes(r.part.kind);

function sectionOf({ part, outcome }, extras) {
  const own = { id: part.section?.id ?? part.id, title: part.section?.title ?? titleOf(part), placement: part.section?.placement, part: part.id, version: part.version, source: `project store · ${part.from}`, createdFor: extras.createdFor?.[part.from] ?? null };
  return { ...own, status: outcome.ok ? "ok" : outcome.status, error: outcome.ok ? null : outcome.error ?? null, notes: outcome.notes ?? [], blocks: outcome.ok ? blocksOf(outcome.outputs) : [], metrics: outcome.ok ? outcome.outputs.metrics ?? [] : part.metrics ?? [] };
}

const titleOf = (part) => part.metrics?.[0]?.label ?? part.id;

// A part's own section blocks when it drew any; otherwise its metrics, each as
// the block its shape calls for.
function blocksOf(outputs) {
  const drawn = (outputs.section ?? []).flatMap((s) => [...(s.summary ? [{ type: "text", title: s.title, body: s.summary }] : []), ...s.blocks]);
  return drawn.length ? drawn : (outputs.metrics ?? []).flatMap(metricBlocks);
}

const METRIC_BLOCKS = [
  { has: (m) => m.value !== null && m.value !== undefined, block: (m) => ({ type: "tiles", items: [{ label: m.label, value: m.value, unit: m.unit, note: basisNote(m) }] }) },
  { has: (m) => Array.isArray(m.table?.rows), block: (m) => ({ type: "table", title: m.label, columns: m.table.columns ?? [], rows: m.table.rows }) },
  { has: (m) => Array.isArray(m.series?.labels), block: (m) => ({ type: "chart", kind: m.series.kind ?? "bar", title: m.label, unit: m.unit, labels: m.series.labels, series: m.series.series ?? [] }) },
];

const metricBlocks = (m) => METRIC_BLOCKS.filter((b) => b.has(m)).map((b) => b.block(m));

const basisNote = (m) => (Number.isInteger(m.basis?.samples) ? `from ${m.basis.samples} item(s)` : null);

const partLine = ({ part, outcome }) => ({ id: part.id, version: part.version, kind: part.kind, source: part.source, from: part.from, sha256: part.sha256 ?? null, status: outcome.ok ? outcome.status ?? "ok" : outcome.status, error: outcome.ok ? null : outcome.error ?? null, errorKind: outcome.ok ? null : outcome.kind, ms: outcome.ms ?? null, metrics: (outcome.ok ? outcome.outputs.metrics ?? [] : []).map((m) => `${m.id}@${m.version}`) });

const notesOf = ({ part, outcome }) => (outcome.ok && part.source === "builtin" ? [] : (outcome.notes ?? []).map((n) => `${part.id}: ${n}`));
