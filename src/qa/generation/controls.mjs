// The CONTROLS an obligation's shape asks for (doc §7; ADR 0031). A negative result proves nothing
// without its positive control; a state control shows nothing else changed; a duplicate is a second
// attempt on purpose; a fault is a point the project declared. A design names at least one control
// for every role its shape lists, and a control acts as an approved identity on a fixture resource.
//
// cx (the generation context, skills/orbit-qa/ports.mjs) may answer `faultPointsOf(workloadAlias)`: the fault points a
// workload's node declares in the system graph, read the way the binder reads it (src/runtime/sandbox/declarations.mjs)
// -- or null, when it declares none.
//
// A row about one control `role` may also say, in `says`, what a design with such a control must do that the control's
// own contract does not show: a host reads it before it designs (src/investigation/loop.mjs protocolOf, and the template
// of an obligation whose shape needs that role, src/investigation/obligations.mjs), never first in a refusal.
import { isOp, refOf, requestOf, stepsOf } from "../backend/skeleton.mjs";
import { CONTROL_ROLES } from "../obligations/contract.mjs";

// What the workload control (the `orbit.workload.control` family operation) is asked to do, in the open workload
// protocol's own words: arm a fault point, and the two actions that bring a stopped workload back.
const WORKLOAD_CONTROL = "orbit.workload.control";
const FAULT = "fault";
const BRINGS_BACK = ["start", "restart"];

const RESTORED = `A fault stops the workload it is armed in at its point, and nothing declared says that workload comes back by itself: a project may keep it down so what the fault left can be read first. A design that faults one brings it back — a step ${WORKLOAD_CONTROL} on that workload with request.action ${BRINGS_BACK.join(" or ")} — after the step that witnesses the fault, before any later step asks that workload for more or reads what it did after the fault, and before the test ends: the next test in this sandbox finds the workload as this one left it.`;

export const CONTROL_RULES = [
  { id: "SHAPE_ROLES", findings: (d, shape) => shape.controls.filter((role) => !(d.controls ?? []).some((c) => c.role === role)).map((role) => `the ${shape.id} obligation needs a ${role} control, and the design names none`) },
  { id: "KNOWN_ROLES", findings: (d) => (d.controls ?? []).filter((c) => !CONTROL_ROLES.includes(c.role)).map((c) => `a control's role is one of ${CONTROL_ROLES.join(", ")} — not ${String(c.role).slice(0, 30)}`) },
  { id: "NEGATIVE_PAIRED", findings: (d) => ((d.controls ?? []).some((c) => c.role === "negative") && !(d.controls ?? []).some((c) => c.role === "positive") ? ["a negative control with no positive one proves nothing — a refusal of everybody looks the same"] : []) },
  { id: "NEGATIVE_DISTINCT", findings: (d) => controlsOf(d, "negative").filter((c) => c.identityRef && controlsOf(d, "positive").some((p) => p.identityRef === c.identityRef)).map((c) => `the negative control acts as ${c.identityRef}, the identity the positive control is allowed as — a refusal of the allowed actor proves nothing about anybody else`) },
  { id: "CONTROL_ACTS", findings: (d) => (d.controls ?? []).filter((c) => c.identityRef && !skeletonSteps(d).some((s) => s?.input?.identityRef === c.identityRef)).map((c) => `the ${c.role} control acts as ${c.identityRef}, and no step of the test acts as it — a control the test never runs shows nothing`) },
  { id: "WITNESS_IS_FAULT", findings: (d) => (d.controls ?? []).filter((c) => c.role !== "fault" && (c.step !== undefined || c.point !== undefined)).map((c) => `only a fault control names a point and the step that witnesses it — the ${c.role} control names one`) },
  { id: "WITNESS_STEP", findings: (d) => controlsOf(d, "fault").filter((c) => c.step !== undefined && (!c.point || !Number.isInteger(c.step) || c.step < 1 || c.step > skeletonSteps(d).length)).map((c) => `a fault control's witness is a step of the test (1–${skeletonSteps(d).length}) and names the point it witnesses — this one names step ${String(c.step).slice(0, 12)}${c.point ? "" : " and no point"}`) },
  { id: "DECLARED_POINT", findings: (d, shape, cx) => controlsOf(d, "fault").filter((c) => typeof c.point === "string").flatMap((c) => undeclaredPoint(c, workloadsOf(d, cx))) },
  { id: "RESTORED_AFTER_FAULT", role: "fault", says: RESTORED, findings: (d) => controlsOf(d, "fault").filter((c) => typeof c.point === "string").flatMap((c) => faultedIn(d, c.point).flatMap((armed) => unrestored(d, c, armed))) },
];

const controlsOf = (d, role) => (d.controls ?? []).filter((c) => c.role === role);

const skeletonSteps = (d) => (Array.isArray(d.skeleton?.steps) ? d.skeleton.steps : []);

// The workloads a design binds -- every alias a step names through a family operation that binds a workload -- each with
// the fault points it declares: a fault is injected into one of them, and observed on one.
const workloadsOf = (d, cx) => [...new Set(stepsOf(d).filter((s) => s.op?.refs.includes("workload")).map((s) => refOf(s, "workload")).filter((a) => typeof a === "string"))].map((alias) => ({ alias, points: cx?.faultPointsOf?.(alias) ?? null }));

// A point none of them declares is a point their test hooks refuse when the run asks for it: refused before a draft
// exists, naming what they do declare. Held only where every workload the design binds declares its points -- one that
// declares none is unknown, and unknown is never a refusal.
const undeclaredPoint = (c, workloads) => (workloads.length && workloads.every((w) => w.points) && !workloads.some((w) => w.points.includes(c.point)) ? [`the fault control names point "${c.point.slice(0, 64)}", which no workload this design binds declares — ${workloads.map((w) => `${w.alias} declares ${w.points.join(", ")}`).join("; ")}`] : []);

// ── a workload a fault stopped ─────────────────────────────────────────────
//
// What a fault leaves behind is the system's own: one project's supervisor restarts the workload, another keeps it down
// until a test starts it -- and nothing a workload, an adapter or a family operation declares says which. A start of a
// workload that is already back changes nothing, so a design that brings it back itself holds whichever it is: the rule
// reads no declaration and is held everywhere, from the design alone.

const controlling = (s, actions) => isOp(s, WORKLOAD_CONTROL) && actions.includes(requestOf(s).action);

// Each workload a design arms this point in, with the last step that arms it there: the fault may happen any time after.
const faultedIn = (d, point) => [...new Map(stepsOf(d).filter((s) => controlling(s, [FAULT]) && requestOf(s).point === point && typeof refOf(s, "workload") === "string").map((s) => [refOf(s, "workload"), s.i]))];

// From the step that WITNESSES the fault -- the control's own step, when it names one of the test -- the workload is
// stopped: a later step that asks it for more comes after a step that brings it back. Witnessed or not, one brings it
// back before the test ends -- after the witness, or at least after the step that armed it, since without a witness the
// design never says when the fault happened.
function unrestored(d, c, [alias, armed]) {
  const seen = Number.isInteger(c.step) && c.step >= 1 && c.step <= skeletonSteps(d).length ? c.step : null;
  const from = seen ?? armed;
  const back = stepsOf(d).find((s) => s.i > from && controlling(s, BRINGS_BACK) && refOf(s, "workload") === alias)?.i ?? Infinity;
  const again = seen ? stepsOf(d).find((s) => s.i > from && s.i < back && asks(s, alias)) : undefined;
  return again || back === Infinity ? [unrestoredSay(alias.slice(0, 64), from, seen, again)] : [];
}

// A step that asks a workload for anything -- what it did, or to act -- through a family operation that binds it; the
// control that stops, starts or faults it asks nothing of it.
const asks = (s, alias) => Boolean(s.op?.refs.includes("workload")) && refOf(s, "workload") === alias && !isOp(s, WORKLOAD_CONTROL);

// What to add and where comes FIRST, then why: a host sees the first 240 characters of a refusal (src/investigation/
// loop.mjs resultView), and a long alias may cut the why, never the step to add or the steps it goes between.
const unrestoredSay = (alias, from, seen, again) => `add ${WORKLOAD_CONTROL} (request.action ${BRINGS_BACK.join(" or ")}) on ${alias} after ${seen ? `step ${from}` : "the step that sees its fault"} and before ${again ? `step ${again.i}: step ${again.i} asks it for more after its fault (witnessed at step ${from}), and nothing brought it back` : `reading its effect: its fault (${seen ? "witnessed" : "armed"} at step ${from}) leaves it stopped for the next test`}`;

export const controlFindings = (design, shape, cx) => CONTROL_RULES.flatMap((rule) => rule.findings(design, shape, cx).map((say) => ({ rule: rule.id, say })));

// What a host reads before it designs: every rule that says what a design with a control of its role must do -- or only
// those about the roles asked, an obligation's shape's -- by the id a refusal starts with, in the rule's own words.
export const controlRulesFor = (roles) => CONTROL_RULES.filter((r) => r.says && (!roles || roles.includes(r.role))).map((r) => ({ rule: r.id, role: r.role, says: r.says }));
