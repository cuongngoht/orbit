// The vocabulary of a TEST PLAN, defined ONCE -- the same table-of-rows shape
// dsl/fields.mjs uses for a case, and read by the same enforcement.
//
// A plan used to be Markdown, which meant nothing could be checked without
// guessing at prose. The metadata below is the plan; the Markdown is RENDERED
// from it (qa/markdown.mjs), so there is one source and nothing to keep in sync
// by hand. Every `doc` becomes the sentence an editor shows, and every type,
// enum, pattern and minimum is enforced at load time by src/constraints.mjs --
// declared once, never re-written as a rule.
//
// The one field worth reading twice is `expect`: its members are keyed by LAYER,
// and the layers come from the VERB table. A plan cannot commit to a layer this
// engine has no verb for, and the day a verb proves a fourth one, plans can
// speak about it with no edit here.
import { LAYERS } from "../dsl/verbs.mjs";
import { EXECUTIONS, EXPECT_OP_NAMES, LINK_STATE_NAMES, MUTATION_NAMES, NEED_NAMES, PRIORITIES, READINESS_NAMES, REPEAT_NAMES, TECHNIQUE_NAMES } from "./vocab.mjs";
import { FOLDER } from "../tests-tree.mjs";

// A plan id names a file; a member id is quoted in tickets, commits and
// conversations, so it is short, loud and stable.
export const PLAN_ID = /^[a-z0-9][a-z0-9-]*$/;
export const MEMBER_ID = /^[A-Z][A-Z0-9_-]*$/;

export const SCHEMA_VERSION = 1;

const id = (doc) => ({ type: "string", pattern: MEMBER_ID.source, doc });
const lines = (doc) => ({ type: "array", items: { type: "string" }, doc });
const ref = (name, doc) => ({ $ref: `#/definitions/${name}`, doc });
const list = (name, doc) => ({ type: "array", items: { $ref: `#/definitions/${name}` }, doc });

export const PLAN_FIELDS = {
  $schema: { type: "string", doc: "Path to the plan schema, so the editor validates as you type." },
  schema: { type: "integer", minimum: 1, doc: `The metadata version this file is written to. ${SCHEMA_VERSION} is what this engine reads.` },
  id: { type: "string", pattern: PLAN_ID.source, doc: "Must equal the file name without .plan.json." },
  title: { type: "string", doc: "One line a human reads in a list of plans." },
  screen: { type: "string", pattern: FOLDER.source, doc: "The screen (an id in graph/screens.json) whose folder holds this plan: screens/<screen>/<id>.plan.json." },
  feature: { type: "string", doc: "The feature this plan is about, in the team's own words." },
  revision: { type: "string", doc: "This plan's own revision. Evidence recorded against an older one is history, not proof of this one." },
  at: { type: "string", doc: "When this revision was written (ISO date)." },
  author: { type: "string", doc: "Who wrote it — a person to ask, not a signature." },
  scope: ref("scope", "What this plan covers and what it deliberately does not."),
  sources: list("source", "Where the expected behaviour came from, with a revision where one exists. A source that describes the IMPLEMENTATION is marked as such — it says what the code does, never what it should do."),
  map: ref("mapref", "The UI map and build this plan was designed against."),
  environments: { type: "array", items: { type: "string" }, doc: "Which environments this plan is meant to be run against. The project decides what the names mean." },
  budget: ref("budget", "What there is room to run, so selection is a decision instead of an accident."),
  done: lines("What has to be true for this plan to be finished. Written before the work, not after."),
  criteria: list("criterion", "Acceptance criteria with stable IDs. Never invented: if nobody knows, it is an open question."),
  assumptions: list("assumption", "What was taken as true without confirmation — each one a thing that can turn out wrong."),
  questions: list("question", "What nobody could answer, linked to what it blocks. An assumed criterion produces a test that proves the assumption."),
  exclusions: list("exclusion", "Deliberately out of scope, with the reason. Shown in coverage — never silently dropped to flatter a ratio."),
  scenarios: list("scenario", "The scenarios, each one derived with a technique."),
  manual: list("check", "What no browser can observe, as checks a PERSON owns — never a JSON case that would quietly assert nothing."),
  note: { type: "string", doc: "Anything a reader of this plan needs that no field above holds." },
};

export const PLAN_REQUIRED = ["schema", "id", "title", "criteria", "scenarios"];

export const SCOPE_FIELDS = {
  in: lines("What is being tested."),
  out: lines("What is not, so a reader does not assume it was."),
};

export const SOURCE_FIELDS = {
  id: id("Stable id, e.g. REQ1 — criteria cite it."),
  kind: { enum: ["requirement", "ticket", "doc", "conversation", "design", "commit", "code"], doc: "What kind of source. `code` and `commit` describe the IMPLEMENTATION: they say what the product does, which is not evidence of what it should do." },
  ref: { type: "string", doc: "Where to find it — an id, a url, a path." },
  revision: { type: "string", doc: "Which revision was read. Without one, nothing can say whether it has moved since." },
  at: { type: "string", doc: "When it was read." },
  says: { type: "string", doc: "What it says, quoted or summarised." },
  authority: { enum: ["accepted", "draft"], doc: "Whether this is the team's ACCEPTED requirement or still a draft. Absent reads accepted in a committed plan and draft in an agent's draft plan; a criterion from a draft source prepares tests and never confirms a finding." },
  digest: { type: "string", doc: "The digest of what was read, so a source that moved with no new revision is noticed rather than trusted." },
  dialect: { type: "string", doc: "The dialect a contract document is written in -- e.g. openapi-3.1, asyncapi-3.0, json-schema/2020-12 -- so a reader of it is chosen by what it is, never guessed." },
};

export const MAPREF_FIELDS = {
  fe_commit: { type: "string", doc: "The frontend commit the map was at when this plan was designed." },
  captured: { type: "string", doc: "When the map was last confirmed against the running app." },
};

export const BUDGET_FIELDS = {
  minutes: { type: "integer", minimum: 1, doc: "How many minutes of running there is room for." },
  profile: { type: "string", doc: "Which set this budget is for — a name the team uses, such as smoke or release." },
  because: { type: "string", doc: "Where the number came from." },
};

export const CRITERION_FIELDS = {
  id: id("Stable id, e.g. AC1. Quoted in tickets and commits, so it never changes meaning."),
  says: { type: "string", doc: "The criterion, in the words of whoever owns the feature." },
  source: { type: "string", doc: "Which source id it came from." },
  risk: ref("risk", "What it would cost to get this wrong."),
  disposition: ref("disposition", "Only when no scenario covers it: why not, and what happens instead."),
  expects: list("criterionExpect", "What the criterion states as STRUCTURED expectations over observed meanings. Only these can be mapped to an assertion without anybody's judgement; prose still prepares a test, and never confirms one."),
};

// A meaning (src/topology/vocab.mjs MEANINGS), optionally with a sub-path: response.status,
// response.body.error, effect.count.
const MEANING_PATH = /^[a-z][a-zA-Z]*\.[a-zA-Z][a-zA-Z0-9]*(\.[A-Za-z0-9_-]+)*$/;

export const CRITERION_EXPECT_FIELDS = {
  id: id("Stable id, e.g. E1."),
  property: { type: "string", pattern: MEANING_PATH.source, doc: "The observed meaning it is about, e.g. response.status, effect.count, message.id -- never a provider's field name." },
  op: { enum: EXPECT_OP_NAMES, doc: "What must hold of it (src/qa/vocab.mjs EXPECT_OPS)." },
  value: { doc: "The value the criterion states: a number, a word, a list -- exactly as its owner wrote it." },
  within: { type: "integer", minimum: 1, doc: "The window, in seconds, an absence or a completion is claimed within. Required for those two; never invented." },
  because: { type: "string", doc: "Where in the source it says so." },
};

export const DISPOSITION_FIELDS = {
  state: { enum: ["excluded", "deferred", "manual", "open"], doc: "Why this criterion has no scenario. `open` means it is not decided yet — which is a gap, said out loud." },
  because: { type: "string", doc: "The reason. A disposition with no reason is a criterion quietly dropped." },
};

export const ASSUMPTION_FIELDS = {
  id: id("Stable id, e.g. A1."),
  says: { type: "string", doc: "What was assumed." },
  because: { type: "string", doc: "Why it was reasonable to assume it." },
};

export const QUESTION_FIELDS = {
  id: id("Stable id, e.g. Q1."),
  asks: { type: "string", doc: "The question, as it would be put to the person who knows." },
  blocks: { type: "array", items: { type: "string" }, doc: "The criteria and scenarios this question holds up." },
  owner: { type: "string", doc: "Who can answer it. `unassigned` when nobody has been asked yet." },
  state: { enum: ["open", "answered"], doc: "Answered means the answer is in the plan, not in somebody's memory." },
  answer: { type: "string", doc: "What they said, once they said it." },
};

export const EXCLUSION_FIELDS = {
  id: id("Stable id, e.g. X1."),
  says: { type: "string", doc: "What is excluded." },
  because: { type: "string", doc: "Why. Shown in the coverage report beside what was covered." },
  technique: { enum: TECHNIQUE_NAMES, doc: "The technique this exclusion decides against -- a security obligation the plan derived (permission, scoping) is then answered, not owed." },
};

export const RISK_FIELDS = {
  impact: { type: "integer", minimum: 1, maximum: 5, doc: "How bad it is for the business if this is wrong." },
  likelihood: { type: "integer", minimum: 1, maximum: 5, doc: "How likely it is to be wrong." },
  usage: { type: "integer", minimum: 1, maximum: 5, doc: "How often this path is actually used." },
  blast: { type: "integer", minimum: 1, maximum: 5, doc: "How much of the change touches it." },
  history: { type: "integer", minimum: 1, maximum: 5, doc: "How often this area has broken before." },
  because: { type: "string", doc: "Why these numbers. A score with no sentence is a number nobody can argue with." },
};

export const ACTOR_FIELDS = {
  as: { type: "string", doc: "The logical identity that performs it — a kind of user, never a profile name." },
  roles: { type: "array", items: { type: "string" }, doc: "Roles this actor holds." },
  notRoles: { type: "array", items: { type: "string" }, doc: "Roles this actor must NOT hold. This says who is RUNNING; it is not, by itself, evidence the product refused anything." },
  owner: { type: "string", doc: "Who owns the resource being acted on — the actor, or somebody else." },
  tenant: { type: "string", doc: "Which tenant the resource belongs to." },
  state: { type: "string", doc: "The business state the resource is in when the action starts." },
};

export const EXPECTATION_FIELDS = {
  need: { enum: NEED_NAMES, doc: "required = this layer must rule on it · n-a = it does not apply · unverifiable = it applies and nothing here can check it. The third is a capability gap, never a lowered bar." },
  says: { type: "string", doc: "The expected result on this layer, concretely enough to be checked." },
  because: { type: "string", doc: "Why it does not apply, or what is missing. Required for anything but `required`." },
};

export const DENIAL_FIELDS = {
  lacks: { type: "array", items: { type: "string" }, doc: "The permission this actor does NOT have — the thing being tested." },
  action: { type: "string", doc: "What they attempt." },
  ui: { type: "string", doc: "What the screen must do: the control is hidden, disabled, or the attempt shows an error. Required — a permission scenario with no observable refusal proves nothing." },
  backend: ref("expectation", "What the server must do, when there is a way to drive the attempt past the UI. `unverifiable` with a reason is an honest answer; silence is not."),
  unchanged: ref("expectation", "The evidence that nothing changed when the attempt was refused."),
  because: { type: "string", doc: "Why this combination is the one worth testing." },
};

export const REPEAT_FIELDS = {
  kind: { enum: REPEAT_NAMES, doc: "How the action happens a second time. `concurrent` means at the same moment — a sequence described as concurrency tests nothing about racing." },
  expect: { type: "string", doc: "What the CONTRACT says the second attempt produces. Not assumed: a second create is not automatically a duplicate, nor automatically the same status." },
  extra: { type: "string", doc: "What must NOT appear — the second row, the second message, the second charge." },
  guarded: { type: "boolean", doc: "true when the linked case's skip-if guard is there to protect a re-RUN. It protects the run; it is not evidence about the product." },
};

export const MUTATION_FIELDS = {
  kind: { enum: MUTATION_NAMES, doc: "What this scenario changes. Not only create: an update that writes the wrong row is the same class of bug." },
  before: { type: "string", doc: "The state before the action." },
  action: { type: "string", doc: "What is done." },
  after: { type: "string", doc: "The state after — what must be true of the data, not of the screen." },
  unchanged: { type: "array", items: { type: "string" }, doc: "What must have stayed exactly as it was. The half people forget, and where scoping bugs are caught." },
  onRefusal: { type: "string", doc: "What must be true when the action is refused or fails part way." },
  effect: { type: "string", doc: "The \"<screen>/<via>\" the map already traced for this action, so the plan cites the map instead of re-typing it." },
};

export const LIFECYCLE_FIELDS = {
  data: { enum: ["per-run", "fixture", "existing", "none"], doc: "per-run = made fresh and identifiable · fixture = deliberately seeded and shared · existing = whatever is there, which is how order-dependence starts." },
  key: { type: "string", doc: "The business key that identifies this scenario's own data, e.g. a TC- prefixed name." },
  record: { type: "string", doc: "How the record id is obtained when the key is not enough." },
  scope: { type: "string", doc: "Which owner or tenant the data belongs to." },
  cleanup: { type: "string", doc: "How it is put back. SQL verification is read-only here, so cleanup is a UI action, a fixture reset, or a person — never a written statement." },
  onFailure: { type: "string", doc: "What is left behind when the scenario stops half way, and who deals with it." },
  isolation: { type: "string", doc: "How this avoids depending on the order the scenarios run in." },
};

export const ASYNC_FIELDS = {
  accepted: { type: "string", doc: "What the product may legitimately answer immediately — an acknowledgement is not a result." },
  complete: { type: "string", doc: "The business condition that means it actually finished." },
  deadline: { type: "integer", minimum: 1, doc: "How many seconds completion is allowed to take." },
  because: { type: "string", doc: "Where that deadline came from. A number with no source is a guess that will be tuned until the test goes green." },
  observe: { type: "array", items: { enum: LAYERS }, doc: `Which layers are actually watched for completion (${LAYERS.join(", ")}). A reload is not a commit, so the screen alone does not settle it.` },
  unverified: { type: "string", doc: "The part of the flow nothing here can see." },
};

export const BLOCKER_FIELDS = {
  id: id("Stable id, e.g. B1."),
  kind: { enum: ["map", "capability", "data", "environment", "question", "other"], doc: "What kind of thing is in the way. `map` and `capability` block AUTOMATION — they are not a reason to drop the scenario from the plan." },
  says: { type: "string", doc: "What is missing, and what would unblock it." },
};

export const LINK_FIELDS = {
  id: { type: "string", doc: "The case id, found in whichever ui-tests/screens/<screen>/cases/ holds it. One scenario may have several; one case may serve several scenarios." },
  state: { enum: LINK_STATE_NAMES, doc: "How far the case has got. Claimed here and CHECKED against the file — a link claiming `validated` about a case that does not validate is a finding." },
  covers: { type: "string", doc: "Which part of the scenario this case covers, when it does not cover all of it." },
};

export const ESTIMATE_FIELDS = {
  minutes: { type: "integer", minimum: 1, doc: "How long a run takes." },
  because: { type: "string", doc: "What that is based on — a past run, a similar case. Without a basis it is a wish." },
};

export const SCENARIO_FIELDS = {
  id: id("Stable id, e.g. S1."),
  name: { type: "string", doc: "One line: what this scenario does." },
  covers: { type: "array", items: { type: "string" }, doc: "Which criteria (and other scenarios' risks) this covers. Coverage is this list — never guessed from a case name." },
  technique: { enum: TECHNIQUE_NAMES, doc: "How this scenario was derived. Some techniques oblige a block: permission asks for `denial`, idempotency for `repeat`." },
  why: { type: "string", doc: "Why it is worth the time. The answer that is not 'for completeness'." },
  priority: { enum: PRIORITIES, doc: "P1 the feature is broken without it · P2 real but survivable · P3 nice to have." },
  must: { type: "boolean", doc: "true when this one runs in every profile. A must that does not fit the budget is a reported shortfall, never a quiet demotion." },
  profiles: { type: "array", items: { type: "string" }, doc: "Which named sets this belongs to — smoke, regression, release, whatever the team calls them." },
  because: { type: "string", doc: "Why this priority, when the risk numbers would suggest another." },
  risk: ref("risk", "The factors behind the priority. Only the ones there is evidence for."),
  actor: ref("actor", "Who performs it, what they hold, and whose data they touch."),
  preconditions: lines("What must already be true before the first step."),
  data: ref("lifecycle", "Where this scenario's data comes from and what happens to it."),
  intent: lines("What the steps DO, in intent — never selectors. The case writer turns these into edges."),
  expect: { type: "object", additionalProperties: { $ref: "#/definitions/expectation" }, doc: `The expected result per layer (${LAYERS.join(", ")}). Every layer says required, n-a or unverifiable, with a reason — silence about a layer is how a case ends up proving less than it claims.` },
  mutation: ref("mutation", "What changes, what must not, and what happens when it is refused."),
  repeat: ref("repeat", "What happens when the action is performed a second time, or twice at once."),
  async: ref("async", "For anything that finishes after the response: what is accepted, what counts as done, and how long it may take."),
  denial: ref("denial", "For a permission or scoping scenario: who is refused, and how the refusal is OBSERVED."),
  dependsOn: { type: "array", items: { type: "string" }, doc: "Scenario ids that must run first. A cycle here is a finding, not an ordering." },
  blockers: list("blocker", "What stops it today. A blocker is a reason it cannot be automated yet, not a reason to leave it out of the plan."),
  execution: { enum: EXECUTIONS, doc: "auto = a JSON case · manual = a person · mixed = both, and the plan says which part is which." },
  cases: list("link", "The cases that drive it."),
  checks: { type: "array", items: { type: "string" }, doc: "The manual check ids that cover the rest of it." },
  estimate: ref("estimate", "How long it takes, when there is something to base that on."),
  readiness: { enum: READINESS_NAMES, doc: "The DESIGN state only: is enough known to write this. Not whether a case exists, and not whether it passed." },
};

export const SCENARIO_REQUIRED = ["id", "name"];

export const CHECK_FIELDS = {
  id: id("Stable id, e.g. M1."),
  name: { type: "string", doc: "One line: what a person checks." },
  covers: { type: "array", items: { type: "string" }, doc: "The criteria and scenarios this check covers." },
  because: { type: "string", doc: "Why it is not automated — a queue, a mail, a scheduled job, a thing no browser can see." },
  owner: { type: "string", doc: "The person or team who does it. `unassigned` when nobody has been asked — which is honest, and visible." },
  preconditions: lines("What must be true before they start."),
  steps: lines("What they do, in order."),
  expect: { type: "string", doc: "What they must see. A check with no expected result cannot be passed or failed." },
  evidence: lines("What they capture, so somebody else can believe the answer."),
  state: { enum: ["todo", "done", "blocked"], doc: "Where this check is. `done` is a claim about a person's work and needs its evidence." },
  blockers: list("blocker", "What stops it."),
};

export const CHECK_REQUIRED = ["id", "name"];

// Which container holds which member table -- read by the shape walk and by the
// schema generator, so a new container is one row here and nothing else.
export const DEFINITIONS = {
  scope: { table: SCOPE_FIELDS, required: [] },
  source: { table: SOURCE_FIELDS, required: ["id"] },
  mapref: { table: MAPREF_FIELDS, required: [] },
  budget: { table: BUDGET_FIELDS, required: [] },
  criterion: { table: CRITERION_FIELDS, required: ["id", "says"] },
  criterionExpect: { table: CRITERION_EXPECT_FIELDS, required: ["id", "property", "op"] },
  disposition: { table: DISPOSITION_FIELDS, required: ["state", "because"] },
  assumption: { table: ASSUMPTION_FIELDS, required: ["id", "says"] },
  question: { table: QUESTION_FIELDS, required: ["id", "asks"] },
  exclusion: { table: EXCLUSION_FIELDS, required: ["id", "says", "because"] },
  risk: { table: RISK_FIELDS, required: [] },
  actor: { table: ACTOR_FIELDS, required: [] },
  expectation: { table: EXPECTATION_FIELDS, required: ["need"] },
  denial: { table: DENIAL_FIELDS, required: [] },
  repeat: { table: REPEAT_FIELDS, required: ["kind"] },
  mutation: { table: MUTATION_FIELDS, required: ["kind"] },
  lifecycle: { table: LIFECYCLE_FIELDS, required: [] },
  async: { table: ASYNC_FIELDS, required: [] },
  blocker: { table: BLOCKER_FIELDS, required: ["id", "kind", "says"] },
  link: { table: LINK_FIELDS, required: ["id"] },
  estimate: { table: ESTIMATE_FIELDS, required: [] },
  scenario: { table: SCENARIO_FIELDS, required: SCENARIO_REQUIRED },
  check: { table: CHECK_FIELDS, required: CHECK_REQUIRED },
};
