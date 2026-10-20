// The SHAPE guard, and the only family that runs before the others -- the same
// role dsl/rules/shape.mjs plays for a case, and for the same reason: every rule
// below walks a container, and none of them can say anything useful about a
// `scenarios` that turned out to be an object.
//
// What counts as a container is read off the rows themselves (`items.$ref`,
// `additionalProperties.$ref`), so a new container in fields.mjs is covered here
// with no entry anywhere.
import { basename } from "node:path";
import { memberRef } from "../../constraints.mjs";
import { PLAN_FIELDS, SCHEMA_VERSION } from "../fields.mjs";
import { error } from "../finding.mjs";

const CONTAINERS = Object.entries(PLAN_FIELDS).filter(([, spec]) => memberRef(spec));

export const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);

export function shapeFindings(p) {
  if (!isObject(p)) return [error("plan", `must be a JSON object, not ${kindOf(p)}`)];
  if (p._broken) return [error(basename(p._file ?? "plan"), p._broken)];
  return [...versionFindings(p), ...CONTAINERS.flatMap(([k, spec]) => containerFindings(at(p), k, spec, p[k]))];
}

const at = (p) => (typeof p.id === "string" ? p.id : basename(p._file ?? "plan"));

// A version this build does not read is a HARD stop, not a warning: every rule
// below assumes the vocabulary of its own version, and applying them to a file
// written for another one produces confident nonsense.
function versionFindings(p) {
  if (p.schema === undefined) return [error(at(p), `no schema version — add "schema": ${SCHEMA_VERSION}`)];
  if (p.schema === SCHEMA_VERSION) return [];
  return [error(at(p), `is written to plan schema ${p.schema}; this engine reads ${SCHEMA_VERSION} — upgrade the engine, or the plan`)];
}

function containerFindings(id, k, spec, v) {
  if (v === undefined) return [];
  const kind = kindFindings(k, spec, v);
  return kind.length ? kind.map((m) => error(id, m)) : memberFindings(id, k, v);
}

function kindFindings(k, spec, v) {
  const ok = spec.type === "array" ? Array.isArray(v) : isObject(v);
  return ok ? [] : [`${k} must be ${spec.type === "array" ? "an array" : "an object"}, not ${kindOf(v)}`];
}

function memberFindings(id, k, v) {
  const members = Array.isArray(v) ? v.map((m, i) => [`${k}[${i + 1}]`, m]) : Object.entries(v).map(([n, m]) => [`${k}.${n}`, m]);
  return members.filter(([, m]) => !isObject(m)).map(([where, m]) => error(id, `${where} must be an object, not ${kindOf(m)}`));
}

function kindOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return `${/^[aeiou]/.test(typeof v) ? "an" : "a"} ${typeof v}`;
}
