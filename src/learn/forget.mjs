// Forgetting, without keeping what was forgotten.
//
// "Forget this" has to mean two things at once: the lesson goes, AND the next
// analysis does not calmly derive it again from the same history tomorrow. The
// second half needs the tool to recognise the lesson, which needs it to remember
// SOMETHING -- so the question is how little is enough.
//
// A tombstone keeps: the lesson id (the subject -- which is the thing being
// suppressed, so it cannot be avoided), a one-way hash of the claim, one-way
// hashes of the evidence pointers, and the session count at the time. It keeps no
// statement, no body and no evidence text. Nothing in it can be read back into
// what the lesson said.
//
// Evidence hashes buy the distinction that makes `forget` honest rather than
// blunt: the same lesson re-derived from the SAME runs is suppressed, while the
// same claim backed by runs that happened since is offered once more, labelled as
// something you already dismissed. "Stop telling me this from what you already
// knew" is what people mean; `--forever` is there for the other meaning.
import { claimHash, evidenceHashes } from "./fingerprint.mjs";

export const SCOPES = ["evidence", "always"];

export function tombstoneFor(lesson, opts = {}) {
  const refs = citations(lesson);
  return { v: 1, id: lesson.id, topic: lesson.topic, fp: claimHash(lesson), evh: evidenceHashes(refs), evN: refs.length, sessions: lesson.sessions ?? 0, scope: opts.scope ?? "evidence", why: opts.why ?? null };
}

// Two shapes reach this: a LESSON, which nests its citations under `evidence`,
// and a FINDING, which has not been made into one yet and carries them at the
// top. Reading only the lesson shape made every finding look like it cited
// nothing, so the subset test below always said "nothing new" and `forget`
// silently became `forget --forever`.
export const citations = (x) => [...(x.evidence?.sessions ?? x.sessions ?? []), ...(x.evidence?.notes ?? x.evidenceNotes ?? [])].map(String);

// A candidate is suppressed only when the tombstone already saw ALL of its
// evidence. One pointer the tombstone has never seen is enough to bring it back.
export function suppressed(candidate, tombs) {
  const tomb = matching(candidate, tombs);
  if (!tomb) return { yes: false, revived: false, why: null };
  if (tomb.scope === "always") return { yes: true, revived: false, why: `forgotten for good on ${dayOf(tomb)}` };
  return verdict(candidate, tomb);
}

const matching = (candidate, tombs) => tombs.find((t) => t.id === candidate.id || t.fp === claimHash(candidate)) ?? null;

function verdict(candidate, tomb) {
  const seen = new Set(tomb.evh ?? []);
  const fresh = evidenceHashes(citations(candidate)).filter((h) => !seen.has(h));
  if (!fresh.length) return { yes: true, revived: false, why: `you forgot this on ${dayOf(tomb)} and nothing new has happened since` };
  return { yes: false, revived: true, why: `you forgot this on ${dayOf(tomb)}; it has happened ${fresh.length} more time(s) since` };
}

const dayOf = (tomb) => String(tomb.at ?? "").slice(0, 10);

// What the ladder needs to know about a forgotten subject, without the ladder
// having to understand tombstones.
export function priorFrom(tombs, id) {
  const tomb = tombs.find((t) => t.id === id);
  if (!tomb) return null;
  return { forgotten: true, forgotAt: tomb.at, sessionsAtForget: tomb.sessions ?? 0 };
}
