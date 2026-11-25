// THE CEO'S STAFFING PLAN (Executive, pure; ADR 0062, staffing). On the owner's hiring request -- and only on one -- the
// CEO ends its answer with ONE fenced block:
//
//   ```orbit-staffing
//   { "departments": [{ "name": "Human Resources" }],
//     "hires": [{ "name": "Lan", "department": "Human Resources", "role": "manager", "title": "HR manager",
//                 "duties": "...", "instructions": "...", "skills": ["recruiting"], "languages": ["en"] }] }
//   ```
//
// The server reads the LAST such block, takes only a plan's own fields (checkStaffingPlan: a name, a department, a role,
// what the person does -- never a model, a connection, resources or a permission), and holds it to the request and to the
// company as it is NOW: the request's scope (one department, or the whole company), its room (the most it may hire),
// unique names, departments that exist or that the plan makes (and none made twice or named like one that exists), and
// the managers -- exactly one for a department the plan makes, at most one for a department that has none, none for a
// department whose manager is in office. A plan that breaks any rule is refused WHOLE, with every problem listed.
import { checkStaffingPlan, type StaffingHire, type StaffingPlan } from "@orbit-web/contracts";

const FENCE = /```orbit-staffing[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;

// What a block holds, as written (the last one counts), and the answer without any of them.
export function staffingBlocks(answer: string): { last: string | null; text: string } {
  const blocks = [...answer.matchAll(FENCE)];
  return { last: blocks.length === 0 ? null : ((blocks.at(-1) as RegExpMatchArray)[1] ?? ""), text: answer.replace(FENCE, "").replace(/\n{3,}/g, "\n\n").trim() };
}

// The company as a plan is held to: the request's scope, the live departments (each with its manager in office, or none),
// and how many it may hire.
export interface StaffingFacts {
  departmentId: string | null;
  departments: readonly { id: string; name: string; manager: string | null }[];
  maxHires: number;
}

// A hire as Orbit carries it out: its department resolved -- a live department's id, or the name of one the plan makes.
export interface PlannedHire extends StaffingHire {
  departmentId: string | null;
  newDepartment: string | null;
}

export interface ReadStaffing {
  plan: StaffingPlan | null;
  // The departments to make (their names, as the plan writes them), and the hires.
  departments: string[];
  hires: PlannedHire[];
  problems: string[];
}

const key = (name: string): string => name.trim().toLocaleLowerCase();
const refused = (problems: string[], plan: StaffingPlan | null = null): ReadStaffing => ({ plan, departments: [], hires: [], problems });

function parsed(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// The departments the plan makes: never in a request for one department, never one that exists, never twice.
function madeOf(plan: StaffingPlan, f: StaffingFacts, scope: { name: string } | null, problems: string[]): Map<string, string> {
  const live = new Set(f.departments.map((d) => key(d.name)));
  const made = new Map<string, string>();
  for (const d of plan.departments) {
    if (scope !== null) problems.push(`This request is for ${scope.name}: the plan makes no department ("${d.name}").`);
    else if (live.has(key(d.name))) problems.push(`"${d.name}" is a department already: a plan names it, and never makes it again.`);
    else if (made.has(key(d.name))) problems.push(`The plan makes "${d.name}" twice.`);
    else made.set(key(d.name), d.name);
  }
  return made;
}

// Each department's managers in the plan, held to who is in office there now.
function managerProblems(hires: readonly PlannedHire[], f: StaffingFacts, made: Map<string, string>, problems: string[]): void {
  const managers = new Map<string, string[]>();
  for (const h of hires.filter((x) => x.role === "manager")) managers.set(key(h.department), [...(managers.get(key(h.department)) ?? []), h.name]);
  for (const [k, name] of made) {
    const m = managers.get(k) ?? [];
    if (m.length !== 1) problems.push(`A department the plan makes gets exactly one manager: "${name}" gets ${m.length}${m.length > 0 ? ` (${m.join(", ")})` : ""}.`);
  }
  for (const d of f.departments) {
    const m = managers.get(key(d.name)) ?? [];
    if (m.length > 0 && d.manager !== null) problems.push(`${d.name} has a manager in office (${d.manager}): the plan appoints no other (${m.join(", ")}).`);
    else if (m.length > 1) problems.push(`${d.name} gets one manager, not ${m.length} (${m.join(", ")}).`);
  }
}

export function readStaffing(raw: string | null, f: StaffingFacts): ReadStaffing {
  if (raw === null) return refused(["The CEO's answer held no staffing plan (no ```orbit-staffing block)."]);
  const checked = checkStaffingPlan(parsed(raw));
  if (!checked.ok) return refused(checked.errors.slice(0, 20).map((e) => `The plan: ${e}.`));
  const plan = checked.value;
  const problems: string[] = [];
  const scope = f.departmentId === null ? null : (f.departments.find((d) => d.id === f.departmentId) ?? null);
  if (f.departmentId !== null && scope === null) problems.push("The department this request is for is no longer live.");
  const made = madeOf(plan, f, scope, problems);
  if (plan.hires.length > f.maxHires) problems.push(`The plan hires ${plan.hires.length}; this request may hire at most ${f.maxHires}.`);
  const live = new Map(f.departments.map((d) => [key(d.name), d]));
  const names = new Set<string>();
  const hires: PlannedHire[] = [];
  for (const h of plan.hires) {
    if (names.has(key(h.name))) problems.push(`The plan hires "${h.name}" twice.`);
    names.add(key(h.name));
    const existing = live.get(key(h.department)) ?? null;
    const making = made.get(key(h.department)) ?? null;
    if (existing === null && making === null) problems.push(`${h.name}'s department "${h.department}" is neither a department of the company nor one the plan makes.`);
    else if (scope !== null && existing?.id !== scope.id) problems.push(`This request is for ${scope.name}: ${h.name} cannot go to "${h.department}".`);
    else hires.push({ ...h, department: existing?.name ?? (making as string), departmentId: existing?.id ?? null, newDepartment: existing === null ? making : null });
  }
  managerProblems(hires, f, made, problems);
  return problems.length > 0 ? refused(problems, plan) : { plan, departments: [...made.values()], hires, problems: [] };
}
