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
// The rows that DECIDE which word an execution earns are RESULT below (PBI 16); across an
// obligation's controls, OBLIGATION; across attempts on the same pinned inputs, ATTEMPTS.

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

// ── deciding (PBI 16) ──────────────────────────────────────────────────────
//
// Which word ONE execution earns: ordered rows over FACTS a record shows -- the host's check of the
// worker's envelope, whether what it rested on moved, the runner's status and what its stop said
// about itself (src/run/loop.mjs typedOf: a helper's class, a gap, an ambiguous write, a verdict
// contradicted, a gate that refused for want of permission), and the authority of the oracle --
// never the text of a message. The first row that holds wins and the last always answers, and no
// row can make a word stronger than its evidence: a draft oracle never confirms anything, an
// observation that could not see everything never passes.
//
// facts: { status, failure: { helperClass, gap, ambiguous, contradiction, authorization },
//          envelope: [findings], stale, authority, positiveFailed, faultMissed }
const failure = (f) => f.failure ?? {};

export const RESULT = [
  { id: "ENVELOPE", when: (f) => (f.envelope ?? []).length > 0, word: "EXECUTION_ERROR", why: "the worker's envelope did not hold — nothing it claimed is taken" },
  { id: "MOVED", when: (f) => f.stale === true, word: "STALE", why: "what this ran on moved since: the source, the case or the contract" },
  { id: "UNSETTLED_WRITE", when: (f) => Boolean(failure(f).ambiguous), word: "AMBIGUOUS", why: "a write was sent and how it ended is not known" },
  { id: "NOTHING_SERVES", when: (f) => Boolean(failure(f).gap), word: "CAPABILITY_MISSING", why: "nothing here could perform or observe what the step needed" },
  { id: "NOT_ALLOWED", when: (f) => f.status === "REFUSED" && failure(f).authorization === true, word: "AUTHORIZATION_BLOCKED", why: "a gate refused it for want of permission" },
  { id: "TEST_WRONG", when: (f) => f.status === "REFUSED", word: "INVALID_TEST", why: "the test itself was refused before it could rule on anything" },
  { id: "COULD_NOT_SEE", when: (f) => f.status === "BLOCKED" && failure(f).helperClass === "incomplete", word: "INCONCLUSIVE", why: "an observation could not see everything it needed to decide" },
  { id: "TOOL_BROKE", when: (f) => f.status === "BLOCKED" && failure(f).helperClass === "protocol", word: "EXECUTION_ERROR", why: "a provider answered something no engine can read" },
  { id: "NOT_READY", when: (f) => f.status === "BLOCKED", word: "ENVIRONMENT_BLOCKED", why: "the sandbox or a dependency was not ready, or a budget was spent" },
  { id: "NO_ORACLE", when: (f) => f.authority !== "accepted", word: "REQUIRES_REQUIREMENT", why: "no accepted oracle stands behind it — a draft prepares a test and never rules on one" },
  { id: "POSITIVE_CONTROL", when: (f) => f.status === "FAIL" && f.positiveFailed === true, word: "INCONCLUSIVE", why: "the positive control did not hold, so the refusal this obligation is about proves nothing — what it contradicted is its own criterion's finding" },
  { id: "FAULT_NOT_SEEN", when: (f) => f.status === "FAIL" && f.faultMissed === true, word: "INCONCLUSIVE", why: "the fault the design injects never showed in what the run observed, so what failed after it says nothing about how the system survives that fault" },
  { id: "CONTRADICTED", when: (f) => f.status === "FAIL" && failure(f).contradiction === true, word: "CONTRADICTED", why: "a verdict compiled from the accepted oracle was contradicted by what was observed" },
  { id: "STEP_FAILED", when: (f) => f.status === "FAIL", word: "EXECUTION_ERROR", why: "a step failed before any verdict could rule" },
  { id: "MET", when: (f) => f.status === "PASS", word: "SATISFIED", why: "every verdict held, against the accepted oracle" },
  { id: "UNDECIDED", when: () => true, word: "INCONCLUSIVE", why: "the run ruled on nothing it could be counted for" },
];

export function resultOf(facts) {
  const row = RESULT.find((r) => r.when(facts ?? {}));
  return { outcome: row.word, rule: row.id, why: row.why };
}

// Across attempts on the SAME pinned inputs: a contradiction that another attempt did not repeat is
// FLAKY -- every attempt kept, never the last one that passed chosen.
export const ATTEMPTS = [
  { id: "BOTH_WAYS", when: (words) => words.includes("CONTRADICTED") && words.includes("SATISFIED"), word: "FLAKY" },
  { id: "LATEST", when: () => true, word: null },
];

export function attemptsOutcome(words) {
  const row = ATTEMPTS.find((r) => r.when(words));
  return row.word ?? words.at(-1) ?? "INCONCLUSIVE";
}

// Across an obligation's CONTROLS: a negative proves nothing without its positive (doc §7, §15 group
// 5), so a positive that was not satisfied leaves the obligation INCONCLUSIVE whatever the negative
// did -- what the positive contradicts is its OWN criterion's finding, made by that criterion's own
// obligation; a contradiction anywhere else stands; only every control satisfied satisfies it.
export const OBLIGATION = [
  { id: "POSITIVE_FAILED", when: (c) => c.positive !== undefined && c.positive !== "SATISFIED", word: () => "INCONCLUSIVE" },
  { id: "CONTRADICTED", when: (c) => Object.values(c).includes("CONTRADICTED"), word: () => "CONTRADICTED" },
  { id: "ALL_MET", when: (c) => Object.values(c).length > 0 && Object.values(c).every((w) => w === "SATISFIED"), word: () => "SATISFIED" },
  { id: "FIRST_UNMET", when: () => true, word: (c) => Object.values(c).find((w) => w !== "SATISFIED") ?? "INCONCLUSIVE" },
];

export function obligationOutcome(controls) {
  const row = OBLIGATION.find((r) => r.when(controls ?? {}));
  return { outcome: row.word(controls ?? {}), rule: row.id };
}
