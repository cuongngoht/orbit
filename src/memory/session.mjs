// What counts as ONE session, in ONE place.
//
// The engine records no session id. `cli/review.mjs` synthesised one as
// (this machine) x (an ISO date prefix) so a review could say "today's runs",
// and learning needs the same notion to count INDEPENDENT confirmations: three
// runs of a case in one sitting are one person hitting one thing once, and
// counting them as three is how a memory store talks itself into certainty.
//
// Two definitions would mean a review and a lesson disagreeing about what
// happened, so there is one, here, and both import it.
//
// It is wrong in two known ways -- two testers on one laptop on one day count as
// one session, and a session that crosses midnight UTC counts as two. SESSION_IS
// travels with every count that rests on it, so no reader has to guess.
import { short } from "../hash.mjs";

export const SESSION_IS = "a session is one machine on one UTC day — the engine records no session id";

export const dayOf = (run) => String(run?.at ?? "").slice(0, 10);

export const sessionId = (run) => `${run?.host ?? "?"}@${dayOf(run)}`;

export const independent = (runs) => new Set(runs.map(sessionId)).size;

// Insertion-ordered, so the first session of a lesson is the first one recorded.
export function sessionsOf(runs) {
  const byId = new Map();
  for (const r of runs) byId.set(sessionId(r), [...(byId.get(sessionId(r)) ?? []), r]);
  return byId;
}

// ── Engineering observations: the same notion, sharpened where a host says more.
//
// A hook DOES know its session: Claude Code hands every hook a `session_id`,
// Antigravity a `conversationId`. `hostSession` turns one into an identity this
// engine may keep -- namespaced by host, hashed, so the raw id is never stored.
// Where no host id exists (a `record` typed at a shell), the day rule above is
// the fallback, as before.
//
// Mixing the two is where one sitting could count itself twice: a hook observes
// under session X, then the same person pipes a candidate by hand under
// `host@day`. So the INDEPENDENCE rule, which src/engineering/reconcile.mjs asks
// through `knownIn` and never restates:
//
//   real vs real        independent iff the ids differ -- two people on one
//                       laptop, or one session across midnight, are finally
//                       counted right
//   synthetic vs synth  independent iff host or UTC day differ -- the old rule
//   real vs synthetic   NOT independent on the same host and day
//
// Each observation leaves MARKS in a list: a real one `r:<id>` and `h:<host@day>`,
// a synthetic one `s:<host@day>`. What a mark matches is the table below.
export const hostSession = (host, id) => (id ? `${host}:${short(String(id), 16)}` : null);

// The mark a TASK keeps of the session that created it (its journal's `created.session`): the host session
// above, hashed once more. One function, because a viewer that wants "this session's task" must compute
// exactly what the task's writer stored -- two spellings of it would be two stories about one session.
export const taskSessionMark = (hostSessionId) => (hostSessionId ? short(String(hostSessionId), 16) : null);

const dayKey = (seen) => short(sessionId(seen), 12);

export function sessionMarks(seen) {
  if (!seen?.session) return [`s:${dayKey(seen)}`];
  return [`r:${short(seen.session, 12)}`, `h:${dayKey(seen)}`];
}

// Which marks already in a list make this observation the SAME session.
const MATCHES = {
  real: (seen) => [`r:${short(seen.session, 12)}`, `s:${dayKey(seen)}`],
  synthetic: (seen) => [`s:${dayKey(seen)}`, `h:${dayKey(seen)}`],
};

export const knownIn = (list, seen) => MATCHES[seen?.session ? "real" : "synthetic"](seen ?? {}).some((m) => list.includes(m));
