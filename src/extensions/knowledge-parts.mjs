// The KNOWLEDGE PARTS registry: relation rows and interpreters, from whoever
// offers them -- one registry per context, like the capability registry, so two
// projects in one process never share a meaning by accident.
//
// Two doors, for two kinds of offerer:
//
//   register(parts, from)    an EXTENSION's whole knowledge module. The loader
//                            asks `check` first, BEFORE that extension registers
//                            anything else, and then this is all or nothing
//   offer(rows, from, layer) DATA rows -- Orbit's catalog, an organisation's and a
//                            project's own files -- row by row, every refusal
//                            recorded, never a throw: one bad file must not take
//                            the rest of the vocabulary down
//
// Extensions register first, into an empty registry, so whether one LOADS never
// depends on what some data file says; a data row that means something else by
// an id already registered is the one refused. Two rows that mean the same --
// role and cardinality agree -- are one relation, and the second is noted as
// "also declared", not refused.
import { Refused } from "../errors.mjs";
import { interpreterProblems, isObject, relationProblems, sameMeaning } from "./knowledge-v1.mjs";

export function createKnowledgeParts() {
  const s = { relations: new Map(), interpreters: new Map(), refused: [], also: [] };
  return {
    check: (parts) => partsProblems(s, parts),
    register: (parts, from) => registered(s, parts, from),
    offer: (rows, from, layer) => offered(s, rows, from, layer),
    relations: () => [...s.relations.values()],
    relation: (id) => s.relations.get(id) ?? null,
    interpreters: () => [...s.interpreters.values()],
    refused: () => [...s.refused],
    also: () => [...s.also],
  };
}

const listOf = (v) => (Array.isArray(v) ? v : []);

function partsProblems(s, parts) {
  const relations = listOf(parts?.relations);
  const interpreters = listOf(parts?.interpreters);
  return [...relations.flatMap((r, i) => relationClash(s, r, i, relations)), ...interpreters.flatMap((x, i) => interpreterClash(s, x, i, interpreters))];
}

const label = (what, i, row) => `${what} ${i + 1} "${row?.id ?? "?"}"`;

function relationClash(s, row, i, all) {
  const shape = relationProblems(row, label("relation", i, row));
  if (shape.length) return shape;
  const twice = all.slice(0, i).some((r) => r?.id === row.id) ? [`${label("relation", i, row)}: declared twice in one module`] : [];
  return [...twice, ...meaningClash(s, row, label("relation", i, row))];
}

function meaningClash(s, row, at) {
  const had = s.relations.get(row.id);
  return had && !sameMeaning(had, row) ? [`${at}: ${had.from} already declares it as ${meaningOf(had)} — two meanings for one relation, so this one is refused`] : [];
}

const meaningOf = (r) => `${r.role ?? "no role"}, cardinality ${r.cardinality ?? "many"}`;

function interpreterClash(s, row, i, all) {
  const shape = interpreterProblems(row, label("interpreter", i, row));
  if (shape.length) return shape;
  const owner = s.interpreters.get(row.id)?.from ?? (all.slice(0, i).some((x) => x?.id === row.id) ? "this module" : null);
  return owner ? [`${label("interpreter", i, row)}: already registered by ${owner} — two interpreters under one id, so neither wins`] : [];
}

function registered(s, parts, from) {
  const wrong = partsProblems(s, parts);
  if (wrong.length) throw new Refused(`${from}: cannot register what it teaches project knowledge — ${wrong.join("; ")}`);
  for (const row of listOf(parts?.relations)) kept(s, row, from, "project");
  for (const row of listOf(parts?.interpreters)) s.interpreters.set(row.id, { ...row, from });
}

function kept(s, row, from, layer) {
  const had = s.relations.get(row.id);
  if (had) return void s.also.push({ id: row.id, from, layer, first: had.from });
  s.relations.set(row.id, { id: row.id, role: row.role ?? null, cardinality: row.cardinality ?? "many", doc: row.doc ?? "", layer, from });
}

function offered(s, rows, from, layer) {
  const out = { loaded: [], refused: [] };
  for (const [i, row] of listOf(rows).entries()) one(s, out, row, { from, layer, at: `${from} row ${i + 1} "${row?.id ?? "?"}"` });
  return out;
}

function one(s, out, row, where) {
  const shape = relationProblems(row, where.at);
  const wrong = shape.length || !isObject(row) ? shape : meaningClash(s, row, where.at);
  if (wrong.length) return void refusal(s, out, { id: row?.id ?? "?", from: where.from, layer: where.layer, why: wrong.join("; ") });
  kept(s, row, where.from, where.layer);
  out.loaded.push(row.id);
}

function refusal(s, out, r) {
  s.refused.push(r);
  out.refused.push(r);
}
