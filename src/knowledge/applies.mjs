// WHEN a claim holds -- matched against the context a question is asked in,
// without knowing what any dimension means.
//
// A claim's context is an open map, and so is a query's. The kernel compares
// them structurally and never interprets a key:
//
//   excluded     a dimension both name has different values: the claim is
//                about somewhere else, and says nothing here
//   holds        every dimension the claim names, the query names with the
//                same value -- including a claim that names none, which holds
//                everywhere and is always SAID to
//   conditional  the claim names a dimension the query did not: it would hold
//                IF that were so, and it is reported with the condition,
//                never as though it held
//
// "More specific" is NESTING and nothing else: a context narrower than another
// has every one of its dimensions, with the same values, and more. Two contexts
// with the same number of dimensions that do not nest are not ranked at all --
// counting dimensions would rank a claim about somewhere else above one that
// holds here.
import { DIMENSION, VALUE } from "./fields.mjs";

const GRADES = [
  { grade: "excluded", when: (c, q) => Object.entries(c).some(([k, v]) => k in q && q[k] !== v) },
  { grade: "holds", when: (c, q) => Object.keys(c).every((k) => k in q) },
  { grade: "conditional", when: () => true },
];

export const GRADE_NAMES = GRADES.map((g) => g.grade);

export const applies = (claimContext, queryContext) => GRADES.find((g) => g.when(claimContext ?? {}, queryContext ?? {})).grade;

// `inner` is strictly narrower than `outer`: it contains `outer`, and more.
export const narrower = (inner, outer) => Object.keys(inner ?? {}).length > Object.keys(outer ?? {}).length && Object.entries(outer ?? {}).every(([k, v]) => inner?.[k] === v);

// Two contexts as one -- or null, when they disagree about a dimension. A
// derivation carries the context along its path this way, and a path whose
// claims hold in incompatible places is no path at all.
export function merged(a, b) {
  const clash = Object.entries(b ?? {}).some(([k, v]) => k in (a ?? {}) && a[k] !== v);
  return clash ? null : { ...(a ?? {}), ...(b ?? {}) };
}

// `k=v,k2=v2` off a command line, into a context and the findings that stop it.
export function parseContext(text) {
  const pairs = String(text ?? "").split(",").map((p) => p.trim()).filter(Boolean).map((p) => p.split("="));
  const findings = pairs.filter((p) => p.length !== 2 || !new RegExp(DIMENSION).test(p[0]) || !new RegExp(VALUE).test(p[1])).map((p) => `--context: "${p.join("=")}" is not dimension=value (lowercase slugs)`);
  return { context: Object.fromEntries(pairs.filter((p) => p.length === 2)), findings };
}

// The dimensions a claim names that the query did not -- what a conditional
// claim is conditional ON.
export const unmet = (claimContext, queryContext) => Object.keys(claimContext ?? {}).filter((k) => !(k in (queryContext ?? {})));
