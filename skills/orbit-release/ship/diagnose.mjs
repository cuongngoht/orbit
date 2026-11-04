// DIAGNOSE: what a ship does about one row that did not hold -- an ordered table over facts the row's verdict already
// carries (the run's own ending cause and class, its state, the kind of row), first match wins, the last always
// matching. It never reads a sentence a run printed, and it repairs only what an independent verifier can hold: a
// source case's real variant failing on a cause the case itself declares repairable. A QA or engineering case carried
// by the model is never "repaired" against its hidden ground truth -- a fix told what a QA case plants would be fitted
// to the test -- so its failure stops the release, with its evidence, for a person to capture as a source case.
//
//   diagnosed(f) -> { id, then, needs, stop, says }          INTERRUPTED_RUNS
//   f: { row, v (its verdict), case, repair, flakyLeft, autonomousLeft, interruptedLeft, resumed } -- how many more runs
//      each kind of retry has, and whether a person resumed the blocked ship after this run
//   then: HELD (a person held the run) · BLOCK (resumable: an environment) · RETRY (once more, a new run) · REPAIR · STOP
//   DIAGNOSE
const ENVIRONMENT = ["ENVIRONMENT_BLOCKED", "INFRASTRUCTURE_FAILURE"];

const BENCHMARK = ["BENCHMARK_DEFECT", "VERIFIER_DEFECT"];

// How many more times one cycle runs a row again, as a NEW run, after a restart interrupted its run (ROW_VERDICT
// INTERRUPTED) -- declared here and nowhere else. A run nobody saw end is not the model's miss, so it spends none of the
// retries a person allowed the model (--retries); once these are spent too, the environment -- never the model or the
// release -- is what keeps the row from an ending, and the ship BLOCKS with every interrupted run kept, until a person
// resumes it where a run can end.
export const INTERRUPTED_RUNS = 2;

const repairable = (f) => f.row.run === "verify" && f.row.kind === "source" && f.row.variant === "real" && f.v.class === "ORBIT_SOURCE_DEFECT" && (f.case?.measures?.repairable ?? []).includes(f.v.cause);

export const DIAGNOSE = [
  { id: "PERSON_HELD", when: (f) => f.v.state === "HELD_BY_PERSON", then: "HELD", says: () => "a person paused or cancelled the run in Orbit Control" },
  { id: "INTERRUPTED", when: (f) => f.v.state === "INTERRUPTED", then: "RETRY", left: "interruptedLeft", says: (f) => `${f.row.id} cannot be evidence and is not the model's miss: ${f.v.says} -- run again as a new run, spending none of --retries`, spent: { then: "BLOCK", needs: "environment", stop: "ENVIRONMENT_BLOCKED", says: (f) => `${f.row.id}: a restart interrupted ${INTERRUPTED_RUNS + 1} runs of it in this cycle before one could end -- none is evidence and none is the model's miss; the environment cannot hold a run of it to its end: resume the ship where one can` } },
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

// A row allowed another run becomes what its row says once it has none left (a stop, unless it says otherwise); a
// repair, a stop when this ship only verifies.
const spentOf = (row) => ({ ...row, then: "STOP", stop: "VERIFICATION_FAILED", ...(row.spent ?? {}) });

const narrowed = (row, f) => (row.then === "RETRY" && !(f[row.left] > 0) ? spentOf(row) : row.then === "REPAIR" && !f.repair ? { ...row, then: "STOP", stop: "VERIFICATION_FAILED", says: () => `${row.says(f)} -- and this ship verifies only (--no-repair)` } : row);

// A row its environment blocked, run again as a new run once a person resumed the blocked ship after that run -- what
// blocked it is asked again ("fix it and --resume"), one run per resume, never a loop of the ship's own.
const lifted = (row, f) => (row.then === "BLOCK" && f.resumed === true ? { ...row, then: "RETRY", needs: null, stop: null, says: (g) => `${row.says(g)} -- a person resumed the ship: run again as a new run` } : row);

export function diagnosed(f) {
  const row = lifted(narrowed(DIAGNOSE.find((r) => r.when(f)), f), f);
  return { id: row.id, then: row.then, needs: row.needs ?? null, stop: row.stop ?? null, says: row.says(f) };
}
