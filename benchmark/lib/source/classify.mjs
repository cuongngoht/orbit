// WHY a run stands where it does: one ordered table over facts the controller can show -- never over the text of an
// error message -- whose first matching row is the cause, and whose last row always matches. Only a cause the case
// itself declares repairable opens a repair; everything else is said and left for a person: an environment, a
// provider or a budget is never "fixed" by changing the source, and a benchmark or a verifier that is wrong is never
// graded.
//
// Every row also says its CLASS: the one word, from FAILURE_CLASSES, a report and a metric speak in whatever the kind of
// case. Row ids stay what earlier reports used; the class is what a reader compares across them.
//
//   CAUSES -> rows        causeOf(f) -> { id, class, says, repairable: boolean }        classOfCause(id) -> class
//   f: { benchmark, verifier, environment, infrastructure, credentials, provider, budget: null | { says },
//        runs: [{ complete, signature, failures, hiddenFailed, gatesFailed, missingExports, probeBroken }],
//        repairable: [cause ids the case declares] }
export const FAILURE_CLASSES = ["ORBIT_SOURCE_DEFECT", "BENCHMARK_DEFECT", "VERIFIER_DEFECT", "ENVIRONMENT_BLOCKED", "PROVIDER_FAILURE", "INFRASTRUCTURE_FAILURE", "NON_DETERMINISTIC", "INSUFFICIENT_EVIDENCE", "BUDGET_EXHAUSTED", "HUMAN_APPROVAL_REQUIRED", "UNKNOWN"];

const first = (f) => f.runs?.[0] ?? null;

const disagree = (f) => new Set((f.runs ?? []).map((r) => r.signature)).size > 1;

const declared = (f, id) => (f.repairable ?? []).includes(id);

export const CAUSES = [
  { id: "BENCHMARK_INVALID", class: () => "BENCHMARK_DEFECT", when: (f) => Boolean(f.benchmark), says: (f) => f.benchmark.says },
  { id: "VERIFIER_INVALID", class: () => "VERIFIER_DEFECT", when: (f) => Boolean(f.verifier), says: (f) => f.verifier.says },
  { id: "ENVIRONMENT", class: () => "ENVIRONMENT_BLOCKED", when: (f) => Boolean(f.environment), says: (f) => f.environment.says },
  { id: "CREDENTIALS", class: () => "ENVIRONMENT_BLOCKED", when: (f) => Boolean(f.credentials), says: (f) => f.credentials.says },
  { id: "INFRASTRUCTURE", class: () => "INFRASTRUCTURE_FAILURE", when: (f) => Boolean(f.infrastructure), says: (f) => f.infrastructure.says },
  { id: "PROVIDER", class: () => "PROVIDER_FAILURE", when: (f) => Boolean(f.provider), says: (f) => f.provider.says },
  { id: "BUDGET_EXHAUSTED", class: () => "BUDGET_EXHAUSTED", when: (f) => Boolean(f.budget), says: (f) => f.budget.says },
  { id: "INSUFFICIENT_EVIDENCE", class: () => "INSUFFICIENT_EVIDENCE", when: (f) => !first(f) || (f.runs ?? []).some((r) => !r.complete), says: () => "a verification did not come to an answer" },
  { id: "NON_DETERMINISTIC", class: () => "NON_DETERMINISTIC", when: (f) => disagree(f), says: () => "the same source, checked twice with the same seed, did not fail the same way: the result is not stable enough to repair on" },
  { id: "CAPABILITY_MISSING", class: (f) => (declared(f, "CAPABILITY_MISSING") ? "ORBIT_SOURCE_DEFECT" : "UNKNOWN"), when: (f) => (first(f).missingExports ?? []).length > 0, says: (f) => `the subject does not provide what the case requires: ${first(f).missingExports.join(", ")}` },
  { id: "ORBIT_SOURCE_DEFECT", class: () => "ORBIT_SOURCE_DEFECT", when: (f) => first(f).hiddenFailed > 0 || first(f).probeBroken === true, says: (f) => (first(f).probeBroken ? "the subject's own modules could not be loaded to answer the checks" : `${first(f).hiddenFailed} hidden check(s) fail, the same way on both verifications`) },
  { id: "GATE_UNEXPLAINED", class: () => "UNKNOWN", when: (f) => first(f).gatesFailed > 0, says: (f) => `every hidden check holds, and ${first(f).gatesFailed} gate(s) of the repository fail beside them — whether that is the source or the verifier's environment is not shown` },
  { id: "PASS", class: () => null, when: (f) => (first(f).failures ?? []).length === 0, says: () => "every hidden check and every gate holds on this source" },
  { id: "UNKNOWN", class: () => "UNKNOWN", when: () => true, says: () => "what was seen does not settle a cause" },
];

export function causeOf(f) {
  const row = CAUSES.find((r) => r.when(f));
  return { id: row.id, class: row.class(f), says: row.says(f), repairable: declared(f, row.id) };
}

// The class a round's own blocker is reported in: what kept the round from being one, by the cause it was found under.
const ROUND_CLASSES = { ENVIRONMENT: "ENVIRONMENT_BLOCKED", CREDENTIALS: "ENVIRONMENT_BLOCKED", INFRASTRUCTURE: "INFRASTRUCTURE_FAILURE", PROVIDER: "PROVIDER_FAILURE", BUDGET_EXHAUSTED: "BUDGET_EXHAUSTED" };

export const classOfCause = (id) => ROUND_CLASSES[id] ?? "UNKNOWN";
