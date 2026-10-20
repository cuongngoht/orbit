// What WAITS FOR WHAT in a coordinated workflow's plan, and the order its steps are listed in -- tables, never an
// edge a model drew (1.8.6). A workflow row (workflows.mjs) says WHICH kinds an objective gets; DEPENDS says what
// each kind waits for; the capabilities the objective names add a playbook step each, and a WORKFLOW gap the
// skill factory may close adds the two steps that draft and register its playbook first.
//
//   graphOf(specs, facts, values)     -> steps [{ id, kind, provides, after, for?, needs?, because }], in order
//   withSteps(plan, specs, facts)     -> the plan's steps with more added: every id it had kept, every edge drawn
//                                        again, the order taken again (a plan REVISION, replan.mjs)
//   topo(steps)                       -> the steps in dependency order, ties by kind then by where they stood
//
// An edge only ever joins two steps that are both in the plan: no QA step, no edge to it. A step that is FOR a
// capability waits only for the steps of its own capability and for the shared ones; a shared step (review)
// waits for every step of a kind it names. The order is deterministic -- the same facts always plan the same --
// and topological, so every step waits only for steps listed before it (plan.mjs NO_FORWARD_REF holds by
// construction, and a table that drew a cycle would be refused there, never run).
import { short } from "../hash.mjs";
import { KIND_IDS, kindOf } from "./steps.mjs";

export const DEPENDS = {
  requirement: [],
  context: [],
  runtime: ["context"],
  engineering: ["requirement", "context", "runtime"],
  qa: ["engineering", "runtime", "context"],
  regression: ["engineering"],
  review: ["regression", "qa", "playbook"],
  "propose-skill": ["context"],
  "register-skill": ["propose-skill"],
  playbook: ["register-skill", "context", "engineering"],
};

// Why each step is in the plan, in words a person reads beside it -- templated by the engine from the plan's own
// facts, never a host's text.
export const BECAUSE = {
  requirement: (f) => `${f.ref ?? "the work item"} is settled and frozen before anything is built on it`,
  context: () => "what the project already knows is read first, memory first, so no step decides blind",
  runtime: () => "whether the checkout runs here decides how the change is built, tested and investigated",
  engineering: () => "the change itself: made, built and tested in an engineering task of its own",
  qa: (f) => `the running change is investigated against the objective${f.requirement?.identity ? ` and ${f.requirement.identity}` : ""}`,
  regression: () => "every declared test the change reaches must pass after its last change",
  review: () => "the change is held to its plan before the workflow may complete",
  "propose-skill": (f, s) => `nothing here provides ${s.for ?? "the workflow"}: a playbook is drafted for it, instruction-only`,
  "register-skill": (f, s) => `the draft for ${s.for ?? "the workflow"} is held to the contract before anything follows it`,
  playbook: (f, s) => `the objective needs ${s.for ?? "this workflow"}, and its provider's playbook is how it is done`,
};

const BECAUSE_LIMIT = 120;

// ---- the steps a workflow's kinds and an objective's capabilities make ---------------------------------------

const specOf = (spec) => (typeof spec === "string" ? { kind: spec } : spec);

const keyOf = (s) => `${s.kind}|${s.for ?? ""}`;

const deduped = (list) => list.filter((s, i) => list.findIndex((x) => keyOf(x) === keyOf(s)) === i);

const capabilityFacts = (facts) => (facts.capabilities ?? []).filter(Boolean);

const factOf = (facts, capability) => capabilityFacts(facts).find((c) => c.capability === capability) ?? null;

// What the plan's kinds already provide: a capability one of them owns needs no step of its own.
const providedByKinds = (specs) => new Set(specs.map((s) => kindOf(s.kind)?.provides).filter(Boolean));

// A capability a person or a host NAMED for the objective (`--capability`) gets a playbook step of its own,
// unless a kind of the plan already provides it or a step is already for it.
const namedSteps = (specs, facts) => capabilityFacts(facts).filter((c) => c.named && !providedByKinds(specs).has(c.capability) && !specs.some((s) => s.for === c.capability)).map((c) => ({ kind: "playbook", for: c.capability }));

// What a drafted playbook composes: the other capabilities the objective names that ARE provided here.
const composes = (facts, capability) => capabilityFacts(facts).filter((c) => c.capability !== capability && c.outcome === "provided").map((c) => c.capability).slice(0, 6);

const generationOf = (facts) => (s) => [{ kind: "propose-skill", for: s.for, needs: composes(facts, s.for) }, { kind: "register-skill", for: s.for }];

// Draft and register steps before every playbook step whose gap the skill factory may close, as many as a person
// allows one task to generate (`skillFactory.maxSkillsPerTask`); the rest stay plain and block honestly.
const generating = (specs, facts, values) => specs.filter((s) => s.kind === "playbook" && factOf(facts, s.for)?.generates === true).slice(0, values?.skillFactory?.maxSkillsPerTask ?? 1);

const withGeneration = (specs, facts, values) => [...specs, ...generating(specs, facts, values).flatMap(generationOf(facts))];

// ---- ids, edges and why -----------------------------------------------------------------------------------

// A step's id is its kind while the plan holds one step of that kind -- so every plan an earlier release made keeps
// the ids it had -- else its kind and the capability it is for, short enough that the journal's `step.<id>` stays
// a slug (src/task/fields.mjs: 64 characters).
const ID_ROOM = 59;

const slugOf = (text, room) => ((s) => (s.length <= room ? s : `${s.slice(0, room - 7)}-${short(s, 6)}`))(String(text ?? "step").toLowerCase().replace(/[^a-z0-9.-]+/g, "-"));

const idOf = (all, taken) => (s) => (s.id ? s : { ...s, id: all.filter((x) => x.kind === s.kind).length === 1 && !taken.has(s.kind) ? s.kind : `${s.kind}.${slugOf(s.for, ID_ROOM - s.kind.length - 1)}` });

const identified = (steps) => ((taken) => steps.map(idOf(steps, taken)))(new Set(steps.filter((s) => s.id).map((s) => s.id)));

// Whether `step` waits for `other` through the kind it names: a step for a capability waits only for its own
// capability's steps and the shared ones; a shared step waits for every step of the kind.
const waits = (step, other, kind) => other.kind === kind && other !== step && (step.for === undefined || other.for === undefined || other.for === step.for);

const edged = (steps) => steps.map((s) => ({ ...s, after: (DEPENDS[s.kind] ?? []).flatMap((k) => steps.filter((o) => waits(s, o, k)).map((o) => o.id)) }));

// Once ordered, each step's waits are listed in the plan's own order -- read top to bottom like the plan.
const listed = (steps) => steps.map((s) => ({ ...s, after: [...s.after].sort((a, b) => steps.findIndex((x) => x.id === a) - steps.findIndex((x) => x.id === b)) }));

const explained = (facts) => (s) => (s.because ? s : { ...s, because: String(BECAUSE[s.kind](facts, s)).slice(0, BECAUSE_LIMIT) });

const provided = (s) => (s.kind === "playbook" ? s.for ?? null : kindOf(s.kind)?.provides ?? null);

const shaped = (s) => ({ id: s.id, kind: s.kind, provides: provided(s), after: s.after, ...(s.for ? { for: s.for } : {}), ...(s.needs?.length ? { needs: s.needs } : {}), because: s.because });

// ---- the order ------------------------------------------------------------------------------------------

const rankOf = (steps) => (s) => [KIND_IDS.indexOf(s.kind), steps.indexOf(s)];

const earlier = (rank) => (a, b) => rank(a)[0] - rank(b)[0] || rank(a)[1] - rank(b)[1];

const freeOf = (left, done) => left.filter((s) => s.after.every((a) => done.has(a)));

// Kahn's order, the earliest kind first among the steps whose waits are all met. A step that can never be free (a
// cycle) is left where it stood, after the rest -- and NO_FORWARD_REF refuses the plan.
export function topo(steps, done = new Set(), out = []) {
  const left = steps.filter((s) => !done.has(s.id));
  const next = freeOf(left, done).sort(earlier(rankOf(steps)))[0];
  if (!next) return [...out, ...left];
  return topo(steps, new Set([...done, next.id]), [...out, next]);
}

export function graphOf(specs, facts, values) {
  const kinds = deduped(specs.filter(Boolean).map(specOf));
  const steps = withGeneration(deduped([...kinds, ...namedSteps(kinds, facts)]), facts, values);
  return listed(topo(edged(identified(steps)))).map(explained(facts)).map(shaped);
}

export const generationFor = (step, facts = {}) => generationOf(facts)({ for: step.for });

export const withSteps = (plan, specs, facts = {}) => listed(topo(edged(identified(deduped([...plan.steps, ...specs.map(specOf)]))))).map(explained(facts)).map(shaped);
