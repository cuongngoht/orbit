// Does this task need the repository read at all, and if so, how much of it?
//
// This table is the whole feature. Everything else exists so that this can
// answer CURRENT most of the time -- a snapshot that is never consulted is a
// scan with extra steps.
//
// Pure, the discipline src/query/classify.mjs states outright: facts in, one row
// out, reads no file and spawns nothing. The facts are assembled separately (see
// `facts.mjs`), so a test can DESCRIBE a stale scope or a missing capability
// instead of having to produce one -- which is what keeps a suite with no clock
// and no disk able to cover every path through this.
//
// Three properties every row holds to, and each cost something to learn
// somewhere else in this engine:
//
//   the last row always matches      -- `classify.mjs`. A decision table with a
//                                       hole returns undefined at 2am.
//   `writes` is a COLUMN             -- so `--dry` is the table with one column
//                                       flipped, and "current means no scan" and
//                                       "--dry writes nothing" are one assertion
//                                       rather than two that can drift.
//   every row SAYS what it decided   -- `store.mjs`'s `considered`: a tool that
//                                       decides silently cannot be audited.
import { movedScopes } from "../freshness.mjs";

// `scan` names WHAT would be read, and is the only thing that costs anything:
//   none    the snapshot answers it
//   scopes  only the scopes that moved
//   asked   only what the capability question names
//   all     every root, budgeted -- the once-per-project price
export const DECISIONS = [
  {
    name: "BLOCKED_SOURCE",
    scan: "none",
    writes: false,
    stops: true,
    when: (f) => !f.readable,
    say: () => "there is no readable git checkout here, so nothing can be read or dated",
  },
  // `architecture scan` asks outright. A forced rescan is not a decision, but
  // it belongs in the table anyway: every other path through this file is a row,
  // and a branch beside them would be the one nobody reads when they read the
  // policy.
  {
    name: "RESCAN",
    scan: "all",
    writes: true,
    when: (f) => f.forced,
    say: (f) => `asked for outright — re-reading everything, over ${f.count} fact(s) already here`,
  },
  {
    name: "BOOTSTRAP",
    scan: "all",
    writes: true,
    when: (f) => !f.model && !f.count,
    say: () => "nothing has scanned this project yet — reading it once, so nothing after this has to",
  },
  {
    name: "UNREADABLE_STATE",
    scan: "all",
    writes: true,
    when: (f) => !f.model,
    say: (f) => `${f.count} fact(s) are here but the state beside them cannot be read — ${f.modelWhy}. The old file is left where it is`,
  },
  // The caller asked a question. Answering it beats refreshing something they
  // did not ask about -- but the row has to SAY which stale scopes it skipped,
  // or "current" would be quietly overstating what was checked.
  {
    name: "TARGETED",
    scan: "asked",
    writes: true,
    when: (f) => f.unanswered.length > 0,
    say: (f) => `nothing recorded here speaks to ${f.unanswered.join(", ")} — looking only where that could be`,
  },
  {
    name: "INCREMENTAL",
    scan: "scopes",
    writes: true,
    when: (f) => f.moved.length > 0,
    say: (f) => `${f.moved.length} scope(s) moved or cannot be settled: ${f.moved.join(", ")} — re-reading those and nothing else`,
  },
  {
    name: "CURRENT",
    scan: "none",
    writes: false,
    when: () => true,
    say: (f) => `${f.count} fact(s), every scope still where the snapshot left it`,
  },
];

export function decide(facts, opts = {}) {
  const row = DECISIONS.find((d) => d.when(facts));
  const dry = Boolean(opts.dry);
  return { ...row, dry, writes: row.writes && !dry, say: row.say(facts), skipped: skipped(row, facts) };
}

// What this decision is NOT covering. A targeted scan that says nothing about
// the three stale scopes it walked past has told the reader a half-truth.
const skipped = (row, facts) => (row.name === "TARGETED" ? facts.moved : []);

export const movedOf = (scopes) => movedScopes(scopes);
