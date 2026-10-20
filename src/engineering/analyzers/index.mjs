// The engineering analysers, as a table -- src/architecture/analyzers/index.mjs's
// shape. Each is PURE, `(input) => {candidates, unknowns}`, over:
//
//   files     the tracked listing (one `git ls-files`) -- never file contents
//   scopes    the scopes the session touched; empty means the whole tree
//   commands  what the session ran: a class and an outcome per command
//   gates     the gate paths architecture's invariant facts cite
//   verified  (1.8.9, a finished task only: src/engineering/observe/task.mjs) the
//             declared checks that passed after the task's last change, and
//             `verifiedScopes`, the scopes that change touched
//
// None of them reads a file. That is the budget, and it is also the honesty
// constraint: an analyser that reads names and outcomes can only claim what
// names and outcomes show, which is why each of them proposes `observed` and
// nothing stronger. What they propose is a CANDIDATE, held to the same contract
// and the same reconciliation as anything a person pipes in.
//
// Not here, on purpose: conventions and extension points (architecture already
// derives them from the same listing -- engineering never duplicates what
// architecture owns), and security or data isolation (a token search for
// "tenant" or "auth" would claim far more than it can show; those are the
// observer AGENT's to propose, for a person to accept).
import { boundary } from "./boundary.mjs";
import { pattern } from "./pattern.mjs";
import { verified } from "./verified.mjs";
import { workflow } from "./workflow.mjs";

export const ANALYZERS = [
  { name: "pattern", run: pattern, doc: "design-pattern role families, read off file names" },
  { name: "boundary", run: boundary, doc: "a role every member of which lives in one layer" },
  { name: "workflow", run: workflow, doc: "checks a session ran and passed, against the gates the project declares" },
  { name: "verified", run: verified, doc: "the declared checks a finished task passed after its last change, and where it changed" },
];

export const ANALYZER_NAMES = ANALYZERS.map((a) => a.name);

// One analyser throwing must not take the others down: it becomes an unknown.
export const analysed = (input) => ANALYZERS.map((a) => isolated(a, input)).reduce((all, r) => ({ candidates: [...all.candidates, ...r.candidates], unknowns: [...all.unknowns, ...r.unknowns] }), { candidates: [], unknowns: [] });

function isolated(analyzer, input) {
  try {
    return analyzer.run(input);
  } catch (e) {
    return { candidates: [], unknowns: [`${analyzer.name}: could not be computed — ${String(e?.message ?? e).slice(0, 120)}`] };
  }
}
