// The words a WORK speaks, as tables with the columns a rule asks.
//
// A work is what is being done about a requirement: an objective, the requirement it
// rests on, and the NEEDS that doing it has -- each a semantic capability (something to
// know, something to do, something to prove) and never a provider. Which provider serves
// a need today is a BINDING, noted beside it and replaceable; the need itself does not
// change when a server is disabled or a tool is upgraded.
//
// Everything about where a work stands is DERIVED on every read from its journal: a need's
// state, the frontier, what is stale. Nothing is stored beside the journal to drift.

export const WORK_SCHEMA = 1;

// What a need is FOR. `rank`: what comes first when several are ready -- proving what a
// change must satisfy before finding out what it needs, before changing anything.
export const NEED_TYPES = [
  { name: "proof", rank: 1, verb: "prove", needsCapability: true, doc: "something that must be shown to hold, through a capability that can show it" },
  { name: "knowledge", rank: 2, verb: "find out", needsCapability: true, doc: "something to find out, through a capability that can tell -- a technical fact, never what the requirement says" },
  { name: "action", rank: 3, verb: "do", needsCapability: false, doc: "something to do, through a capability that can do it" },
];

export const NEED_TYPE_NAMES = NEED_TYPES.map((t) => t.name);

export const needsCapability = (type) => NEED_TYPES.find((t) => t.name === type)?.needsCapability === true;

export const rankOf = (type) => NEED_TYPES.find((t) => t.name === type)?.rank ?? NEED_TYPES.length + 1;

// Why a need stopped being valid: the dependency that moved. A requirement source moving
// reaches a need as a FACT moving, because a need rests on facts and never on a source.
export const STALE_CAUSES = ["fact", "binding", "scope"];

// What a person or the engine may say a need CAME TO.
export const SETTLED_STATES = ["satisfied", "blocked", "not-applicable"];

// A binding whose resolution says nothing can serve the need is a blocker, not a pending
// step: the need waits for a capability, a decision, or a machine that has what it needs.
export const BLOCKING_STATUSES = ["gap", "decision", "impaired"];

// What the journal keeps, per kind of line -- an allow-list, so a field nobody declared
// never reaches the disk. A need's own type is `type`, never `kind`: `kind` is the
// journal's word for which line it is, and a record carrying one would overwrite it.
export const KINDS = {
  created: ["id", "objective", "root", "source", "snapshot", "by", "schema", "session", "checkout", "ref", "mode"],
  snapshot: ["id", "snapshot", "digest", "clarity", "authority"],
  need: ["id", "type", "capability", "subject", "asks", "dependsOn", "scope", "because"],
  binding: ["id", "need", "provider", "fingerprint", "status", "why"],
  receipt: ["id", "need", "capability", "provider", "tool", "queryDigest", "resultDigest", "sourceRefs", "outcome", "why", "seen"],
  settled: ["id", "need", "state", "receipt", "evidence", "why", "scopes"],
  stale: ["id", "need", "because", "from"],
  checkpoint: ["id", "upto", "frontier", "snapshot", "why"],
  resumed: ["id", "session", "revalidated", "stale"],
  // Unified work tracking (1.8.8, src/work/track/): who is doing the work and how it stands, as lines in the SAME
  // journal. A line is about the work and never a need; an old engine folds none of them and a journal without them
  // is a work that is simply not tracked. `eid` is an event id a callback may resend: a second line with one is
  // never folded twice.
  bound: ["id", "session", "host", "checkout", "mode", "skill", "route", "because", "reopen", "eid"],
  handoff: ["id", "from", "to", "task", "because", "session", "eid"],
  linked: ["id", "what", "target", "role", "eid"],
  state: ["id", "state", "wait", "why", "occurred", "reopen", "session", "eid"],
  report: ["id", "outcome", "summary", "changed", "checks", "proved", "unverified", "blocked", "evidence", "session", "eid"],
};

// The prefix of a record's id, by kind. A need's id is a hash of what it is (model.mjs).
export const PREFIX = { snapshot: "snp", binding: "bnd", receipt: "rct", settled: "stl", stale: "sta", checkpoint: "ckp", resumed: "rsm", bound: "bd", handoff: "hnd", linked: "lnk", state: "st", report: "rpt" };

// Text that came from a person or somewhere else, scrubbed on the way in.
// `from` is built by the engine (a fact, a provider, a path and what it hashed to), never typed.
export const FREE_TEXT = ["objective", "asks", "because", "why", "evidence", "summary", "proved", "unverified", "blocked"];
