// What a PROJECT INTELLIGENCE fact may say, as tables.
//
// Architecture answers "what structurally exists" -- modules, imports, the
// shape of the tree. Engineering memory answers "how does this project tend,
// or have to, build things". This answers the question between them: WHICH
// technologies are here, and what is each one actually used FOR. Three
// subjects, three vocabularies; the words they share -- confidence, freshness,
// provenance -- are the SAME words, asserted equal by a test rather than
// imported, so none of the three reaches into another for them.
//
// Nothing in this file, or anywhere under src/intelligence/, names an
// ecosystem, a package format, a product or a vendor. A technology arrives as a
// DESCRIPTOR someone registered, a usage as an ANALYSER's canonical output, and
// a manifest as an ecosystem ADAPTER's canonical record. The core only ever
// sees those shapes, which is what makes the next ecosystem a registration.

// What kind of thing a fact is. `stage` is the part of a scan that produces it,
// and therefore the part a rescan REPLACES: re-reading the manifests replaces
// every manifests-stage fact, re-reading a directory replaces the usage-stage
// facts scoped to it, and the derived stage is recomputed from the rest every
// time because it reads nothing. `fields` are its extra fields, the way a
// verb's row lists its own.
export const KINDS = [
  { name: "ecosystem", stage: "manifests", fields: ["ecosystem", "units", "runtime", "targets", "sdk"], doc: "an ecosystem present in one checkout: how many units it has, and what they target" },
  { name: "manifest", stage: "manifests", fields: ["ecosystem", "unit", "dependencies", "requires", "runtime", "targets", "sdk", "projectKinds", "reach", "appliesTo"], doc: "one manifest, read through its adapter: every dependency it states — recognised or not — and how" },
  { name: "technology", stage: "manifests", fields: ["technology", "category", "provider", "ecosystems", "packages", "domains"], doc: "a technology a descriptor recognised among the DECLARED dependencies. Declared, never by itself used" },
  { name: "usage", stage: "usage", fields: ["technology", "integration", "operation", "role", "signals", "defines"], doc: "source code that demonstrably touches a technology — and, where the code says, what for" },
  { name: "wiring", stage: "usage", fields: ["abstraction", "implementation", "lifetime", "name", "signals"], doc: "something registered with a composition root: an abstraction, what implements it, and for how long it lives" },
  { name: "integration", stage: "derived", fields: ["integration", "operation", "technologies", "roles"], doc: "an external system and one operation on it, and which technology this project does it with. Derived from usage, never read" },
];

// The MATURITY of a technology, lowest first. Every rung is reached by a
// different kind of evidence, and none implies the next: a package that is
// declared may never be used, code that uses a client may never say what for,
// and a repetition is a candidate for a pattern, never a rule. `reached` asks
// the facts; it never asks the technology's name.
export const MATURITY = [
  { name: "declared", doc: "a manifest names a package a descriptor recognises", reached: (facts, t) => facts.some((f) => f.kind === "technology" && f.technology === t) },
  { name: "used", doc: "source code touches it", reached: (facts, t) => facts.some((f) => f.kind === "usage" && f.technology === t) },
  { name: "configured", doc: "a composition root registers something that uses it", reached: (facts, t, links) => (links.get(t) ?? []).length > 0 },
  { name: "used-for", doc: "the code shows WHAT it is used for — an operation, not only a client", reached: (facts, t) => facts.some((f) => f.kind === "usage" && f.technology === t && f.operation) },
  { name: "architectural-pattern", doc: "a CANDIDATE: it is wrapped behind this project's own abstractions more than once. Observed is never adopted, and never enforced", reached: (facts, t, links) => (links.get(t) ?? []).filter((w) => w.implementation && w.abstraction !== w.implementation).length >= 2 },
];

// Identical in name and meaning to src/architecture/vocab.mjs's and
// src/engineering/vocab.mjs's tables -- provenance, certainty and freshness are
// one concept each, and test/intelligence-contract.test.mjs asserts the names
// agree.
export const SOURCES = [
  { name: "repository", verified: true, doc: "tracked source, read through the source port" },
  { name: "package-manifest", verified: true, doc: "a dependency manifest this project commits" },
  { name: "project-config", verified: true, doc: "ui-tests/project.json — what the project declared about itself" },
  { name: "test-suite", verified: true, doc: "the tests and the gates the project runs on itself" },
  { name: "generated-schema", verified: true, doc: "an artefact this engine generates and can regenerate" },
  { name: "claude-memory", verified: false, doc: "what the host's own project memory says. Useful context; nobody checked it against the code" },
  { name: "human-declared-memory", verified: false, doc: "what a person told this tool. An instruction, never an inference" },
];

export const CONFIDENCE = [
  { name: "certain", routes: true, doc: "a comparison this tool can show: a manifest declares it, the code names the client and the operation" },
  { name: "possible", routes: false, doc: "a weaker signal: a type name without its namespace, a usage whose purpose the code does not say" },
  { name: "unknown", routes: false, doc: "nothing here could determine it" },
];

export const STATUS = [
  { name: "fresh", counts: true, doc: "the scope's fingerprint is what it was when this was recorded" },
  { name: "stale", counts: false, doc: "the scope moved. Re-read it — a moved scope is not a wrong fact" },
  { name: "unknown", counts: false, doc: "the scope could not be fingerprinted — it is gone, has uncommitted edits, or there is no checkout to ask" },
];

export const names = (rows) => rows.map((r) => r.name);

export const KIND_NAMES = names(KINDS);
export const SOURCE_NAMES = names(SOURCES);
export const CONFIDENCE_NAMES = names(CONFIDENCE);
export const STATUS_NAMES = names(STATUS);
export const MATURITY_NAMES = names(MATURITY);

const index = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

const BY_KIND = index(KINDS);
const BY_SOURCE = index(SOURCES);

export const kindRow = (name) => BY_KIND[name] ?? null;

export const stageOf = (kind) => BY_KIND[kind]?.stage ?? null;

export const kindsIn = (stage) => KINDS.filter((k) => k.stage === stage).map((k) => k.name);

export const fieldsOf = (kind) => BY_KIND[kind]?.fields ?? [];

export const kindsWith = (field) => KINDS.filter((k) => (k.fields ?? []).includes(field)).map((k) => k.name);

export const verifiedBy = (source) => BY_SOURCE[source]?.verified === true;
