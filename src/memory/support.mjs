// How many INDEPENDENT sessions back a record, and what that makes its
// confidence -- in ONE place, beside src/memory/session.mjs's definition of
// what a session is.
//
// Engineering memory reconciled facts with these rules first; project
// knowledge (src/knowledge/) reconciles claims with the very same ones. Two
// copies would be two stories about how sure the engine is allowed to be, so
// both subsystems import this and neither restates it:
//
//   CONFIDENCE is derived, never carried: two or more independent sessions and
//   nothing against is `certain`, anything else is `possible`.
//   SESSIONS are a set of hashed marks, not a counter beside the last one seen,
//   so A, B, A is two sessions and never three -- and whether an observation
//   is a session already counted is `knownIn`, asked of session.mjs, once.
//
import { knownIn, sessionMarks } from "./session.mjs";
import { Refused } from "../errors.mjs";

// How many session keys a record remembers. Enough to tell a rerun from a new
// session long past the two that make it certain; bounded so a record does not
// grow with every session that ever looked.
export const KEEP_SESSIONS = 32;

// The ONE statement of what confidence is. Everything else asks this.
export const derive = (support) => (support.sessions >= 2 && support.against === 0 ? "certain" : "possible");

// Existing records must carry the current independent-session support contract.
export function supportOf(record) {
  const s = record.support;
  if (!s || !["examples", "sessions", "against"].every((k) => Number.isInteger(s[k]) && s[k] >= 0) || !Array.isArray(s.seen) || !Array.isArray(s.contested)) throw new Refused("Unsupported record support schema");
  return s;
}

export const NO_SUPPORT = { examples: 0, sessions: 0, against: 0, seen: [], contested: [] };

// Which counter a list feeds: supporting sessions, or contradicting ones.
const COUNTS = { seen: "sessions", contested: "against" };

// Whether this observation is a session the list has already counted is
// src/memory/session.mjs's `knownIn` -- the independence rule lives there, once.
export function counted(support, seenBy, list) {
  if (knownIn(support[list], seenBy)) return support;
  const marks = [...support[list], ...sessionMarks(seenBy)].slice(-KEEP_SESSIONS);
  return { ...support, [list]: marks, [COUNTS[list]]: support[COUNTS[list]] + 1 };
}

// Confidence and its reason, derived from the support -- never from the record.
export function settled(record, support, said) {
  const confidence = derive(support);
  return { ...record, support, confidence, because: because(support, said) };
}

const BECAUSE = [
  { when: (s) => s.against > 0, say: (s) => `${s.against} session(s) contradict it — contested, so it stays possible however many support it` },
  { when: (s) => s.sessions >= 2, say: (s) => `${s.sessions} independent session(s), 0 contradicting` },
  { when: () => true, say: (_s, said) => said ?? "one session — an observation, not yet certain" },
];

const because = (support, said) => BECAUSE.find((r) => r.when(support)).say(support, said);
