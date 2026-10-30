// What a person lets self-improvement do on its own, read from the EFFECTIVE automation settings a composition root
// hands in (src/automation/settings.mjs, the `improvement` block: machine narrowed by project, written only through
// Orbit Control's door). Every switch is on by default; every threshold is a floor a person may only raise.
//
//   detect · generate · evaluate · promote          the four things a campaign may do by itself
//   minSessions · minRuns                           how much independent evidence anything needs first
//   maxCandidatesPerSubject · maxEvaluationAttempts · maxEvaluationMinutes · maxConcurrentEvaluations   the budgets
//   isolation · cooldownHours · retentionDays       where an evaluation may run, how soon a subject is improved again,
//                                                   and how long an unacted opportunity is kept
import { Refused } from "../errors.mjs";
import { CODES } from "./vocab.mjs";

export const DEFAULTS = { detect: true, generate: true, evaluate: true, promote: true, minSessions: 2, minRuns: 3, maxCandidatesPerSubject: 2, maxEvaluationAttempts: 3, maxEvaluationMinutes: 30, maxConcurrentEvaluations: 1, isolation: "gated", cooldownHours: 24, retentionDays: 90 };

// The improvement block of whatever effective values were handed in, every missing field at its default.
export const improvementOf = (values) => ({ ...DEFAULTS, ...(values?.improvement ?? {}) });

// Which switch a stage needs: a stage whose switch a person turned off answers IMP_OFF and does nothing.
export const SWITCHES = { detect: "detect", diagnose: "detect", generate: "generate", stage: "generate", evaluate: "evaluate", promote: "promote", rollback: "promote" };

export const allowedTo = (values, stage) => improvementOf(values)[SWITCHES[stage]] !== false;

export function allowed(values, stage) {
  if (!allowedTo(values, stage)) throw Object.assign(new Refused(`${CODES.OFF}: a person turned improvement.${SWITCHES[stage]} off — ${stage} does nothing until a person turns it on in Orbit Control`), { code: CODES.OFF });
}

const HOUR = 3600 * 1000;

export const cooldownMs = (values) => improvementOf(values).cooldownHours * HOUR;

export const retentionMs = (values) => improvementOf(values).retentionDays * 24 * HOUR;
