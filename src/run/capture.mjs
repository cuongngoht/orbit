// What EVERY binding has in common, and nothing that is one verb's business.
//
// How a step turns its result into a value is the verb's own knowledge, and it
// lives with the verb (`capture` in run/verbs/report.mjs and run/verbs/sql.mjs).
// This file used to branch on `step.do` to decide, which is the second verb list
// the registry exists to make impossible.
import { StepError } from "./errors.mjs";

const MAX = 512;

export function oneValue(step, value) {
  const text = String(value);
  if (!text.length) throw new StepError(`into ${step.into}: the value is empty — every later step would ask a different question`);
  if (text.length > MAX) throw new StepError(`into ${step.into}: ${text.length} characters is not an identifier — bind the value, not the document`);
  return text;
}

// The verb decides; the registry guarantees a verb that offers `into` can.
export const captureOf = (impl, step, result) => oneValue(step, impl.capture(step, result));
