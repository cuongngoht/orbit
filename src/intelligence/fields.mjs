// The SHAPE of a project intelligence fact, declared once and enforced from the
// declaration by src/constraints.mjs -- src/architecture/fields.mjs's
// discipline, over a different subject.
//
// Every fact carries what an architecture fact carries -- a scope freshness is
// measured over, evidence a reader can open, a source, a confidence, a status,
// and the unknowns it could not settle -- plus the ROOT it belongs to, because a
// project that spans checkouts must never have its technologies flattened into
// one soup: `backend` using one client and `worker` another are two facts.
import { CONFIDENCE_NAMES, KIND_NAMES, SOURCE_NAMES, STATUS_NAMES, fieldsOf } from "./vocab.mjs";

const SLUG = "^[a-z0-9][a-z0-9.-]*$";

export const COMMON_FIELDS = {
  id: { type: "string", pattern: "^intel-[a-z][a-z0-9-]*-[0-9a-f]{6,12}$", doc: "Stable id: intel-<kind>-<hash of the subject>. Derived from kind and key, so re-deriving the same fact rewrites one file." },
  kind: { enum: KIND_NAMES, doc: "What kind of thing this is. Decides which extra fields are allowed, and which stage of a scan replaces it." },
  key: { type: "string", doc: "What this fact is ABOUT, namespaced by its checkout, so the same relative path in two repositories is two subjects." },
  root: { type: "string", doc: "The checkout it belongs to: `.` for the primary, the alias for any other." },
  statement: { type: "string", doc: "One sentence, built from a template filled with computed values. Never text lifted out of a file." },
  scope: { type: "array", items: { type: "string" }, minItems: 1, doc: "The paths this fact is ABOUT. Freshness is measured over exactly these, so an unrelated commit leaves it alone." },
  fingerprint: { type: "string", doc: "What the scope hashed to when this was recorded. Compared, never interpreted." },
  evidence: { type: "array", items: { type: "string" }, minItems: 1, doc: "Tracked paths a reader can open to check it." },
  source: { enum: SOURCE_NAMES, doc: "Where it came from. Whether that counts as source-verified is read off the table, never claimed here." },
  confidence: { enum: CONFIDENCE_NAMES, doc: "How sure, not how important." },
  status: { enum: STATUS_NAMES, doc: "Whether the scope has moved since. `stale` means re-read it, and never means false." },
  because: { type: "string", doc: "Why this confidence and not a higher one." },
  unknowns: { type: "array", items: { type: "string" }, doc: "What this fact could NOT determine. Always present, even when empty." },
  at: { type: "string", doc: "When it was recorded. Stamped, not asked for." },
  commit: { type: "string", doc: "The source commit it was recorded against." },
};

export const KIND_FIELDS = {
  ecosystem: { type: "string", pattern: SLUG, doc: "The ecosystem adapter that read it." },
  ecosystems: { type: "array", items: { type: "string" }, doc: "Every ecosystem a technology was declared through, in this checkout." },
  units: { type: "integer", minimum: 0, doc: "How many buildable units the ecosystem has here." },
  unit: { type: "boolean", doc: "A buildable unit rather than a file other units inherit from." },
  dependencies: { type: "array", items: { type: "object" }, doc: "Every dependency the manifest states — name, relationship, role, condition — RECOGNISED OR NOT. An unrecognised package is still a fact about this project." },
  requires: { type: "object", doc: "Runtime or toolchain ranges the manifest requires, as written." },
  runtime: { type: "string", pattern: SLUG, doc: "The runtime a unit targets." },
  targets: { type: "array", items: { type: "string" }, doc: "What the unit builds for, as the format names it." },
  sdk: { type: "string", doc: "A pinned toolchain version." },
  projectKinds: { type: "array", items: { type: "string" }, doc: "What kind of unit the format declares it to be. Never an inference about what it does." },
  reach: { enum: ["self", "subtree"], doc: "Whether the manifest speaks for itself, or for the units beneath it." },
  appliesTo: { type: "array", items: { type: "string" }, doc: "The units a subtree manifest actually reaches — the nearest one of its name wins." },
  technology: { type: "string", pattern: SLUG, doc: "The descriptor id this is about." },
  category: { type: "string", pattern: SLUG, doc: "The descriptor's category: what kind of thing the technology is." },
  provider: { type: "string", pattern: SLUG, doc: "Who publishes it, as the descriptor says." },
  packages: { type: "array", items: { type: "string" }, doc: "The declared package names the descriptor matched." },
  domains: { type: "array", items: { type: "string" }, doc: "What the descriptor says the technology CAN serve. Knowledge about the technology, never a decision about this project." },
  integration: { type: "string", pattern: SLUG, doc: "The external system the code reaches, when the code names it." },
  operation: { type: "string", pattern: SLUG, doc: "What the code does with it, when the code says. Absent when it does not — that is an answer, not a gap to fill." },
  role: { type: "string", pattern: SLUG, doc: "Which side of an exchange the code is on, when the code says: producer, consumer, publisher, subscriber." },
  signals: { type: "array", items: { type: "string" }, doc: "The identifiers in the code that settled it. What a reader searches for to check." },
  defines: { type: "array", items: { type: "string" }, doc: "The types the evidence files declare, so a registration of one can be traced to what it uses." },
  abstraction: { type: "string", doc: "What a registration is asked for by." },
  implementation: { type: "string", doc: "What answers it. Absent when a factory builds it and the code does not say what type." },
  lifetime: { type: "string", pattern: SLUG, doc: "How long one lives: singleton, scoped, transient — or options, for a bound configuration type." },
  name: { type: "string", doc: "A registration's own name, when it has one." },
  technologies: { type: "array", items: { type: "string" }, doc: "Every technology this project does the operation with. More than one is a finding, not an error." },
  roles: { type: "array", items: { type: "string" }, doc: "Every role the code plays in the integration." },
};

export const FACT_FIELDS = { ...COMMON_FIELDS, ...KIND_FIELDS };

export const REQUIRED = ["kind", "key", "root", "statement", "scope", "evidence", "source", "confidence"];

export const COMMON_NAMES = Object.keys(COMMON_FIELDS);

export const allowedOn = (kind) => [...COMMON_NAMES, ...fieldsOf(kind)];

export const misplacedOn = (kind, key) => key in KIND_FIELDS && !allowedOn(kind).includes(key);
