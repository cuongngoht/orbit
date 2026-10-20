// One step, start to finish: bind its ${PARAM}s, refuse an unfilled placeholder,
// act, then poll the wait that proves it landed. The shape is the same for every
// verb (Template Method); only `act` varies (Strategy, in verbs/).
import { interpolateStep, unresolved } from "../dsl/interpolate.mjs";
import { StepError } from "./errors.mjs";
import { budgetOf, poll } from "./poll.mjs";
import { markRequests } from "./watermark.mjs";
import { EXECUTORS } from "./verbs/index.mjs";

export function runStep(ctx, run, s) {
  const t0 = ctx.now();
  run.at = s;
  return { ...repeat(ctx, run, bound(ctx, s, run)), ms: ctx.now() - t0 };
}

// LATE binding: the step is interpolated here, not when the plan was made, so it
// can use a value an earlier step produced. `run.at` is the step as it is
// actually being driven -- the log, the printer and the evidence all read it, or
// a failure would be reported against text nobody sent to the browser.
function bound(ctx, s, run) {
  const step = interpolateStep(s, run.values ?? {}, ctx.dsl);
  refuseUnresolved(step, ctx.dsl);
  run.at = step;
  return step;
}

// The FIRST execution is unconditional, and that is the whole point: a step that
// "passed" without running is the one thing a step loop must not be able to
// express. `times: 0` used to leave `last` undefined, and {...undefined} spreads
// to nothing -- so an assert that never ran was logged ok:true. The validator
// refuses times: 0 now; this makes it unsayable.
function repeat(ctx, run, s) {
  let last = runOnce(ctx, run, s);
  for (let n = 1; n < (s.times ?? 1); n++) last = runOnce(ctx, run, s);
  return last;
}

// The defence against the false PASS: a step still carrying `${X}` would ask a
// different question and get an answer that looks like a result.
function refuseUnresolved(s, dsl) {
  const names = unresolved(s, dsl);
  if (names.length) throw Object.assign(new StepError(`unresolved placeholder(s) ${names.map((n) => `\${${n}}`).join(", ")} — not a param, and no resolve filled it`), { phase: "bind" });
}

function runOnce(ctx, run, s) {
  markRequests(ctx, run, s);
  const registry = ctx.executors?.resolve ? ctx.executors : EXECUTORS;
  const result = registry.resolve(s.do).act(ctx, run, s);
  const polls = s.wait ? poll(ctx, s.wait, budgetOf(ctx, run, s)) : (typeof result === "number" ? result : 0);
  return { result, polls };
}
