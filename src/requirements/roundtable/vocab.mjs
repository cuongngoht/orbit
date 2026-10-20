// The words a REQUIREMENT ROUNDTABLE speaks, as tables with the columns a rule asks.
//
// A roundtable is a bounded clarification step between recording what a requirement says and
// freezing it: three perspectives each look at the standing requirement and propose QUESTIONS, one
// critic keeps, drops, merges or refines them, and what is retained goes through the question
// engine that already exists. Nothing here decides a requirement. A perspective proposes, the
// critic challenges, and only a person answers -- so no row below can carry an answer, a decision
// or an authority, and no word names a model, a host or a provider.
//
// What a perspective LOOKS AT is data, printed in the envelope a reviewer is handed, so no
// playbook keeps a second copy of it.

// The default bounds of one clarification: rounds per requirement, candidates one reviewer may
// hand in, questions one round may keep. The envelope is bounded too, because a host cuts a long
// tool answer and a requirement may hold thousands of facts.
export const LIMITS = { rounds: 3, candidates: 5, retained: 8, because: 120, envelope: { facts: 30, open: 15, settled: 15 } };

// `reviewer`: it reads the requirement and proposes. The one that is not a reviewer reads what the
// reviewers proposed. `working` is what the board says while it is the one at work: task status,
// never a reasoning trace. `activity` is the progress vocabulary's word for it.
export const PERSPECTIVES = [
  { id: "product", label: "Product", reviewer: true, purpose: "find missing intent and scope", focus: ["the actor", "the user's goal", "what triggers it", "what success looks like", "what is in and out of scope", "behaviour choices that change what a user experiences"], working: "reviewing actor, goal and scope", activity: "reviewing-intent" },
  { id: "domain", label: "Domain", reviewer: true, purpose: "find missing business semantics", focus: ["business rules", "states and transitions", "validation and limits", "relationships between things", "rules that conflict", "what repeating an operation means, where the requirement itself implies one"], working: "reviewing rules and state transitions", activity: "reviewing-rules" },
  { id: "qa", label: "QA", reviewer: true, purpose: "use adversarial test thinking only to expose behaviour nobody specified", focus: ["invalid input", "empty state", "failure and retry", "a duplicate action", "permission denied", "boundaries", "concurrency", "partial failure"], working: "reviewing failure paths and edge cases", activity: "reviewing-edge-cases" },
  { id: "socrates", label: "Socrates", reviewer: false, purpose: "challenge the proposed questions: keep, drop, merge or refine, and never answer one", focus: ["does it change expected behaviour", "could two reasonable builds differ because of it", "is it only an implementation detail", "is it a duplicate of another", "can it be asked more atomically"], working: "challenging candidates", activity: "challenging-candidates" },
];

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

export const PERSPECTIVE_IDS = PERSPECTIVES.map((p) => p.id);

export const REVIEWERS = PERSPECTIVES.filter((p) => p.reviewer).map((p) => p.id);

export const CRITIC = PERSPECTIVES.find((p) => !p.reviewer).id;

export const perspective = (id) => PERSPECTIVES.find((p) => p.id === id) ?? null;

// Where a perspective, or the round as a whole, stands. The glyph is what the board prints.
export const STATES = [
  { name: "queued", glyph: "○" },
  { name: "working", glyph: "◐" },
  { name: "completed", glyph: "✓" },
  { name: "failed", glyph: "✗" },
  { name: "skipped", glyph: "-" },
  { name: "waiting-human", glyph: "?" },
];

export const STATE_NAMES = STATES.map((s) => s.name);

export const glyphOf = (state) => STATES.find((s) => s.name === state)?.glyph ?? "-";

// Who may appear on the board: each perspective, and the round itself.
export const ACTORS = [...PERSPECTIVE_IDS, "roundtable"];

// The only fields a progress event may carry. An event is task STATUS -- who, what state, what kind of
// work, how far -- and a short sentence filled from counts; there is no field for a reasoning trace.
export const PROGRESS_FIELDS = ["type", "root", "round", "actor", "state", "activity", "current", "total", "summary"];

export const ACTIVITIES = ["preparing-context", "reviewing-intent", "reviewing-rules", "reviewing-edge-cases", "challenging-candidates", "deduplicating", "checking-existing-answers", "preparing-questions", "recording-round", "waiting-for-human", "completed"];

// What the critic may say about one candidate, and the fields each verdict may carry besides
// `candidate` and `verdict`. A verdict carries no answer, no slot and no state: a critic that could
// change which slots a question is about would change which question it is.
export const VERDICTS = { keep: [], drop: ["because"], merge: ["into", "because"], refine: ["asks", "blocking", "proposed", "because"] };

export const VERDICT_NAMES = Object.keys(VERDICTS);

// Fields that would be an ANSWER, a decision or a claim of authority if a proposal carried them.
// Refused by name, with a sentence, wherever they turn up.
export const ANSWERING = ["answer", "says", "decision", "decided", "human", "authority", "approved", "status", "state", "outcome", "confidence"];
