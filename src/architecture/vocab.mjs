// What an architecture fact may SAY, as tables.
//
// Three closed word lists, each with the columns a rule asks of it, so no module
// below ever tests a name: `verifiedBy(source)` rather than
// `source !== "claude-memory"`. That difference is the whole guarantee -- a
// seventh source added next year is a row, and it cannot default to trusted
// because `verified` has no default.
//
// These are a SECOND vocabulary, deliberately, alongside src/qa/vocab.mjs and
// src/dsl/verbs.mjs: a different subject gets its own words. What must not
// happen is the same subject getting two, so the words themselves are the ones
// already in use -- `fresh | stale | unknown` from the plan checker, and
// `certain | possible | unknown` from change impact -- and a test asserts the
// name sets still agree rather than an import forcing them to.
//
// Nothing here names a product, a vendor, a stack or a hostname. A capability
// arrives at RUNTIME, as tokens off a task, and is stored as data. The moment
// a real one appears as a row in this file -- or in a comment in it -- the
// engine has learned a product and the change is wrong.

// What kind of thing a fact is. `fields` lists the extra fields that kind may
// carry, the way a verb's row lists its own -- so a capability's `providedBy`
// on a `module` fact is a finding rather than a field nobody reads.
export const KINDS = [
  { name: "stack", doc: "a language, runtime or framework this project declares a dependency on" },
  { name: "module", doc: "a directory that holds enough of the tracked source to be worth naming" },
  { name: "boundary", doc: "what may know what — either observed from imports, or declared in a document" },
  { name: "capability", fields: ["capability", "providedBy", "optional"], doc: "something this project can actually do or verify. Absence is a fact too, and says where it looked" },
  { name: "convention", doc: "a shape the tree repeats. A repetition, never an agreement — the difference is in `because`" },
  { name: "extension-point", fields: ["pattern"], doc: "sibling directories sharing a shape: where a new integration of that kind goes" },
  { name: "invariant", doc: "a rule this project enforces on itself — a gate a script or a pipeline runs" },
];

// WHERE a fact came from, and whether that place counts as the source tree.
// `verified` is the column that stops a memory statement from being promoted by
// writing a field: `verifiedAgainstSource` is computed from here and is not a
// field anyone may set.
export const SOURCES = [
  { name: "repository", verified: true, doc: "tracked source, read through the source port" },
  { name: "package-manifest", verified: true, doc: "a dependency manifest this project commits" },
  { name: "project-config", verified: true, doc: "ui-tests/project.json — what the project declared about itself" },
  { name: "test-suite", verified: true, doc: "the tests and the gates the project runs on itself" },
  { name: "generated-schema", verified: true, doc: "an artefact this engine generates and can regenerate" },
  { name: "claude-memory", verified: false, doc: "what the host's own project memory says. Useful context; nobody checked it against the code" },
  { name: "human-declared-memory", verified: false, doc: "what a person told this tool. An instruction, never an inference, and never evidence for another fact" },
];

// How sure the tool is that the statement holds -- never how important it is.
// The same three words `src/qa/impact.mjs` reasons with, given a table here
// because this is the first thing that needs to read them as data.
export const CONFIDENCE = [
  { name: "certain", routes: true, doc: "a comparison this tool can show: a manifest declares it, a path is in the listing, a gate exists" },
  { name: "possible", routes: false, doc: "a heuristic over shape. Worth printing, never worth acting on alone" },
  { name: "unknown", routes: false, doc: "nothing here could determine it. A first-class answer, and the reason `unknowns` exists" },
];

// Whether the fact still describes the tree. STALE means NEEDS REVALIDATION and
// never means false -- the distinction `src/learn/recall.mjs` already keeps for
// a lesson, for the same reason: something recorded at an older commit may still
// be the truest thing anybody knows, and hiding it guarantees nobody rechecks it.
export const STATUS = [
  { name: "fresh", counts: true, doc: "the scope's fingerprint is what it was when this was recorded" },
  { name: "stale", counts: false, doc: "the scope moved. Re-read it — a moved scope is not a wrong fact" },
  { name: "unknown", counts: false, doc: "the scope could not be fingerprinted — it is gone, has uncommitted edits, or there is no checkout to ask" },
];

const index = (rows) => Object.fromEntries(rows.map((r) => [r.name, r]));

export const names = (rows) => rows.map((r) => r.name);

export const KIND_NAMES = names(KINDS);
export const SOURCE_NAMES = names(SOURCES);
export const CONFIDENCE_NAMES = names(CONFIDENCE);
export const STATUS_NAMES = names(STATUS);

const BY_KIND = index(KINDS);
const BY_SOURCE = index(SOURCES);
const BY_CONFIDENCE = index(CONFIDENCE);

export const kindRow = (name) => BY_KIND[name] ?? null;

// The one question the provenance rule rests on. Asked of the TABLE, so a fact
// cannot answer it about itself.
export const verifiedBy = (source) => BY_SOURCE[source]?.verified === true;

export const sourceRow = (name) => BY_SOURCE[name] ?? null;

// May a fact of this confidence be acted on -- cited in a recommendation, used
// to answer a capability question? The same shape as `classify.mjs` allowing
// only a high confidence to carry a handoff.
export const routes = (confidence) => BY_CONFIDENCE[confidence]?.routes === true;

// Which extra fields a kind may carry, and which are common to every fact.
export const fieldsOf = (kind) => BY_KIND[kind]?.fields ?? [];

export const kindsWith = (field) => KINDS.filter((k) => (k.fields ?? []).includes(field)).map((k) => k.name);
