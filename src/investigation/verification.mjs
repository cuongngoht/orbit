// What a generated test's execution CAME TO (doc §11; ADR 0032) -- a word of its own, kept
// apart from the runner's status and from an investigation's findings on purpose.
//
// The runner still says PASS, FAIL, REFUSED, BLOCKED, INCONCLUSIVE, PARTIAL or SKIP with the
// exit codes it always had (src/run/status.mjs), and nothing here re-judges it. A finding
// (vocab.mjs OUTCOMES) is still what the evidence says about the product. A VERIFICATION
// OUTCOME is the third thing: what one execution of a test, bound to an accepted oracle, may be
// counted as -- a FAIL is not mechanically a defect (an assertion that threw is a test error),
// and a PASS on a stale tree raises nothing.
//
// Columns, each a question a rule asks instead of spelling a word:
//   counts      raises coverage -- exactly one row does (the RUN_STATES rule, src/qa/vocab.mjs)
//   defect      accuses the product -- exactly one row does
//   obligation  the loop state the obligation moves to (vocab.mjs OBLIGATION_STATES), or null
//               when the word is about a report rather than an obligation
//   retry       safe (ask again within the budget), read-back (read what happened first, never
//               resend), never (another attempt cannot change it; somebody acts)
//   recovery    what happens next, said once
// The rows that DECIDE which word an execution earns come with verification (PBI 16).

export const VERIFICATION_OUTCOMES = [
  { id: "GENERATION_FAILED", counts: false, defect: false, obligation: "pending", retry: "safe", recovery: "keep the reason and repair the proposal within the budget — nothing was learned about the product", say: "no design or case could be made" },
  { id: "INVALID_TEST", counts: false, defect: false, obligation: "pending", retry: "safe", recovery: "the case writer or the DSL doctor repairs the representation and keeps the oracle", say: "the case, its JSON or an assertion is not valid" },
  { id: "CAPABILITY_MISSING", counts: false, defect: false, obligation: "blocked", retry: "never", recovery: "record the gap and resolve a provider through its owner — nothing is installed", say: "nothing here can perform or observe what the test needs" },
  { id: "AUTHORIZATION_BLOCKED", counts: false, defect: false, obligation: "needs-approval", retry: "never", recovery: "keep the exact permission that is missing — a person decides; no policy is edited", say: "the policy, the mode or an identity does not allow it" },
  { id: "ENVIRONMENT_BLOCKED", counts: false, defect: false, obligation: "blocked", retry: "safe", recovery: "the runtime's owner makes the sandbox, a dependency or an endpoint ready — never a product failure", say: "the sandbox or a dependency was not ready" },
  { id: "EXECUTION_ERROR", counts: false, defect: false, obligation: "pending", retry: "read-back", recovery: "keep the receipt; retry a bounded number of times only where it is safe", say: "a provider crashed or a protocol failed" },
  { id: "INCONCLUSIVE", counts: false, defect: false, obligation: "pending", retry: "safe", recovery: "restore the observation, or run again with a scope that can conclude", say: "the evidence cannot decide it" },
  { id: "REQUIRES_REQUIREMENT", counts: false, defect: false, obligation: "needs-requirement", retry: "never", recovery: "find the accepted source, or a person settles the missing criterion", say: "the oracle is missing or in conflict" },
  { id: "CONTRADICTED", counts: false, defect: true, obligation: "violated", retry: "never", recovery: "keep the runner's verdict; the verification owner confirms the cause and the finding", say: "a valid run contradicted a qualified oracle" },
  { id: "SATISFIED", counts: true, defect: false, obligation: "satisfied", retry: "never", recovery: "count it only for the revision, layers and controls that ran", say: "a valid run met the oracle within its scope" },
  { id: "FLAKY", counts: false, defect: false, obligation: "blocked", retry: "never", recovery: "keep every attempt and never choose the last one that passed", say: "the same inputs gave different results" },
  { id: "NON_REPRODUCIBLE", counts: false, defect: false, obligation: "pending", retry: "never", recovery: "keep every attempt and show that it did not repeat — history is never replaced by the latest run", say: "a contradiction did not repeat on the same pinned inputs" },
  { id: "STALE", counts: false, defect: false, obligation: "pending", retry: "safe", recovery: "make a new version and plan again what it affects", say: "the source, the case or the contract changed" },
  { id: "AMBIGUOUS", counts: false, defect: false, obligation: "blocked", retry: "read-back", recovery: "read back and reconcile by receipt and operation key — never resend blind", say: "a write was sent and how it ended is not known" },
  { id: "REPORT_FAILED", counts: false, defect: false, obligation: null, retry: "safe", recovery: "render the frozen snapshot again — the test is never run again for it", say: "the report could not be rendered" },
];

export const VERIFICATION_OUTCOME_IDS = VERIFICATION_OUTCOMES.map((o) => o.id);

export const verificationOutcomeOf = (id) => VERIFICATION_OUTCOMES.find((o) => o.id === id) ?? null;

// The one way to ask whether a word raises coverage or accuses the product: off the row, so a word
// this table has never heard of is neither.
export const countsForCoverage = (id) => verificationOutcomeOf(id)?.counts === true;
export const accusesProduct = (id) => verificationOutcomeOf(id)?.defect === true;
