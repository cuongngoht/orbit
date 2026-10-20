// The words REQUIREMENT INTELLIGENCE speaks, as tables with the columns a rule asks.
//
// What should be true is one question; what currently happens is another, and this
// subsystem answers only the first. Nothing here -- and nothing in a rule that reads
// these tables -- looks at source code, a screen, an API, a database, a test or a run:
// a business behaviour nobody wrote down stays UNKNOWN until an authoritative source,
// a person's decision or a derivation from other requirement facts settles it.
//
// A rule never names a status: it asks a COLUMN. A status added one day is a row, and
// every rule that reads a column already handles it.

// The status of a fact. `settles`: it says what should be true. `current`: it is the
// standing version of its slot. `human`: only a person's decision may make it so.
// `candidate`: a proposed fact may claim it -- the rest are the engine's to say.
export const STATUS = [
  { name: "stated", settles: true, current: true, human: false, candidate: true, doc: "an authoritative source says it, and a person can point at where" },
  { name: "decided", settles: true, current: true, human: true, candidate: false, doc: "a person answered a question about it -- the team's word, whatever the source said" },
  { name: "derived", settles: true, current: true, human: false, candidate: true, doc: "it follows from other requirement facts, and lists which" },
  { name: "unknown", settles: false, current: true, human: false, candidate: false, doc: "nobody has said, so it is a question and not a guess" },
  { name: "conflict", settles: false, current: true, human: false, candidate: false, doc: "two sources say different things, and both are kept until a person decides" },
  { name: "superseded", settles: false, current: false, doc: "a later revision or decision replaced it; it stays, so history explains itself", human: false, candidate: false },
];

export const STATUS_NAMES = STATUS.map((s) => s.name);

const BY_STATUS = Object.fromEntries(STATUS.map((s) => [s.name, s]));

export const statusRow = (name) => BY_STATUS[name] ?? null;
export const settles = (status) => BY_STATUS[status]?.settles === true;
export const isCurrent = (status) => BY_STATUS[status]?.current === true;
export const humanOnly = (status) => BY_STATUS[status]?.human === true;
export const candidateStatuses = () => STATUS.filter((s) => s.candidate).map((s) => s.name);

// A fact still waiting to be settled: standing, and saying nothing yet.
export const unsettled = (fact) => isCurrent(fact.status) && !settles(fact.status);

// A question's life. `open`: it still waits for a person.
export const QUESTION_STATES = [
  { name: "open", open: true, doc: "asked, and nobody has answered" },
  { name: "reopened", open: true, doc: "answered once, and what the answer rested on has moved and now says otherwise" },
  { name: "answered", open: false, doc: "a person decided, and it stays decided until the ground moves" },
  { name: "withdrawn", open: false, doc: "a person said it need not be asked" },
];

export const QUESTION_STATE_NAMES = QUESTION_STATES.map((s) => s.name);

export const isOpen = (question) => QUESTION_STATES.find((s) => s.name === question.state)?.open === true;

// HOW CLEAR the requirement is, in the first row that holds -- and never how much
// anybody's word is worth: that is authority, a separate axis. A requirement can be
// complete and still a draft.
export const CLARITY = [
  { name: "blocked", when: (facts, questions) => questions.some((q) => isOpen(q) && q.blocking === true), doc: "a question that stops the work is still open" },
  { name: "partial", when: (facts, questions) => facts.some(unsettled) || questions.some(isOpen), doc: "something is still unknown, in conflict or asked" },
  { name: "complete", when: () => true, doc: "every standing fact says something, and nothing is asked" },
];

export const CLARITY_NAMES = CLARITY.map((c) => c.name);

export const clarityOf = (facts, questions) => CLARITY.find((c) => c.when(facts ?? [], questions ?? [])).name;

// WHOSE word, weakest last. The two words ADR 0007 gave a source: a test holds these
// equal to the plan's own and to the sources'.
export const AUTHORITY_ORDER = ["accepted", "draft"];

export const weakerAuthority = (a, b) => (AUTHORITY_ORDER.indexOf(a) >= AUTHORITY_ORDER.indexOf(b) ? a : b);

// What the journal keeps, per kind of line -- an allow-list, so a field nobody declared
// never reaches the disk. The field is `type` where a record needs a kind of its own,
// never `kind`: that is the journal's word for which line it is.
export const KINDS = {
  recorded: ["id", "factId", "outcome", "candidate", "result", "operation", "sequence", "seenBy"],
  asked: ["id", "questionId", "question", "sequence", "seenBy"],
  answered: ["id", "questionId", "decisionId", "decision", "fact", "sequence", "seenBy"],
  reopened: ["id", "questionId", "because", "sequence"],
  withdrawn: ["id", "questionId", "because", "sequence", "seenBy"],
  snapshot: ["id", "snapshotId", "digest", "clarity", "authority", "sequence"],
  // A clarification round (roundtable/): what one perspective handed in, and the close of the round.
  // Candidates are question PROPOSALS and verdicts are the critic's; neither is ever a fact or a
  // decision, and nothing here is a transcript: a field nobody declared never reaches the disk.
  reviewed: ["id", "digest", "perspective", "outcome", "candidates", "sequence", "seenBy"],
  "round-closed": ["id", "digest", "after", "round", "pooled", "verdicts", "retained", "questions", "asked", "settled", "failed", "sequence", "seenBy"],
};

// Text that came from somewhere else, scrubbed on the way in wherever it sits.
export const FREE_TEXT = ["says", "asks", "proposed", "because", "candidate", "result", "question", "decision", "fact", "candidates", "verdicts"];
