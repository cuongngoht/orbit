// Why the loop should not take a new step NOW -- the first row that holds -- or null to go on.
//
// The order is the order of urgency: a person's cancel, an ending, a person's pause, a person's
// pending decision; then what the EVIDENCE says ends or blocks the task (a requirement that moved,
// a loop going round, a spent budget) -- those rows also say what to WRITE, and the step writes it
// instead of running anything; then an action that never settled; then an open block.
//
// A stop is never a verdict. COMPLETED is only ever written when every completion row holds
// (src/orchestration/verification.mjs).
import { blockedBy, currentAttempt, kindOf, lastAttempt, lastOf, openActions } from "./journal.mjs";
import { planOf } from "./obligations.mjs";
import { noProgress } from "./progress.mjs";
import { CHECKING } from "./stages.mjs";
import { LIFE, NO_PROGRESS_REPEATS, STAGE, STOP } from "./vocab.mjs";

const life = (lw) => lw.view.lifecycle;

const limit = (lw, k) => lw.view.budget[k]?.limit ?? null;

const spent = (lw, k) => limit(lw, k) !== null && lw.view.budget[k].spent >= limit(lw, k);

// Where the next step can only be a NEW attempt: after a diagnosis, before the first one, or in a
// checking stage whose attempt the environment abandoned.
const NEEDS_ATTEMPT = [STAGE.PLANNING, STAGE.DIAGNOSING];

const needsAttempt = (lw) => !currentAttempt(lw) && (NEEDS_ATTEMPT.includes(lw.view.stage) || CHECKING.includes(lw.view.stage));

const exhausted = (lw) => spent(lw, "actions") || spent(lw, "minutes") || (spent(lw, "attempts") && needsAttempt(lw));

const budgetSay = (lw) => ["attempts", "actions", "minutes"].filter((k) => spent(lw, k)).map((k) => `${k} ${lw.view.budget[k].spent} of ${limit(lw, k)}`).join(", ");

// An open action that is not a change being made: it never settled.
const unsettled = (lw) => openActions(lw).filter((a) => kindOf(a) !== "implement");

export const STOPS = [
  { id: "cancelled", when: (lw) => life(lw) === LIFE.CANCELLED, say: () => "a person cancelled the task: nothing new starts, and what it started is asked to stop" },
  { id: "ended", when: (lw) => lw.view.terminal, say: (lw) => `the task is ${life(lw)}` },
  { id: "paused", when: (lw) => life(lw) === LIFE.PAUSED, say: () => "a person paused the task: nothing new starts until they resume it, in Orbit Control" },
  { id: "waiting-approval", when: (lw) => life(lw) === LIFE.WAITING_APPROVAL, say: () => "an action waits for a person's decision in Orbit Control (Mission Control → Approvals)" },
  { id: "requirement-moved", when: (lw) => lw.requirement?.ok === false && blockedBy(lw) !== STOP.REQUIREMENT_BLOCKED, writes: (lw) => ["block", { stop: STOP.REQUIREMENT_BLOCKED, needs: "requirement", because: lw.requirement.because }], say: (lw) => lw.requirement.because },
  { id: "no-progress", when: (lw) => noProgress(lw) !== null, writes: (lw) => ["fail", { stop: STOP.NO_PROGRESS, because: noProgress(lw).because }], say: (lw) => noProgress(lw).because },
  { id: "budget", when: (lw) => exhausted(lw), writes: (lw) => ["fail", { stop: STOP.BUDGET_EXHAUSTED, because: `its budget is spent: ${budgetSay(lw)}` }], say: (lw) => `its budget is spent: ${budgetSay(lw)}` },
  { id: "unsettled", when: (lw) => unsettled(lw).length > 0, say: (lw) => `${unsettled(lw).map((a) => a.id).join(", ")} started and never settled — reconcile it: what it did is read back, never done again` },
  { id: "blocked", hints: true, when: (lw) => blockedBy(lw) !== null, say: (lw) => `blocked (${blockedBy(lw)}): ${lw.view.blocked.because ?? "no reason recorded"} — only what can show it gone may run` },
];

// -> the first row that holds, as { id, say, writes?, hints }, or null. `hints` is a column: a stop that
// leaves a way on (a block a person can lift) is the one a suggestion may be added to.
export function stopOf(lw) {
  const row = STOPS.find((s) => s.when(lw));
  return row ? { id: row.id, say: row.say(lw), writes: row.writes?.(lw) ?? null, hints: row.hints === true } : null;
}

// What the journal must show for a host to END a task with a stop of its own choosing (`finish
// --stop=…`): giving up is always allowed, but only for a reason the evidence supports.
const anySpent = (lw) => ["attempts", "actions", "minutes"].some((k) => spent(lw, k));

export const STOP_EVIDENCE = {
  [STOP.NO_PROGRESS]: { holds: (lw) => noProgress(lw) !== null, needs: `${NO_PROGRESS_REPEATS} attempts in a row ending on one failure signature` },
  [STOP.BUDGET_EXHAUSTED]: { holds: (lw) => anySpent(lw), needs: "a budget that is spent" },
  [STOP.UNSAFE_CHANGE]: { holds: (lw) => lastOf(lw, "review")?.state === "failed", needs: "a review that found the change outside its plan's scope" },
  [STOP.VERIFICATION_FAILED]: { holds: (lw) => lastAttempt(lw)?.outcome === "failed" || lw.view.verification.some((v) => v.state === "violated") || planOf(lw).missing.length > 0, needs: "a failed attempt, a violated verification, or something the change reaches that nothing declared verifies" },
  [STOP.EXECUTION_FAILED]: { holds: (lw) => lw.view.actions.some((a) => a.state === "error"), needs: "an action that could not be carried out" },
  [STOP.REQUIREMENT_BLOCKED]: { holds: (lw) => blockedBy(lw) === STOP.REQUIREMENT_BLOCKED, needs: "the task blocked on its requirement" },
  [STOP.ENVIRONMENT_BLOCKED]: { holds: (lw) => blockedBy(lw) === STOP.ENVIRONMENT_BLOCKED, needs: "the task blocked on its environment" },
};
