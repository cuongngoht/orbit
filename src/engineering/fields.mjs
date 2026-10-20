// The SHAPE of an engineering fact, declared once and enforced from the
// declaration by src/constraints.mjs -- the same leaf src/architecture/fields.mjs
// answers to for a different subject.
//
// `verifiedAgainstSource` and `support` are deliberately NOT settable fields for
// the same reason architecture's `verifiedAgainstSource` is not one: the first
// is computed from `source`'s own row, the second is stamped by reconciliation
// (src/engineering/reconcile.mjs) from how many independent sessions actually
// supplied evidence. A candidate that carries either is a candidate that is
// guessing, and an unknown field is already a finding.
import { CONFIDENCE_NAMES, KIND_NAMES, SOURCE_NAMES, STATUS_NAMES, STRENGTH_NAMES, fieldsOf } from "./vocab.mjs";

// Every fact carries these, whatever its kind.
export const COMMON_FIELDS = {
  id: { type: "string", pattern: "^eng-[a-z][a-z0-9-]*-[0-9a-f]{6,12}$", doc: "Stable id: eng-<kind>-<hash of the subject>. Derived from what the fact is ABOUT, so re-deriving the same fact rewrites one file rather than appending a twin." },
  kind: { enum: KIND_NAMES, doc: "What kind of thing this is. Decides which extra fields are allowed." },
  key: { type: "string", pattern: "^[a-z0-9][a-z0-9:._/#-]*$", doc: "What this fact is ABOUT -- the subject, not the sentence. The id is derived from kind and key, so it is a slug: lower case, no spaces, nothing prose could smuggle in." },
  statement: { type: "string", doc: "One sentence. Never free text out of a file -- that reaches `evidence`, through `quote`, and nothing else." },
  scope: { type: "array", items: { type: "string" }, minItems: 1, doc: "The repo-relative paths this fact is ABOUT. Freshness is measured over exactly these." },
  fingerprint: { type: "string", doc: "What the scope hashed to when this was recorded. Compared, never interpreted." },
  evidence: { type: "array", items: { type: "string" }, minItems: 1, doc: "Tracked paths a reader can open. A path nothing tracks is refused when a fact is recorded." },
  examples: { type: "array", items: { type: "object" }, doc: "Representative { path, role } pairs -- the smallest set a developer should actually read, not every file that matched." },
  source: { enum: SOURCE_NAMES, doc: "Where it came from. Whether that counts as source-verified is read off the table, never claimed here." },
  confidence: { enum: CONFIDENCE_NAMES, doc: "How sure, not how binding. DERIVED by reconciliation from `support`, never supplied: `certain` is two or more independent sessions with no contradiction, anything else is `possible`." },
  strength: { enum: STRENGTH_NAMES, doc: "How binding, not how sure. `enforced` and `adopted` may not be claimed by an AI observer -- see claimableByObserver in vocab.mjs." },
  status: { enum: STATUS_NAMES, doc: "Whether the scope has moved since. `stale` means re-read it, and never means false." },
  because: { type: "string", doc: "Why this confidence and this strength, and not stronger -- and what would settle it if not `certain`/`enforced`." },
  unknowns: { type: "array", items: { type: "string" }, doc: "What this fact could NOT determine. Always present, even when empty." },
  support: { type: "object", doc: "{ examples, sessions, against, seen, contested } -- stamped by reconciliation: `seen`/`contested` are the hashed keys of the sessions that supported or contradicted this, `sessions`/`against` their counts. Never supplied by a candidate." },
  lastSeenBy: { type: "object", doc: "{ host, at } of the most recent session that confirmed this fact. Stamped, so a reader can date the last confirmation." },
  enforcedBy: { type: "array", items: { type: "string" }, minItems: 1, doc: "The tracked gate or test that enforces this -- required for `enforced`, and checked: every path must be tracked and be a gate the architecture facts cite, or the source must be `test-suite`." },
  adoptedBy: { type: "object", doc: "{ host, at } of the explicit human record that set this strength. Stamped by reconciliation, never supplied." },
  at: { type: "string", doc: "When it was recorded. Stamped by the store, not asked for." },
  commit: { type: "string", doc: "The source commit it was recorded against. Structural -- never masked, or nothing could date it." },
};

// Extra fields, allowed only on the kinds whose row lists them.
export const KIND_FIELDS = {
  appliesWhen: { type: "array", items: { type: "string" }, doc: "Conditions under which this pattern is a reasonable choice." },
  avoidWhen: { type: "array", items: { type: "string" }, doc: "Conditions under which this pattern is a poor choice, even though it applies." },
  pattern: { type: "string", doc: "The shape the siblings share, and therefore what a new one has to look like." },
};

export const FACT_FIELDS = { ...COMMON_FIELDS, ...KIND_FIELDS };

// Stamped by the store or by reconciliation rather than supplied, so a
// candidate that carries them is a candidate that is guessing. `id` is here
// because it is DERIVED from kind and key: a candidate naming its own id could
// name any other fact's, and overwrite it.
export const STAMPED = ["id", "at", "commit", "status", "fingerprint", "support", "lastSeenBy", "adoptedBy"];

export const REQUIRED = ["kind", "key", "statement", "scope", "evidence", "source", "confidence", "strength"];

export const COMMON_NAMES = Object.keys(COMMON_FIELDS);

// Which fields this kind may carry: the common ones, plus its own row's.
export const allowedOn = (kind) => [...COMMON_NAMES, ...fieldsOf(kind)];

// A field that exists but belongs to another kind reads differently from one
// nobody ever declared -- src/architecture/fields.mjs's same distinction.
export const misplacedOn = (kind, key) => key in KIND_FIELDS && !allowedOn(kind).includes(key);
