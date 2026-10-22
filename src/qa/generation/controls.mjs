// The CONTROLS an obligation's shape asks for (doc §7; ADR 0031). A negative result proves nothing
// without its positive control; a state control shows nothing else changed; a duplicate is a second
// attempt on purpose; a fault is a point the project declared. A design names at least one control
// for every role its shape lists, and a control acts as an approved identity on a fixture resource.
import { CONTROL_ROLES } from "../obligations/contract.mjs";

export const CONTROL_RULES = [
  { id: "SHAPE_ROLES", findings: (d, shape) => shape.controls.filter((role) => !(d.controls ?? []).some((c) => c.role === role)).map((role) => `the ${shape.id} obligation needs a ${role} control, and the design names none`) },
  { id: "KNOWN_ROLES", findings: (d) => (d.controls ?? []).filter((c) => !CONTROL_ROLES.includes(c.role)).map((c) => `a control's role is one of ${CONTROL_ROLES.join(", ")} — not ${String(c.role).slice(0, 30)}`) },
  { id: "NEGATIVE_PAIRED", findings: (d) => ((d.controls ?? []).some((c) => c.role === "negative") && !(d.controls ?? []).some((c) => c.role === "positive") ? ["a negative control with no positive one proves nothing — a refusal of everybody looks the same"] : []) },
  { id: "NEGATIVE_DISTINCT", findings: (d) => controlsOf(d, "negative").filter((c) => c.identityRef && controlsOf(d, "positive").some((p) => p.identityRef === c.identityRef)).map((c) => `the negative control acts as ${c.identityRef}, the identity the positive control is allowed as — a refusal of the allowed actor proves nothing about anybody else`) },
  { id: "CONTROL_ACTS", findings: (d) => (d.controls ?? []).filter((c) => c.identityRef && !skeletonSteps(d).some((s) => s?.input?.identityRef === c.identityRef)).map((c) => `the ${c.role} control acts as ${c.identityRef}, and no step of the test acts as it — a control the test never runs shows nothing`) },
  { id: "WITNESS_IS_FAULT", findings: (d) => (d.controls ?? []).filter((c) => c.role !== "fault" && (c.step !== undefined || c.point !== undefined)).map((c) => `only a fault control names a point and the step that witnesses it — the ${c.role} control names one`) },
  { id: "WITNESS_STEP", findings: (d) => controlsOf(d, "fault").filter((c) => c.step !== undefined && (!c.point || !Number.isInteger(c.step) || c.step < 1 || c.step > skeletonSteps(d).length)).map((c) => `a fault control's witness is a step of the test (1–${skeletonSteps(d).length}) and names the point it witnesses — this one names step ${String(c.step).slice(0, 12)}${c.point ? "" : " and no point"}`) },
];

const controlsOf = (d, role) => (d.controls ?? []).filter((c) => c.role === role);

const skeletonSteps = (d) => (Array.isArray(d.skeleton?.steps) ? d.skeleton.steps : []);

export const controlFindings = (design, shape) => CONTROL_RULES.flatMap((rule) => rule.findings(design, shape).map((say) => ({ rule: rule.id, say })));
