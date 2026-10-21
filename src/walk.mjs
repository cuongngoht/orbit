// Every record a set of DEFINITIONS reaches, held to its own field table.
//
// A leaf over src/constraints.mjs, because three owners describe nested documents with the same
// table-of-rows shape and none of them may import another: a test plan (src/qa/fields.mjs), the
// sidecars a generated test carries (src/qa/obligations/contract.mjs) and an adapter's
// declaration (src/adapters/contract-v1.mjs). The rules -- an unknown field is refused, a
// required one missing is named, every declared constraint is enforced, every `$ref` member is
// walked -- are ONE definition, so a plan and a sidecar cannot disagree about what "an unknown
// field" is.
//
// A member that carries an `id` is labelled by that id rather than by its index, because
// "things S3: unknown field" is a sentence somebody can act on and "things scenarios[3]" is
// one they have to count to.
import { constraintFindings, memberRef, missingFindings } from "./constraints.mjs";

const NONE = new Set();

// `own` names fields a LOADER adds rather than an author (where a file was found, whether it
// came from a drafts room): known at every depth, never reported.
export function walkFindings(defs, table, required, record, at, own = NONE) {
  return recordFindings({ defs, own }, table, required, record, at);
}

function recordFindings(w, table, required, record, at) {
  const known = new Set([...Object.keys(table), ...w.own]);
  const unknown = Object.keys(record).filter((k) => !known.has(k)).map((k) => `${at}: unknown field "${k}"`);
  const declared = [...missingFindings(required, record, at), ...constraintFindings(table, record, at)];
  return [...unknown, ...declared, ...nestedFindings(w, table, record, at)];
}

const nestedFindings = (w, table, record, at) => Object.entries(table).flatMap(([k, spec]) => memberFindings(w, spec, record[k], at, k));

function memberFindings(w, spec, v, at, k) {
  const name = refNameOf(spec);
  if (v === undefined || !name) return [];
  return membersOf(spec, v, at, k).flatMap(([where, m]) => oneMember(w, name, m, where));
}

const refNameOf = (spec) => nameFrom(spec.$ref) ?? nameFrom(memberRef(spec));

const nameFrom = (ref) => (typeof ref === "string" ? ref.split("/").pop() : null);

export const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

function membersOf(spec, v, at, k) {
  if (spec.$ref) return [[`${at} ${k}`, v]];
  if (Array.isArray(v)) return v.map((m, i) => [labelOf(at, k, i, m), m]);
  return isObject(v) ? Object.entries(v).map(([n, m]) => [`${at} ${k}.${n}`, m]) : [];
}

const labelOf = (at, k, i, m) => (typeof m?.id === "string" ? `${at} ${m.id}` : `${at} ${k}[${i + 1}]`);

function oneMember(w, name, m, where) {
  const def = w.defs[name];
  if (!isObject(m) || !def) return [];
  return recordFindings(w, def.table, def.required, m, where);
}
