// The CONTROLS an obligation's shape asks for (doc §7; ADR 0031). A negative result proves nothing
// without its positive control; a state control shows nothing else changed; a duplicate is a second
// attempt on purpose; a fault is a point the project declared. A design names at least one control
// for every role its shape lists, and a control acts as an approved identity on a fixture resource.
import { CONTROL_ROLES } from "../obligations/contract.mjs";

export const CONTROL_RULES = [
  { id: "SHAPE_ROLES", findings: (d, shape) => shape.controls.filter((role) => !(d.controls ?? []).some((c) => c.role === role)).map((role) => `the ${shape.id} obligation needs a ${role} control, and the design names none`) },
  { id: "KNOWN_ROLES", findings: (d) => (d.controls ?? []).filter((c) => !CONTROL_ROLES.includes(c.role)).map((c) => `a control's role is one of ${CONTROL_ROLES.join(", ")} — not ${String(c.role).slice(0, 30)}`) },
  { id: "NEGATIVE_PAIRED", findings: (d) => ((d.controls ?? []).some((c) => c.role === "negative") && !(d.controls ?? []).some((c) => c.role === "positive") ? ["a negative control with no positive one proves nothing — a refusal of everybody looks the same"] : []) },
];

export const controlFindings = (design, shape) => CONTROL_RULES.flatMap((rule) => rule.findings(design, shape).map((say) => ({ rule: rule.id, say })));
