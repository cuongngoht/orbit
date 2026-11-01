// DIAGNOSE: what a ship does about one row that did not hold -- an ordered table over facts the row's verdict already
// carries (the run's own ending cause and class, its state, the kind of row), first match wins, the last always
// matching. It never reads a sentence a run printed, and it repairs only what an independent verifier can hold: a
// source case's real variant failing on a cause the case itself declares repairable. A QA or engineering case carried
// by the model is never "repaired" against its hidden ground truth -- a fix told what a QA case plants would be fitted
// to the test -- so its failure stops the release, with its evidence, for a person to capture as a source case.
//
//   diagnosed(f) -> { id, then, needs, stop, says }
//   f: { row, v (its verdict), case, repair, flakyLeft, autonomousLeft } -- how many more runs each kind of retry has
//   then: HELD (a person held the run) · BLOCK (resumable: an environment) · RETRY (once more, a new run) · REPAIR · STOP
//   DIAGNOSE
const ENVIRONMENT = ["ENVIRONMENT_BLOCKED", "INFRASTRUCTURE_FAILURE"];

const BENCHMARK = ["BENCHMARK_DEFECT", "VERIFIER_DEFECT"];

const repairable = (f) => f.row.run === "verify" && f.row.kind === "source" && f.row.variant === "real" && f.v.class === "ORBIT_SOURCE_DEFECT" && (f.case?.measures?.repairable ?? []).includes(f.v.cause);

export const DIAGNOSE = [
  { id: "PERSON_HELD", when: (f) => f.v.state === "HELD_BY_PERSON", then: "HELD", says: () => "a person paused or cancelled the run in Orbit Control" },
  { id: "AUTH", when: (f) => f.v.cause === "CREDENTIALS" || /^AUTH_/.test(f.v.code ?? ""), then: "BLOCK", needs: "environment", stop: "ENVIRONMENT_BLOCKED", says: () => "the coding host has no credential it can use: set ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN, by name, and resume" },
  { id: "ENVIRONMENT", when: (f) => f.v.state === "BLOCKED" || ENVIRONMENT.includes(f.v.class), then: "BLOCK", needs: "environment", stop: "ENVIRONMENT_BLOCKED", says: (f) => `the environment kept ${f.row.id} from running: ${f.v.says}` },
  { id: "PROVIDER", when: (f) => f.v.class === "PROVIDER_FAILURE", then: "BLOCK", needs: "environment", stop: "ENVIRONMENT_BLOCKED", says: (f) => `the model's provider did not carry ${f.row.id}: ${f.v.says}` },
  { id: "FLAKY", when: (f) => f.v.class === "NON_DETERMINISTIC" || f.v.outcome === "INCONCLUSIVE" || f.v.class === "INSUFFICIENT_EVIDENCE", then: "RETRY", left: "flakyLeft", says: (f) => `${f.row.id} came to no verdict it could stand on (${f.v.class ?? f.v.outcome}): run once more as a new run` },
  { id: "BENCHMARK", when: (f) => f.v.state === "REFUSED" || BENCHMARK.includes(f.v.class) || f.v.outcome === "BENCHMARK_INVALID", then: "STOP", stop: "VERIFICATION_FAILED", says: (f) => `the benchmark itself does not hold for ${f.row.id} -- a person's benchmark work, never the ship's: ${f.v.says}` },
  { id: "UNTRUSTED", when: (f) => f.v.state === "UNTRUSTED", then: "STOP", stop: "VERIFICATION_FAILED", says: (f) => `${f.row.id} cannot be evidence: ${f.v.says}` },
  { id: "PERSON", when: (f) => f.v.class === "HUMAN_APPROVAL_REQUIRED", then: "STOP", stop: "VERIFICATION_FAILED", says: (f) => `${f.row.id} waits for a person's approval, which a release never grants` },
  { id: "REPAIRABLE", when: repairable, then: "REPAIR", says: (f) => `${f.row.case} fails on its real source (${f.v.cause}): a repair the case declares, through the benchmark's repair path` },
  { id: "AUTONOMOUS_MISS", when: (f) => f.row.autonomous, then: "RETRY", left: "autonomousLeft", stop: "VERIFICATION_FAILED", says: (f) => `${f.row.id} did not reach its verdict with the coding host (${f.v.outcome}): its evidence is kept; a person captures what Orbit missed as a source case, which a ship can repair` },
  { id: "UNKNOWN", when: () => true, then: "STOP", stop: "VERIFICATION_FAILED", says: (f) => `${f.row.id}: ${f.v.says}` },
];

// A row allowed another run becomes a stop when it has none left; a repair, when this ship only verifies.
const narrowed = (row, f) => (row.then === "RETRY" && !(f[row.left] > 0) ? { ...row, then: "STOP", stop: "VERIFICATION_FAILED" } : row.then === "REPAIR" && !f.repair ? { ...row, then: "STOP", stop: "VERIFICATION_FAILED", says: () => `${row.says(f)} -- and this ship verifies only (--no-repair)` } : row);

export function diagnosed(f) {
  const row = narrowed(DIAGNOSE.find((r) => r.when(f)), f);
  return { id: row.id, then: row.then, needs: row.needs ?? null, stop: row.stop ?? null, says: row.says(f) };
}
