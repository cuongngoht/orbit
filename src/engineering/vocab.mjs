// What an ENGINEERING fact may SAY, as tables -- the same discipline
// src/architecture/vocab.mjs applies to a different question.
//
// Architecture answers "what does this project structurally look like" --
// modules, imports, declared dependencies. Engineering answers "how does this
// project tend or have to build code" -- patterns, conventions, the shape a
// repository pattern takes here, a tenant-scoping rule. Two subjects, so two
// tables; a kind name that reads the same in English (`boundary`, `convention`)
// is not the same fact, because it is derived a different way: architecture's
// from an import graph, engineering's from repeated evidence in the working
// set. The subject that IS identical between them -- confidence, status,
// source provenance -- reuses the exact same words on purpose, never a second
// spelling of one idea, and a test asserts the name sets agree rather than an
// import forcing them to.
//
// Nothing here names a product, a vendor, a stack or a hostname. See
// src/architecture/vocab.mjs's own header for why that line is never crossed.

export const KINDS = [
  { name: "language", doc: "a programming language this project is written in" },
  { name: "framework", doc: "a framework or runtime this project builds on" },
  { name: "pattern", fields: ["appliesWhen", "avoidWhen"], doc: "a design pattern this project uses, or a generic one that could apply", key: "the pattern's name" },
  { name: "convention", doc: "a naming or shaping rule the tree repeats -- a repetition, never by itself an agreement" },
  { name: "boundary", doc: "which layer owns what, demonstrated by repeated example pairs -- not an import graph, which is architecture's own boundary kind" },
  { name: "security", doc: "how identity or authorisation is resolved" },
  { name: "data-isolation", doc: "how tenant- or owner-scoped data is kept scoped" },
  { name: "workflow", doc: "how this project is normally built, tested or shipped" },
  { name: "invariant", onlyStrength: "enforced", doc: "a rule this project enforces on itself -- only ever paired with strength: enforced, which `onlyStrength` makes a checked column rather than a sentence" },
  { name: "extension-point", fields: ["pattern"], doc: "sibling implementations sharing a shape: where a new one of that kind goes" },
];

// WHERE a fact came from. Identical in name and meaning to
// src/architecture/vocab.mjs's SOURCES -- provenance is one concept, not two --
// so a test asserts the two tables' names agree.
export const SOURCES = [
  { name: "repository", verified: true, doc: "tracked source, read through the source port" },
  { name: "package-manifest", verified: true, doc: "a dependency manifest this project commits" },
  { name: "project-config", verified: true, doc: "ui-tests/project.json -- what the project declared about itself" },
  { name: "test-suite", verified: true, doc: "the tests and the gates the project runs on itself" },
  { name: "generated-schema", verified: true, doc: "an artefact this engine generates and can regenerate" },
  { name: "claude-memory", verified: false, doc: "what the host's own project memory says. Useful context; nobody checked it against the code" },
  { name: "human-declared-memory", verified: false, doc: "what a person told this tool. An instruction, never an inference, and never evidence for another fact" },
];

// How sure the tool is that the statement holds -- never how important it is,
// and never how binding it is. Same three words and the same meaning as
// src/architecture/vocab.mjs's CONFIDENCE.
export const CONFIDENCE = [
  { name: "certain", routes: true, doc: "a comparison this tool can show: two or more independent sessions with no contradiction" },
  { name: "possible", routes: false, doc: "one session's worth of evidence, or a heuristic over shape" },
  { name: "unknown", routes: false, doc: "nothing here could determine it" },
];

// Whether the fact still describes the tree. Same three words and the same
// meaning as src/architecture/vocab.mjs's STATUS / src/qa/vocab.mjs's
// FRESHNESS. STALE means NEEDS REVALIDATION and never means false.
export const STATUS = [
  { name: "fresh", counts: true, doc: "the scope's fingerprint is what it was when this was recorded" },
  { name: "stale", counts: false, doc: "the scope moved. Re-read it -- a moved scope is not a wrong fact" },
  { name: "unknown", counts: false, doc: "the scope could not be fingerprinted -- it is gone, has uncommitted edits, or there is no checkout to ask" },
];

// HOW BINDING a fact is on a developer -- the axis architecture facts do not
// have, because architecture never tells anyone what to do. Orthogonal to
// confidence: a fact can be certain and only observed (the tree consistently
// does it, nobody decided it must), or possible and enforced (a gate exists,
// but this tool has only glimpsed it once).
//
// `claimableByObserver` is the rule PHẦN 10 of the brief states outright: an
// AI-authored candidate may report only what a source demonstrates. A gate or a
// test proves `enforced`; only an explicit human/record path may set
// `adopted`. Neither is a grade a token search or a working-set read can earn
// on its own, so an observer's candidate claiming either is refused by
// src/engineering/record.mjs, which reads this column rather than hand-coding
// the two names.
//
// `needsGate` is the second half: a person saying a rule is enforced is not the
// rule being enforced. `enforced` also needs `enforcedBy` naming a gate the
// engine can see (src/engineering/candidate.mjs), so a human statement buys
// `adopted` and only machine evidence buys `enforced`.
export const STRENGTH = [
  { name: "enforced", claimableByObserver: false, needsGate: true, doc: "a gate, a test or a tool in THIS repository demonstrably enforces it" },
  { name: "adopted", claimableByObserver: false, needsGate: false, doc: "the team explicitly decided this -- only human acceptance or an explicit engineering command may set it" },
  { name: "observed", claimableByObserver: true, needsGate: false, doc: "the code consistently does this. Observed is not mandatory" },
  { name: "suggested", claimableByObserver: true, needsGate: false, doc: "generic engineering advice or a design-pattern recommendation. Never blocks" },
];

// How much a fact may STEER a coding agent -- the routing policy, as an ordered
// table over the three axes a fact carries. First match wins, the last always
// matches, and reading the rows in order is reading the policy:
//
//   binding   true only where a gate proves it (CONSTRAINT) or a person decided
//             it (CONVENTION). Nothing an observer saw, however often, binds.
//   minScore  how directly a task must touch the fact before it is shown: a
//             binding fact surfaces on any relevant token or nearby scope, a
//             hint only on a direct subject hit. `possible` is never a rule.
//
// A binding fact whose scope moved is REVALIDATE before it is anything else:
// `stale` means re-check, never false -- and never "still binding, unread".
export const ROUTING = [
  { tier: "REVALIDATE", binding: false, minScore: 1, when: (f) => f.status !== "fresh" && !claimableByObserverRow(f.strength), says: "was binding, but what it watches moved or cannot be settled — re-check before relying on it" },
  { tier: "CONSTRAINT", binding: true, minScore: 1, when: (f) => f.strength === "enforced" && f.confidence === "certain", says: "hard constraint — a gate in this repository enforces it" },
  { tier: "CLAIMED_GATE", binding: false, minScore: 1, when: (f) => f.strength === "enforced", says: "a gate is named but only one session has seen it — confirm the gate before treating it as hard" },
  { tier: "CONVENTION", binding: true, minScore: 1, when: (f) => f.strength === "adopted", says: "project convention — the team decided this; follow it unless told otherwise" },
  { tier: "CONTEXT", binding: false, minScore: 1, when: (f) => f.strength === "observed" && f.confidence === "certain" && f.status === "fresh", says: "strong context — the code consistently does this; not mandatory" },
  { tier: "HINT", binding: false, minScore: 3, when: (f) => f.strength === "observed", says: "hint only — seen, not settled; never a rule" },
  { tier: "ADVICE", binding: false, minScore: 3, when: (f) => f.strength === "suggested", says: "recommendation — generic advice, never blocks" },
  { tier: "UNROUTED", binding: false, minScore: Infinity, when: () => true, says: "not routed — nothing here can say how far it holds" },
];

export const TIERS = ROUTING.map((r) => r.tier);

export const routeOf = (fact) => ROUTING.find((r) => r.when(fact));

const index = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

export const names = (rows) => rows.map((r) => r.name);

export const KIND_NAMES = names(KINDS);
export const SOURCE_NAMES = names(SOURCES);
export const CONFIDENCE_NAMES = names(CONFIDENCE);
export const STATUS_NAMES = names(STATUS);
export const STRENGTH_NAMES = names(STRENGTH);

const BY_KIND = index(KINDS);
const BY_SOURCE = index(SOURCES);
const BY_CONFIDENCE = index(CONFIDENCE);
const BY_STRENGTH = index(STRENGTH);

export const kindRow = (name) => BY_KIND[name] ?? null;

export const verifiedBy = (source) => BY_SOURCE[source]?.verified === true;

export const sourceRow = (name) => BY_SOURCE[name] ?? null;

export const routes = (confidence) => BY_CONFIDENCE[confidence]?.routes === true;

// May an AI observer's own candidate claim this strength unescorted? `false`
// for enforced/adopted routes a claim of either through the human/record path
// instead of straight onto the store.
export const claimableByObserver = (strength) => claimableByObserverRow(strength);

function claimableByObserverRow(strength) {
  return STRENGTH.find((r) => r.name === strength)?.claimableByObserver === true;
}

export const needsGate = (strength) => BY_STRENGTH[strength]?.needsGate === true;

export const fieldsOf = (kind) => BY_KIND[kind]?.fields ?? [];

export const kindsWith = (field) => KINDS.filter((k) => (k.fields ?? []).includes(field)).map((k) => k.name);
