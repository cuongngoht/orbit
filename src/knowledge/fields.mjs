// The SHAPE of a knowledge claim, declared once and enforced from the
// declaration by src/constraints.mjs -- the discipline every other memory's
// fields.mjs keeps.
//
// There is deliberately NO statement field. A sentence stored beside the triple
// is a prose door (and one more thing to rot when a template changes); the
// sentence a reader sees is rendered from the triple at display time
// (model.mjs `said`). What prose a claim does carry -- why, and what it could
// not settle -- is scrubbed on the way in.
import { ID } from "../extensions/knowledge-v1.mjs";
import { CONFIDENCE_NAMES, LAYER_NAMES, SOURCE_NAMES, STATUS_NAMES, STRENGTH_NAMES } from "./vocab.mjs";

// A context holds at most this many dimensions: a claim that needs more is
// several claims.
export const MAX_DIMS = 6;

// How much evidence one claim keeps: the newest, once confirmations extend it.
export const MAX_EVIDENCE = 16;

// A context dimension is a slug; so is its value. Nothing here names one.
export const DIMENSION = "^[a-z][a-z0-9._-]{0,31}$";
export const VALUE = "^[a-z0-9][a-z0-9._-]{0,63}$";

export const CLAIM_FIELDS = {
  v: { type: "integer", minimum: 1, doc: "The claim format this was written in. A reader that does not know it leaves the file alone." },
  id: { type: "string", pattern: "^k-[0-9a-f]{12}$", doc: "k-<hash of subject, relation, object and context>. Derived, so the same claim said twice is one file — and the same triple in two contexts is two." },
  subject: { type: "string", pattern: ID, doc: "What the claim is about — a concept id this project uses. Nothing here decides what counts as a concept." },
  relation: { type: "string", pattern: ID, doc: "How subject and object relate. Any id: one no vocabulary declares is kept, shown and derives nothing." },
  object: { type: "string", pattern: ID, doc: "What the subject relates to — another concept id, or a capability id for a relation whose role needs one." },
  context: { type: "object", doc: "WHEN it holds: { dimension: value }, open-ended. Empty means everywhere, and is said as such." },
  scope: { type: "array", items: { type: "string" }, doc: "The repo-relative paths whose movement should send this claim back for revalidation. Defaults to its path evidence." },
  evidence: { type: "array", items: { type: "string" }, minItems: 1, doc: "Tracked paths a reader can open — or, for a claim the engine made itself, a `scheme:id` reference it stamped." },
  source: { enum: SOURCE_NAMES, doc: "Where it came from. Whether that is verified against source is read off the table." },
  strength: { enum: STRENGTH_NAMES, doc: "How binding: enforced and adopted only through an explicit --human record." },
  layer: { enum: LAYER_NAMES, doc: "Who declared it. Only `project` is ever recorded into a project's store." },
  confidence: { enum: CONFIDENCE_NAMES, doc: "DERIVED from independent sessions, never supplied." },
  status: { enum: STATUS_NAMES, doc: "Freshness when it was recorded. Readers measure it again; stale means re-check, never false." },
  because: { type: "string", doc: "Why this confidence, and not stronger." },
  unknowns: { type: "array", items: { type: "string" }, doc: "What it could not settle. Always present, even when empty." },
  support: { type: "object", doc: "{ examples, sessions, against, seen, contested } — stamped by reconciliation (src/memory/support.mjs)." },
  lastSeenBy: { type: "object", doc: "{ host, at, session? } of the last session that confirmed it." },
  adoptedBy: { type: "object", doc: "{ host, at } of the explicit human record that set its strength." },
  enforcedBy: { type: "array", items: { type: "string" }, minItems: 1, doc: "The tracked gate that enforces it — required for enforced." },
  at: { type: "string", doc: "When it was recorded. Stamped." },
  commit: { type: "string", doc: "The source commit it was recorded against. Stamped, never masked." },
  fingerprint: { type: "string", doc: "What its scope hashed to when recorded. Compared, never interpreted." },
};

// What the engine owns. A candidate carrying any of these is claiming to have
// been checked, repeated or dated by filling a field in.
export const STAMPED = ["v", "id", "at", "commit", "status", "fingerprint", "support", "lastSeenBy", "adoptedBy", "confidence"];

export const REQUIRED = ["v", "id", "subject", "relation", "object", "context", "evidence", "source", "strength", "layer", "confidence"];

export const CANDIDATE_REQUIRED = ["subject", "relation", "object", "evidence", "source", "strength"];

// Fields a candidate carries to tell reconciliation about ITSELF, never kept.
export const ENVELOPE_FIELDS = {
  contradicts: { type: "string", pattern: "^k-[0-9a-f]{12}$", doc: "The id of the claim this observation says is wrong — which must be this candidate's own claim." },
};

// What the prose fields may never carry into a claim: the scrubber masks them
// on the way in (src/scrub.mjs KNOW_TEXT).
export const PROSE = ["because", "unknowns"];
