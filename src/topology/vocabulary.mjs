// The effective SYSTEM GRAPH vocabulary of one project: which node kinds and relations mean
// something here, and what (ADR 0033).
//
// Three layers, offered in a fixed order:
//
//   orbit          catalog/topology.json -- a starting vocabulary, never an ontology
//   organization   <storeBase>/organization/topology/vocabulary/*.json -- what an organisation
//                  means by its own words, for all its projects
//   project        <storeRoot>/topology/vocabulary/*.json -- this project's own
//
// A row is `{id, role, doc}`, and its role must be one src/topology/vocab.mjs knows for its
// section. A later layer may ADD names; one that gives an id already declared a DIFFERENT role
// is refused and recorded, and one that means the same is noted as also declared. A name NO
// layer declares is still a name: `kindOf` and `relationOf` answer it with no role -- kept,
// shown, deriving nothing -- the rule the knowledge vocabulary keeps for its relations.
import { join } from "node:path";
import { catalogFile, readCatalog } from "../catalog.mjs";
import { NODE_ROLE_IDS, RELATION_ROLE_IDS } from "./vocab.mjs";

export const TOPOLOGY_VOCABULARY_SCHEMA = 1;

const SECTIONS = [
  { id: "nodeKinds", roles: NODE_ROLE_IDS },
  { id: "relations", roles: RELATION_ROLE_IDS },
];

export const vocabularyRooms = (storeBase, storeRoot) => ({
  organization: join(storeBase, "organization", "topology", "vocabulary"),
  project: join(storeRoot, "topology", "vocabulary"),
});

export function mergeVocabulary(layers) {
  const vocab = { nodeKinds: new Map(), relations: new Map(), notes: [], problems: [] };
  for (const l of layers) offerLayer(vocab, l);
  return vocab;
}

function offerLayer(vocab, layer) {
  if (layer.problem) vocab.problems.push(layer.problem);
  for (const s of SECTIONS) for (const row of layer.doc?.[s.id] ?? []) offerRow(vocab, s, row, layer);
}

function offerRow(vocab, section, row, layer) {
  const why = rowProblem(section, row);
  if (why) return void vocab.problems.push(`${layer.from}: ${why} — refused`);
  const known = vocab[section.id].get(row.id);
  if (known) return void noteAgain(vocab, known, row, layer);
  vocab[section.id].set(row.id, { id: row.id, role: row.role, doc: row.doc ?? "", layer: layer.layer, from: layer.from });
}

const rowProblem = (section, row) => (typeof row?.id !== "string" || !row.id ? "a row with no id" : roleProblem(section, row));

const roleProblem = (section, row) => (section.roles.includes(row.role) ? null : `${row.id}: role "${row.role}" is not one of ${section.roles.join(", ")}`);

function noteAgain(vocab, known, row, layer) {
  if (known.role !== row.role) return void vocab.problems.push(`${layer.from}: ${row.id} is already declared by ${known.from} with role ${known.role} — refused`);
  vocab.notes.push(`${layer.from}: ${row.id} also declared (${known.from})`);
}

export const kindOf = (vocab, id) => lookedUp(vocab.nodeKinds, id);
export const relationOf = (vocab, id) => lookedUp(vocab.relations, id);

const lookedUp = (map, id) => (map.has(id) ? { ...map.get(id), declared: true } : { id, role: null, doc: "", layer: null, from: null, declared: false });

// ── reading the layers ─────────────────────────────────────────────────────
// Orbit's own rows, fail-soft: a plugin tree without the catalog (a trimmed install, a test
// fixture) has no starting vocabulary -- never an error, always said.
export function catalogLayer(pluginRoot, io) {
  try { return { layer: "orbit", from: "catalog/topology.json", doc: readCatalog(io, catalogFile(pluginRoot, "topology")) }; }
  catch (e) { return { layer: "orbit", from: "catalog/topology.json", doc: null, problem: String(e?.message ?? e) }; }
}

// The files a person keeps in a room, `{ "schema": 1, "nodeKinds": […], "relations": […] }`
// each, sorted so two machines offer them in the same order. Reading never creates the room.
export function roomLayers(io, dir, layer) {
  const files = (io.exists(dir) ? io.list(dir) : []).filter((n) => n.endsWith(".json")).sort();
  return files.map((name) => fileLayer(io.read(join(dir, name)), `${layer} ${name}`, layer));
}

function fileLayer(text, from, layer) {
  const doc = parsed(text);
  if (doc?.schema !== TOPOLOGY_VOCABULARY_SCHEMA) return { layer, from, doc: null, problem: `${from} is not a schema ${TOPOLOGY_VOCABULARY_SCHEMA} topology vocabulary file — nothing in it was offered` };
  return { layer, from, doc };
}

function parsed(text) {
  try { return text ? JSON.parse(text) : null; }
  catch { return null; }
}

export function loadVocabulary({ pluginRoot, storeBase, storeRoot, io }) {
  const rooms = vocabularyRooms(storeBase, storeRoot);
  return mergeVocabulary([catalogLayer(pluginRoot, io), ...roomLayers(io, rooms.organization, "organization"), ...roomLayers(io, rooms.project, "project")]);
}
