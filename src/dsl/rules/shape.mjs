// The SHAPE guard, and the only rule family that runs before the others.
//
// Every rule below this one walks a container -- steps.flatMap, params.map,
// Object.keys(identity). Handed `{"steps": {...}}` they threw a raw TypeError
// out of the validator, which cli/run-case.mjs re-threw as exit 1: a malformed
// FILE reported as a misbehaving PRODUCT, with a stack trace instead of a
// sentence. So the shape is settled first and `validate` stops if it is wrong:
// a rule cannot say anything useful about a container it cannot walk.
//
// What counts as a container is read off the rows themselves -- `items.$ref`
// and `additionalProperties.$ref` both mean "every member is an object" -- so a
// new container field in fields.mjs is covered here without an entry anywhere.
import { basename } from "node:path";
import { memberRef } from "../../constraints.mjs";
import { ROOT_FIELDS } from "../fields.mjs";
import { isObject } from "./common.mjs";

const CONTAINERS = Object.entries(ROOT_FIELDS).filter(([, spec]) => memberRef(spec));

export function shapeFindings(c) {
  if (!isObject(c)) return [`case: must be a JSON object, not ${kindOf(c)}`];
  if (c._broken) return [`${basename(c._file ?? "case")}: ${c._broken}`];
  return CONTAINERS.flatMap(([k, spec]) => containerFindings(c.id, k, spec, c[k]));
}

function containerFindings(id, k, spec, v) {
  if (v === undefined) return [];
  const kind = kindFindings(k, spec, v);
  return kind.length ? kind.map((m) => `${id}: ${m}`) : memberFindings(id, k, v);
}

function kindFindings(k, spec, v) {
  const ok = spec.type === "array" ? Array.isArray(v) : isObject(v);
  return ok ? [] : [`${k} must be ${spec.type === "array" ? "an array" : "an object"}, not ${kindOf(v)}`];
}

// A null or a bare string where a record belongs is the shape that crashed
// rules/step.mjs on `st.do`, so it is named with the position a reader can find.
function memberFindings(id, k, v) {
  const members = Array.isArray(v) ? v.map((m, i) => [`${k}[${i + 1}]`, m]) : Object.entries(v).map(([n, m]) => [`${k}.${n}`, m]);
  return members.filter(([, m]) => !isObject(m)).map(([at, m]) => `${id}: ${at} must be an object, not ${kindOf(m)}`);
}

function kindOf(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "an array";
  return `${/^[aeiou]/.test(typeof v) ? "an" : "a"} ${typeof v}`;
}
