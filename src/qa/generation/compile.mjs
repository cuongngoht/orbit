// From an ACCEPTED criterion's structured expectation to the predicate a generated test is judged
// by (ADR 0031, 0038).
//
// The host proposes WHICH criterion slot a step rules on, and with which approved template. The
// engine writes the predicate: the template the expectation's op compiles to, the path the step's
// OUTPUTS put that meaning at -- the pinned adapter's or the capability's, handed in -- and the
// value exactly as the criterion's owner wrote it. Nothing the host sends is a value, a path or a
// window, so whoever proposes a design cannot weaken an assertion into passing, and a predicate
// edited afterwards no longer has the digest the design pinned (src/run/evaluator.mjs).
//
// What does not map is REFUSED with its reason -- a criterion nobody accepted, a template its op
// does not compile to or its obligation's shape does not allow, a meaning the step's answer does
// not carry, a window on an observation that cannot say it saw everything -- and never guessed.
import { operationFor } from "../../adapters/families.mjs";
import { predicateDigest, predicateFindings, renderOf } from "../../predicate.mjs";
import { MEANINGS, meaningAt, meaningEntries } from "../../topology/vocab.mjs";
import { EXPECT_OP } from "../vocab.mjs";

const VALUE_FIELD = { in: "values", ordered: "values" };
const COMPLETENESS = "observation.completeness";

// One assertion: { criterionRef, template, step } against the accepted expectations and the step's
// declared outputs. Answers { tree, window? } or { refused }.
// The shape's templates bind the obligation's OWN slots (`expected`); another accepted slot a design rules with -- a
// positive control's, a completion barrier's window -- compiles to what its own op says.
export function compiledAssertion(assertion, { expectations, outputsOf, shape, expected }) {
  const expectation = expectations.get(assertion.criterionRef);
  const refused = mappingProblem(assertion, expectation, (expected ?? [assertion.criterionRef]).includes(assertion.criterionRef) ? shape : null);
  if (refused) return { refused };
  return treeFor(assertion, expectation, outputsOf(assertion.step) ?? {});
}

function mappingProblem(a, e, shape) {
  const op = e ? EXPECT_OP.get(e.op) : null;
  if (!e) return `${a.criterionRef} is not an expectation of an ACCEPTED criterion — a draft or an unknown slot prepares a test and never rules on one`;
  if (!op || op.template !== a.template) return `${a.criterionRef} says ${e.op}, which compiles to ${op?.template ?? "nothing"} — not to ${a.template}`;
  return shape && !shape.templates.includes(a.template) ? `the ${shape.id} obligation does not rule with ${a.template} — it allows ${shape.templates.join(", ")}` : null;
}

function treeFor(a, e, outputs) {
  const path = pathOf(outputs, judgedMeaning(e), a.template);
  if (path.refused) return path;
  const window = EXPECT_OP.get(e.op).window ? windowOf(outputs, e) : {};
  if (window.refused) return window;
  return checked({ template: a.template, path: path.path, ...valueOf(e), ...(window.completeness ? { completeness: window.completeness } : {}), means: e.property }, window.waitMs);
}

// What a verdict reads: the property itself, or -- for a schema -- whether the answer conformed,
// which the helper that holds the pinned schema says (`schema.valid`).
const judgedMeaning = (e) => (e.op === "conforms" ? "schema.valid" : e.property);

const valueOf = (e) => (e.op === "conforms" ? {} : { [VALUE_FIELD[e.op] ?? "value"]: e.value });

function checked(tree, waitMs) {
  const wrong = predicateFindings(tree);
  return wrong.length ? { refused: `the compiled predicate would not be one the evaluator judges — ${wrong.join("; ")}` } : { tree, ...(waitMs ? { window: { waitMs } } : {}) };
}

// ── where a meaning is in an answer ────────────────────────────────────────

// The field whose declared meaning is the property, or a prefix of it (response.body.error is
// inside response.body). A count of something only answered as a list counts that list
// (effect.count of effect.value). Two fields that mean it are ambiguous, never a choice.
function pathOf(outputs, property, template) {
  const direct = fieldsMeaning(outputs, property);
  if (direct.length > 1) return { refused: `the step's answer has ${direct.length} fields that mean ${property} — which one is a choice, and the compiler makes none` };
  if (direct.length === 1) return { path: direct[0] };
  return countedPath(outputs, property, template);
}

function fieldsMeaning(outputs, property) {
  const entries = meaningEntries(outputs).filter(([, means]) => property === means || property.startsWith(`${means}.`));
  return entries.map(([field, means]) => `${field}${property.slice(means.length)}`);
}

function countedPath(outputs, property, template) {
  const of = MEANINGS.find((m) => m.id === meaningAt(property)?.id)?.countOf;
  const lists = of && template.startsWith("count-") ? fieldsMeaning(outputs, of).filter((f) => f.includes("[]")) : [];
  if (lists.length === 1) return { path: lists[0].slice(0, lists[0].lastIndexOf("[]") + 2) };
  return { refused: `the step's answer carries nothing that means ${property} — its declared outputs are ${meaningEntries(outputs).map(([f, m]) => `${f}=${m}`).join(", ") || "none"}` };
}

// An absence or a completion is claimed within the criterion's own window, on an observation that
// says whether it saw everything.
function windowOf(outputs, e) {
  const completeness = fieldsMeaning(outputs, COMPLETENESS);
  if (!Number.isInteger(e.within) || e.within < 1) return { refused: `${e.id} claims ${e.op} with no window — only its source may give one` };
  return completeness.length === 1 ? { completeness: completeness[0], waitMs: e.within * 1000 } : { refused: `${e.op} is claimed on an observation that cannot say whether it saw everything — the step's answer has no ${COMPLETENESS}` };
}

// ── a whole design ─────────────────────────────────────────────────────────

// Every assertion compiled; each step's predicate (one, or all of several) rendered and digested;
// the mapping verdict per assertion. A design with a refused assertion compiles nothing for the step
// it was on -- a step is never judged by part of what it was meant to rule on.
export function compileDesign(design, context) {
  const results = [...(design.assertions ?? []), ...triggerEvidence(design)].map((a) => ({ a, r: a.structural ? structuralTree(a, context) : compiledAssertion(a, context) }));
  const mapping = results.map(({ a, r }) => ({ criterionRef: a.criterionRef ?? null, ...(a.structural ? { structural: a.structural } : {}), template: a.template ?? r.tree?.template ?? null, step: a.step, verdict: r.refused ? "refused" : "mapped", ...(r.refused ? { why: r.refused } : {}) }));
  const steps = stepsOf(results);
  return { steps, mapping, digests: Object.fromEntries(Object.entries(steps).map(([i, s]) => [i, s.digest])), windows: results.filter(({ r }) => r.window).map(({ a, r }) => ({ step: a.step, waitMs: r.window.waitMs })) };
}

function stepsOf(results) {
  const byStep = new Map();
  for (const x of results) byStep.set(String(x.a.step), [...(byStep.get(String(x.a.step)) ?? []), x]);
  const whole = [...byStep].filter(([, rs]) => rs.every(({ r }) => r.tree));
  return Object.fromEntries(whole.map(([i, rs]) => [i, stepPredicate(rs.map(({ r }) => r.tree))]));
}

function stepPredicate(trees) {
  const tree = trees.length === 1 ? trees[0] : { template: "all", of: trees };
  return { expect: renderOf(tree), digest: predicateDigest(tree), proves: provesOf(trees) };
}

// Which layer a step's verdict rules on: the layer of the meanings it reads (src/topology/vocab.mjs
// MEANINGS), the first that has one -- an interface's answer otherwise.
function provesOf(trees) {
  const layers = trees.map((t) => MEANINGS.find((m) => m.id === meaningAt(String(t.means ?? ""))?.id)?.layer).filter(Boolean);
  return layers[0] ?? "api";
}

// A step no accepted criterion speaks about rules on what its own operation's answer shows when the system took it
// (families.mjs `accepted`): the TRIGGER, an observer ARMED before it, a duplicate sent on purpose. A trigger whose
// operation shows nothing of the kind -- an HTTP write -- must be ruled on by a criterion; any other step that shows
// nothing is left for the verdict stage to refuse.
function triggerEvidence(design) {
  const steps = design.skeleton?.steps ?? [];
  const ruled = new Set((design.assertions ?? []).map((a) => a.step));
  const trigger = Number.isInteger(design.trigger?.step) && !ruled.has(design.trigger.step) ? [{ structural: "trigger-accepted", step: design.trigger.step, capability: steps[design.trigger.step - 1]?.capability }] : [];
  return [...trigger, ...steps.map((s, n) => ({ s, step: n + 1 })).filter(({ s, step }) => step !== design.trigger?.step && !ruled.has(step) && operationFor(s?.capability)?.accepted).map(({ s, step }) => ({ structural: "step-accepted", step, capability: s.capability }))];
}

function structuralTree(a, context) {
  const accepted = operationFor(a.capability)?.accepted;
  if (!accepted) return { refused: `the trigger step (${a.step}) asks ${a.capability ?? "nothing"}, whose answer shows nothing of being accepted — an accepted criterion must rule on it` };
  const path = pathOf(context.outputsOf(a.step) ?? {}, accepted.means, accepted.template);
  return path.refused ? path : checked({ template: accepted.template, path: path.path, ...(accepted.value !== undefined ? { value: accepted.value } : {}), means: accepted.means });
}
