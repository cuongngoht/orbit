// The SIDECARS a generated test carries, version 1, as data (doc §4.4; ADR 0031, 0032).
//
// A JSON case keeps exactly the grammar src/dsl/ validates -- the validator refuses a root field
// it does not know, and that is right -- so everything a generated test must ALSO say about
// itself lives beside it, in these documents, owned by QA: which source it rests on and with
// what authority, which obligation it serves, what was designed, which immutable version ran,
// in which sandbox, under which grant, what was observed and what that came to.
//
// Each definition says what a host may PROPOSE and what only the engine may STAMP: an id, a
// digest, an authority, an applicability, a compiled assertion, a verdict. A proposal carrying a
// stamped field is refused BY NAME, never silently dropped (src/qa/obligations/validate.mjs), so
// a model cannot slip "accepted" or "SATISFIED" into a record by writing it. A ref that grants
// anything -- an identity, a resource, a fixture, an observer -- is a logical ALIAS, never a URL,
// an address, a path or a value; the binding resolves it.
import { BOUNDARY_IDS } from "../../topology/vocab.mjs";
import { BACKEND_DEFINITIONS, TRIGGER_KINDS } from "../backend/bindings.mjs";
import { AUTHORITY_IDS } from "./authority.mjs";

export const SIDECAR_API = "orbit.qa-sidecar/v1";

export const ALIAS = /^[a-z][a-z0-9-]{0,63}$/;
export const DIGEST = "^[0-9a-f]{64}$";

const text = (doc) => ({ type: "string", doc });
const texts = (doc) => ({ type: "array", items: { type: "string" }, doc });
const alias = (doc) => ({ type: "string", pattern: ALIAS.source, doc });
const idOf = (prefix, doc) => ({ type: "string", pattern: `^${prefix}-[a-z0-9]{6,40}$`, doc });
const digest = (doc) => ({ type: "string", pattern: DIGEST, doc });
const ref = (name, doc) => ({ $ref: `#/definitions/${name}`, doc });
const list = (name, doc) => ({ type: "array", items: { $ref: `#/definitions/${name}` }, doc });

export const BINDING_TYPES = ["criterion", "api-contract", "message-contract", "schedule-policy", "workflow-contract", "control", "policy", "plan"];
export const METHODS = ["runtime-test", "static-evidence", "design-review", "manual"];
export const APPLICABILITY = ["applicable", "not-applicable", "unknown"];
export const CONTROL_ROLES = ["positive", "negative", "state", "duplicate", "fault"];

export const BINDING_FIELDS = {
  id: idOf("bnd", "The binding's id, stamped from what it binds."),
  type: { enum: BINDING_TYPES, doc: "What kind of source this is." },
  ref: text("The owner record: a requirement snapshot and fact, an accepted source, a catalog control, a plan criterion."),
  locator: text("Where inside it: a criterion id, a pointer into a contract document, a control id."),
  revision: text("The revision the binding read. A source that moves past it makes the obligation stale."),
  digest: digest("The digest of what was read."),
  sourceAuthority: { enum: AUTHORITY_IDS, doc: "Derived from the owner's own answer (src/qa/obligations/authority.mjs), never accepted from a sender." },
  acceptanceRef: text("The owner's acceptance receipt, when there is one."),
  owner: text("Which owner answered."),
  state: { enum: ["fresh", "stale", "conflict"], doc: "Whether the source still says what was bound." },
};

export const APPLICABILITY_FIELDS = {
  state: { enum: APPLICABILITY, doc: "applicable, not-applicable with its reason, or unknown with what would settle it." },
  why: text("Why: the graph refs that made it hold, or the reason it does not apply."),
  refs: texts("The facts the answer rests on."),
  settles: text("What would settle an unknown."),
  by: text("A person, when a person decided it."),
};

export const OBLIGATION_FIELDS = {
  id: idOf("tob", "The obligation's id, stamped."),
  revision: text("Its revision: a design or source change makes a new one; the old is kept."),
  digest: digest("The digest of its content."),
  statement: text("What must be true, in one sentence."),
  shape: text("Which obligation shape it was derived as (src/qa/obligations/shapes.mjs)."),
  target: text("The graph node it is about -- the target component, workload, interface or resource."),
  bindings: texts("The source bindings it rests on."),
  expected: texts("The accepted criterion slots it expects, by id."),
  method: { enum: METHODS, doc: "How it can be verified: a runtime test, static evidence, a design review or a person." },
  applicability: ref("applicability", "Whether it applies here, derived from the graph and the source."),
  authority: { enum: AUTHORITY_IDS, doc: "The weakest authority among its bindings." },
  missingCriterion: text("What no accepted source says yet. Unknown is a legal answer; it is never filled in from the implementation."),
  conflict: text("Which accepted sources disagree."),
  boundary: { enum: BOUNDARY_IDS, doc: "The one boundary it claims: synchronous, publication, delivery, processing, state, scheduler timing or the whole chain." },
};

export const ASSERTION_FIELDS = {
  criterionRef: text("The accepted criterion slot this assertion is mapped to: <criterion id>/<expectation id>."),
  template: text("The approved assertion template it is compiled from."),
  slot: text("Which part of the template the slot fills."),
  step: { type: "integer", minimum: 1, doc: "The step of the skeleton whose answer it rules on, counted from 1 as a run counts them." },
};

export const CONTROL_FIELDS = {
  role: { enum: CONTROL_ROLES, doc: "positive (the allowed case works), negative (the refused case is refused), state (nothing else changed), duplicate (a second attempt on purpose), fault (a declared fault point)." },
  identityRef: alias("The approved identity it runs as."),
  resourceRef: alias("The fixture resource it acts on."),
  why: text("Why this control is the one worth running."),
};

export const TRIGGER_FIELDS = {
  kind: { enum: TRIGGER_KINDS, doc: "How the system under test is made to act." },
  ref: alias("The interface, schedule, channel or step that triggers it."),
};

export const OBSERVATION_PLAN_FIELDS = {
  observerRef: alias("The observer, armed and baselined before the trigger."),
  channelRef: alias("The channel it watches, when it watches one."),
  boundary: { enum: BOUNDARY_IDS, doc: "Which boundary this observation can prove." },
  correlation: text("How a message or an effect is tied to this run: namespace, run, message or occurrence identity, business resource -- never a payload that merely looks the same."),
};

export const DESIGN_FIELDS = {
  id: idOf("tds", "The design's id, stamped."),
  obligation: text("The obligation it serves."),
  digest: digest("The digest of the design."),
  skeleton: { type: "object", doc: "The steps the host proposes, with no expect, js or wait text: the engine compiles those from templates." },
  assertions: list("assertion", "Each assertion slot mapped to an accepted criterion slot and an approved template."),
  controls: list("control", "The controls the obligation's shape asks for."),
  fixtureRefs: texts("The fixture resources it needs, by alias."),
  trigger: ref("trigger", "What makes the system act."),
  observationPlan: list("observation-plan", "What is armed before the trigger, and what each can prove."),
  effectScope: { enum: ["fixture"], doc: "Where it may have effects: the task's own fixture. Anything else is refused at authorization." },
  compiled: { type: "array", doc: "The compiled assertions, template@version with encoded literals and digest -- stamped." },
  mapping: { type: "object", doc: "The mapping verdict: each assertion verified against its slot, or why not -- stamped." },
  temporalContract: ref("temporal", "The deadline and windows, only from an accepted binding -- stamped."),
  budget: { type: "object", doc: "The budget it runs under, never wider than the settings -- stamped." },
};

export const VERSION_FIELDS = {
  testCaseRef: text("The case id."),
  caseDigest: digest("The digest of the frozen case as it ran."),
  version: { type: "integer", minimum: 1, doc: "The version number of this case's design." },
  generatorVersion: text("The engine version that generated it."),
  designRef: text("The design it was compiled from."),
  validatorVersion: text("The validator that held it to the grammar."),
  dslDigest: digest("The digest of the vocabulary it was validated against."),
  extensionsDigest: digest("The digest of the project's extensions it was validated with."),
};

export const EXECUTION_FIELDS = {
  runId: text("The run, by its evidence id."),
  taskId: text("The task that owns the sandbox."),
  attempt: { type: "integer", minimum: 1, doc: "The TEST attempt -- never a delivery attempt." },
  sandboxRef: text("The sandbox it ran in."),
  targetRevision: text("The revision of the system under test."),
  tree: text("The source tree id the sandbox was built from."),
  providerVersion: text("The capability and adapter versions it ran with."),
  policyRevision: text("The policy revision the grant was minted under."),
  authorizationRef: text("The grant it ran under."),
  bindingRefs: texts("The bindings resolved for it, sealed by digest."),
  logicalTrigger: text("The trigger as designed, kept apart from any delivery attempt."),
};

export const RESULT_FIELDS = {
  id: idOf("res", "The result's id."),
  execution: text("The execution it evaluates."),
  obligation: text("The obligation it is about."),
  runnerVerdict: text("What the runner said, read back from its own triage -- never re-judged."),
  verificationOutcome: text("What it came to (src/investigation/verification.mjs VERIFICATION_OUTCOMES)."),
  expected: text("What the accepted contract expected."),
  observedRef: text("Where what was observed is kept."),
  evidenceRefs: texts("The evidence it rests on."),
  gaps: texts("What could not be seen or checked."),
  reproducibility: text("How it reproduces: identical pinned inputs, and what differed between attempts."),
  provedBoundary: { enum: BOUNDARY_IDS, doc: "The boundary this result proves, and no other." },
};

export const ASSESSMENT_FIELDS = {
  id: idOf("asm", "The assessment's id."),
  controlVersion: text("The catalog version its controls were taken from."),
  scopeDigest: digest("The digest of what was in scope."),
  resultRefs: texts("The results it counts."),
  findingRefs: texts("The findings it holds."),
  gapRefs: texts("The gaps it reports, each with its reason."),
  reportRef: text("The report rendered from it."),
  supersedes: text("The assessment revision it replaces, when late evidence made a new one."),
};

const all = (table) => Object.keys(table);

// What may be proposed, what is stamped, and what a host may never write at all.
export const DEFINITIONS = {
  binding: { table: BINDING_FIELDS, required: ["type", "ref"], stamped: ["id", "revision", "digest", "sourceAuthority", "acceptanceRef", "owner", "state"] },
  applicability: { table: APPLICABILITY_FIELDS, required: ["state"], stamped: [] },
  obligation: { table: OBLIGATION_FIELDS, required: ["statement"], stamped: ["id", "revision", "digest", "shape", "applicability", "authority", "conflict", "boundary"] },
  assertion: { table: ASSERTION_FIELDS, required: ["criterionRef", "template"], stamped: [] },
  control: { table: CONTROL_FIELDS, required: ["role"], stamped: [] },
  trigger: { table: TRIGGER_FIELDS, required: ["kind"], stamped: [] },
  "observation-plan": { table: OBSERVATION_PLAN_FIELDS, required: ["observerRef"], stamped: [] },
  design: { table: DESIGN_FIELDS, required: ["obligation"], stamped: ["id", "digest", "compiled", "mapping", "temporalContract", "budget"], aliases: ["fixtureRefs"] },
  version: { table: VERSION_FIELDS, required: ["testCaseRef", "caseDigest", "version"], stamped: all(VERSION_FIELDS), proposable: false },
  execution: { table: EXECUTION_FIELDS, required: ["runId", "attempt"], stamped: all(EXECUTION_FIELDS), proposable: false },
  result: { table: RESULT_FIELDS, required: ["id", "execution", "verificationOutcome"], stamped: all(RESULT_FIELDS), proposable: false },
  assessment: { table: ASSESSMENT_FIELDS, required: ["id"], stamped: all(ASSESSMENT_FIELDS), proposable: false },
  ...BACKEND_DEFINITIONS,
};

export const SIDECAR_KINDS = Object.keys(DEFINITIONS);
