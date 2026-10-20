// What a run that did not pass is evidence OF, as an ordered table.
//
// The nine names are a diagnosis vocabulary, not a verdict: the verdict is what
// the run earned and nothing here may change it. What this decides is who owns
// the next move -- and getting that wrong is expensive in one direction in
// particular. "The click timed out, so the selector must have changed" sends
// somebody to edit a map record that was right, and the defect it was hiding
// ships.
//
// So every row is keyed on facts a caller can DEMONSTRATE, never on the text of
// an error message. The one field that makes this possible is `phase`, recorded
// by whoever threw (run/poll.mjs, run/step.mjs): a browser command that failed
// is news about the locator, a wait that ran out is news about the product
// reaching a state, and an unfilled placeholder is news about the data. Those
// three used to be one string starting with different words.
//
// `confidence` is two-valued on purpose. `high` means the facts here settle it.
// `low` means the facts are CONSISTENT with it and one named command would
// settle it -- and a low confidence never carries a handoff, because a
// specialist handed an uncertain classification repairs the wrong artifact.
//
// Pure: facts in, one row out. It reads no file, spawns nothing, and knows
// nothing about a browser -- which is what lets a test describe a failure
// instead of having to produce one.

export const TYPES = ["DSL_INVALID", "AUTH", "ENVIRONMENT", "DATA", "MAP_DRIFT", "PRODUCT_FAILURE", "TIMING", "CASE_LOGIC", "UNKNOWN"];

// Specialists, named once. A type with no owner is a type a person reads.
const DSL_DOCTOR = "orbit-dsl-doctor";
const MAP_HEALER = "orbit-map-healer";

const acted = (f) => f.failure?.phase === "act";
const waited = (f) => f.failure?.phase === "wait";
const bound = (f) => f.failure?.phase === "bind";
const stopped = (f) => Boolean(f.failure);

// A step whose locator the engine actually resolved, off an edge the map has.
// Both halves matter: an unknown edge is a case referring to something that is
// not there (the validator's business), and an edge whose selector was never
// captured cannot have drifted away from anything.
const drivable = (f) => f.edgeKnown === true && f.selectorResolved === true;

// A call outside 2xx behind a failed action is the server refusing what the
// step tried. It explains the failure on its own, so it has to be read BEFORE
// the locator is doubted -- otherwise "the dialog never opened" becomes a map
// repair and the 500 that caused it ships.
const refusedByServer = (f) => (f.nonTwoXx?.length ?? 0) > 0;

export const CLASSES = [
  {
    type: "DSL_INVALID", confidence: "high", handoff: DSL_DOCTOR,
    when: (f) => (f.invalid?.length ?? 0) > 0,
    because: (f) => `the validator rejects this case as written: ${f.invalid[0]}`,
    next: "query.mjs check names every finding; the repair is the smallest change that satisfies it",
  },
  {
    type: "AUTH", confidence: "high", handoff: null,
    when: (f) => f.signedOut === true || (f.identityProblem?.length ?? 0) > 0,
    because: (f) => f.identityProblem?.[0] ?? "the session was signed out, or parked on a declared sign-in page",
    next: "sign the session in again and re-run; if the claims are wrong, the case's identity and the profile disagree",
  },
  {
    type: "ENVIRONMENT", confidence: "high", handoff: null,
    when: (f) => f.status === "BLOCKED" && stopped(f),
    because: () => "a precondition could not be established while the run was under way — the harness gave up, which says nothing about the product",
    next: "query.mjs doctor for the tooling this project declared; BLOCKED is never a defect",
  },
  {
    type: "DATA", confidence: "high", handoff: null,
    when: (f) => bound(f),
    because: (f) => `a placeholder reached the step unfilled: ${f.failure.message}`,
    next: "query.mjs case <id> shows the resolve rows and the params — the value the case needed was not produced",
  },
  {
    type: "DATA", confidence: "low", handoff: null,
    when: (f) => f.status === "BLOCKED" && !stopped(f),
    because: () => "the run stopped before its first step, which the engine only does when `resolve` matched no row or the database could not be reached",
    next: "query.mjs case <id> for the resolve rows, query.mjs doctor for the database client — one of those two, and they are different problems",
  },
  {
    type: "PRODUCT_FAILURE", confidence: "low", handoff: null,
    when: (f) => acted(f) && f.ruled === false && refusedByServer(f),
    because: (f) => `the action itself failed and the server answered outside 2xx: ${f.nonTwoXx[0]}`,
    next: "preserve it. The product refused what this step tried, and no verdict got as far as ruling on it — the map is not what is wrong here",
  },
  {
    type: "MAP_DRIFT", confidence: "high", handoff: MAP_HEALER,
    when: (f) => acted(f) && f.ruled === false && drivable(f) && !refusedByServer(f) && f.driftedRecord === true,
    because: (f) => `the browser could not act on ${f.failure.on}, and verify names that record as citing code that changed`,
    next: "orbit-map-healer proposes one locator correction; it is applied after a live look, never before",
  },
  {
    type: "MAP_DRIFT", confidence: "low", handoff: null,
    when: (f) => acted(f) && f.ruled === false && drivable(f) && !refusedByServer(f),
    because: (f) => `the browser could not act on the locator resolved for ${f.failure.on}, and no call fell outside 2xx`,
    next: "query.mjs verify — if it names this record the classification is high and the healer may be called; if it does not, an overlay, a rejected action or a missing precondition explains this just as well",
  },
  {
    type: "PRODUCT_FAILURE", confidence: "high", handoff: null,
    when: (f) => f.status === "FAIL" && f.ruled === true,
    because: (f) => `a step that RULED on the product ran, and the answer was not what the case requires: ${f.failure?.message ?? "see the log"}`,
    next: "preserve it — reproduce by hand, then file it. Never weaken the case to make this green",
  },
  {
    type: "TIMING", confidence: "low", handoff: null,
    when: (f) => waited(f) && f.passedHereAtSameBuild === true,
    because: () => "the wait ran out, and this machine has already passed this case at this same frontend commit — so neither the product nor the map changed between those two runs",
    next: "query.mjs history <id> and query.mjs flaky. Raising the budget to make it green is refused: it measures the wait, not the product",
  },
  {
    type: "CASE_LOGIC", confidence: "high", handoff: null,
    when: (f) => f.status === "INCONCLUSIVE" && f.whole === true,
    because: () => "the whole case ran and ruled on nothing — it has no executable verdict, so it could not have failed either",
    next: "the case owes a verdict on what the scenario committed to; that is a decision, not a repair",
  },
  {
    type: "UNKNOWN", confidence: "low", handoff: null,
    when: () => true,
    because: (f) => (waited(f) ? "a wait ran out, which is equally consistent with a drifted record, a product that never reached that state, and a wait asking the wrong question" : "the evidence does not distinguish between the remaining explanations"),
    next: "gather one more fact before anything is edited: query.mjs verify, query.mjs history <id>, learn.mjs recall <id>, or a live look",
  },
];

// First match wins, and the last row matches everything -- so this always
// answers, and never answers "probably".
export function classify(facts = {}) {
  const row = CLASSES.find((c) => c.when(facts));
  return said(row, facts);
}

// A low confidence carries no handoff, whatever the row says it owns: a
// specialist given an uncertain classification repairs the wrong artifact, and
// its report then reads as though the cause was established.
function said(row, facts) {
  const handoff = row.confidence === "high" ? row.handoff : null;
  return { type: row.type, confidence: row.confidence, because: row.because(facts), next: row.next, handoff };
}
