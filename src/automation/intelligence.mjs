// What a workflow is planned FROM: the objective, read the way the prompt router reads it, and what the
// project's own owners already say -- each fact one port read, memory first, and an unknown left unknown.
// Nothing here scans a repository, starts anything or asks a model.
//
//   intent · matched   the routing table's word for the objective, and every intent whose cues it hit
//   requirement        when a work item was named: its root and whether a frozen snapshot no question
//                      blocks exists already (then the requirement step is the engine's to read back)
//   startable          what the checkout declares it can start (runtime understanding's memory), so QA of
//                      the running change is planned only where there is something to run
//   capabilities       (1.8.6) every capability the objective needs -- the router's table words, then any a
//                      person or a host NAMED (`--capability`) -- each resolved: provided, or which gap it is
//                      (src/skill-factory/gap.mjs), and whether the skill factory may close it under the
//                      automation policy -- never a capability gap, never past a switch
//   playbook           the first of them: what a playbook workflow is planned for
//
// `missingOf(facts, plan)` says what the plan cannot know yet, and whether a step finds it out or a person must
// say it -- once the workflow is known, since what a playbook workflow lacks is not what a change lacks. An
// acceptance criterion is never invented to fill one.
import { verdictOf } from "./policy.mjs";
import { MAX_CAPABILITIES } from "./vocab.mjs";

const quietly = (fn, fallback) => {
  try { return fn() ?? fallback; }
  catch { return fallback; }
};

function requirementFacts(ports, ref) {
  if (!ref) return null;
  const req = ports.requirements.resolve(ref);
  const looked = quietly(() => ports.requirements.look(req.root), null);
  return { root: req.root, identity: req.identity?.id ?? ref, ready: Boolean(looked?.latest) && looked.blocking === 0, snapshot: looked?.latest ? { id: looked.latest.id, clarity: looked.latest.clarity ?? null, authority: looked.latest.authority ?? null } : null };
}

// Whether the skill factory may close a gap: a WORKFLOW gap only, and only while the automation policy does not
// deny generating an instruction-only playbook.
export const generates = (gap, values) => gap?.kind === "workflow" && gap.generates === true && verdictOf(values, "generate-instruction-skill") !== "deny";

const resolvedOf = (ports) => (capability) => ({ capability, r: quietly(() => ports.resolve(capability), null) });

// One capability's facts. `composes`: the other capabilities the objective needs that ARE provided -- what a
// playbook drafted for this one would compose, and so its shape.
function capabilityFact(ports, values, x, composes) {
  const gap = x.r?.outcome === "provided" ? null : quietly(() => ports.gapOf(x.r, values, composes), null);
  const word = gap?.word ?? (x.r?.outcome === "provided" ? "NO_GAP" : null);
  return { capability: x.capability, outcome: x.r?.outcome ?? "cannot-tell", provider: x.r?.provider ?? null, gap: gap?.kind ?? null, word, shape: gap?.shape ?? null, because: gap?.because ?? x.r?.why ?? null, generates: generates(gap, values) };
}

const unique = (list) => [...new Set(list)];

function capabilitiesOf(ports, values, wanted) {
  const resolved = wanted.map(resolvedOf(ports));
  const provided = resolved.filter((x) => x.r?.outcome === "provided").map((x) => x.capability);
  return resolved.map((x) => capabilityFact(ports, values, x, provided.filter((p) => p !== x.capability)));
}

const named = (spec) => (Array.isArray(spec.capabilities) ? spec.capabilities : []);

const capabilityFacts = (ports, classified, spec, values) => ((list) => capabilitiesOf(ports, values, list).map((c) => ({ ...c, named: named(spec).includes(c.capability) })))(unique([...classified.requirements, ...named(spec)]).slice(0, MAX_CAPABILITIES));

// What the plan cannot know yet: `by` says whether a step of the plan finds it out (`discover`) or only a person
// can say it (`person`). Ordered; every row that holds is listed.
const planHas = (plan, kind) => (plan?.steps ?? []).some((s) => s.kind === kind);

// A capability the plan has a playbook step for, that nothing provides and the skill factory may not close.
const stepped = (plan) => new Set((plan?.steps ?? []).filter((s) => s.kind === "playbook").map((s) => s.for ?? s.provides));

const unclosed = (f, plan) => f.capabilities.filter((c) => stepped(plan).has(c.capability) && c.outcome !== "provided" && !c.generates).map((c) => c.capability);

export const MISSING = [
  { what: "requirement", by: "person", when: (f, plan) => !f.ref && planHas(plan, "engineering"), say: () => "no work item was named: what the change must satisfy is the objective's sentence alone — name one with --ref; an acceptance criterion is never invented" },
  { what: "snapshot", by: "discover", when: (f) => Boolean(f.ref) && f.requirement?.ready !== true, say: () => "the work item has no frozen snapshot that no question blocks: the requirement step settles it first, and a person answers what blocks it" },
  { what: "startable", by: "discover", when: (f, plan) => f.startable.length === 0 && planHas(plan, "engineering"), say: () => "nothing this checkout declares can be started here yet: the runtime step finds out, and a QA step of the running change goes in when it can" },
  { what: "capability", by: "person", when: (f, plan) => unclosed(f, plan).length > 0, say: (f, plan) => `not provided here, and not a gap the skill factory may close: ${unclosed(f, plan).join(", ")} — the step blocks until a person decides` },
];

export const missingOf = (f, plan) => MISSING.filter((m) => m.when(f, plan)).map((m) => ({ what: m.what, by: m.by, say: m.say(f, plan) }));

export function factsOf(ports, spec, values) {
  const classified = ports.classify(spec.objective);
  const capabilities = capabilityFacts(ports, classified, spec, values);
  const base = { objective: spec.objective, ref: spec.ref ?? null, intent: classified.intent.id, confidence: classified.intent.confidence, matched: classified.matched, capabilities, named: named(spec), playbook: capabilities[0] ?? null };
  return { ...base, requirement: requirementFacts(ports, spec.ref), startable: quietly(() => ports.runtime.startable(), []), host: ports.host };
}
