// Every step resolved before anything is touched: the selector taken from the
// named edge, the screen it belongs to, its url.
//
// What is NOT done here is interpolation. A planned step is the TEMPLATE, and
// ${PARAM} is substituted when the step runs (run/step.mjs) -- which is what
// lets a step use a value an earlier step bound with `into`. It also fixes an
// older bug by construction: `url` used to be computed from the RAW attribute
// and spread in AFTER the interpolated copy, so it overwrote it and a goto to
// "/things/${ID}" reached the runner still carrying ${ID}.
import { screenOfStep, selectorOf, viaOf } from "../dsl/selector.mjs";
import { Refused } from "./errors.mjs";
import { EXECUTORS } from "./verbs/index.mjs";

export function planSteps(c, graph, executors = EXECUTORS) {
  const out = [];
  let at = c.start;
  (c.steps ?? []).forEach((st, i) => { const r = resolveStep(st, i, at, graph, executors); at = r.screen; out.push(r); });
  return out;
}

// A verb that needs something resolved from the MAP before the run says so with
// `plan` (goto and its url). Asking the verb keeps the planner from knowing what
// any particular verb is.
function resolveStep(st, i, prevScreen, graph, executors) {
  const own = (executors.has(st.do) ? executors.resolve(st.do).plan?.(st, graph) : null) ?? {};
  return { ...st, ...own, i: i + 1, screen: screenOfStep(st, prevScreen), via: viaOf(st), selector: selectorOf(st, graph) };
}

export function sliceSteps(steps, from, to) {
  const lo = bound(from, 1, "from"), hi = bound(to, steps.length, "to");
  const slice = steps.filter((s) => s.i >= lo && s.i <= hi);
  if (!slice.length) throw new Refused(`--from=${lo} --to=${hi} selects no step of ${steps.length}`);
  return { slice, from: lo, to: hi };
}

// Number("abc") is NaN, and the only complaint that ever reached anyone was
// "selects no step" -- which reads like the case is short, not like the flag is
// wrong.
function bound(given, fallback, name) {
  if (given === undefined) return fallback;
  const n = Number(given);
  if (!Number.isInteger(n) || n < 1) throw new Refused(`--${name}=${given} is not a step number`);
  return n;
}
