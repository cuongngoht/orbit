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
import { canonicalJson } from "../hash.mjs";
import { isCompiled, parsedPredicate, predicateDigest, predicateFindings } from "../predicate.mjs";

export { COMPILED_PREFIX, predicateDigest, predicateFindings, renderOf } from "../predicate.mjs";

export const HOLDS = "holds";
export const VIOLATED = "violated";
export const UNDECIDED = "undecided";

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

// One judge per template the predicate format declares (src/predicate.mjs TEMPLATE_SHAPES).
export const TEMPLATES = {
  "value-eq": { judge: (it, p, values) => single(values, (v) => same(v, p.value)) },
  "value-in": { judge: (it, p, values) => single(values, (v) => p.values.some((w) => same(v, w))) },
  "value-present": { judge: (it, p, values) => single(values, (v) => v !== null && v !== "") },
  "value-excludes": { judge: (it, p, values) => verdictOf(values.every((v) => !contains(v, p.value))) },
  "count-eq": { judge: (it, p, values) => counted(p, values, (n) => n === p.value) },
  "count-at-most": { judge: (it, p, values) => counted(p, values, (n) => n <= p.value) },
  "schema-valid": { judge: (it, p, values) => single(values, (v) => v === true) },
  "order-eq": { judge: (it, p, values) => verdictOf(same(values, p.values)) },
  complete: { judge: (it, p, values) => windowed(it, p, values, sawIt(values, p.value)) },
  "absent-within": { judge: (it, p, values) => windowed(it, p, values, sawIt(values, p.value)) },
  all: { judge: (it, p) => combined(p.of.map((q) => judgedNode(q, it))) },
};

// A count is how many values a LIST path holds, or the number a count field answered; a field that
// answered anything else cannot be counted, and is undecided.
function counted(p, values, test) {
  const n = String(p.path).includes("[]") ? values.length : values.length === 1 && Number.isInteger(values[0]) ? values[0] : null;
  return n === null ? UNDECIDED : verdictOf(test(n));
}

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

// ── the step's verdict ─────────────────────────────────────────────────────

// A person's inline `expect` is evaluated as it always was -- unless this run is under a design,
// where every verdict is compiled and an inline one is the test's error.
export const usesEvaluator = (step, ctx) => isCompiled(step?.expect) || ctx?.evaluation?.mode === "compiled";

export function judgeStep(step, it, ctx) {
  const tree = treeOf(step);
  pinned(step, tree, ctx);
  const r = judgedNode(tree, it);
  if (r.outcome === VIOLATED) throw Object.assign(new StepError(`EXPECT FAILED: ${r.why} — ${step.expect.slice(0, 300)}\n     reported: ${JSON.stringify(it)?.slice(0, 500)}`), { contradiction: true });
  if (r.outcome === UNDECIDED) throw Object.assign(new Blocked(`expect could not be decided — ${r.why}; an observation that could not see everything never lets a verdict pass`), { helperClass: "incomplete" });
}

function treeOf(step) {
  if (!isCompiled(step.expect)) throw new Refused(`step ${step.i}: this run is under a design, and its expect is not a compiled predicate — a generated test is judged only by the predicate its design compiled`);
  const tree = parsedPredicate(step.expect);
  const wrong = predicateFindings(tree);
  if (wrong.length) throw new Refused(`step ${step.i}: its compiled predicate is not one this evaluator judges — ${wrong.join("; ")}`);
  return tree;
}

// Under a design, the predicate must be the one the design pinned for this step.
function pinned(step, tree, ctx) {
  if (ctx?.evaluation?.mode !== "compiled") return;
  const want = ctx.evaluation.digests?.[String(step.i)];
  if (want !== predicateDigest(tree)) throw new Refused(`step ${step.i}: its predicate is not the one its design pinned${want ? "" : " — the design pinned none for this step"}`);
}
