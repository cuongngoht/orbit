// WHAT COMES NEXT after a repair round: one ordered table over what the round's evidence shows -- never over what a
// host said about it -- whose first matching row decides, and whose last row always matches. A round is continued
// only on the SAME engineering task, while it is still open, while the failure keeps changing and while the budget
// lasts; there is no row that starts a second task, raises a budget or grades a candidate the verifier did not pass.
//
//   NEXT -> rows      nextOf(r) -> { id, end: "complete" | "fail" | "block" | null, stop, outcome, says }
//   r: { frozenIntact, roundError: null | { cause, says }, verified, changed, engineering: { lifecycle, terminal,
//        stopReason } | null, signature, previous: [signature of each earlier attempt, in order], left: { rounds,
//        minutes, usd }, scope: [finding] }
import { sha } from "../../src/hash.mjs";

// A benchmark run has few attempts -- the baseline and a round or two -- so it stops on the FIRST repeat: two attempts
// in a row ending on one signature. (The engineering loop's own threshold, inside the runner, is its own: three.)
export const NO_PROGRESS_AFTER = 2;

// The stops a task's journal may be written with (src/task/vocab.mjs STOP_REASONS, `writable`).
export const WRITABLE = ["REQUIREMENT_BLOCKED", "ENVIRONMENT_BLOCKED", "NO_PROGRESS", "BUDGET_EXHAUSTED", "UNSAFE_CHANGE", "VERIFICATION_FAILED", "EXECUTION_FAILED"];

const spent = (left) => left.rounds <= 0 || left.minutes <= 0 || left.usd <= 0;

const engineStop = (r) => (WRITABLE.includes(r.engineering?.stopReason) ? r.engineering.stopReason : "VERIFICATION_FAILED");

const rejectedStop = (r) => (r.scope?.length ? "UNSAFE_CHANGE" : "VERIFICATION_FAILED");

export const NEXT = [
  { id: "BENCHMARK_CHANGED", when: (r) => r.frozenIntact === false, end: "fail", stop: () => "REQUIREMENT_BLOCKED", outcome: "BENCHMARK_INVALID", says: () => "the frozen benchmark changed during the run: nothing it judged after that can count" },
  { id: "VERIFIED", when: (r) => r.verified === true, end: "complete", stop: () => null, outcome: "REPAIRED_VERIFIED", says: () => "the candidate holds every hidden check, every gate and its own regression test, inside its scope" },
  { id: "BLOCKED", when: (r) => Boolean(r.roundError), end: "block", stop: () => "ENVIRONMENT_BLOCKED", outcome: "BLOCKED", says: (r) => r.roundError.says },
  { id: "ENGINE_ENDED", when: (r) => r.engineering?.terminal === true, end: "fail", stop: (r) => (r.engineering.lifecycle === "COMPLETED" ? rejectedStop(r) : engineStop(r)), outcome: "REPAIR_REJECTED", says: (r) => `the engineering task ended ${r.engineering.lifecycle}${r.engineering.stopReason ? ` (${r.engineering.stopReason})` : ""} and the verifier does not pass what it left` },
  { id: "NO_PROGRESS", when: (r) => r.previous.at(-1) === r.signature, end: "fail", stop: () => "NO_PROGRESS", outcome: "NO_PROGRESS", says: () => `the candidate fails exactly as the attempt before it did: ${NO_PROGRESS_AFTER} attempts in a row on one signature` },
  { id: "BUDGET", when: (r) => spent(r.left), end: "fail", stop: () => "BUDGET_EXHAUSTED", outcome: "BUDGET_EXHAUSTED", says: (r) => `the budget is spent: ${r.left.rounds} round(s), ${r.left.minutes} minute(s), ${r.left.usd} USD left` },
  { id: "CONTINUE", when: () => true, end: null, stop: () => null, outcome: null, says: () => "the failure changed and the task is still open: another round on the same task, with what the verifier saw" },
];

export function nextOf(r) {
  const row = NEXT.find((n) => n.when(r));
  return { id: row.id, end: row.end, stop: row.stop(r), outcome: row.outcome, says: row.says(r) };
}

// One failure, as 12 hex characters: the sorted failing ids, never their text -- the task journal's own shape.
export const signatureOf = (failures) => sha(JSON.stringify([...new Set(failures)].sort())).slice(0, 12);
