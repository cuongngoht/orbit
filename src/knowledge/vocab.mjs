// What a PROJECT KNOWLEDGE claim may say, as tables -- and nothing about any
// particular project, technology or domain.
//
// Architecture answers "what structurally exists", engineering "how this
// project builds code", intelligence "which technologies, and what for". This
// answers the question under all three: what does this project's concept A
// have to do with concept B, in which context, on what evidence, and how far
// may anybody rely on it. A claim is `subject · relation · object · context`,
// and the kernel knows NONE of those words: a concept is an id, a relation is
// an id whose meaning (if any) arrives as a row (src/extensions/knowledge-v1.mjs
// ROLES), and a context is an open map whose dimensions nobody declares. What
// the kernel does is structural -- shape, identity, scope, evidence,
// reconciliation, precedence, conflict, freshness.
//
// The axes a claim shares with the other memories are the SAME words: strength
// and confidence and status are engineering's, asserted equal by a test, and
// every source this table shares with architecture carries the same name and
// the same `verified`. What is new is said as a COLUMN, so no module below
// ever tests a name.
import { CARDINALITY, ROLES } from "../extensions/knowledge-v1.mjs";

export { CARDINALITY, ROLES };

// WHERE a claim came from. `host`: a coding host's own memory -- context, never
// truth. `recordable`: may a candidate from it enter the store at all (a host's
// memory never does: it is read for one invocation and forgotten).
// `strengths`: what a candidate from it may claim, when its word is all there
// is. `null` means whatever the candidate contract otherwise allows.
export const SOURCES = [
  { name: "repository", verified: true, host: false, recordable: true, strengths: null, doc: "tracked source, read through the source port" },
  { name: "package-manifest", verified: true, host: false, recordable: true, strengths: null, doc: "a dependency manifest this project commits" },
  { name: "project-config", verified: true, host: false, recordable: true, strengths: null, doc: "what the project declared about itself in its own configuration" },
  { name: "test-suite", verified: true, host: false, recordable: true, strengths: null, doc: "the tests and the gates the project runs on itself" },
  { name: "generated-schema", verified: true, host: false, recordable: true, strengths: null, doc: "an artefact this engine generates and can regenerate" },
  { name: "human-declared-memory", verified: false, host: false, recordable: true, strengths: ["adopted", "suggested"], doc: "what a person told this tool — an instruction, never an inference" },
  { name: "host-memory", verified: false, host: true, recordable: false, strengths: ["observed", "suggested"], doc: "what a coding host's own memory says, through a host-memory provider — context for one invocation, never stored, never truth" },
  { name: "investigation", verified: false, host: false, recordable: true, stamped: true, strengths: ["observed"], doc: "what an autonomous investigation verified, citing the journal record it rests on — the engine's own claim, never typed in" },
  { name: "work-receipt", verified: false, host: false, recordable: true, stamped: true, strengths: ["observed", "suggested"], doc: "what a piece of work learned from a provider it asked through the gates, citing the receipt it rests on — the engine's own claim, never typed in, and never a requirement" },
];

// HOW BINDING -- engineering's four words and meanings, asserted equal.
// `observes`: the claim reports what the cited source demonstrably does.
export const STRENGTH = [
  { name: "enforced", claimableByObserver: false, needsGate: true, observes: false, doc: "a gate, a test or a tool in this repository demonstrably enforces it" },
  { name: "adopted", claimableByObserver: false, needsGate: false, observes: false, doc: "a person decided this — only an explicit --human record may set it" },
  { name: "observed", claimableByObserver: true, needsGate: false, observes: true, doc: "the cited source demonstrably does this. Observed is not mandatory" },
  { name: "suggested", claimableByObserver: true, needsGate: false, observes: false, doc: "an inference or a hint — somebody's reading, never a demonstration" },
];

export const CONFIDENCE = [
  { name: "certain", routes: true, doc: "two or more independent sessions supported it, and none contradicted it" },
  { name: "possible", routes: false, doc: "one session's worth of evidence, or a contested one" },
  { name: "unknown", routes: false, doc: "nothing here could determine it" },
];

export const STATUS = [
  { name: "fresh", counts: true, doc: "every scope it watches hashes to what it did when it was recorded" },
  { name: "stale", counts: false, doc: "a scope it watches moved. Re-read it — a moved scope is not a wrong claim" },
  { name: "unknown", counts: false, doc: "nothing could settle it: no scope, a dirty scope, or no checkout to ask" },
];

// WHERE a claim is declared, and what that buys. `stored`: claims at this
// layer live in the project's store (reconciled, journaled). `rules`: a
// person's decision at this layer is a RULE, not a local convention.
export const LAYERS = [
  { name: "orbit", stored: false, rules: false, doc: "Orbit's generic vocabulary, shipped with the plugin — relation rows only" },
  { name: "organization", stored: false, rules: true, doc: "what an organisation declared for its projects, in its own room of the machine store — read, never written by Orbit" },
  { name: "project", stored: true, rules: false, doc: "what this project's sessions recorded, reconciled" },
  { name: "session", stored: false, rules: false, doc: "what a host's memory hinted during ONE invocation — never written anywhere" },
];

// WHY a question is being asked. A verification demands proof, so what cannot
// be proved is the question itself; a change only notes it.
export const PURPOSES = [
  { name: "development", demandsProof: false, doc: "a change is being made: a missing way to prove it is kept, and rarely worth an interruption" },
  { name: "verification", demandsProof: true, doc: "QA, regression, a release or an incident: what nothing can observe is exactly what needs saying" },
];

const index = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

export const names = (rows) => rows.map((r) => r.name);

export const SOURCE_NAMES = names(SOURCES);
export const STRENGTH_NAMES = names(STRENGTH);
export const CONFIDENCE_NAMES = names(CONFIDENCE);
export const STATUS_NAMES = names(STATUS);
export const LAYER_NAMES = names(LAYERS);
export const PURPOSE_NAMES = names(PURPOSES);

const BY_SOURCE = index(SOURCES);
const BY_STRENGTH = index(STRENGTH);
const BY_CONFIDENCE = index(CONFIDENCE);
const BY_STATUS = index(STATUS);
const BY_LAYER = index(LAYERS);
const BY_PURPOSE = index(PURPOSES);
const BY_ROLE = index(ROLES);
const BY_CARDINALITY = index(CARDINALITY);

export const sourceRow = (name) => BY_SOURCE[name] ?? null;
export const verifiedBy = (source) => BY_SOURCE[source]?.verified === true;
export const hostSource = (source) => BY_SOURCE[source]?.host === true;
export const recordable = (source) => BY_SOURCE[source]?.recordable === true;
export const strengthsFor = (source) => BY_SOURCE[source]?.strengths ?? null;
// A source only the engine's STAMPED door records (src/knowledge/record.mjs
// judgeStamped): its evidence is a record the engine keeps, never a path.
export const stampedOnly = (source) => BY_SOURCE[source]?.stamped === true;
export const claimableByObserver = (strength) => BY_STRENGTH[strength]?.claimableByObserver === true;
export const needsGate = (strength) => BY_STRENGTH[strength]?.needsGate === true;
export const observes = (strength) => BY_STRENGTH[strength]?.observes === true;
export const routes = (confidence) => BY_CONFIDENCE[confidence]?.routes === true;
export const counts = (status) => BY_STATUS[status]?.counts === true;
export const storedAt = (layer) => BY_LAYER[layer]?.stored === true;
export const rulesAt = (layer) => BY_LAYER[layer]?.rules === true;
export const demandsProof = (purpose) => BY_PURPOSE[purpose]?.demandsProof === true;
export const roleRow = (role) => BY_ROLE[role] ?? null;
export const competes = (cardinality) => BY_CARDINALITY[cardinality ?? "many"]?.competes === true;

// Which roles carry a column: `rolesWhere("follows")` is the walk, never a list
// of role names in a caller.
export const rolesWhere = (column) => ROLES.filter((r) => r[column]).map((r) => r.name);

// HOW FAR a claim may be relied on -- the ladder the brief asks for, derived
// from the axes a claim already carries rather than stored beside them: an
// explicit rule, then a person's decision, then what current source shows, then
// what independent sessions confirmed, then a host's memory, then everything
// else. First match wins, the last always matches, and every predicate reads a
// column. `measured` is freshness as measured NOW, never the status stamped at
// recording -- a moved scope must not keep a claim at `source`.
export const AUTHORITY = [
  { tier: "rule", binding: true, minScore: 1, when: (c) => (needsGate(c.strength) && routes(c.confidence) && counts(c.measured)) || (rulesAt(c.layer) && !claimableByObserver(c.strength)), says: "a rule — a gate in this repository enforces it, or the organisation declared it" },
  { tier: "adopted", binding: true, minScore: 1, when: (c) => !claimableByObserver(c.strength), says: "a person decided this — follow it unless told otherwise" },
  { tier: "source", binding: false, minScore: 1, when: (c) => verifiedBy(c.source) && counts(c.measured) && observes(c.strength), says: "the current source shows it" },
  { tier: "confirmed", binding: false, minScore: 1, when: (c) => routes(c.confidence) && observes(c.strength) && !hostSource(c.source), says: "two independent sessions, nothing against — the source may have moved since" },
  { tier: "host-memory", binding: false, minScore: 3, when: (c) => hostSource(c.source), says: "the host's memory says so — context for this invocation, never truth" },
  { tier: "inference", binding: false, minScore: 3, when: () => true, says: "one observation, advice or an inference — never a rule" },
];

export const TIERS = AUTHORITY.map((a) => a.tier);

export const authorityOf = (claim) => AUTHORITY.find((row) => row.when({ ...claim, measured: claim.measured ?? claim.status }));

export const rankOf = (tier) => (TIERS.includes(tier) ? TIERS.indexOf(tier) : TIERS.length);

// The weaker of two tiers: what a chain of claims is worth is its weakest link.
export const weaker = (a, b) => (rankOf(a) >= rankOf(b) ? a : b);
