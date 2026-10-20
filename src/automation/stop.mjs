// Why a coordinated workflow stops NOW, in order of urgency: the first row that holds is the answer. A row
// with `writes` is a stop the evidence says to RECORD (the task's own `fail`), written instead of anything
// a decision asked for; the others are states the journal already shows.
//
// STOP_EVIDENCE is what a host must be able to point at to end the workflow itself (`finish --stop=`): a
// stop is never a host's opinion of how things went.
import { LIFE, NO_PROGRESS_REPEATS, STOP } from "./vocab.mjs";

const spent = (v, k) => v.budget[k].limit !== null && v.budget[k].limit !== undefined && v.budget[k].spent >= v.budget[k].limit;

export const STOPS = [
  { id: "cancelled", when: (lw) => lw.view.lifecycle === LIFE.CANCELLED, say: () => "a person cancelled the workflow — a child task it started keeps running until a person cancels it in Orbit Control" },
  { id: "ended", when: (lw) => lw.view.terminal, say: (lw) => `the workflow is ${lw.view.lifecycle}` },
  { id: "paused", when: (lw) => lw.view.lifecycle === LIFE.PAUSED, say: () => "a person paused the workflow — it goes on only when they resume it, in Orbit Control" },
  { id: "waiting-approval", when: (lw) => lw.view.lifecycle === LIFE.WAITING_APPROVAL, say: () => "a step waits for a person's approval in Orbit Control (Mission Control → Approvals)" },
  { id: "no-progress", when: (lw) => lw.view.repeats >= NO_PROGRESS_REPEATS, writes: (lw) => ["fail", { stop: STOP.NO_PROGRESS, because: `the last ${lw.view.repeats} plan revisions failed the same way` }], say: () => "its plan revisions keep failing the same way" },
  { id: "budget", when: (lw) => spent(lw.view, "actions") || spent(lw.view, "minutes"), writes: () => ["fail", { stop: STOP.BUDGET_EXHAUSTED, because: "the actions or minutes a person allowed are spent" }], say: () => "its budget is spent" },
  { id: "blocked", when: (lw) => lw.view.lifecycle === LIFE.BLOCKED, say: (lw) => `blocked (${lw.view.blocked?.stop}, needs ${lw.view.blocked?.needs}): ${lw.view.blocked?.because ?? ""} — run the blocked step again once that is settled` },
];

export const stopOf = (lw) => STOPS.find((s) => s.when(lw)) ?? null;

const failedStep = (lw) => lw.states.some((s) => s.state === "failed");

export const STOP_EVIDENCE = {
  [STOP.VERIFICATION_FAILED]: { needs: "a step that failed on its evidence", holds: (lw) => failedStep(lw) },
  [STOP.EXECUTION_FAILED]: { needs: "an action that failed", holds: (lw) => lw.view.actions.some((a) => a.state === "error" || a.state === "failed") },
  [STOP.NO_PROGRESS]: { needs: `${NO_PROGRESS_REPEATS} plan revisions failing the same way`, holds: (lw) => lw.view.repeats >= NO_PROGRESS_REPEATS },
  [STOP.BUDGET_EXHAUSTED]: { needs: "a spent budget", holds: (lw) => ["attempts", "actions", "minutes"].some((k) => spent(lw.view, k)) },
  [STOP.REQUIREMENT_BLOCKED]: { needs: "the workflow blocked on its requirement", holds: (lw) => lw.view.blocked?.stop === STOP.REQUIREMENT_BLOCKED },
  [STOP.ENVIRONMENT_BLOCKED]: { needs: "the workflow blocked on its environment", holds: (lw) => lw.view.blocked?.stop === STOP.ENVIRONMENT_BLOCKED },
};
