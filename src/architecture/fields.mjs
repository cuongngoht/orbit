// The SHAPE of an architecture fact, declared once and enforced from the
// declaration by src/constraints.mjs -- the same leaf that holds a case field
// and a project.json key to what their own tables say.
//
// So there is no hand-written rule anywhere for "scope must be a non-empty list"
// or "source must be one of these". The row says it; `constraintFindings` checks
// it; a message comes out that names the field and the fix.
//
// `verifiedAgainstSource` is deliberately NOT a field. It is computed from the
// fact's `source` row (`verifiedBy`), so a candidate arriving from an agent
// cannot claim to have been checked against the tree by setting a boolean. An
// unknown field is already a finding, which is what makes that structural rather
// than a convention.
import { CONFIDENCE_NAMES, KIND_NAMES, SOURCE_NAMES, STATUS_NAMES, fieldsOf } from "./vocab.mjs";

// Every fact carries these, whatever its kind.
export const COMMON_FIELDS = {
  id: { type: "string", pattern: "^arch-[a-z][a-z0-9-]*-[0-9a-f]{6,12}$", doc: "Stable id: arch-<kind>-<hash of the subject>. Derived from what the fact is ABOUT, so re-deriving the same fact rewrites one file rather than appending a twin." },
  kind: { enum: KIND_NAMES, doc: "What kind of thing this is. Decides which extra fields are allowed." },
  key: { type: "string", doc: "What this fact is ABOUT — the subject, not the sentence. The id is derived from kind and key, so re-deriving the same fact rewrites one file instead of appending a twin that says the same thing in different words." },
  statement: { type: "string", doc: "One sentence, built from a template filled with computed values. Never free text out of a file — that reaches `evidence`, through `quote`, and nothing else." },
  scope: { type: "array", items: { type: "string" }, minItems: 1, doc: "The repo-relative paths this fact is ABOUT. Freshness is measured over exactly these, which is why an unrelated commit leaves the fact alone." },
  fingerprint: { type: "string", doc: "What the scope hashed to when this was recorded. Compared, never interpreted." },
  evidence: { type: "array", items: { type: "string" }, minItems: 1, doc: "Tracked paths a reader can open. Checked against the source listing when the fact is recorded — a path nothing tracks is refused, which is what stops a guess becoming a fact." },
  source: { enum: SOURCE_NAMES, doc: "Where it came from. Whether that counts as source-verified is read off the table, never claimed here." },
  confidence: { enum: CONFIDENCE_NAMES, doc: "How sure, not how important. `certain` is a comparison this tool can show." },
  status: { enum: STATUS_NAMES, doc: "Whether the scope has moved since. `stale` means re-read it, and never means false." },
  because: { type: "string", doc: "Why this confidence and not a higher one — and, for anything short of `certain`, what would settle it." },
  unknowns: { type: "array", items: { type: "string" }, doc: "What this fact could NOT determine. Always present, even when empty: a section that vanishes teaches the reader that its absence means everything is known." },
  at: { type: "string", doc: "When it was recorded. Stamped by the store, not asked for." },
  commit: { type: "string", doc: "The source commit it was recorded against. Structural — never masked, or nothing could date it." },
};

// Extra fields, allowed only on the kinds whose row lists them.
export const KIND_FIELDS = {
  capability: { type: "string", pattern: "^[a-z0-9][a-z0-9-]*$", doc: "The capability this is about, as tokens. Arrives from the task, never from a list in this engine." },
  providedBy: { type: "string", doc: "What supplies it — a declared dependency, a directory, a configured command. Absent when the answer is that nothing does." },
  optional: { type: "boolean", doc: "Whether the project works without it." },
  pattern: { type: "string", doc: "The shape the siblings share, and therefore what a new one has to look like." },
  nodeKind: { type: "string", pattern: "^[a-z][a-z0-9-]{0,47}$", doc: "The node's kind as a vocabulary names it (catalog/topology.json, an organisation's or the project's own layer). What it means is that row's role, read when the graph is projected; a kind no layer declares is kept and derives nothing." },
  name: { type: "string", doc: "What the system itself calls it: a service's name, a channel's, a schedule's id, an endpoint's method and path. Never an address a sandbox gives, never a credential." },
  of: { type: "string", doc: "The key of the node this one belongs to: a workload's component, a subscription's topic." },
  transport: { type: "string", pattern: "^[a-z][a-z0-9.+-]{0,47}$", doc: "The transport token a file declares for it, as a token. Matched against what adapters serve, never interpreted." },
  attributes: { type: "object", doc: "What the file declares about it, as flat name → value pairs: a routing key, a timezone, an image. Never a secret, and never a URL that carries one." },
  relation: { type: "string", pattern: "^[a-z][a-z0-9-]{0,47}$", doc: "The relation's name as a vocabulary names it. What it means is that row's role, read when the graph is projected; one nobody declares is kept and derives nothing." },
  from: { type: "string", doc: "The key of the node the edge starts at, or `unknown` when the source does not fix it." },
  to: { type: "string", doc: "The key of the node the edge ends at, or `unknown` for a target the source does not fix — a name computed at run time is never guessed." },
};

export const FACT_FIELDS = { ...COMMON_FIELDS, ...KIND_FIELDS };

// Stamped by the store rather than supplied, so a candidate that carries them is
// a candidate that is guessing.
export const STAMPED = ["at", "commit", "status", "fingerprint"];

export const REQUIRED = ["kind", "key", "statement", "scope", "evidence", "source", "confidence"];

export const COMMON_NAMES = Object.keys(COMMON_FIELDS);

// Which fields this kind may carry: the common ones, plus its own row's.
export const allowedOn = (kind) => [...COMMON_NAMES, ...fieldsOf(kind)];

// A field that exists but belongs to another kind gets a different sentence from
// a field nobody has ever declared -- the distinction the DSL's misplaced-field
// and unknown-field rules already make, for the same reason: one is a typo and
// the other is a misunderstanding.
export const misplacedOn = (kind, key) => key in KIND_FIELDS && !allowedOn(kind).includes(key);
