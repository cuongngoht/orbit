// WHAT COMES NEXT after a repair round: one ordered table over what the round's evidence shows -- never over what a
// host said about it -- whose first matching row decides, and whose last row always matches. A round is continued
// only on the SAME engineering task, while it is still open, while the failure keeps changing and while the budget
// lasts; there is no row that starts a second task, raises a budget, approves anything or grades a candidate the
// verifier did not pass. A round that left exactly a candidate an earlier round left, failing exactly as it did, is no
// progress even when it is not the round right before: another round would spend the budget on the same answer.
//
//   NEXT -> rows      nextOf(r) -> { id, end: "complete" | "fail" | "block" | null, stop, needs, outcome, class, says }
//   r: { frozenIntact, roundError: null | { cause, says }, verified, changed, engineering: { lifecycle, terminal,
//        stopReason, waiting } | null, signature, previous: [signature of each earlier attempt, in order], left: { rounds,
//        minutes, usd }, scope: [finding], cutShort, patchDigest, earlier: [{ patchDigest, signature }] }
import { sha } from "../../../src/hash.mjs";
import { classOfCause } from "./classify.mjs";

// A benchmark run has few attempts -- the baseline and a round or two -- so it stops on the FIRST repeat: two attempts
// in a row ending on one signature. (The engineering loop's own threshold, inside the runner, is its own: three.)
export const NO_PROGRESS_AFTER = 2;

// The stops a task's journal may be written with (src/task/vocab.mjs STOP_REASONS, `writable`).
export const WRITABLE = ["REQUIREMENT_BLOCKED", "ENVIRONMENT_BLOCKED", "NO_PROGRESS", "BUDGET_EXHAUSTED", "UNSAFE_CHANGE", "VERIFICATION_FAILED", "EXECUTION_FAILED"];

const spent = (left) => left.rounds <= 0 || left.minutes <= 0 || left.usd <= 0;

const engineStop = (r) => (WRITABLE.includes(r.engineering?.stopReason) ? r.engineering.stopReason : "VERIFICATION_FAILED");

const rejectedStop = (r) => (r.scope?.length ? "UNSAFE_CHANGE" : "VERIFICATION_FAILED");

const repeated = (r) => Boolean(r.patchDigest) && (r.earlier ?? []).some((e) => e.patchDigest === r.patchDigest && e.signature === r.signature);

// What a verified round says, by what its goal expects: a change that holds, or a refusal that changed nothing.
const VERIFIED_SAYS = {
  change: "the candidate holds every hidden check, every gate and its own regression test, inside its scope",
  blocked: "the goal was refused as it must be: its plan left the change unresolved for the missing rule, nothing was delivered, and every hidden check and gate still holds",
};

// What still stands when a repair is refused or makes no progress: the source defect it was asked to repair -- or, for a
// goal (`standing: null`), nothing of the taxonomy: a goal not met is the outcome itself, never a defect of the source.
const STANDS = (r) => (r.standing === undefined ? "ORBIT_SOURCE_DEFECT" : r.standing);

export const NEXT = [
  { id: "BENCHMARK_CHANGED", when: (r) => r.frozenIntact === false, end: "fail", stop: () => "REQUIREMENT_BLOCKED", outcome: "BENCHMARK_INVALID", class: () => "BENCHMARK_DEFECT", says: () => "the frozen benchmark changed during the run: nothing it judged after that can count" },
  { id: "VERIFIED", when: (r) => r.verified === true, end: "complete", stop: () => null, outcome: "REPAIRED_VERIFIED", class: () => null, says: (r) => VERIFIED_SAYS[r.expects ?? "change"] },
  { id: "BLOCKED", when: (r) => Boolean(r.roundError), end: "block", stop: () => "ENVIRONMENT_BLOCKED", outcome: "BLOCKED", class: (r) => classOfCause(r.roundError.cause), says: (r) => r.roundError.says },
  { id: "WAITING_FOR_PERSON", when: (r) => r.engineering?.waiting === true, end: "block", stop: () => "ENVIRONMENT_BLOCKED", needs: "person", outcome: "BLOCKED", class: () => "HUMAN_APPROVAL_REQUIRED", says: () => "the engineering task waits for a person's approval (HUMAN_APPROVAL_REQUIRED): a benchmark never approves anything, so the run stops here and a person decides" },
  { id: "ENGINE_ENDED", when: (r) => r.engineering?.terminal === true, end: "fail", stop: (r) => (r.engineering.lifecycle === "COMPLETED" ? rejectedStop(r) : engineStop(r)), outcome: "REPAIR_REJECTED", class: STANDS, says: (r) => `the engineering task ended ${r.engineering.lifecycle}${r.engineering.stopReason ? ` (${r.engineering.stopReason})` : ""} and the verifier does not pass what it left` },
  { id: "REPEATED_CANDIDATE", when: repeated, end: "fail", stop: () => "NO_PROGRESS", outcome: "NO_PROGRESS", class: STANDS, says: () => "the round left exactly the candidate an earlier round left, failing exactly as it did: another round would spend the budget on the same answer" },
  { id: "CUT_SHORT", when: (r) => r.cutShort === true && !spent(r.left), end: null, stop: () => null, outcome: null, class: () => null, says: () => "the round was stopped at its deadline while the engineering task was still open: another round on the same task picks it up where it stands" },
  { id: "NO_PROGRESS", when: (r) => r.previous.at(-1) === r.signature, end: "fail", stop: () => "NO_PROGRESS", outcome: "NO_PROGRESS", class: STANDS, says: () => `the candidate fails exactly as the attempt before it did: ${NO_PROGRESS_AFTER} attempts in a row on one signature` },
  { id: "BUDGET", when: (r) => spent(r.left), end: "fail", stop: () => "BUDGET_EXHAUSTED", outcome: "BUDGET_EXHAUSTED", class: () => "BUDGET_EXHAUSTED", says: (r) => `the budget is spent: ${r.left.rounds} round(s), ${r.left.minutes} minute(s), ${r.left.usd} USD left` },
  { id: "CONTINUE", when: () => true, end: null, stop: () => null, outcome: null, class: () => null, says: () => "the failure changed and the task is still open: another round on the same task, with what the verifier saw" },
];

export function nextOf(r) {
  const row = NEXT.find((n) => n.when(r));
  return { id: row.id, end: row.end, stop: row.stop(r), needs: row.needs ?? "environment", outcome: row.outcome, class: row.class(r), says: row.says(r) };
}

// One failure, as 12 hex characters: the sorted failing ids, never their text -- the task journal's own shape.
export const signatureOf = (failures) => sha(JSON.stringify([...new Set(failures)].sort())).slice(0, 12);
