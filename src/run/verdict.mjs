// The case's own definition of right and wrong, evaluated HERE in node over the
// value the step just produced (bound to `it`) -- not in the page, which may
// have repainted since the evidence was recorded.
//
// A PERSON's case is judged inline, as it always was. `new Function` is not an
// injection hole there and must not be "fixed" into an expression parser:
// `expect` comes from a case file in the same repo whose `js` is already shipped
// to the browser and evaluated there. Anyone who can write `expect` can write
// `js`. Feed this a case from anywhere else and that stops being true -- which is
// why a GENERATED test's `expect` is a compiled predicate the evaluator
// interprets (src/run/evaluator.mjs, ADR 0038), and why a run under a design
// judges nothing inline at all.
import { StepError } from "./errors.mjs";
import { judgeStep, usesEvaluator } from "./evaluator.mjs";

export function verdict(step, raw, ctx = {}) {
  const it = parsed(raw);
  if (usesEvaluator(step, ctx)) return compiled(step, it, ctx);
  if (!evaluate(step.expect, it)) throw new StepError(`EXPECT FAILED: ${step.expect}\n     reported: ${JSON.stringify(it)}`);
  return it;
}

function compiled(step, it, ctx) {
  judgeStep(step, it, ctx);
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
