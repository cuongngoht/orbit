// The SHAPE of a requirement fact, a question, a decision and a snapshot, declared once
// and enforced from the declaration by src/constraints.mjs -- the discipline every other
// memory's fields.mjs keeps.
//
// A fact's `says` is a short, masked RESTATEMENT of what a source said, never a copy of
// the source: the store keeps what it needs to be explained (where it came from, which
// revision), and the text of a work item stays in the system that owns it. What a
// candidate may carry is CANDIDATE_FIELDS; everything the engine stamps is STAMPED and
// refused by name if a candidate brings it.
import { CLARITY_NAMES, QUESTION_STATE_NAMES, STATUS_NAMES } from "./vocab.mjs";

// A slot is WHAT a fact is about: a subject and an aspect of it, both plain slugs.
// The engine names no subject and no aspect.
export const SLOT = "^[a-z0-9][a-z0-9._-]{0,63}$";

export const MAX_SAYS = 400;
export const MAX_ASKS = 240;
export const MAX_SOURCES = 8;
export const MAX_DERIVED_FROM = 8;
export const MAX_SLOTS = 4;

// Where a fact came from: a source at a revision -- with, optionally, a locator a
// person can find it by -- or a person's recorded decision. Never a path, a URL, a claim
// or a run: those are how something is BUILT, and what is built does not say what
// should be.
export const SOURCE_REF = "^source:src-[0-9a-f]{12}@[^#\\s]{1,64}(#[A-Za-z0-9._-]{1,32})?$";
export const DECISION_REF = "^decision:rd-[0-9a-f]{12}$";

export const FACT_FIELDS = {
  v: { type: "integer", minimum: 1, doc: "The fact format this was written in. A reader that does not know it leaves the file alone." },
  id: { type: "string", pattern: "^rf-[0-9a-f]{12}$", doc: "rf-<hash of the requirement, subject and aspect>: one file per slot, whoever says it and however often." },
  root: { type: "string", pattern: "^req-[0-9a-f]{12}$", doc: "The requirement set this belongs to." },
  subject: { type: "string", pattern: SLOT, doc: "What the fact is about." },
  aspect: { type: "string", pattern: SLOT, doc: "Which aspect of the subject." },
  says: { type: "string", doc: "What should be true, restated briefly and masked. Never a copy of the source." },
  status: { type: "string", enum: STATUS_NAMES, doc: "How it came to be. What each means is read off the STATUS table." },
  sources: { type: "array", items: { type: "string" }, doc: "source:<id>@<revision>[#locator] or decision:<id>: where it comes from, and which revision of it." },
  derivedFrom: { type: "array", items: { type: "string" }, doc: "For a derived fact: the standing facts it follows from." },
  decision: { type: "string", pattern: "^rd-[0-9a-f]{12}$", doc: "The decision that settled it, when a person did." },
  revision: { type: "integer", minimum: 1, doc: "Which version of this slot this is. A superseded version is kept beside it." },
  supersedes: { type: "string", pattern: "^rf-[0-9a-f]{12}@[0-9]+$", doc: "The earlier version this replaced, as <id>@<revision>." },
  supersededBy: { type: "string", pattern: "^rf-[0-9a-f]{12}@[0-9]+$", doc: "The version that replaced this one, as <id>@<revision>." },
  rivals: { type: "array", items: { type: "string" }, doc: "For a conflict: the other versions still standing." },
  at: { type: "string", doc: "When it was written." },
  seenBy: { type: "object", doc: "{ host, at, session? } -- which session said it." },
};

export const FACT_REQUIRED = ["v", "id", "root", "subject", "aspect", "says", "status", "revision", "at"];

export const QUESTION_FIELDS = {
  v: { type: "integer", minimum: 1, doc: "The question format this was written in." },
  id: { type: "string", pattern: "^rq-[0-9a-f]{12}$", doc: "rq-<hash of the requirement and the slots it is about>: one open question per set of slots." },
  root: { type: "string", pattern: "^req-[0-9a-f]{12}$", doc: "The requirement set this belongs to." },
  slots: { type: "array", doc: "What is unknown: objects with a subject and an aspect." },
  asks: { type: "string", doc: "The question, in one sentence." },
  blocking: { type: "boolean", doc: "Whether the work cannot go on without the answer." },
  proposed: { type: "string", doc: "What the asker would suggest -- a proposal, never a decision." },
  state: { type: "string", enum: QUESTION_STATE_NAMES, doc: "Where it is in its life." },
  dependsOn: { type: "array", items: { type: "string" }, doc: "The sources, at a revision, the question rests on: when one moves and contradicts the answer, the question reopens." },
  answer: { type: "string", pattern: "^rd-[0-9a-f]{12}$", doc: "The decision that answered it." },
  asked: { type: "object", doc: "Per workflow, the sessions it was already put to a person in, so it is never put twice in one." },
  history: { type: "array", doc: "What happened to it, newest last, bounded." },
  at: { type: "string", doc: "When it was first asked." },
};

export const QUESTION_REQUIRED = ["v", "id", "root", "slots", "asks", "blocking", "state", "at"];

export const DECISION_FIELDS = {
  v: { type: "integer", minimum: 1, doc: "The decision format this was written in." },
  id: { type: "string", pattern: "^rd-[0-9a-f]{12}$", doc: "rd-<hash of the question and the time>." },
  root: { type: "string", pattern: "^req-[0-9a-f]{12}$", doc: "The requirement set this belongs to." },
  question: { type: "string", pattern: "^rq-[0-9a-f]{12}$", doc: "The question it answered." },
  says: { type: "string", doc: "What the person decided, restated briefly and masked." },
  by: { type: "string", enum: ["person"], doc: "Always a person: an engine never decides a requirement." },
  human: { type: "boolean", doc: "true: relayed with --human." },
  at: { type: "string", doc: "When." },
  seenBy: { type: "object", doc: "{ host, at, session? }." },
};

export const DECISION_REQUIRED = ["v", "id", "root", "question", "says", "by", "human", "at"];

export const SNAPSHOT_FIELDS = {
  v: { type: "integer", minimum: 1, doc: "The snapshot format this was written in." },
  id: { type: "string", pattern: "^rs-[0-9a-f]{12}$", doc: "rs-<hash of the state>: the same state is the same snapshot." },
  root: { type: "string", pattern: "^req-[0-9a-f]{12}$", doc: "The requirement set this froze." },
  identity: { type: "object", doc: "The root source's identity." },
  sources: { type: "array", doc: "Each source used, with its revision, digest and whose word it is." },
  facts: { type: "array", doc: "Each standing fact, by id, revision and digest -- never its text." },
  decisions: { type: "array", items: { type: "string" }, doc: "Each decision the state rests on." },
  open: { type: "array", items: { type: "string" }, doc: "Each question still open." },
  clarity: { type: "string", enum: CLARITY_NAMES, doc: "How clear it was." },
  authority: { type: "string", enum: ["accepted", "draft"], doc: "Whose word it was, at its weakest." },
  digest: { type: "string", doc: "sha of all of the above but the id, the time and the engine." },
  at: { type: "string", doc: "When it was frozen." },
  engine: { type: "string", doc: "Which engine froze it." },
};

export const SNAPSHOT_REQUIRED = ["v", "id", "root", "sources", "facts", "decisions", "open", "clarity", "authority", "digest", "at"];

// What a CANDIDATE fact may say. Everything else a fact holds is the engine's.
export const CANDIDATE_FIELDS = ["subject", "aspect", "says", "status", "sources", "derivedFrom"];

// Fields the engine stamps and a candidate may never bring -- refused by name.
export const STAMPED = ["v", "id", "root", "decision", "revision", "supersedes", "supersededBy", "rivals", "at", "seenBy", "authority"];

// What a QUESTION candidate may say.
export const QUESTION_CANDIDATE_FIELDS = ["slots", "asks", "blocking", "proposed", "dependsOn"];

export const QUESTION_STAMPED = ["v", "id", "root", "state", "answer", "asked", "history", "at"];
