// Everything an evaluation could reach, judged BEFORE anything is validated: a keyword outside the declared vocabulary,
// a value of the wrong shape, a `$ref` that cannot be followed here. Each is a gap, and a schema with a gap is never
// judged at all -- there is no partial verdict a caller could mistake for a whole one. `$defs` are reached only through
// a `$ref`, as the evaluation reaches them, so an unused definition cannot turn a readable schema into a gap.
import { ANNOTATION, ASSERTING, EXTENSION_PREFIX, UNSUPPORTED } from "./vocab.mjs";
import { SHAPES } from "./shapes.mjs";
import { children, targetOf } from "./resources.mjs";
import { childPath, isObject } from "./json.mjs";

const SHAPE_OF = new Map([...ASSERTING, ...ANNOTATION].map((r) => [r.keyword, r.shape]));
const WHY_NOT = new Map(UNSUPPORTED.map((r) => [r.keyword, r.why]));

// Ordered: the first row that holds names the gap, and a key no row holds is read.
const KEY_GAPS = [
  { holds: (s, k) => WHY_NOT.has(k), why: (s, k) => WHY_NOT.get(k) },
  { holds: (s, k) => !SHAPE_OF.has(k) && !k.startsWith(EXTENSION_PREFIX), why: () => "a keyword this validator does not declare" },
  { holds: (s, k) => SHAPE_OF.has(k) && !SHAPES[SHAPE_OF.get(k)].test(s[k]), why: (s, k) => SHAPES[SHAPE_OF.get(k)].why },
  { holds: (s, k, opts) => k === "format" && opts.assertFormat === true, why: () => "asserting format was asked for, and format is only an annotation here" },
];

export function scan(index, root, opts) {
  const state = { index, opts, seen: new Set(), refs: new Map(), gaps: [...index.gaps] };
  visit(state, root, "#", 0);
  return state;
}

function visit(state, schema, path, depth) {
  if (typeof schema === "boolean" || state.seen.has(schema)) return;
  if (!isObject(schema) || depth > state.index.limits.depth) return noted(state, nodeGap(state, schema, path));
  state.seen.add(schema);
  Object.keys(schema).forEach((key) => judgeKey(state, schema, key, path));
  [...children(schema, path, ["$defs"]), ...followed(state, schema, path)].forEach((c) => visit(state, c.schema, c.path, depth + 1));
}

// One limit is enough to stop: a second "too deep" from the same walk says nothing new.
const isLimit = (gap) => gap.keyword === "limits";
const noted = (state, gap) => (isLimit(gap) && state.gaps.some(isLimit) ? state.gaps.length : state.gaps.push(gap));

const nodeGap = (state, schema, path) => (isObject(schema) ? { keyword: "limits", path, why: `the schema nests deeper than ${state.index.limits.depth} levels` } : { keyword: "(schema)", path, why: "a schema is an object or a boolean" });

function judgeKey(state, schema, key, path) {
  const row = KEY_GAPS.find((r) => r.holds(schema, key, state.opts));
  if (row) state.gaps.push({ keyword: key, path: childPath(path, key), why: row.why(schema, key) });
}

// A readable `$ref` is followed, and what it lands on is remembered for the evaluation.
function followed(state, schema, path) {
  if (typeof schema.$ref !== "string") return [];
  const found = targetOf(state.index, schema);
  if (found.why) return refGap(state, path, found.why);
  state.refs.set(schema, found.schema);
  return [{ schema: found.schema, path: childPath(path, "$ref") }];
}

const refGap = (state, path, why) => {
  state.gaps.push({ keyword: "$ref", path: childPath(path, "$ref"), why });
  return [];
};
