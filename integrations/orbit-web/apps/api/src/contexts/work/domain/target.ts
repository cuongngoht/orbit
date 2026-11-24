// WHO A MISSION GOES TO (Work, pure; ADR 0061 §8): an employee by name; a DEPARTMENT, which goes to its manager in office;
// the CEO. Resolved inside the transaction that makes the mission, from the slot as it is then -- and held to what the
// person saw (`expected`): an appointment that moved since is refused, never followed silently. The CEO gives work only
// to departments (roles.ts), so work for a CEO with no department that has a manager in office is refused before
// anything is made: it would only wait for nobody.
import type { ExpectedAssignee, MissionTarget } from "@orbit-web/contracts";

export interface SlotFacts {
  // The slot's incumbent (active or suspended), and whether its employee works now.
  incumbent: { appointmentId: string; employeeId: string; employeeName: string; state: "active" | "suspended"; slotRevision: number; working: boolean } | null;
  departmentName: string | null;
  // The CEO's slot: how many live departments have a manager in office (active, working) to give the work to.
  departmentsManaged: number;
}

export interface ResolvedMissionTarget {
  employeeId: string;
  appointmentId: string | null;
  appointmentRevision: number | null;
}

export type TargetRefusal = { code: "no_ceo" | "no_manager" | "appointment_suspended" | "not_working" | "ceo_needs_departments"; message: string };

export const CEO_NEEDS_DEPARTMENTS = "The CEO gives work only to departments, and none has a manager yet: create a department and appoint its manager, or give the work to an employee.";

export function resolveMissionTarget(target: MissionTarget, slot: SlotFacts): ResolvedMissionTarget | TargetRefusal {
  if (target.kind === "employee") return { employeeId: target.employeeId, appointmentId: null, appointmentRevision: null };
  const what = target.kind === "ceo" ? "The company" : (slot.departmentName ?? "The department");
  const i = slot.incumbent;
  if (i === null) return target.kind === "ceo" ? { code: "no_ceo", message: "The company has no CEO: appoint one (Office → Leadership), or give the work to an employee." } : { code: "no_manager", message: `${what} has no manager: appoint one, or give the work to an employee of it.` };
  if (i.state === "suspended") return { code: "appointment_suspended", message: `${i.employeeName}'s appointment ${target.kind === "ceo" ? "as CEO" : `as ${what}'s manager`} is suspended: reinstate it, appoint someone else, or give the work to an employee.` };
  if (!i.working) return { code: "not_working", message: `${i.employeeName} does not work now: appoint someone who does.` };
  if (target.kind === "ceo" && slot.departmentsManaged === 0) return { code: "ceo_needs_departments", message: CEO_NEEDS_DEPARTMENTS };
  return { employeeId: i.employeeId, appointmentId: i.appointmentId, appointmentRevision: i.slotRevision };
}

// Whether what the person saw is who is responsible now.
export const sameAssignee = (expected: ExpectedAssignee, now: ResolvedMissionTarget): boolean =>
  expected.employeeId === now.employeeId && expected.appointmentId === now.appointmentId && expected.appointmentRevision === now.appointmentRevision;
