// What each asserting keyword DOES, one row each, keyed by the keyword it implements -- the Specification pattern:
// a row naming its own subject. A keyword that applies only to one JSON type passes every other type, as 2020-12 says.
// `then`, `else`, `minContains` and `maxContains` are read by the row that owns them (`if`, `contains`).
import { evaluate, fail, quiet } from "./evaluate.mjs";
import { childPath, isMultiple, isObject, jsonType, keyOf, sameJson } from "./json.mjs";

const pass = () => true;
const isNumber = (x) => typeof x === "number";
const isString = (x) => typeof x === "string";
const codePoints = (s) => [...s].length;
const missing = (names, x) => names.filter((n) => !Object.hasOwn(x, n));
const deeper = (at) => at.depth + 1;

const TYPE_TEST = {
  null: (x) => x === null,
  boolean: (x) => typeof x === "boolean",
  object: isObject,
  array: (x) => Array.isArray(x),
  number: isNumber,
  string: isString,
  integer: (x) => Number.isInteger(x),
};

const regex = (ctx, source) => ctx.regexes.get(source) ?? ctx.regexes.set(source, new RegExp(source, "u")).get(source);

// A keyword that judges only one JSON type: anything else passes it untouched.
const only = (applies, keyword, holds, says) => (ctx, v, x, at) => !applies(x) || holds(v, x) || fail(ctx, at.path, keyword, says(v, x));

const each = (results) => results.every(Boolean);
const into = (ctx, schema, x, path, at) => evaluate(ctx, schema, x, path, deeper(at));

const present = (map, x) => Object.entries(map).filter(([k]) => Object.hasOwn(x, k));
const matching = (ctx, pattern, x) => Object.keys(x).filter((k) => regex(ctx, pattern).test(k));
const declared = (schema, k) => Object.hasOwn(schema.properties ?? {}, k);
const patterned = (ctx, schema, k) => Object.keys(schema.patternProperties ?? {}).some((p) => regex(ctx, p).test(k));
const others = (ctx, schema, x) => Object.keys(x).filter((k) => !declared(schema, k) && !patterned(ctx, schema, k));
const prefixOf = (schema) => (Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0);

function conditional(ctx, v, x, at) {
  const holds = quiet(ctx, () => into(ctx, v, x, at.path, at));
  const branch = holds ? at.schema.then : at.schema.else;
  return branch === undefined || into(ctx, branch, x, at.path, at);
}

function containing(ctx, v, x, at) {
  const matched = x.filter((item, i) => quiet(ctx, () => into(ctx, v, item, childPath(at.path, i), at))).length;
  const least = at.schema.minContains ?? 1;
  const most = at.schema.maxContains ?? Infinity;
  return (matched >= least && matched <= most) || fail(ctx, at.path, "contains", `${matched} item(s) match, and between ${least} and ${most} must`);
}

function exactlyOne(ctx, v, x, at) {
  const matched = v.filter((s) => quiet(ctx, () => into(ctx, s, x, at.path, at))).length;
  return matched === 1 || fail(ctx, at.path, "oneOf", `${matched} subschemas match, and exactly one must`);
}

function referenced(ctx, x, at) {
  const target = ctx.refs.get(at.schema);
  return target === undefined ? fail(ctx, at.path, "$ref", "the $ref was not resolved by the scan") : into(ctx, target, x, at.path, at);
}

export const CHECKS = {
  type: (ctx, v, x, at) => [v].flat().some((name) => TYPE_TEST[name](x)) || fail(ctx, at.path, "type", `expected ${[v].flat().join(" or ")}, got ${jsonType(x)}`),
  enum: (ctx, v, x, at) => v.some((e) => sameJson(e, x)) || fail(ctx, at.path, "enum", "not one of the enumerated values"),
  const: (ctx, v, x, at) => sameJson(v, x) || fail(ctx, at.path, "const", "not the constant value"),
  multipleOf: only(isNumber, "multipleOf", (v, x) => isMultiple(x, v), (v) => `not a multiple of ${v}`),
  maximum: only(isNumber, "maximum", (v, x) => x <= v, (v) => `above the maximum ${v}`),
  exclusiveMaximum: only(isNumber, "exclusiveMaximum", (v, x) => x < v, (v) => `not below ${v}`),
  minimum: only(isNumber, "minimum", (v, x) => x >= v, (v) => `below the minimum ${v}`),
  exclusiveMinimum: only(isNumber, "exclusiveMinimum", (v, x) => x > v, (v) => `not above ${v}`),
  maxLength: only(isString, "maxLength", (v, x) => codePoints(x) <= v, (v) => `longer than ${v} code points`),
  minLength: only(isString, "minLength", (v, x) => codePoints(x) >= v, (v) => `shorter than ${v} code points`),
  pattern: (ctx, v, x, at) => !isString(x) || regex(ctx, v).test(x) || fail(ctx, at.path, "pattern", `does not match ${v}`),
  maxItems: only(Array.isArray, "maxItems", (v, x) => x.length <= v, (v) => `more than ${v} items`),
  minItems: only(Array.isArray, "minItems", (v, x) => x.length >= v, (v) => `fewer than ${v} items`),
  uniqueItems: only(Array.isArray, "uniqueItems", (v, x) => !v || new Set(x.map(keyOf)).size === x.length, () => "two items are equal"),
  maxProperties: only(isObject, "maxProperties", (v, x) => Object.keys(x).length <= v, (v) => `more than ${v} properties`),
  minProperties: only(isObject, "minProperties", (v, x) => Object.keys(x).length >= v, (v) => `fewer than ${v} properties`),
  required: only(isObject, "required", (v, x) => missing(v, x).length === 0, (v, x) => `missing ${missing(v, x).join(", ")}`),
  dependentRequired: only(isObject, "dependentRequired", (v, x) => present(v, x).every(([, names]) => missing(names, x).length === 0), () => "a property is present without the properties it requires"),
  allOf: (ctx, v, x, at) => each(v.map((s) => into(ctx, s, x, at.path, at))),
  anyOf: (ctx, v, x, at) => quiet(ctx, () => v.some((s) => into(ctx, s, x, at.path, at))) || fail(ctx, at.path, "anyOf", "no subschema matches"),
  oneOf: exactlyOne,
  not: (ctx, v, x, at) => !quiet(ctx, () => into(ctx, v, x, at.path, at)) || fail(ctx, at.path, "not", "matches the schema it must not"),
  if: conditional,
  then: pass,
  else: pass,
  properties: (ctx, v, x, at) => !isObject(x) || each(present(v, x).map(([k, s]) => into(ctx, s, x[k], childPath(at.path, k), at))),
  patternProperties: (ctx, v, x, at) => !isObject(x) || each(Object.entries(v).flatMap(([p, s]) => matching(ctx, p, x).map((k) => into(ctx, s, x[k], childPath(at.path, k), at)))),
  additionalProperties: (ctx, v, x, at) => !isObject(x) || each(others(ctx, at.schema, x).map((k) => into(ctx, v, x[k], childPath(at.path, k), at))),
  prefixItems: (ctx, v, x, at) => !Array.isArray(x) || each(v.slice(0, x.length).map((s, i) => into(ctx, s, x[i], childPath(at.path, i), at))),
  items: (ctx, v, x, at) => !Array.isArray(x) || each(x.slice(prefixOf(at.schema)).map((item, i) => into(ctx, v, item, childPath(at.path, i + prefixOf(at.schema)), at))),
  contains: (ctx, v, x, at) => !Array.isArray(x) || containing(ctx, v, x, at),
  minContains: pass,
  maxContains: pass,
  propertyNames: (ctx, v, x, at) => !isObject(x) || each(Object.keys(x).map((k) => into(ctx, v, k, childPath(at.path, k), at))),
  dependentSchemas: (ctx, v, x, at) => !isObject(x) || each(present(v, x).map(([, s]) => into(ctx, s, x, at.path, at))),
  $ref: (ctx, v, x, at) => referenced(ctx, x, at),
  $defs: pass,
  $id: pass,
  $schema: pass,
};
