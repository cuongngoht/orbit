// The case's own definition of right and wrong, evaluated HERE in node over the
// value the step just produced (bound to `it`) -- not in the page, which may
// have repainted since the evidence was recorded.
//
// `new Function` is not an injection hole here and must not be "fixed" into an
// expression parser: `expect` comes from a case file in the same repo whose
// `js` is already shipped to the browser and evaluated there. Anyone who can
// write `expect` can write `js`. Feed this a case from anywhere else and that
// stops being true.
import { StepError } from "./errors.mjs";

export function verdict(step, raw) {
  const it = parsed(raw);
  if (!evaluate(step.expect, it)) throw new StepError(`EXPECT FAILED: ${step.expect}\n     reported: ${JSON.stringify(it)}`);
  return it;
}

export function parsed(raw) {
  if (typeof raw !== "string") return raw;
  try { return JSON.parse(raw); } catch { return raw; }
}

function evaluate(expect, it) {
  try {
    return new Function("it", `return (${expect})`)(it);
  } catch (e) {
    throw new StepError(`expect could not be evaluated — ${expect} — ${e.message}`);
  }
}
