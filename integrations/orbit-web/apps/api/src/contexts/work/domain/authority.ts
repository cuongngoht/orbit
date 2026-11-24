// WHO AN EMPLOYEE MAY GIVE WORK TO (Work, pure; ADR 0061 §8). Authority comes from an APPOINTMENT in force or an explicit
// DELEGATION GRANT a person made -- never from a title, instructions, or a profile's "may delegate" switch:
//
//   - the CEO gives work to the managers in office (a department, which goes to its manager);
//   - a department's manager gives work to the working members of its department;
//   - anyone gives work to whom a person granted it: an employee, or a department (through its manager);
//   - never to itself, nor to anyone above it in this mission's chain of leads.
//
// ONE function feeds what the attempt is told, whether its delegate tool is offered at all, and what its plan is held to.

export interface AuthorityFacts {
  self: string;
  // The employees of the leads above this assignment (its lead, its lead's lead ...).
  chain: readonly string[];
  // The appointment it holds IN FORCE (a suspended one grants nothing).
  appointment: { role: "ceo" | "manager"; departmentId: string | null } | null;
  // The managers in office (active appointments of working employees).
  managers: readonly { employeeId: string; name: string; title: string; departmentId: string; departmentName: string; appointmentId: string; slotRevision: number }[];
  // The working employees of the account, with their department.
  working: readonly { employeeId: string; name: string; title: string; departmentId: string | null; departmentName: string | null }[];
  // The live departments.
  departments: readonly { id: string; name: string }[];
  // The delegation grants it holds that are active.
  grants: readonly ({ kind: "employee"; employeeId: string } | { kind: "department"; departmentId: string })[];
}

export type Via = "ceo" | "manager" | "grant";

export interface ScopeEmployee {
  id: string;
  name: string;
  title: string;
  departmentName: string | null;
  via: Via;
}

export interface ScopeDepartment {
  id: string;
  name: string;
  // Who takes work given to it: its manager in office (null: none -- it takes nothing).
  manager: { employeeId: string; name: string; appointmentId: string; slotRevision: number } | null;
  via: Via;
}

export interface DelegationScope {
  employees: ScopeEmployee[];
  departments: ScopeDepartment[];
}

export const scopeIsEmpty = (s: DelegationScope): boolean => s.employees.length === 0 && s.departments.length === 0;

export function delegationScope(f: AuthorityFacts): DelegationScope {
  const barred = new Set([f.self, ...f.chain]);
  const employees = new Map<string, ScopeEmployee>();
  const departments = new Map<string, ScopeDepartment>();
  const managerOf = (departmentId: string) => f.managers.find((m) => m.departmentId === departmentId) ?? null;
  const addEmployee = (id: string, via: Via) => {
    const w = f.working.find((x) => x.employeeId === id);
    if (w === undefined || barred.has(id) || employees.has(id)) return;
    employees.set(id, { id, name: w.name, title: w.title, departmentName: w.departmentName, via });
  };
  const addDepartment = (id: string, via: Via) => {
    const d = f.departments.find((x) => x.id === id);
    const m = managerOf(id);
    if (d === undefined || departments.has(id) || (m !== null && barred.has(m.employeeId))) return;
    departments.set(id, { id, name: d.name, manager: m === null ? null : { employeeId: m.employeeId, name: m.name, appointmentId: m.appointmentId, slotRevision: m.slotRevision }, via });
  };
  if (f.appointment?.role === "ceo") {
    for (const m of f.managers) {
      addEmployee(m.employeeId, "ceo");
      addDepartment(m.departmentId, "ceo");
    }
  }
  if (f.appointment?.role === "manager" && f.appointment.departmentId !== null) {
    for (const w of f.working.filter((x) => x.departmentId === f.appointment?.departmentId)) addEmployee(w.employeeId, "manager");
  }
  for (const g of f.grants) {
    if (g.kind === "employee") addEmployee(g.employeeId, "grant");
    else addDepartment(g.departmentId, "grant");
  }
  return { employees: [...employees.values()], departments: [...departments.values()] };
}

export interface ResolvedTarget {
  employeeId: string;
  target: { kind: "employee" | "department"; departmentId: string | null; appointmentId: string | null; appointmentRevision: number | null };
}

const same = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

// Who a part of a plan goes to: an employee in its scope (by id or exact name), or a department in its scope (by id or
// exact name), which goes to its manager in office.
export function resolveTarget(scope: DelegationScope, to: { employee?: string; department?: string }): ResolvedTarget | { problem: string } {
  if (to.department !== undefined && to.department.trim() !== "") {
    const d = scope.departments.find((x) => x.id === to.department || same(x.name, to.department ?? ""));
    if (d === undefined) return { problem: `"${to.department}" is not a department you may give work to.` };
    if (d.manager === null) return { problem: `${d.name} has no manager in office: nobody there can take it.` };
    return { employeeId: d.manager.employeeId, target: { kind: "department", departmentId: d.id, appointmentId: d.manager.appointmentId, appointmentRevision: d.manager.slotRevision } };
  }
  const who = to.employee ?? "";
  const e = scope.employees.find((x) => x.id === who || same(x.name, who));
  if (e === undefined) {
    const hint = scope.departments.length > 0 ? ` Give it to a department instead (${scope.departments.map((d) => d.name).join(", ")}): it goes to its manager.` : "";
    return { problem: `"${who}" is not someone you may give work to.${hint}` };
  }
  return { employeeId: e.id, target: { kind: "employee", departmentId: null, appointmentId: null, appointmentRevision: null } };
}
