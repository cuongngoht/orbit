// WHY a run stands where it does: one ordered table over facts the controller can show -- never over the text of an
// error message -- whose first matching row is the cause, and whose last row always matches. Only a cause the case
// itself declares repairable opens a repair; everything else is said and left for a person: an environment, a
// provider or a budget is never "fixed" by changing the source, and a benchmark that is wrong is never graded.
//
//   CAUSES -> rows        causeOf(f) -> { id, says, repairable: boolean }
//   f: { benchmark, environment, credentials, provider, budget: null | { says },
//        runs: [{ complete, signature, failures, hiddenFailed, gatesFailed, missingExports, probeBroken }],
//        repairable: [cause ids the case declares] }
const first = (f) => f.runs?.[0] ?? null;

const disagree = (f) => new Set((f.runs ?? []).map((r) => r.signature)).size > 1;

export const CAUSES = [
  { id: "BENCHMARK_INVALID", when: (f) => Boolean(f.benchmark), says: (f) => f.benchmark.says },
  { id: "ENVIRONMENT", when: (f) => Boolean(f.environment), says: (f) => f.environment.says },
  { id: "CREDENTIALS", when: (f) => Boolean(f.credentials), says: (f) => f.credentials.says },
  { id: "PROVIDER", when: (f) => Boolean(f.provider), says: (f) => f.provider.says },
  { id: "BUDGET_EXHAUSTED", when: (f) => Boolean(f.budget), says: (f) => f.budget.says },
  { id: "INSUFFICIENT_EVIDENCE", when: (f) => !first(f) || (f.runs ?? []).some((r) => !r.complete) || disagree(f), says: (f) => (disagree(f) ? "the same source, checked twice with the same seed, did not fail the same way: the result is not stable enough to repair on" : "a verification did not come to an answer") },
  { id: "CAPABILITY_MISSING", when: (f) => (first(f).missingExports ?? []).length > 0, says: (f) => `the subject does not provide what the case requires: ${first(f).missingExports.join(", ")}` },
  { id: "ORBIT_SOURCE_DEFECT", when: (f) => first(f).hiddenFailed > 0 || first(f).probeBroken === true, says: (f) => (first(f).probeBroken ? "the subject's own modules could not be loaded to answer the checks" : `${first(f).hiddenFailed} hidden check(s) fail, the same way on both verifications`) },
  { id: "GATE_UNEXPLAINED", when: (f) => first(f).gatesFailed > 0, says: (f) => `every hidden check holds, and ${first(f).gatesFailed} gate(s) of the repository fail beside them — whether that is the source or the verifier's environment is not shown` },
  { id: "PASS", when: (f) => (first(f).failures ?? []).length === 0, says: () => "every hidden check and every gate holds on this source" },
  { id: "INSUFFICIENT_EVIDENCE", when: () => true, says: () => "what was seen does not settle a cause" },
];

export function causeOf(f) {
  const row = CAUSES.find((r) => r.when(f));
  return { id: row.id, says: row.says(f), repairable: (f.repairable ?? []).includes(row.id) };
}
