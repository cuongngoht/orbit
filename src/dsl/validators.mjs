// Extra rules a project's own extension may apply to a case.
//
// The validator was already a composition of small families (rules/, one file
// per family) and this adds one more link to the same chain rather than a second
// chain beside it. The alternative -- and the thing this exists to prevent -- was
// an extension's needs being met by editing rules/semantic.mjs inside the
// installed plugin, which the next upgrade overwrites, and which would put one
// project's product knowledge in an engine that must not hold any.
//
// The ORDER is fixed and deterministic: core first, always, and extensions after
// in the order they loaded (ids sorted). A rule that ran before the core shape
// check would be a rule walking a container that might be a string.
//
// A rule returns FINDINGS -- strings -- exactly as every core family does, and
// may not throw. A rule that throws is reported as the extension's own defect,
// with its id, rather than as the case being wrong: a generated rule with a bug
// in it must never be able to condemn somebody's test.
import { Refused } from "../errors.mjs";

export const PHASES = ["case", "step"];

export function createValidatorRegistry() {
  const rules = [];
  return {
    register: (given, from) => add(rules, given, from),
    all: () => [...rules],
    where: (phase) => rules.filter((r) => r.phase === phase),
    ids: () => rules.map((r) => r.id),
  };
}

function add(rules, given, from) {
  const list = Array.isArray(given) ? given : [given].filter(Boolean);
  for (const rule of list) one(rules, rule, from);
  return rules.length;
}

function one(rules, rule, from) {
  const bad = problems(rules, rule, from);
  if (bad.length) throw new Refused(`${from ?? "this caller"}: cannot register a validator — ${bad.join("; ")}`);
  rules.push({ ...rule, from: from ?? "core" });
}

function problems(rules, rule, from) {
  if (!isObject(rule) || typeof rule.id !== "string") return ["a validator is an object with an id"];
  const at = `validator "${rule.id}"`;
  if (typeof rule.validate !== "function") return [`${at}: has no validate(subject)`];
  return [...phaseProblem(rule, at), ...takenProblem(rules, rule.id, at)];
}

const phaseProblem = (rule, at) => (PHASES.includes(rule.phase) ? [] : [`${at}: phase must be ${PHASES.join(" or ")}`]);

const takenProblem = (rules, id, at) => {
  const owner = rules.find((r) => r.id === id)?.from;
  return owner ? [`${at}: already registered by ${owner}`] : [];
};

// What the chain actually runs. `subject` is the whole case for a "case" rule
// and one step (with its index and the case around it) for a "step" rule, so a
// rule never has to reconstruct where it is.
export const caseFindings = (validators, c, graph, dsl) =>
  validators.where("case").flatMap((r) => guarded(r, () => r.validate({ case: c, graph, dsl })));

export const stepFindings = (validators, c, steps, graph, dsl) =>
  validators.where("step").flatMap((r) => steps.flatMap((st, i) => guarded(r, () => r.validate({ case: c, step: st, at: i, graph, dsl }))));

// A generated rule with a bug in it condemns nobody's test. It reports itself.
function guarded(rule, run) {
  try { return asFindings(run(), rule); }
  catch (e) { return [`${rule.from}: validator ${rule.id} threw — ${e?.message ?? e}. That is the extension's defect, not the case's.`]; }
}

const asFindings = (out, rule) => (Array.isArray(out) ? out.filter((f) => typeof f === "string").map((f) => `${f} (${rule.id})`) : []);

// A registry with nothing in it, for every caller that means the engine's own
// rules and only those. Frozen, so nobody can register into the default.
export const NO_VALIDATORS = Object.freeze({ all: () => [], where: () => [], ids: () => [], register: () => 0 });

const isObject = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
