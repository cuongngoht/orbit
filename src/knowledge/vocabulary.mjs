// The effective RELATION VOCABULARY of one project -- which relations mean
// something here, and what.
//
// Offered into the one knowledge-parts registry the context carries
// (src/extensions/knowledge-parts.mjs), in a fixed order:
//
//   extensions     registered when they LOAD, before any data row, so whether
//                  an extension loads never depends on some data file
//   orbit           Orbit's generic rows, catalog/knowledge.json -- one relation
//                  per role, and nothing more: a starting vocabulary, never an
//                  ontology
//   organization   <storeBase>/organization/knowledge/vocabulary/*.json -- what
//                  an organisation means by its own words, for all its projects
//   project        <store>/knowledge/vocabulary/*.json -- this project's own
//
// A data row that means something else by an id already declared is refused
// and recorded; one that means the same is noted as "also declared". A
// relation NO layer declares is still a relation: `relationOf` answers it with
// no role and cardinality `many` -- kept, shown, deriving nothing.
import { join } from "node:path";
import { catalogFile, readCatalog } from "../catalog.mjs";

export const VOCABULARY_SCHEMA = 1;

export function offerLayers(parts, layers) {
  return layers.map((l) => ({ layer: l.layer, from: l.from, problem: l.problem ?? null, ...parts.offer(l.rows ?? [], l.from, l.layer) }));
}

// Orbit's own rows, fail-soft: a plugin tree without the catalog (a trimmed
// install, a test fixture) has no generic vocabulary -- never an error.
export function catalogLayer(pluginRoot, io) {
  try { return { layer: "orbit", from: "catalog/knowledge.json", rows: readCatalog(io, catalogFile(pluginRoot, "knowledge")).relations ?? [] }; }
  catch (e) { return { layer: "orbit", from: "catalog/knowledge.json", rows: [], problem: String(e?.message ?? e) }; }
}

// The files a person keeps in a room -- `{ "schema": 1, "relations": [ … ] }`
// each -- as layers, sorted, so two machines offer them in the same order.
export function roomLayers(io, dir, layer) {
  const files = io.list(dir).filter((n) => n.endsWith(".json")).sort();
  return files.map((name) => fileLayer(io.read(join(dir, name)), `${layer} ${name}`, layer));
}

function fileLayer(text, from, layer) {
  const doc = parsed(text);
  if (doc?.schema !== VOCABULARY_SCHEMA) return { layer, from, rows: [], problem: `${from} is not a schema ${VOCABULARY_SCHEMA} vocabulary file — nothing in it was offered` };
  return { layer, from, rows: Array.isArray(doc.relations) ? doc.relations : [] };
}

function parsed(text) {
  try { return text ? JSON.parse(text) : null; }
  catch { return null; }
}

// What a relation IS here.
export function relationOf(parts, id) {
  const row = parts.relation(id);
  return row ? { ...row, declared: true } : { id, role: null, cardinality: "many", doc: "", layer: null, from: null, declared: false };
}

// Who understands a relation: a row that gives it a role, or an interpreter
// that declares it. Neither is a relation the kernel knows the meaning of.
export const interpretersOf = (parts, id) => parts.interpreters().filter((i) => (i.understands ?? []).includes(id)).map((i) => i.id);

export const understood = (parts, id) => Boolean(parts.relation(id)?.role) || interpretersOf(parts, id).length > 0;
