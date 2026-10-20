// Everything a TABLE already declares, enforced over the whole document.
//
// Type, enum, pattern, minimum, maximum and required live in qa/fields.mjs and
// are enforced by src/constraints.mjs -- exactly as a case's are. This family
// only WALKS: it finds every record the definitions reach and holds each one to
// its own table, so a new nested block needs no rule written for it.
//
// A member that carries an `id` is labelled by that id rather than by its index,
// because "things S3: unknown field" is a sentence somebody can act on and
// "things scenarios[3]" is one they have to count to.
import { constraintFindings, memberRef, missingFindings } from "../../constraints.mjs";
import { DEFINITIONS, PLAN_FIELDS, PLAN_REQUIRED } from "../fields.mjs";
import { ERROR, fromStrings } from "../finding.mjs";
import { isObject } from "./shape.mjs";

// What the LOADER adds, never the author: where it was found, why it would not
// parse, and whether it came from the machine store's drafts room.
const OWN = new Set(["_file", "_broken", "_draft"]);

export const declaredFindings = (p) => fromStrings(ERROR, idOf(p), recordFindings(PLAN_FIELDS, PLAN_REQUIRED, p, idOf(p)));

const idOf = (p) => (typeof p?.id === "string" ? p.id : "plan");

function recordFindings(table, required, record, at) {
  const known = new Set([...Object.keys(table), ...OWN]);
  const unknown = Object.keys(record).filter((k) => !known.has(k)).map((k) => `${at}: unknown field "${k}"`);
  const declared = [...missingFindings(required, record, at), ...constraintFindings(table, record, at)];
  return [...unknown, ...declared, ...nestedFindings(table, record, at)];
}

const nestedFindings = (table, record, at) => Object.entries(table).flatMap(([k, spec]) => memberFindings(spec, record[k], at, k));

function memberFindings(spec, v, at, k) {
  const name = refNameOf(spec);
  if (v === undefined || !name) return [];
  return membersOf(spec, v, at, k).flatMap(([where, m]) => oneMember(name, m, where));
}

const refNameOf = (spec) => nameFrom(spec.$ref) ?? nameFrom(memberRef(spec));

const nameFrom = (ref) => (typeof ref === "string" ? ref.split("/").pop() : null);

function membersOf(spec, v, at, k) {
  if (spec.$ref) return [[`${at} ${k}`, v]];
  if (Array.isArray(v)) return v.map((m, i) => [labelOf(at, k, i, m), m]);
  return isObject(v) ? Object.entries(v).map(([n, m]) => [`${at} ${k}.${n}`, m]) : [];
}

const labelOf = (at, k, i, m) => (typeof m?.id === "string" ? `${at} ${m.id}` : `${at} ${k}[${i + 1}]`);

function oneMember(name, m, where) {
  const def = DEFINITIONS[name];
  if (!isObject(m) || !def) return [];
  return recordFindings(def.table, def.required, m, where);
}
