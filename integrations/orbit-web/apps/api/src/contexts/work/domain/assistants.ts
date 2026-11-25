// TEMPORARY ASSISTANTS (Work, pure; ADR 0061 §8): who may engage one for the mission at hand, where it goes, and whether
// a lead's `delegate` tool is offered for it. Authority is the appointment IN FORCE, never a grant, a title or a switch:
//
//   - a department's MANAGER engages into its own department, and the part goes to the assistant itself;
//   - the CEO names a department with a manager in office: the assistant joins that department for the mission, and the
//     part goes to the department -- its manager -- as any work the CEO gives (the CEO gives work only to departments);
//     that manager can then give work to the assistant;
//   - a lead's profile.maxAssistants caps its LIVE assistants (engaged, not expired, not released) -- 0 engages none.
//     The quota is decided through governance (Workforce, as the lead); here it only says whether there is room.
//
// An assistant counts only on its own mission (the OrgReader's working filter): elsewhere it changes nobody's role or
// scope, and it takes no appointment, grant or mission of its own.
import { resolveTarget, scopeIsEmpty, type AuthorityFacts, type DelegationScope, type ResolvedTarget } from "./authority.js";

export interface Quota {
  max: number;
  engaged: number;
  left: number;
}

// Where a hired part goes: to the assistant itself (a manager's), or to the department's manager (the CEO's).
export type HirePlacement = { departmentId: string; goesTo: "assistant" } | { departmentId: string; goesTo: "manager"; employeeId: string; target: ResolvedTarget["target"] } | { problem: string };

// A quota lowered below what is engaged leaves no room, never a negative one.
export const quotaOf = (max: number, engaged: number): Quota => ({ max, engaged, left: Math.max(0, max - engaged) });

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

// Whether its delegate tool is offered: someone to give work to -- or, for a manager in force, room to engage one.
export function canDelegate(scope: DelegationScope, appointment: AuthorityFacts["appointment"], quota: Quota | null): boolean {
  if (!scopeIsEmpty(scope)) return true;
  return appointment?.role === "manager" && quota !== null && quota.left > 0;
}

// Where an assistant a part hires goes, and who takes the part (or why it cannot be engaged at all).
export function placeHire(f: AuthorityFacts, scope: DelegationScope, to: { employee?: string; department?: string }): HirePlacement {
  const named = (to.department ?? "").trim();
  if ((to.employee ?? "").trim() !== "") return { problem: "a part that engages an assistant names nobody else: its assistant (or, for the CEO, the department it joins) takes it." };
  if (f.appointment?.role === "manager" && f.appointment.departmentId !== null) {
    const own = f.departments.find((d) => d.id === f.appointment?.departmentId);
    if (named !== "" && named !== own?.id && !same(named, own?.name ?? "")) return { problem: `your assistant joins your own department (${own?.name ?? "yours"}), never another.` };
    return { departmentId: f.appointment.departmentId, goesTo: "assistant" };
  }
  if (f.appointment?.role === "ceo") {
    if (named === "") return { problem: "name the department it joins: a department with a manager in office, who takes the part and gives the assistant its work." };
    const r = resolveTarget(scope, { department: named });
    if ("problem" in r) return r;
    return { departmentId: r.target.departmentId as string, goesTo: "manager", employeeId: r.employeeId, target: r.target };
  }
  return { problem: "Only the CEO or a department's manager engages an assistant: give the part to someone you may give work to." };
}
