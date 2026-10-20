// How sure the tool is allowed to be, as an ordered table. First match wins.
//
// A table rather than a chain of ifs because the house forbids `else` and
// `switch`, and because the rules are the design: reading them in order is
// reading the policy. A new rule is a row.
//
// The rules that matter most are the ones that stop it flattering itself:
//   * one session is an OBSERVATION. It is printed and not stored. The ledger
//     already holds it, and a store that writes down every single failure is a
//     store nobody reads.
//   * confirmations are counted in SESSIONS, never runs, so three runs in one
//     sitting are one person hitting one thing once.
//   * notes never move the ladder. They appear in `because` and nowhere else --
//     a remark is a claim, and a claim is not evidence for itself.
//   * `said` (a person told us) is graded on its own row and never converges with
//     `saw`. An inference cannot become an instruction by being repeated.
//   * "no longer observed" and "proven false" are different rows, with different
//     states and different sentences.
import { dayOf } from "../memory/session.mjs";

export const STATES = ["candidate", "validated", "stale", "rejected", "superseded"];

export const LADDER = [
  {
    state: "rejected",
    when: (f, prior) => prior?.forgotten && f.for <= prior.sessionsAtForget,
    because: (f, prior) => `you forgot this on ${dayOf({ at: prior.forgotAt })}; ${prior.sessionsAtForget} session(s) supported it then and ${f.for} do now — nothing new`,
  },
  {
    state: "superseded",
    when: (f, prior) => Boolean(prior?.supersededBy),
    because: (f, prior) => `replaced by ${prior.supersededBy}`,
  },
  {
    state: "rejected",
    when: (f) => f.against >= f.for && f.against >= 2,
    because: (f) => `${f.against} session(s) now do the opposite under the same conditions — contradicted, not merely unobserved`,
  },
  {
    state: "candidate",
    when: (f) => f.against >= 1,
    because: (f) => `${f.against} session(s) contradict it — demoted, pending more evidence`,
  },
  {
    state: "stale",
    when: (f, prior, head) => f.for >= 2 && f.fe_commit && head && f.fe_commit !== head,
    because: (f, prior, head) => `nothing has confirmed it since ${dayOf({ at: f.confirmed })}; the frontend is now ${head}. Not observed lately is not the same as false`,
  },
  {
    state: "validated",
    when: (f) => f.kind === "said",
    because: (f) => `a person said so on ${dayOf({ at: f.confirmed })} — an instruction, not an inference`,
  },
  {
    state: "validated",
    when: (f) => f.for >= 2 && f.against === 0,
    because: (f) => `${f.for} independent session(s) on ${f.hosts} machine(s); 0 contradict${noteCredit(f)}`,
  },
  {
    state: "candidate",
    when: (f) => f.for <= 1,
    because: () => "one session — an observation, not yet a lesson",
  },
];

const noteCredit = (f) => (f.notes ? `; ${f.notes} note(s) about the same thing say so too` : "");

export function gradeOf(finding, prior, head) {
  const row = LADDER.find((r) => r.when(finding, prior, head));
  if (!row) return { state: "candidate", because: "not enough evidence to say anything yet" };
  return { state: row.state, because: row.because(finding, prior, head) };
}

// The line between "write this down" and "print it and move on". A lesson a
// single session produced is not a lesson, whatever else is true about it.
export const worthKeeping = (finding, state) => state === "rejected" || finding.kind === "said" || finding.for >= 2;
