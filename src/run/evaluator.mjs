// How a GENERATED test's `expect` is judged (ADR 0038): a predicate TREE, interpreted by a table
// of templates -- never text handed to `new Function`, which in a process that writes an
// authoritative record could reach `process.getBuiltinModule`, `import()` and so the whole host.
//
// A compiled step's `expect` IS the tree: `compiled:` and its canonical JSON. So what the case shows
// is exactly what is judged; the frozen case's digest already binds it, and a run under a design
// (`ctx.evaluation`, set by the worker request) also holds each step's predicate to the digest the
// design pinned, so an assertion edited after the design -- "true", a weaker value -- is the TEST's
// error, never a pass. A template no row here answers is INVALID_TEST (REFUSED) too.
//
//   { template, path, ... }   templates: the EXPECT_OPS rows' (src/qa/vocab.mjs), plus `all`
//   path                      a dot path into the answer; `name[]` fans out over a list
//
// Three answers, because an observation can be unable to decide: HOLDS; VIOLATED (a FAIL); and
// UNDECIDED -- the answer has no such path, or an absence or a deadline rests on an observation
// that did not stay complete -- which BLOCKS as `incomplete` and can never pass.
import { Blocked, Refused, StepError } from "../errors.mjs";
import { canonicalJson, sha } from "../hash.mjs";

export const COMPILED_PREFIX = "compiled:";
export const HOLDS = "holds";
export const VIOLATED = "violated";
export const UNDECIDED = "undecided";

const MAX_TEXT = 16 * 1024;
const MAX_NODES = 32;
const PATH = /^(\[\]|[A-Za-z0-9_$-]+(\[\])?)(\.[A-Za-z0-9_$-]+(\[\])?)*$/;
const RESERVED = /(^|\.)(__proto__|constructor|prototype)(\[\])?(\.|$)/;
const KEYS = new Set(["template", "path", "value", "values", "completeness", "means", "adapter", "of"]);

const isCompiled = (expect) => typeof expect === "string" && expect.startsWith(COMPILED_PREFIX);

export const renderOf = (tree) => `${COMPILED_PREFIX}${canonicalJson(tree)}`;
export const predicateDigest = (tree) => sha(canonicalJson(tree));

// ── the templates ──────────────────────────────────────────────────────────

const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const verdictOf = (ok) => (ok ? HOLDS : VIOLATED);
const single = (values, test) => verdictOf(values.length === 1 && test(values[0]));
const contains = (value, marker) => canonicalJson(value ?? null).includes(typeof marker === "string" ? marker : canonicalJson(marker));
const sawIt = (values, wanted) => values.some((v) => same(v, wanted));

// The window templates rule only on what an observation that STAYED complete saw.
function windowed(it, p, values, seen) {
  if (seen) return p.template === "absent-within" ? VIOLATED : HOLDS;
  const completeness = valuesAt(it, p.completeness);
  return completeness.known && completeness.values.length === 1 && completeness.values[0] === "complete" ? (p.template === "absent-within" ? HOLDS : VIOLATED) : UNDECIDED;
}

export const TEMPLATES = {
  "value-eq": { needs: ["path", "value"], single: true, judge: (it, p, values) => single(values, (v) => same(v, p.value)) },
  "value-in": { needs: ["path", "values"], single: true, judge: (it, p, values) => single(values, (v) => p.values.some((w) => same(v, w))) },
  "value-excludes": { needs: ["path", "value"], judge: (it, p, values) => verdictOf(values.every((v) => !contains(v, p.value))) },
  "count-eq": { needs: ["path", "value"], judge: (it, p, values) => verdictOf(values.length === p.value) },
  "count-at-most": { needs: ["path", "value"], judge: (it, p, values) => verdictOf(values.length <= p.value) },
  "schema-valid": { needs: ["path"], single: true, judge: (it, p, values) => single(values, (v) => v === true) },
  "order-eq": { needs: ["path", "values"], judge: (it, p, values) => verdictOf(same(values, p.values)) },
  complete: { needs: ["path", "value", "completeness"], judge: (it, p, values) => windowed(it, p, values, sawIt(values, p.value)) },
  "absent-within": { needs: ["path", "value", "completeness"], judge: (it, p, values) => windowed(it, p, values, sawIt(values, p.value)) },
  all: { needs: ["of"], judge: (it, p) => combined(p.of.map((q) => judgedNode(q, it))) },
};

function combined(outcomes) {
  if (outcomes.some((o) => o.outcome === VIOLATED)) return VIOLATED;
  return outcomes.some((o) => o.outcome === UNDECIDED) ? UNDECIDED : HOLDS;
}

// ── reading the answer ─────────────────────────────────────────────────────

// Own properties only: a path reads what the answer SAID, never what its prototype carries.
const at = (value, key) => (value !== null && typeof value === "object" && Object.hasOwn(value, key) ? value[key] : undefined);

export const valuesAt = (it, path) => String(path ?? "").split(".").reduce(stepInto, { known: true, list: false, values: [it] });

function stepInto(acc, segment) {
  if (!acc.known) return acc;
  return segment.endsWith("[]") ? fanned(acc, segment.slice(0, -2)) : fielded(acc, segment);
}

// A list the answer does not have is UNKNOWN, never an empty list.
function fanned(acc, key) {
  const lists = acc.values.map((v) => (key ? at(v, key) : v));
  return lists.every(Array.isArray) ? { known: true, list: true, values: lists.flat() } : { known: false, list: true, values: [] };
}

// A field a single answer does not have is UNKNOWN; inside a list, an item without it is null.
function fielded(acc, key) {
  const got = acc.values.map((v) => at(v, key));
  return { known: acc.list || got[0] !== undefined, list: acc.list, values: got.map((g) => (g === undefined ? null : g)) };
}

// ── judging ────────────────────────────────────────────────────────────────

function judgedNode(p, it) {
  const row = TEMPLATES[p.template];
  if (p.template === "all") return { outcome: row.judge(it, p), why: "all of its parts" };
  const read = valuesAt(it, p.path);
  if (!read.known) return { outcome: UNDECIDED, why: `the answer has no ${p.path}` };
  return { outcome: row.judge(it, p, read.values), why: `${p.template} on ${p.path}` };
}

// What is wrong with a tree as a predicate, before anything is judged. Empty means it may be.
export function predicateFindings(tree) {
  const text = canonicalJson(tree ?? null);
  if (text.length > MAX_TEXT) return [`the predicate is ${text.length} characters, more than ${MAX_TEXT}`];
  if (text.includes("${")) return ["the predicate holds a ${…} placeholder — a compiled predicate is concrete"];
  return nodeFindings(tree, { nodes: 0 }, 0);
}

function nodeFindings(p, count, depth) {
  count.nodes += 1;
  if (!p || typeof p !== "object" || Array.isArray(p)) return ["a predicate is an object"];
  if (count.nodes > MAX_NODES || depth > 3) return [`a predicate holds at most ${MAX_NODES} parts, ${3} deep`];
  const row = TEMPLATES[p.template];
  return row ? [...shapeFindings(p, row), ...(p.template === "all" && Array.isArray(p.of) ? p.of.flatMap((q) => nodeFindings(q, count, depth + 1)) : [])] : [`"${String(p.template).slice(0, 40)}" is not a template this evaluator answers — ${Object.keys(TEMPLATES).join(", ")}`];
}

const SHAPES = [
  (p) => Object.keys(p).filter((k) => !KEYS.has(k)).map((k) => `${p.template}: "${k}" is not a field a predicate has`),
  (p, row) => row.needs.filter((k) => p[k] === undefined).map((k) => `${p.template} needs ${k}`),
  (p) => ["path", "completeness"].filter((k) => p[k] !== undefined && !(typeof p[k] === "string" && PATH.test(p[k]) && !RESERVED.test(p[k]))).map((k) => `${p.template}: ${k} "${String(p[k]).slice(0, 60)}" is not a dot path into the answer`),
  (p, row) => (row.single && String(p.path ?? "").includes("[]") ? [`${p.template} rules on one value, and ${p.path} is a list`] : []),
  (p) => (["count-eq", "count-at-most"].includes(p.template) && !(Number.isInteger(p.value) && p.value >= 0) ? [`${p.template}: value is a whole number`] : []),
  (p) => (p.values !== undefined && !Array.isArray(p.values) ? [`${p.template}: values is a list`] : []),
  (p) => (p.template === "all" && !(Array.isArray(p.of) && p.of.length) ? ["all: of is a list of predicates"] : []),
];

const shapeFindings = (p, row) => SHAPES.flatMap((rule) => rule(p, row));

// ── the step's verdict ─────────────────────────────────────────────────────

// A person's inline `expect` is evaluated as it always was -- unless this run is under a design,
// where every verdict is compiled and an inline one is the test's error.
export const usesEvaluator = (step, ctx) => isCompiled(step?.expect) || ctx?.evaluation?.mode === "compiled";

export function judgeStep(step, it, ctx) {
  const tree = treeOf(step);
  pinned(step, tree, ctx);
  const r = judgedNode(tree, it);
  if (r.outcome === VIOLATED) throw new StepError(`EXPECT FAILED: ${r.why} — ${step.expect.slice(0, 300)}\n     reported: ${JSON.stringify(it)?.slice(0, 500)}`);
  if (r.outcome === UNDECIDED) throw Object.assign(new Blocked(`expect could not be decided — ${r.why}; an observation that could not see everything never lets a verdict pass`), { helperClass: "incomplete" });
}

function treeOf(step) {
  if (!isCompiled(step.expect)) throw new Refused(`step ${step.i}: this run is under a design, and its expect is not a compiled predicate — a generated test is judged only by the predicate its design compiled`);
  const tree = parsedTree(step.expect.slice(COMPILED_PREFIX.length));
  const wrong = predicateFindings(tree);
  if (wrong.length) throw new Refused(`step ${step.i}: its compiled predicate is not one this evaluator judges — ${wrong.join("; ")}`);
  return tree;
}

function parsedTree(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}

// Under a design, the predicate must be the one the design pinned for this step.
function pinned(step, tree, ctx) {
  if (ctx?.evaluation?.mode !== "compiled") return;
  const want = ctx.evaluation.digests?.[String(step.i)];
  if (want !== predicateDigest(tree)) throw new Refused(`step ${step.i}: its predicate is not the one its design pinned${want ? "" : " — the design pinned none for this step"}`);
}
