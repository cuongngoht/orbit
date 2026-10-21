// What an adapter's SEMANTICS declaration may say, and whether it meets what an obligation
// needs (ADR 0035).
//
// The fields are DATA -- catalog/semantics.json, then an organisation's and a project's own
// files, in that order -- so a new property of some broker is a row, never a branch here. Each
// row has a `kind`: an enum of values, a set of them, an integer, a number, or a list of
// strings. Every field also accepts "unknown", and unknown is never a default: a need resting
// on an unknown field is UNKNOWN, which is not met and not refused -- the obligation says what
// would settle it. A field no layer declares is kept on the adapter and shown, and derives
// nothing, the rule the topology and knowledge vocabularies keep.
import { join } from "node:path";
import { catalogFile, readCatalog } from "../catalog.mjs";

export const SEMANTICS_SCHEMA = 1;
export const UNKNOWN = "unknown";

const KINDS = {
  enum: (row, v) => row.values.includes(v),
  set: (row, v) => Array.isArray(v) && v.every((m) => row.values.includes(m)),
  integer: (row, v) => Number.isInteger(v) && v >= 0,
  number: (row, v) => typeof v === "number" && Number.isFinite(v) && v >= 0,
  strings: (row, v) => Array.isArray(v) && v.every((m) => typeof m === "string" && m.length > 0),
};

const NEEDS_VALUES = new Set(["enum", "set"]);

export const semanticsRooms = (storeBase, storeRoot) => ({
  organization: join(storeBase, "organization", "adapters", "semantics"),
  project: join(storeRoot, "adapters", "semantics"),
});

export function mergeSemantics(layers) {
  const vocab = { fields: new Map(), notes: [], problems: [] };
  for (const l of layers) offerLayer(vocab, l);
  return vocab;
}

function offerLayer(vocab, layer) {
  if (layer.problem) vocab.problems.push(layer.problem);
  for (const row of layer.doc?.fields ?? []) offerRow(vocab, row, layer);
}

function offerRow(vocab, row, layer) {
  const why = rowProblem(row);
  if (why) return void vocab.problems.push(`${layer.from}: ${why} — refused`);
  const known = vocab.fields.get(row.id);
  if (known) return void vocab[sameField(known, row) ? "notes" : "problems"].push(`${layer.from}: ${row.id} is already declared by ${known.from}${sameField(known, row) ? "" : " differently — refused"}`);
  vocab.fields.set(row.id, { ...row, layer: layer.layer, from: layer.from });
}

const rowProblem = (row) => (typeof row?.id !== "string" || !row.id ? "a row with no id" : kindProblem(row));

const kindProblem = (row) => (!KINDS[row.kind] ? `${row.id}: kind "${row.kind}" is not one of ${Object.keys(KINDS).join(", ")}` : valuesProblem(row));

const valuesProblem = (row) => (NEEDS_VALUES.has(row.kind) && !(Array.isArray(row.values) && row.values.length) ? `${row.id}: a ${row.kind} field lists its values` : null);

const sameField = (a, b) => a.kind === b.kind && JSON.stringify(a.values ?? []) === JSON.stringify(b.values ?? []);

// Every field of one declaration held to its row. A value that is neither one the row allows
// nor "unknown" is a problem; a field nobody declared is noted as undeclared and kept.
export function semanticsFindings(vocab, semantics, at) {
  const entries = Object.entries(semantics ?? {});
  const undeclared = entries.filter(([k]) => !vocab.fields.has(k)).map(([k]) => k);
  const problems = entries.filter(([k, v]) => vocab.fields.has(k) && !allowed(vocab.fields.get(k), v)).map(([k, v]) => `${at}: semantics.${k} is ${JSON.stringify(v)} — ${says(vocab.fields.get(k))}`);
  return { problems, undeclared };
}

const allowed = (row, v) => v === UNKNOWN || KINDS[row.kind](row, v);

const says = (row) => (NEEDS_VALUES.has(row.kind) ? `${row.kind === "set" ? "a list of" : "one of"} ${row.values.join(", ")}, or ${UNKNOWN}` : `${row.kind === "strings" ? "a list of names" : `a non-negative ${row.kind}`}, or ${UNKNOWN}`);

// Whether one adapter's semantics MEET what an obligation needs: `needs` maps a field to the
// values that would do, and ANY one of them does -- for a set field, the set holding any one
// (redelivery on any of the triggers a shape can induce). An absent or unknown field is
// UNKNOWN -- never met, never refused -- and names what would settle it.
export function meets(semantics, needs) {
  const verdicts = Object.entries(needs ?? {}).map(([field, wanted]) => [field, wanted, verdictOf(semantics?.[field], wanted)]);
  const of = (word) => verdicts.filter(([, , v]) => v === word).map(([field, wanted]) => ({ field, wanted, have: semantics?.[field] ?? UNKNOWN }));
  return { met: of("met").map((r) => r.field), unmet: of("unmet"), unknown: of("unknown").map((r) => r.field) };
}

const verdictOf = (have, wanted) => (have === undefined || have === UNKNOWN ? "unknown" : holds(have, wanted) ? "met" : "unmet");

const holds = (have, wanted) => (Array.isArray(have) ? asList(wanted).some((w) => have.includes(w)) : asList(wanted).includes(have));

const asList = (v) => (Array.isArray(v) ? v : [v]);

// ── reading the layers ─────────────────────────────────────────────────────
export function catalogLayer(pluginRoot, io) {
  try { return { layer: "orbit", from: "catalog/semantics.json", doc: readCatalog(io, catalogFile(pluginRoot, "semantics")) }; }
  catch (e) { return { layer: "orbit", from: "catalog/semantics.json", doc: null, problem: String(e?.message ?? e) }; }
}

export function roomLayers(io, dir, layer) {
  const files = (io.exists(dir) ? io.list(dir) : []).filter((n) => n.endsWith(".json")).sort();
  return files.map((name) => fileLayer(io.read(join(dir, name)), `${layer} ${name}`, layer));
}

function fileLayer(text, from, layer) {
  const doc = parsed(text);
  if (doc?.schema !== SEMANTICS_SCHEMA) return { layer, from, doc: null, problem: `${from} is not a schema ${SEMANTICS_SCHEMA} semantics file — nothing in it was offered` };
  return { layer, from, doc };
}

function parsed(text) {
  try { return text ? JSON.parse(text) : null; }
  catch { return null; }
}

export function loadSemantics({ pluginRoot, storeBase, storeRoot, io }) {
  const rooms = semanticsRooms(storeBase, storeRoot);
  return mergeSemantics([catalogLayer(pluginRoot, io), ...roomLayers(io, rooms.organization, "organization"), ...roomLayers(io, rooms.project, "project")]);
}
