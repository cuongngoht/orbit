// Reading a design's SKELETON (doc §4.1 step 3): the steps a host proposed, counted from 1 as a run
// counts them, each asked what family operation it is and which logical refs it names. The rules
// over observations, correlation and time (observations.mjs, correlation.mjs, temporal.mjs) read a
// skeleton only through here, so a step is one shape to all of them.
import { operationFor } from "../../adapters/families.mjs";

export const stepsOf = (design) => (Array.isArray(design?.skeleton?.steps) ? design.skeleton.steps : []).map((step, n) => ({ i: n + 1, step, op: operationFor(step?.capability) }));

export const isOp = (s, capability) => s.step?.do === "call" && s.step.capability === capability;

export const refOf = (s, kind) => s.step?.input?.[`${kind}Ref`];

export const requestOf = (s) => s.step?.input?.request ?? {};

// What a workload control's action does, in the open workload protocol's own words (its adapter's request.action): the
// actions that end the run a delivery in flight is in, and the ones that bring a stopped workload back. One table, read
// by the design's control rules (src/qa/generation/controls.mjs) and the model of what a design causes (causes.mjs).
export const WORKLOAD_ACTIONS = [
  { action: "fault", interrupts: true },
  { action: "start", bringsBack: true },
  { action: "restart", interrupts: true, bringsBack: true },
  { action: "stop", interrupts: true },
];

export const actionsWhere = (column) => WORKLOAD_ACTIONS.filter((a) => a[column] === true).map((a) => a.action);

export const triggerStep = (design) => (Number.isInteger(design?.trigger?.step) ? design.trigger.step : null);

// The FAULT controls whose witness the engine compiles (src/qa/obligations/contract.mjs CONTROL_FIELDS step): a fault
// control that names its point and a step of the test no criterion's assertion rules on. Only such a step has its
// verdict compiled from the control and may wait within its own bound -- a step any other control names, or one an
// assertion already rules on, is held to every rule a step is held to. One definition, read by the compiler, the
// temporal rules and the design's own control rules alike.
export const witnessControls = (design) => (design?.controls ?? []).filter((c) => c?.role === "fault" && typeof c.point === "string" && c.point.length > 0 && Number.isInteger(c.step) && c.step >= 1 && c.step <= stepsOf(design).length && !(design.assertions ?? []).some((a) => a?.step === c.step));

export const witnessSteps = (design) => new Set(witnessControls(design).map((c) => c.step));
