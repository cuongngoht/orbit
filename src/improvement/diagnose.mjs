// What an opportunity's evidence says about its CAUSE -- an ordered table over facts the owners' records demonstrate,
// never over a model's guess: which category the signal is, whether the same version also held, whether the failing
// steps were answered by one provider. The first row that holds decides, and the last always does. Only the
// definition's own declaration, with high confidence, is answered by a new version of it; everything else is named,
// with what would settle it, and nothing is generated.
//
//   diagnosisOf(o, values) -> { cause, confidence, candidate, hypothesis, supporting, contradicting, unknowns, affected,
//                               risk, test, expected }
import { improvementOf } from "./policy.mjs";
import { causeRow } from "./vocab.mjs";

const steps = (o) => (o.signature?.length ? o.signature.join(", ") : "its steps");

export const DIAGNOSIS = [
  { cause: "environment", confidence: "high", when: (o) => o.category === "environment", missing: () => [] },
  { cause: "policy", confidence: "high", when: (o) => o.category === "policy", missing: () => [] },
  { cause: "provider", confidence: "high", when: (o) => o.category === "provider", missing: () => [] },
  { cause: "efficiency", confidence: "high", when: (o) => o.category === "efficiency", missing: () => [] },
  { cause: "flaky", confidence: "low", when: (o) => o.against > 0, missing: (o) => [`why ${o.pin} held in ${o.against} session(s) and not in ${o.sessions}`] },
  { cause: "inconclusive", confidence: "low", when: (o) => (o.providers?.length ?? 0) > 1, missing: (o) => [`whether the answer's shape is ${o.providers.length} providers' rather than the definition's`] },
  { cause: "inconclusive", confidence: "low", when: (o) => o.subject.kind === "satellite" && !(o.signature?.length), missing: () => ["a failure signature the runs share"] },
  { cause: "definition", confidence: "high", when: (o) => o.category === "definition", missing: () => [] },
  { cause: "inconclusive", confidence: "low", when: () => true, missing: () => ["what the runs have in common"] },
];

// The hypothesis is the engine's sentence, composed from slots the evidence fills -- never free text from anybody.
const HYPOTHESIS = {
  "contract-violation": (o) => `${o.pin} declares an output contract on ${steps(o)} that its providers' answers do not meet`,
  "input-missing": (o) => `${o.pin} binds an input on ${steps(o)} that nothing it asks answers`,
  "budget-spent": (o) => `${o.pin}'s own bounds are spent before ${steps(o)} run`,
  "unverified-outcome": (o) => `runs under ${o.pin} end without evidence reaching their contract`,
};

const hypothesisOf = (o, row) => `${(HYPOTHESIS[o.signal] ?? ((x) => `${x.pin} showed ${x.signal}`))(o)} in ${o.runs} run(s) across ${o.sessions} independent session(s) — ${causeRow(row.cause).say}`;

const expectedOf = (o, values) => `on the same inputs, the candidate meets ${steps(o)} in every run while the version it succeeds does not, across ${improvementOf(values).minSessions} independent sessions, with no step the baseline met newly failing`;

const TEST = "baseline and candidate run on the same frozen inputs through the same owner gates, and are read back from the evaluation's own receipts — never from a report";

export function diagnosisOf(o, values) {
  const row = DIAGNOSIS.find((d) => d.when(o));
  const cause = causeRow(row.cause);
  return { cause: row.cause, confidence: row.confidence, candidate: cause.candidate && row.confidence === "high", hypothesis: hypothesisOf(o, row).slice(0, 240), supporting: (o.evidence ?? []).slice(-12), contradicting: o.against > 0 ? [`${o.pin} held in ${o.against} independent session(s)`] : [], unknowns: [...row.missing(o), "cost in tokens (not observable through owner gates)"], affected: [o.pin], risk: o.subject.kind === "satellite" ? "medium" : "low", test: TEST, expected: expectedOf(o, values).slice(0, 240) };
}
