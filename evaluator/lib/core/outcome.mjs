// THE OUTCOME of one run: one word, from what the controller and the grader OBSERVED -- never from the agent's own word
// alone. An ordered table; the first row that holds is the word. What the agent said (DONE or BLOCKED) only turns an
// unresolved patch into FALSE_DONE: a claim of done that the hidden tests contradict.
//
//   facts: { infra: null | { code, says }, timedOut, stoppedOn: null | "budget" | "turns", patchBytes, saidDone,
//            grade: null | { ran, applied, resolved, regressed, why } }
//   outcomeOf(facts) -> { word, why }         WORDS            RATED (the words a rate counts)
export const WORDS = ["RESOLVED", "UNRESOLVED", "REGRESSED", "EMPTY_PATCH", "FALSE_DONE", "TIMEOUT", "BUDGET", "INFRA_ERROR", "UNGRADABLE"];

// INFRA_ERROR is the environment's, not the agent's: excluded from every rate, always listed.
export const RATED = WORDS.filter((w) => w !== "INFRA_ERROR");

const OUTCOMES = [
  { word: "INFRA_ERROR", when: (f) => Boolean(f.infra), why: (f) => `${f.infra.code}: ${f.infra.says}` },
  { word: "TIMEOUT", when: (f) => f.timedOut === true, why: () => "the run passed its wall time and was stopped" },
  { word: "BUDGET", when: (f) => f.stoppedOn === "budget", why: () => "the coding host stopped on its USD cap" },
  { word: "EMPTY_PATCH", when: (f) => !(f.patchBytes > 0), why: (f) => `the working tree is as it started${f.saidDone ? " (and the agent said DONE)" : ""}` },
  { word: "UNGRADABLE", when: (f) => !f.grade?.ran || !f.grade.applied, why: (f) => `the grader could not grade it: ${f.grade?.why ?? "it did not run"}` },
  { word: "REGRESSED", when: (f) => f.grade.regressed, why: (f) => `a pass-to-pass test now fails: ${(f.grade.p2pFailed ?? []).join(", ")}` },
  { word: "RESOLVED", when: (f) => f.grade.resolved, why: () => "every hidden fail-to-pass test passes and no pass-to-pass test fails" },
  { word: "FALSE_DONE", when: (f) => f.saidDone === true, why: (f) => `the agent said DONE, and ${(f.grade.f2pFailed ?? []).length} hidden fail-to-pass test(s) still fail` },
  { word: "UNRESOLVED", when: () => true, why: (f) => `${(f.grade.f2pFailed ?? []).length} hidden fail-to-pass test(s) still fail` },
];

export function outcomeOf(facts) {
  const row = OUTCOMES.find((r) => r.when(facts));
  return { word: row.word, why: row.why(facts) };
}

export const OUTCOME_ORDER = OUTCOMES.map((r) => r.word);
