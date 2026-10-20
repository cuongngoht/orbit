// Runtime enforcement of the constraints a FIELD TABLE already declares.
//
// A leaf with no imports, because two layers need it: dsl/fields.mjs describes a
// case, project/config.mjs describes a project.json, and both were declaring
// types that nothing checked.
//
// The tables carry a JSON-Schema fragment per field so an editor can validate
// as you type, and schema.mjs publishes them. Nothing enforced them at RUN time
// -- so `times: 0`, declared `minimum: 1` since the day it was added, validated
// clean and then skipped its step's body entirely. This module is the second
// consumer of the same rows: fields.mjs says what a field is, schema.mjs
// publishes it, this holds a case to it. There is still one definition.
//
// A new keyword is added in ONE place -- a row in CHECKS and one in SAYS. The
// branching lives in module-level tables on purpose: a chain of ifs over seven
// keywords cannot be written in five lines, and a table reads as the list it is.

const TYPES = {
  string: (v) => typeof v === "string",
  integer: (v) => Number.isInteger(v),
  number: (v) => typeof v === "number" && Number.isFinite(v),
  boolean: (v) => typeof v === "boolean",
  object: (v) => typeof v === "object" && v !== null && !Array.isArray(v),
  array: (v) => Array.isArray(v),
};

// Each check answers "does this value SATISFY that keyword", and is asked only
// when the keyword is present. A keyword with nothing to say about the value's
// type returns true rather than false: `minimum` has no opinion about a string,
// and `type` is the check that reports it. One wrong field, one sentence.
const CHECKS = {
  type: (v, t) => !TYPES[t] || TYPES[t](v),
  enum: (v, list) => list.includes(v),
  pattern: (v, p) => typeof v !== "string" || new RegExp(p).test(v),
  minimum: (v, n) => typeof v !== "number" || v >= n,
  maximum: (v, n) => typeof v !== "number" || v <= n,
  minItems: (v, n) => !Array.isArray(v) || v.length >= n,
  minProperties: (v, n) => !TYPES.object(v) || Object.keys(v).length >= n,
  items: (v, spec) => !Array.isArray(v) || v.every((m) => CHECKS.type(m, spec.type)),
};

const AN = { string: "a string", integer: "a whole number", number: "a number", boolean: "true or false", object: "an object", array: "an array" };

// The sentence someone fixes the file from. `enum` joins with " or " because
// that is what the hand-written rules said, and "seen must be live or src" is
// a message worth keeping word for word.
const SAYS = {
  type: (k, t) => `${k} must be ${AN[t] ?? t}`,
  enum: (k, list) => `${k} must be ${orList(list)}`,
  pattern: (k, p) => `${k} does not look like ${p}`,
  minimum: (k, n) => `${k} must be at least ${n}`,
  maximum: (k, n) => `${k} must be at most ${n}`,
  minItems: (k, n) => `${k} needs at least ${n}`,
  minProperties: (k, n) => `${k} needs at least ${n} entries`,
  items: (k, spec) => `every entry of ${k} must be ${AN[spec.type] ?? spec.type}`,
};

// "live or src" for two, "GET, POST … or OPTIONS" for seven.
const orList = (list) => (list.length < 3 ? list.join(" or ") : `${list.slice(0, -1).join(", ")} or ${list.at(-1)}`);

const KEYWORDS = Object.keys(SAYS);

// Every field of `record` that the table knows, held to what the table says.
// A field the table does not know is somebody else's finding (the misplaced /
// unknown-field rules), so it is passed over here rather than reported twice.
export function constraintFindings(table, record, where) {
  return Object.entries(record ?? {}).flatMap(([k, v]) => fieldFindings(table[k], k, v, where));
}

function fieldFindings(spec, k, v, where) {
  if (!spec || v === undefined) return [];
  return KEYWORDS.filter((kw) => kw in spec && !CHECKS[kw](v, spec[kw])).map((kw) => `${where}: ${wording(spec, kw, k)}`);
}

// A row may carry its own sentence for one keyword -- `says` -- so guidance that
// teaches the fix lives in fields.mjs beside the field, not in a rule file.
const wording = (spec, kw, k) => spec.says?.[kw] ?? SAYS[kw](k, spec[kw]);

// Required, from the same data: ROOT_REQUIRED already lists them.
export function missingFindings(required, record, where) {
  return required.filter((k) => record?.[k] === undefined).map((k) => `${where}: no ${k}`);
}

// Which members a container must hold, read off the row itself: `items.$ref`
// and `additionalProperties.$ref` both mean "every member is an object". So a
// new container field needs no entry anywhere -- see rules/shape.mjs.
export const memberRef = (spec) => spec?.items?.$ref ?? spec?.additionalProperties?.$ref ?? null;
