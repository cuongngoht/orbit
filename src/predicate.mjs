// The FORMAT of a compiled predicate (ADR 0031, 0038): a leaf both sides read -- the compiler that
// writes one (src/qa/generation/compile.mjs) and the evaluator that judges one (src/run/evaluator.mjs)
// -- so the two can never disagree about what a predicate is, and neither imports the other.
//
//   { template, path, value | values, completeness?, means?, adapter? }   one template
//   { template: "all", of: [ ... ] }                                      all of them
//
// `path` is a dot path into an answer, `name[]` fanning out over a list; a prototype is never a
// segment. A compiled step's `expect` is `compiled:` and the tree's canonical JSON, and its digest
// is the canonical JSON's -- so the case shows exactly what is judged and a design can pin it.
import { canonicalJson, sha } from "./hash.mjs";

export const COMPILED_PREFIX = "compiled:";

const MAX_TEXT = 16 * 1024;
const MAX_NODES = 32;
const MAX_DEPTH = 3;
const PATH = /^(\[\]|[A-Za-z0-9_$-]+(\[\])?)(\.[A-Za-z0-9_$-]+(\[\])?)*$/;
const RESERVED = /(^|\.)(__proto__|constructor|prototype)(\[\])?(\.|$)/;
const KEYS = new Set(["template", "path", "value", "values", "completeness", "means", "adapter", "of"]);

// Every template: the fields it needs, and whether it rules on ONE value (so a list path is wrong).
// The EXPECT_OPS rows (src/qa/vocab.mjs) name these; a test holds the two to each other.
export const TEMPLATE_SHAPES = {
  "value-eq": { needs: ["path", "value"], single: true },
  "value-in": { needs: ["path", "values"], single: true },
  "value-present": { needs: ["path"], single: true },
  "value-excludes": { needs: ["path", "value"] },
  "value-includes": { needs: ["path", "value"], single: true },
  "count-eq": { needs: ["path", "value"] },
  "count-at-most": { needs: ["path", "value"] },
  "schema-valid": { needs: ["path"], single: true },
  "order-eq": { needs: ["path", "values"] },
  complete: { needs: ["path", "value", "completeness"] },
  "absent-within": { needs: ["path", "value", "completeness"] },
  all: { needs: ["of"] },
};

export const isCompiled = (expect) => typeof expect === "string" && expect.startsWith(COMPILED_PREFIX);
export const renderOf = (tree) => `${COMPILED_PREFIX}${canonicalJson(tree)}`;
export const predicateDigest = (tree) => sha(canonicalJson(tree));

export function parsedPredicate(expect) {
  try { return isCompiled(expect) ? JSON.parse(expect.slice(COMPILED_PREFIX.length)) : null; }
  catch { return null; }
}

// What is wrong with a tree as a predicate. Empty means it may be judged.
export function predicateFindings(tree) {
  const text = canonicalJson(tree ?? null);
  if (text.length > MAX_TEXT) return [`the predicate is ${text.length} characters, more than ${MAX_TEXT}`];
  if (text.includes("${")) return ["the predicate holds a ${…} placeholder — a compiled predicate is concrete"];
  return nodeFindings(tree, { nodes: 0 }, 0);
}

function nodeFindings(p, count, depth) {
  count.nodes += 1;
  if (!p || typeof p !== "object" || Array.isArray(p)) return ["a predicate is an object"];
  if (count.nodes > MAX_NODES || depth > MAX_DEPTH) return [`a predicate holds at most ${MAX_NODES} parts, ${MAX_DEPTH} deep`];
  const row = TEMPLATE_SHAPES[p.template];
  return row ? [...shapeFindings(p, row), ...(p.template === "all" && Array.isArray(p.of) ? p.of.flatMap((q) => nodeFindings(q, count, depth + 1)) : [])] : [`"${String(p.template).slice(0, 40)}" is not a template this evaluator answers — ${Object.keys(TEMPLATE_SHAPES).join(", ")}`];
}

const isPath = (v) => typeof v === "string" && PATH.test(v) && !RESERVED.test(v);

const SHAPES = [
  (p) => Object.keys(p).filter((k) => !KEYS.has(k)).map((k) => `${p.template}: "${k}" is not a field a predicate has`),
  (p, row) => row.needs.filter((k) => p[k] === undefined).map((k) => `${p.template} needs ${k}`),
  (p) => ["path", "completeness"].filter((k) => p[k] !== undefined && !isPath(p[k])).map((k) => `${p.template}: ${k} "${String(p[k]).slice(0, 60)}" is not a dot path into the answer`),
  (p, row) => (row.single && String(p.path ?? "").includes("[]") ? [`${p.template} rules on one value, and ${p.path} is a list`] : []),
  (p) => (["count-eq", "count-at-most"].includes(p.template) && !(Number.isInteger(p.value) && p.value >= 0) ? [`${p.template}: value is a whole number`] : []),
  (p) => (p.values !== undefined && !Array.isArray(p.values) ? [`${p.template}: values is a list`] : []),
  (p) => (p.template === "all" && !(Array.isArray(p.of) && p.of.length) ? ["all: of is a list of predicates"] : []),
];

const shapeFindings = (p, row) => SHAPES.flatMap((rule) => rule(p, row));
