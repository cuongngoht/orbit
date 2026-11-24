// ROLES IN THE AI WORKFORCE (Work, pure; ADR 0061 §8). What an employee's standing makes of its work, from the
// appointment it holds IN FORCE and the colleagues it could give parts to -- never from a title or its instructions:
//
//   ceo                plans and synthesizes: it gives the work to departments (each to its manager), reviews what they
//                      hand in and writes the synthesis. It runs no command and reads none of the company's systems.
//   manager_with_team  a manager with at least one other working employee in its department coordinates: it gives the
//                      work to its team, reviews and synthesizes, and decides what its team asks -- nothing it is asked
//                      leaves its department.
//   manager_alone      a manager with nobody to give the work to does it itself, and decides alone.
//   employee           everyone else does the work: a part asks its lead, a root the person who gave it the work.
//
// ONE place decides it: what the attempt is told (its role), the tools it is offered and the tool door (`denied`), and
// whether its hand-in is taken (`delegatesFirst`). A question nobody below the CEO answered in time is answered for its
// asker (clarifications.service.ts) -- it never reaches the CEO or the person who gave the work.
import type { AuthorityFacts } from "./authority.js";

export type WorkRole = "ceo" | "manager_with_team" | "manager_alone" | "employee";

export const WORK_ROLES: readonly WorkRole[] = ["ceo", "manager_with_team", "manager_alone", "employee"];

export interface RoleFacts {
  // The appointment it holds in force (a suspended one grants nothing).
  appointment: { role: "ceo" | "manager"; departmentId: string | null } | null;
  // The working employees of its department other than itself (counted for a manager only).
  workingMembers: number;
}

export function roleOf(f: RoleFacts): WorkRole {
  if (f.appointment?.role === "ceo") return "ceo";
  if (f.appointment?.role === "manager") return f.workingMembers > 0 ? "manager_with_team" : "manager_alone";
  return "employee";
}

// The role the authority facts make: a manager's team is the working employees of its department, other than itself.
export function roleFrom(f: AuthorityFacts): WorkRole {
  const department = f.appointment?.role === "manager" ? f.appointment.departmentId : null;
  const workingMembers = department === null ? 0 : f.working.filter((w) => w.departmentId === department && w.employeeId !== f.self).length;
  return roleOf({ appointment: f.appointment, workingMembers });
}

export interface RoleRules {
  role: WorkRole;
  // Tools it is never offered, each with why (said when one is asked anyway).
  denied: { name: string; why: string }[];
  // Why every connector and knowledge-base tool is withheld from it (null: they are not).
  connectorsDenied: string | null;
  // Why its hand-in is refused while it gave no plan (null: it may do the work itself).
  delegatesFirst: { code: string; message: string } | null;
  // Whether it may move a question its team asked one level up (to a lead below the CEO only; never to the person who
  // gave the work, never to the CEO).
  escalates: boolean;
}

const CEO_SYSTEMS = "The CEO does not run commands or read the company's systems: give the work to a department, which does.";
const CEO_DECIDES = "The CEO decides: answer your team's questions yourself.";
const CEO_ASKS_NOBODY = "The CEO decides: it asks nobody but the person who gave it the work.";
const MANAGER_DECIDES = "You decide: questions do not leave your department. Settle it with your team (/team), or decide with your best judgment and say what you assumed.";

// `isRoot`: the work was given to it by a person (it has no lead in this mission).
export function rulesOf(role: WorkRole, isRoot: boolean): RoleRules {
  if (role === "ceo")
    return {
      role,
      denied: [{ name: "shell", why: CEO_SYSTEMS }, { name: "escalate_question", why: CEO_DECIDES }, ...(isRoot ? [] : [{ name: "ask_question", why: CEO_ASKS_NOBODY }])],
      connectorsDenied: CEO_SYSTEMS,
      delegatesFirst: { code: "ceo_delegates_only", message: "The CEO does not do the work itself: give it to the departments first (delegate), review what they hand in, then hand in your synthesis." },
      escalates: false,
    };
  if (role === "manager_with_team" || role === "manager_alone")
    return {
      role,
      denied: [
        { name: "ask_question", why: MANAGER_DECIDES },
        { name: "escalate_question", why: MANAGER_DECIDES },
      ],
      connectorsDenied: null,
      delegatesFirst: role === "manager_with_team" ? { code: "manager_delegates_to_team", message: "Your department has people to do this: give the work to your team first (delegate), review what they hand in, then hand in your synthesis." } : null,
      escalates: false,
    };
  return { role, denied: [], connectorsDenied: null, delegatesFirst: null, escalates: true };
}

// Why a hand-in is refused now (null: it is taken, as far as its role goes): a role that delegates first hands in only
// once it gave a plan. That every part ended is the team's own rule (`allEnded`).
export function handInRefusal(rules: RoleRules, parts: number): { code: string; message: string } | null {
  return rules.delegatesFirst !== null && parts === 0 ? rules.delegatesFirst : null;
}

// Why a tool is refused to this role (null: the role does not stand in its way).
export function toolRefusal(rules: Pick<RoleRules, "denied" | "connectorsDenied">, name: string, isConnector: boolean): string | null {
  const denied = rules.denied.find((d) => d.name === name);
  if (denied !== undefined) return denied.why;
  return isConnector ? rules.connectorsDenied : null;
}

// What a question nobody below the CEO answered in time is answered with, for its asker.
export const DECIDE_YOURSELF = "Your manager did not answer in time: decide with your best judgment and say what you assumed in your hand-in.";
