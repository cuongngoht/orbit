// What an observation plan must hold before a backend test may run (doc §5.9): an observer is
// ARMED -- and so has its baseline -- before the trigger, every await asks an observer this very
// test armed, and the adapter it is armed through says it can watch WITHOUT taking anything from
// the application. Each rule is a row; each finding names its step and its rule.
import { meets } from "../../adapters/semantics.mjs";
import { isOp, refOf, stepsOf, triggerStep } from "./skeleton.mjs";

export const NON_STEALING = ["shadow-subscription", "independent-cursor", "peek-cursor", "read-only-query", "tap"];

const ARM = "orbit.messaging.observe";
const AWAIT = "orbit.observe.await";

const armedBefore = (steps, ref, i) => steps.some((s) => isOp(s, ARM) && refOf(s, "observer") === ref && s.i < i);

export const OBSERVATION_RULES = [
  { id: "AWAIT_ARMED", findings: (d, steps) => steps.filter((s) => isOp(s, AWAIT) && !armedBefore(steps, refOf(s, "observer"), s.i)).map((s) => `step ${s.i} awaits ${refOf(s, "observer") ?? "no observer"}, which no earlier step armed`) },
  { id: "ARMED_BEFORE_TRIGGER", findings: (d, steps) => armedAfterTrigger(d, steps) },
  { id: "NON_STEALING", findings: (d, steps, ctx) => steps.filter((s) => isOp(s, ARM)).flatMap((s) => stealing(s, ctx)) },
];

function armedAfterTrigger(d, steps) {
  const trigger = triggerStep(d);
  if (trigger === null) return steps.some((s) => isOp(s, ARM)) ? ["the design arms an observer and names no trigger step to arm it before"] : [];
  return steps.filter((s) => isOp(s, ARM) && s.i >= trigger).map((s) => `step ${s.i} arms ${refOf(s, "observer")} at or after the trigger (step ${trigger}) — what happened before it was armed is unseen`);
}

// Unknown is not met: an adapter that does not say how it observes is never assumed to be harmless.
function stealing(s, ctx) {
  const fit = meets(ctx.semanticsOf?.(s.i) ?? {}, { observation: NON_STEALING });
  if (fit.met.length) return [];
  return [`step ${s.i} arms ${refOf(s, "observer")} through an adapter whose observation is ${fit.unknown.length ? "unknown" : "not one that leaves the application's messages where they are"} — an observer never takes what the application would have consumed`];
}

export const observationFindings = (design, ctx = {}) => {
  const steps = stepsOf(design);
  return OBSERVATION_RULES.flatMap((rule) => rule.findings(design, steps, ctx).map((say) => ({ rule: rule.id, say })));
};
