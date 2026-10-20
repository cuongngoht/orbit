// What a PROJECT-REPORT PART is, version 1, as DATA -- a row of an extension's
// `reporting.json`, and a row of the standard kit's own parts table, which is
// held to exactly the same fields so the composition rules cannot treat the two
// differently by accident.
//
// A part is data NAMING a script. The engine never imports anything a report
// extension ships: the loader PARSES reporting.json, and the only code an
// extension brings is a file the report runner starts as a separate process
// (src/project-report/execute.mjs), with a minimal environment and no
// credential. Markdown (a `workflow`) is guidance a host reads; it is never run.
//
// Kinds, in the order a run takes them:
//
//   collector   adds a collection to the snapshot BEFORE it is frozen. From a
//               project's store: local sources only (a documents tree) -- a
//               collector that would need the source's API and its credential
//               is not something an extension can be in v1
//   transform   derives a new collection from the frozen snapshot, beside it
//   metric      declares metrics (id, unit, definition) and computes them
//   section     lays out plain-text blocks for the report
//   exporter    writes another format beside the report
//   workflow    a playbook a host follows; listed, never executed
//
// Engine words only. Which interpreter runs a part is a catalog tool id
// (`runtime`), and a provider's own name never appears in this file.
import { constraintFindings, missingFindings } from "../constraints.mjs";

export const REPORT_PART_API = "orbit.report.part/v1";

export const REPORT_KINDS = [
  { kind: "collector", phase: 0, runs: true, writes: "collection", entry: /\.(py|mjs)$/ },
  { kind: "transform", phase: 1, runs: true, writes: "derived", entry: /\.py$/ },
  { kind: "metric", phase: 2, runs: true, writes: "metrics", entry: /\.py$/ },
  { kind: "section", phase: 3, runs: true, writes: "section", entry: /\.py$/ },
  { kind: "exporter", phase: 4, runs: true, writes: "files", entry: /\.py$/ },
  { kind: "workflow", phase: 5, runs: false, writes: "nothing", entry: /\.md$/ },
];

export const kindOf = (kind) => REPORT_KINDS.find((k) => k.kind === kind) ?? null;

// Namespaced: the first segment is the extension that owns it. `orbit.` is the
// standard kit's, and a project's part may never claim it.
export const PART_ID = /^[a-z][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)+$/;
export const EXPORT_FORMATS = ["csv", "json", "md", "txt"];

export const REPORT_PART_FIELDS = {
  id: { type: "string", pattern: PART_ID.source, doc: "Namespaced: <extension-id>.<name>. orbit.report.* belongs to the standard kit." },
  version: { type: "string", pattern: "^\\d+\\.\\d+\\.\\d+(-[\\w.]+)?$", doc: "This part's own version, recorded in every run that used it." },
  kind: { type: "string", enum: REPORT_KINDS.map((k) => k.kind), doc: "What the part does to a run: collector, transform, metric, section, exporter or workflow." },
  contract: { type: "string", enum: [REPORT_PART_API], doc: "The process contract it was written against." },
  runtime: { type: "string", pattern: "^[a-z][a-z0-9-]*$", doc: "The catalog tool that runs it (catalog/tools.json), e.g. python." },
  requires: { type: "string", doc: "Which versions of that runtime it was written for, e.g. \">=3.11\"." },
  entry: { type: "string", pattern: "^\\./[\\w./-]+\\.(py|md|mjs)$", doc: "The file inside the extension that IS the part: a script, or a playbook for a workflow." },
  doc: { type: "string", doc: "What the part is for, in a sentence a product owner can read." },
  provides: { type: "array", items: { type: "string" }, doc: "What it adds: report.metric.<id>, report.section.<id>, report.collection.<name>." },
  needs: { type: "array", items: { type: "string" }, doc: "What it reads: a snapshot collection, the standard model, another part's output." },
  metrics: { type: "array", items: { type: "object" }, doc: "A metric part's metrics: id, version, label, unit, definition. Nothing undeclared is kept." },
  section: { type: "object", doc: "A section part's section: id, title, and optionally placement (after:<section id>)." },
  replaces: { type: "string", doc: "The part this one REPLACES. Explicit, and only a person activates a replacement." },
  timeoutSec: { type: "integer", minimum: 1, maximum: 1800, doc: "How long a run gives it before it is stopped." },
  fixture: { type: "string", pattern: "^\\./[\\w./-]+\\.json$", doc: "A snapshot it is verified against." },
  basedOn: { type: "array", items: { type: "string" }, doc: "Provenance: the need, snapshot or source it was made from." },
  packages: { type: "array", items: { type: "string" }, doc: "Python packages beyond the standard library. Not supported in this version." },
  provider: { type: "string", doc: "Standard collectors only: the source kind it reads." },
  formats: { type: "array", items: { type: "string" }, doc: "An exporter's output formats." },
};

export const REPORT_PART_REQUIRED = ["id", "version", "kind", "contract", "entry", "doc"];

const KNOWN = new Set(Object.keys(REPORT_PART_FIELDS));
const METRIC_REQUIRED = ["id", "version", "label", "unit", "definition"];

// Findings, never a throw. `owner` is the extension id -- or null for the
// standard kit, whose rows are allowed the `orbit.` namespace and a Node entry.
export function partProblems(row, where, owner = null) {
  if (!row || typeof row !== "object" || Array.isArray(row)) return [`${where}: a reporting part is an object`];
  const shape = [...missingFindings(REPORT_PART_REQUIRED, row, where), ...constraintFindings(REPORT_PART_FIELDS, row, where), ...unknown(row, where)];
  return shape.length ? shape : RULES.filter((r) => r.fails(row, owner)).map((r) => `${where}: ${r.says(row, owner)}`);
}

const unknown = (row, where) => Object.keys(row).filter((k) => !KNOWN.has(k)).map((k) => `${where}: unknown key "${k}"`);

// One sentence per rule, first to last; each asked only of a row that already
// has the right shape.
const RULES = [
  { fails: (r, o) => o !== null && !r.id.startsWith(`${o}.`), says: (r, o) => `${r.id} must be namespaced under its extension: ${o}.<name>` },
  { fails: (r, o) => o !== null && r.id.startsWith("orbit."), says: () => "orbit.* belongs to the standard kit; a project's part may not claim it" },
  { fails: (r) => r.entry.includes(".."), says: () => "entry must stay inside the extension's own directory" },
  { fails: (r) => !kindOf(r.kind).entry.test(r.entry), says: (r) => `a ${r.kind} part's entry is ${r.kind === "workflow" ? "a .md playbook" : "a .py script"}, not ${r.entry}` },
  { fails: (r, o) => o !== null && r.entry.endsWith(".mjs"), says: () => "a project's part is a script run as its own process; the engine never imports an extension's code" },
  { fails: (r) => kindOf(r.kind).runs && !r.entry.endsWith(".mjs") && !r.runtime, says: () => "a part that runs names its runtime, e.g. \"runtime\": \"python\"" },
  { fails: (r) => (r.packages ?? []).length > 0, says: () => "packages beyond the standard library are not supported yet: a report part runs on the standard library only" },
  { fails: (r, o) => o !== null && r.kind === "collector" && (r.needs ?? []).includes("source.read"), says: () => "a project's collector reads local sources only; the source API and its credential stay with the standard collectors" },
  { fails: (r) => r.kind === "metric" && !(r.metrics ?? []).length && !(r.provides ?? []).includes("report.model"), says: () => "a metric part declares its metrics: id, version, label, unit and definition" },
  { fails: (r) => (r.metrics ?? []).some((m) => METRIC_REQUIRED.some((k) => typeof m?.[k] !== "string" || !m[k].trim())), says: () => `every declared metric has ${METRIC_REQUIRED.join(", ")}` },
  { fails: (r, o) => o !== null && (r.metrics ?? []).some((m) => !String(m.id).startsWith(`${o}.`)), says: (r, o) => `a metric id is namespaced under its extension: ${o}.<name>` },
  { fails: (r) => r.kind === "section" && !(r.section?.id && r.section?.title), says: () => "a section part names its section: { id, title }" },
  { fails: (r, o) => o !== null && r.kind === "section" && !String(r.section?.id ?? "").startsWith(`${o}.`), says: (r, o) => `a section id is namespaced under its extension: ${o}.<name>` },
  { fails: (r) => r.kind === "exporter" && !(r.formats ?? []).length, says: () => `an exporter names its formats (${EXPORT_FORMATS.join(", ")})` },
  { fails: (r) => (r.formats ?? []).some((f) => !EXPORT_FORMATS.includes(f)), says: () => `an exporter writes ${EXPORT_FORMATS.join(", ")} only` },
];
