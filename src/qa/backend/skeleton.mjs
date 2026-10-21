// Reading a design's SKELETON (doc §4.1 step 3): the steps a host proposed, counted from 1 as a run
// counts them, each asked what family operation it is and which logical refs it names. The rules
// over observations, correlation and time (observations.mjs, correlation.mjs, temporal.mjs) read a
// skeleton only through here, so a step is one shape to all of them.
import { operationFor } from "../../adapters/families.mjs";

export const stepsOf = (design) => (Array.isArray(design?.skeleton?.steps) ? design.skeleton.steps : []).map((step, n) => ({ i: n + 1, step, op: operationFor(step?.capability) }));

export const isOp = (s, capability) => s.step?.do === "call" && s.step.capability === capability;

export const refOf = (s, kind) => s.step?.input?.[`${kind}Ref`];

export const requestOf = (s) => s.step?.input?.request ?? {};

export const triggerStep = (design) => (Number.isInteger(design?.trigger?.step) ? design.trigger.step : null);
