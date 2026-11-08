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
import { OPERATIONS, operationFor } from "../../adapters/families.mjs";
import { predicateDigest, predicateFindings, renderOf } from "../../predicate.mjs";
import { MEANINGS, meaningAt, meaningEntries } from "../../topology/vocab.mjs";
import { witnessControls, witnessSteps } from "../backend/skeleton.mjs";
import { witnessStatusOf } from "./page.mjs";
import { EXPECT_OP } from "../vocab.mjs";

const VALUE_FIELD = { in: "values", ordered: "values" };
const COMPLETENESS = "observation.completeness";

// One assertion: { criterionRef, template, step } against the accepted expectations and the step's
// declared outputs. Answers { tree, window? } or { refused }.
// The shape's templates bind the obligation's OWN slots (`expected`); another accepted slot a design rules with -- a
// positive control's, a completion barrier's window -- compiles to what its own op says.
// A refusal about WHICH slot rules WHICH step says where it would (refusalSaid, below).
export function compiledAssertion(assertion, context) {
  const raw = assertionTree(assertion, context);
  return raw.refused ? { refused: refusalSaid(assertion, context, raw) } : raw;
}

function assertionTree(assertion, { expectations, outputsOf, shape, expected }) {
  const expectation = expectations.get(assertion.criterionRef);
  const refused = mappingProblem(assertion, expectation, (expected ?? [assertion.criterionRef]).includes(assertion.criterionRef) ? shape : null);
  if (refused) return { refused, ...(expectation ? {} : { unaccepted: true }) };
  return answerless(assertion.step, outputsOf(assertion.step)) ?? treeFor(assertion, expectation, outputsOf(assertion.step) ?? {});
}

// A step whose answer declares no meaning at all -- one past the skeleton's end, one that is not a call or a page step, a
// call nothing here registers, or one whose resource no adapter here answers -- is said as that, with what to check:
// "its declared outputs are none" read as if the capability could not be ruled on at all.
const answerless = (step, outputs) => (meaningEntries(outputs ?? {}).length ? null : { absent: true, refused: `step ${step} has no answer a verdict can read here — check that the assertion names the step it rules on, counted from 1 as a run counts them, and that the step is a call (or a page's report or api witness) whose capability this project registers and whose resource an adapter here answers` });

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
  return { absent: true, refused: `the step's answer carries nothing that means ${property} — its declared outputs are ${meaningEntries(outputs).map(([f, m]) => `${f}=${m}`).join(", ") || "none"}` };
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
  const results = [...(design.assertions ?? []), ...witnessEvidence(design), ...triggerEvidence(design)].map((a) => ({ a, r: onlyStatus(design, a, a.structural === "fault-witnessed" ? witnessTree(a, context) : a.structural ? structuralTree(a, context) : compiledAssertion(a, context)) }));
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

// An api WITNESS rules on one thing: the status the call the page made answered (src/qa/generation/page.mjs). Any other
// assertion on it is refused, never turned into an expect the verb does not have.
const onlyStatus = (design, a, r) => (design.skeleton?.steps?.[a.step - 1]?.do === "api" && r.tree && witnessStatusOf(r.tree) === undefined ? { refused: `step ${a.step} is an api witness, and it rules only on the status its call answered — a value-eq on response.status` } : r);

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
  const ruled = new Set([...(design.assertions ?? []).map((a) => a.step), ...witnessSteps(design)]);
  const trigger = Number.isInteger(design.trigger?.step) && !ruled.has(design.trigger.step) ? [{ structural: "trigger-accepted", step: design.trigger.step, capability: steps[design.trigger.step - 1]?.capability, verb: steps[design.trigger.step - 1]?.do, witnesses: witnessesAfter(steps, design.trigger.step) }] : [];
  return [...trigger, ...steps.map((s, n) => ({ s, step: n + 1 })).filter(({ s, step }) => step !== design.trigger?.step && !ruled.has(step) && operationFor(s?.capability)?.accepted).map(({ s, step }) => ({ structural: "step-accepted", step, capability: s.capability }))];
}

// The api witnesses after a page step: what the request that step sent was answered, the one place its acceptance shows.
const witnessesAfter = (steps, step) => steps.map((s, n) => ({ s, at: n + 1 })).filter(({ s, at }) => at > step && s?.do === "api").map(({ at }) => at);

// A FAULT control's witness rules on what the control itself says happened: a delivery its observation shows ended at
// the declared point (the open workload protocol's terminal reason `fault:<point>`) -- compiled from the control,
// never proposed, and only for the witnesses src/qa/backend/skeleton.mjs names.
const witnessEvidence = (design) => witnessControls(design).map((c) => ({ structural: "fault-witnessed", step: c.step, point: c.point }));

function witnessTree(a, context) {
  const outputs = context.outputsOf(a.step) ?? {};
  const path = pathOf(outputs, "terminal.reason", "complete");
  const completeness = fieldsMeaning(outputs, COMPLETENESS);
  if (path.refused || completeness.length !== 1) return path.refused ? path : { refused: `the fault's witness (step ${a.step}) cannot say whether it saw everything — its answer has no ${COMPLETENESS}` };
  return checked({ template: "complete", path: path.path, value: `fault:${a.point}`, completeness: completeness[0], means: "terminal.reason" });
}

function structuralTree(a, context) {
  const accepted = operationFor(a.capability)?.accepted;
  if (!accepted) return { refused: `the trigger step (${a.step}) ${a.capability ? `asks ${a.capability}` : `is a ${a.verb ?? "step of nothing"}`}, whose answer shows nothing of being accepted: ${triggerSaid(a, context)} — an accepted criterion must rule on it` };
  const path = pathOf(context.outputsOf(a.step) ?? {}, accepted.means, accepted.template);
  return path.refused ? path : checked({ template: accepted.template, path: path.path, ...(accepted.value !== undefined ? { value: accepted.value } : {}), ...(accepted.values !== undefined ? { values: accepted.values } : {}), means: accepted.means });
}

// ── which accepted slot could rule a step ──────────────────────────────────
//
// ONE answer, given three ways: before a design (the obligation's template, `slotContract`: each slot of its own
// criterion and the kinds of step it rules), in a refusal of a step nothing rules (`rulingSaid`: the slots that rule
// that step), and in a refusal of a slot put where it does not rule (`whereSaid`: the steps, or kinds of step, it
// does). Each compiles the slot at that step exactly as an assertion naming it would be compiled (`assertionTree`), so
// what is shown and what is refused cannot drift, and a slot named is one a design can use, with its template.
//
// Only slots of the obligation's OWN criterion (the criterion its `expected` slots belong to) are named. Another
// criterion's slot may compile on the same step and is never named: it states what another interface answers (another
// endpoint's 200), and a host pointed to it would rule a correct answer against it.
const criterionOf = (ref) => ref.slice(0, ref.lastIndexOf("/"));

const ownCriteria = (context) => [...new Set((context.expected ?? []).map(criterionOf))];

function ownSlotsOf(context) {
  const own = ownCriteria(context);
  return [...(context.expectations ?? new Map())].filter(([ref]) => own.includes(criterionOf(ref))).map(([ref, e]) => ({ ref, e, template: EXPECT_OP.get(e.op)?.template })).filter((s) => s.template);
}

const rules = (slot, step, context) => !assertionTree({ criterionRef: slot.ref, template: slot.template, step }, context).refused;

const answering = (context, outputs) => ({ ...context, outputsOf: () => outputs });

export const slotsRuling = (step, context) => ownSlotsOf(context).filter((s) => rules(s, step, context));

const statesOf = (e) => `${e.property} ${e.op} ${JSON.stringify(e.value ?? null).slice(0, 40)}`;

// A step nothing rules: each slot that rules it with its template and what it states -- or, none, that the criterion
// states nothing this answer carries, with what the answer does carry, so the gap is a person's to close in that
// criterion.
export function rulingSaid(step, context) {
  const slots = slotsRuling(step, context);
  if (slots.length) return `rule it by ${slots.map((s) => `${s.ref} (${s.template}: ${statesOf(s.e)})`).join(" or ")}`;
  return `no slot of ${ownCriteria(context).join(", ") || "its criterion"} states what its answer carries (${meaningEntries(context.outputsOf?.(step) ?? {}).map(([, m]) => m).slice(0, 3).join(", ") || "nothing"}), so its criterion's source must state one`;
}

// A slot nothing rules, or one put on a step that does not carry it: the steps of this design it rules, else the kinds
// of step (`context.kinds`: what each declares its answer carries) whose answer it rules, else that nothing here can --
// or null where no kinds were handed in, which is never "none".
export function whereSaid(ref, context) {
  const slot = { ref, e: context.expectations?.get(ref), template: EXPECT_OP.get(context.expectations?.get(ref)?.op)?.template };
  const steps = Array.from({ length: context.stepCount ?? 0 }, (_, n) => n + 1).filter((step) => slot.template && rules(slot, step, context));
  if (steps.length) return `${ref} (${slot.template}) rules step ${steps.join(" or ")}`;
  return context.kinds ? kindsSaid(slot, context) : null;
}

function kindsSaid(slot, context) {
  const kinds = slot.template ? kindsRuling(slot, context) : [];
  return kinds.length ? `${slot.ref} (${slot.template}) is carried by a step asking ${kinds.join(", ")}` : `no answer a step here can ask carries ${slot.ref}'s ${slot.e?.property ?? "property"}, so nothing here can rule it`;
}

// The kinds of step a slot rules, each as declared: one every adapter of which carries it is named alone; one only some
// of its adapters carry is named with those adapters.
function kindsRuling(slot, context) {
  const kinds = [...new Set((context.kinds ?? []).map((k) => k.kind))];
  return kinds.map((kind) => kindSaid(kind, (context.kinds ?? []).filter((k) => k.kind === kind), slot, context)).filter(Boolean);
}

function kindSaid(kind, variants, slot, context) {
  const ruling = variants.filter((k) => rules(slot, 1, answering(context, k.outputs)));
  if (!ruling.length) return null;
  return ruling.length === variants.length ? kind : `${kind} (${ruling.map((k) => k.by).join(", ")})`;
}

// Before a design: each slot of the obligation's own criterion, whether it is one of its `expected` slots, its
// template, what it states and the kinds of step it rules.
export const slotContract = (context) => ownSlotsOf(context).map((s) => ({ slot: s.ref, own: (context.expected ?? []).includes(s.ref), template: s.template, states: statesOf(s.e), rules: kindsRuling(s, context) }));

// What a refusal of an assertion says beside its reason: a slot nobody accepted, which own slots rule that step; a slot
// put on a step that does not carry it, where it does -- first, where a host reads it.
function refusalSaid(a, context, raw) {
  if (raw.unaccepted) return `${raw.refused}: ${rulingSaid(a.step, context)}`;
  const where = raw.absent ? whereSaid(a.criterionRef, context) : null;
  return where ? `${where}, not step ${a.step} — ${raw.refused}` : raw.refused;
}

// A trigger that drives a page (a click) answers nothing a slot reads: the api witness of the request it sent does, and
// that witness ruled by a slot of the obligation's own criterion is the trigger the refusal names. Anything else is told
// which slot rules the step itself, or that none does.
function triggerSaid(a, context) {
  const witness = a.capability || slotsRuling(a.step, context).length ? undefined : (a.witnesses ?? []).find((step) => slotsRuling(step, context).length);
  return witness ? `make step ${witness}, the api witness of its request, the trigger: ${rulingSaid(witness, context)}` : rulingSaid(a.step, context);
}

// The trigger's rule, said before a design from the same rows triggerEvidence holds a design to.
export const TRIGGER_RULE = `a trigger step whose own operation shows it was accepted (${OPERATIONS.filter((o) => o.accepted).map((o) => o.capability).join(", ")}) is ruled by that; any other trigger step must be ruled by a slot that rules its kind of step -- a page's act by the api witness of the request it sent, made the trigger`;
