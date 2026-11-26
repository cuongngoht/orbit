// RUNTIME SECURITY: what an employee's attempt is held to WHILE its programs run, beyond what its sandbox already holds
// (a read-only root, no capability, no-new-privileges, Docker's default seccomp, a noexec /tmp, an internal network).
// Said once in the account's policy (`runtimeSecurity`), tightened by a department's -- never loosened -- and raised by
// the deployment's floor, which nothing an account says can lower. Chats, research and CEO Chat are not held to it: an
// employee's policy governs that employee's attempts alone (ADR 0063).
//
//   disabled  nothing beyond the sandbox (Orbit Web 0.8.0's behaviour). The page says kernel protection is off.
//   observe   an independent sensor reports what the attempt's programs do, and what a control WOULD have refused.
//             Nothing is refused because a rule matched: a report is never prevention.
//   enforce   the chosen controls are installed for the attempt, read back and proven by a probe BEFORE anything the
//             employee runs may start, and kept proven while it runs; where that cannot be done, the attempt does not
//             start, and a running one is contained. Never quietly observe instead.
//
// A control is only offered where it was proven: what it prevents and -- beside it, never left unsaid -- what it does not.
// The catalog is small on purpose; a rule that duplicates what the sandbox already holds is not one (the PoC showed /tmp
// is noexec in both planes already, so no "exec from /tmp" control exists here).
import { isRecord, unknownFields } from "./canonical.js";

export const RUNTIME_MODES = ["disabled", "observe", "enforce"] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

const RANK: Record<RuntimeMode, number> = { disabled: 0, observe: 1, enforce: 2 };
export const runtimeModeRank = (mode: RuntimeMode): number => RANK[mode];
export const isRuntimeMode = (v: unknown): v is RuntimeMode => (RUNTIME_MODES as readonly unknown[]).includes(v);
export const strictestRuntimeMode = (...modes: RuntimeMode[]): RuntimeMode => modes.reduce<RuntimeMode>((a, b) => (RANK[b] > RANK[a] ? b : a), "disabled");

export const RUNTIME_PLANES = ["tool-plane", "model-plane"] as const;
export type RuntimePlane = (typeof RUNTIME_PLANES)[number];

export const RUNTIME_CONTROL_IDS = ["exec.shared-areas"] as const;
export type RuntimeControlId = (typeof RUNTIME_CONTROL_IDS)[number];
export const isRuntimeControlId = (v: unknown): v is RuntimeControlId => (RUNTIME_CONTROL_IDS as readonly unknown[]).includes(v);

export interface RuntimeControlSpec {
  id: RuntimeControlId;
  title: string;
  planes: readonly RuntimePlane[];
  // What it prevents under enforce (and only reports under observe) -- and, beside it, what it does not.
  prevents: string;
  doesNotPrevent: string;
}

export const RUNTIME_CONTROLS: Record<RuntimeControlId, RuntimeControlSpec> = {
  "exec.shared-areas": {
    id: "exec.shared-areas",
    title: "No program runs from a shared area",
    planes: ["tool-plane", "model-plane"],
    prevents:
      "Executing a file from the workstation's team room (/team), deliverables (/output) or inputs (/input), or from the model plane's connection home (/connection): areas shared with other employees, delivered to people or holding a sign-in, where nothing needs to run and where Docker cannot make a volume noexec.",
    doesNotPrevent:
      "Programs run from the employee's own work tree, home or cache (on purpose: a toolbox, a build, pip --user, npx); a shell or an interpreter reading a script as data (`sh file`); a program the dynamic loader maps itself.",
  },
};

// What observe and enforce always watch, whatever controls are chosen. Nothing here refuses anything.
export const RUNTIME_OBSERVATIONS: readonly string[] = [
  "Every process an attempt starts, in both planes, with its parent and how it ended -- never its arguments, environment or what it reads.",
  "A program executed from memory (memfd): the kernel hook sees no file to judge, so this is DETECTED, never claimed prevented.",
  "A shell or an interpreter started in the model plane, where only the AI CLI and Orbit's bridge run.",
];

export interface RuntimeSecurity {
  mode: RuntimeMode;
  // The kernel controls installed for an attempt: they refuse under enforce and only report under observe.
  controls: RuntimeControlId[];
}

// What a department sets for its employees: either key optional (unset: the company's). It can only add to the company.
export interface DepartmentRuntimeSecurity {
  mode?: RuntimeMode;
  controls?: RuntimeControlId[];
}

// The runtime security a policy says: disabled with no control when it says none.
export const runtimeSecurityOf = (policy: { runtimeSecurity?: RuntimeSecurity }): RuntimeSecurity => policy.runtimeSecurity ?? { mode: "disabled", controls: [] };

function controlListErrors(list: unknown, at: string): string[] {
  if (!Array.isArray(list)) return [`${at} must be a list of controls (empty for none)`];
  const errors = list.flatMap((c, i) => (isRuntimeControlId(c) ? [] : [`${at}[${i}] is not a runtime control Orbit Web offers (${RUNTIME_CONTROL_IDS.join(", ")})`]));
  if (new Set(list).size !== list.length) errors.push(`${at} names a control twice`);
  return errors;
}

// The company's section: a mode and its controls, nothing else (no hook, no YAML, no path: those are Orbit's to compile).
export function runtimeSecurityErrors(v: unknown, at = "runtimeSecurity"): string[] {
  if (v === undefined) return [];
  if (!isRecord(v)) return [`${at} must be an object`];
  const errors = unknownFields(v, ["mode", "controls"], `${at}.`);
  if (!isRuntimeMode(v.mode)) errors.push(`${at}.mode must be "disabled", "observe" or "enforce"`);
  return [...errors, ...controlListErrors(v.controls, `${at}.controls`)];
}

// A department's section: its shape. What it may say for THIS company is departmentRuntimeErrors.
export function departmentRuntimeSecurityErrors(v: unknown, at = "runtimeSecurity"): string[] {
  if (v === undefined) return [];
  if (!isRecord(v)) return [`${at} must be an object`];
  const errors = unknownFields(v, ["mode", "controls"], `${at}.`);
  if (v.mode !== undefined && !isRuntimeMode(v.mode)) errors.push(`${at}.mode must be "disabled", "observe" or "enforce" (leave it out to inherit)`);
  return [...errors, ...(v.controls === undefined ? [] : controlListErrors(v.controls, `${at}.controls`))];
}

// A department tightens and never loosens: a mode below the company's is refused in words its owner acts on.
export function departmentRuntimeErrors(dept: { runtimeSecurity?: DepartmentRuntimeSecurity }, company: { runtimeSecurity?: RuntimeSecurity }): string[] {
  const asked = dept.runtimeSecurity?.mode;
  const required = runtimeSecurityOf(company).mode;
  if (asked === undefined || RANK[asked] >= RANK[required]) return [];
  return [`runtimeSecurity.mode: the company requires at least ${required}; a department may only tighten runtime security`];
}

// ---- composition (what an employee's attempt is held to) ----------------------------------------------------------

export type RuntimeSource = "deployment" | "company" | "department";

export interface EffectiveRuntimeSecurity {
  mode: RuntimeMode;
  controls: RuntimeControlId[];
  // The deployment's floor it was composed under, and who set the mode in effect.
  floor: RuntimeMode;
  from: { mode: RuntimeSource };
}

// The strictest of the deployment's floor, the company's mode and the department's; the controls of both, in catalog
// order. A tie is credited to the higher authority; a floor of "disabled" is no requirement and is credited to nobody.
export function composeRuntimeSecurity(company: { runtimeSecurity?: RuntimeSecurity }, dept: { runtimeSecurity?: DepartmentRuntimeSecurity } | null, floor: RuntimeMode): EffectiveRuntimeSecurity {
  const c = runtimeSecurityOf(company);
  const d = dept?.runtimeSecurity;
  const layers: [RuntimeSource, RuntimeMode][] = [...(floor !== "disabled" ? [["deployment", floor] as [RuntimeSource, RuntimeMode]] : []), ["company", c.mode], ["department", d?.mode ?? "disabled"]];
  const [source, mode] = layers.reduce((best, layer) => (RANK[layer[1]] > RANK[best[1]] ? layer : best));
  const chosen = new Set<RuntimeControlId>([...c.controls, ...(d?.controls ?? [])]);
  return { mode, controls: RUNTIME_CONTROL_IDS.filter((id) => chosen.has(id)), floor, from: { mode: source } };
}

// ---- risk ----------------------------------------------------------------------------------------------------------

export interface RuntimeSecurityChange {
  field: "runtimeSecurity.mode" | "runtimeSecurity.controls";
  before: string;
  after: string;
  weakened: boolean;
}

const listOf = (controls: readonly string[]): string => (controls.length === 0 ? "none" : controls.join(", "));

// A lower mode, or a control taken away, WEAKENS what attempts are held to; a stricter mode or an added control narrows.
export function runtimeSecurityChanges(before: { mode: RuntimeMode; controls: readonly RuntimeControlId[] }, after: { mode: RuntimeMode; controls: readonly RuntimeControlId[] }): RuntimeSecurityChange[] {
  const changes: RuntimeSecurityChange[] = [];
  if (before.mode !== after.mode) changes.push({ field: "runtimeSecurity.mode", before: before.mode, after: after.mode, weakened: RANK[after.mode] < RANK[before.mode] });
  if (listOf(before.controls) !== listOf(after.controls)) changes.push({ field: "runtimeSecurity.controls", before: listOf(before.controls), after: listOf(after.controls), weakened: before.controls.some((c) => !after.controls.includes(c)) });
  return changes;
}
