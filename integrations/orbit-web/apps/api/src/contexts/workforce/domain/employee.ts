// THE EMPLOYEE (Workforce context): an AI employee of one account. Three axes are kept apart and never folded into one
// word: EMPLOYMENT (candidate → probation → active ⇄ suspended → archived) is the organisation's decision; AVAILABILITY
// (available, busy, ineligible) is derived from the reservation and the conditions to run; the health of its CONNECTION
// is the connection's. What the employee is -- its profile and its resources -- are immutable revisions; an assignment
// pins the profile revision it was claimed under, an attempt the resource revision it was admitted under.
//
// THE PERSONAL SANDBOX is the employee's persistent environment (desk, toolbox, cache -- volumes with quotas), never a
// container that keeps running: PROVISIONING → READY (every area exists, was written to, its enforcement level recorded
// with evidence) or FAILED (retried); ARCHIVED with the employee.
import type { Employment, EmployeeKind, SandboxState } from "@orbit-web/contracts";
import { AccountOwned, conflictWith, invalid, type OrbitId, type RaisedEvent } from "../../shared/domain.js";

export interface EmployeeData {
  id: string;
  orbitId: OrbitId;
  name: string;
  kind: EmployeeKind;
  departmentId: string | null;
  managerId: string | null;
  employment: Employment;
  employmentReason: string | null;
  profileRevision: number;
  resourceRevision: number;
  connectionId: string | null;
  expiresAt: string | null;
  missionScope: string | null;
  engagedBy: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}

// Which employment moves are allowed, and the command that makes each.
const MOVES: Record<string, { from: readonly Employment[]; to: Employment }> = {
  start_probation: { from: ["candidate"], to: "probation" },
  activate: { from: ["candidate", "probation"], to: "active" },
  reject: { from: ["candidate", "probation"], to: "archived" },
  suspend: { from: ["probation", "active"], to: "suspended" },
  reinstate: { from: ["suspended"], to: "active" },
  archive: { from: ["candidate", "probation", "active", "suspended"], to: "archived" },
  // Only an archived employee's desk is deleted (Governance → Employee desks): its work already ended at the archive.
  delete: { from: ["archived"], to: "deleted" },
};

export type EmploymentMove = keyof typeof MOVES;

// The employments in which an employee may take work (a probation is a trial that does real, limited work).
export const WORKING: readonly Employment[] = ["probation", "active"];

const ASSISTANT_ACTIVE = "a temporary assistant: active for its engagement";

export class Employee extends AccountOwned {
  private readonly raised: RaisedEvent[] = [];

  private constructor(private d: EmployeeData) {
    super(d.orbitId);
  }

  static restore(d: EmployeeData): Employee {
    return new Employee({ ...d });
  }

  // A new hire: a candidate that starts its trial at once, or -- the owner's explicit, recorded choice -- active.
  static hire(o: Omit<EmployeeData, "employment" | "employmentReason" | "profileRevision" | "resourceRevision" | "updatedAt" | "version">, skipProbation: { skip: boolean; reason: string }): Employee {
    if (skipProbation.skip && skipProbation.reason.trim().length === 0) throw invalid("skip_reason_required", "Skipping the trial is recorded with its reason.");
    const employment: Employment = skipProbation.skip ? "active" : "probation";
    const e = new Employee({ ...o, employment, employmentReason: skipProbation.skip ? `trial skipped: ${skipProbation.reason}` : null, profileRevision: 1, resourceRevision: 1, updatedAt: o.createdAt, version: 0 });
    e.raise("EmployeeHired", { name: o.name, kind: o.kind, departmentId: o.departmentId, employment, trialSkipped: skipProbation.skip });
    if (employment === "active") e.raise("EmployeeActivated", { reason: e.d.employmentReason });
    return e;
  }

  // A TEMPORARY ASSISTANT a lead engaged for one mission (ADR 0061 §8): active for its engagement -- it has no trial --
  // until its mission ends or `expiresAt`, whichever comes first. Who engaged it and for which mission are kept on it.
  static engage(o: Omit<EmployeeData, "kind" | "employment" | "employmentReason" | "profileRevision" | "resourceRevision" | "updatedAt" | "version" | "missionScope" | "engagedBy" | "expiresAt"> & { missionScope: string; engagedBy: string; expiresAt: string }): Employee {
    if (o.missionScope.trim() === "") throw invalid("assistant_without_mission", "An assistant is engaged for one mission: name it.");
    if (o.engagedBy === o.id) throw conflictWith("relation_cycle", "An assistant is engaged by its lead, never by itself.");
    if (Date.parse(o.expiresAt) <= Date.parse(o.createdAt)) throw conflictWith("engagement_ended", "This engagement would end before it starts: the mission has no time left for an assistant.");
    const e = new Employee({ ...o, kind: "assistant", employment: "active", employmentReason: ASSISTANT_ACTIVE, profileRevision: 1, resourceRevision: 1, updatedAt: o.createdAt, version: 0 });
    e.raise("EmployeeHired", { name: o.name, kind: "assistant", departmentId: o.departmentId, employment: "active", trialSkipped: true, missionId: o.missionScope, engagedBy: o.engagedBy });
    e.raise("EmployeeActivated", { reason: ASSISTANT_ACTIVE });
    return e;
  }

  // The END OF AN ENGAGEMENT (its mission ended, it expired, its sandbox could not be made): archived, then its desk
  // deleted -- each move said. Only an assistant is released; a permanent employee leaves by a person's command.
  release(reason: string, at: string): void {
    if (this.d.kind !== "assistant") throw conflictWith("not_an_assistant", `${this.d.name} is a permanent employee: only a person ends their employment.`);
    this.move("archive", reason, at);
    this.move("delete", reason, at);
  }

  get data(): Readonly<EmployeeData> {
    return this.d;
  }

  get id(): string {
    return this.d.id;
  }

  get working(): boolean {
    return WORKING.includes(this.d.employment) && (this.d.expiresAt === null || Date.parse(this.d.expiresAt) > Date.now());
  }

  pullEvents(): RaisedEvent[] {
    return this.raised.splice(0, this.raised.length);
  }

  move(move: EmploymentMove, reason: string, at: string): void {
    const m = MOVES[move];
    if (m === undefined || !m.from.includes(this.d.employment)) throw conflictWith("invalid_transition", `An employee who is ${this.d.employment} cannot be moved by "${move}".`, { employment: this.d.employment, command: move });
    this.d = { ...this.d, employment: m.to, employmentReason: reason || null, updatedAt: at };
    this.raise("EmployeeEmploymentChanged", { command: move, employment: m.to, reason: reason || null });
    if (m.to === "active") this.raise("EmployeeActivated", { reason: reason || null });
  }

  rename(name: string, at: string): void {
    this.d = { ...this.d, name, updatedAt: at };
  }

  setManager(managerId: string | null, at: string): void {
    if (managerId === this.d.id) throw conflictWith("relation_cycle", "An employee cannot manage themselves.");
    this.d = { ...this.d, managerId, updatedAt: at };
  }

  moveToDepartment(departmentId: string | null, at: string): void {
    if (this.d.employment === "archived" || this.d.employment === "deleted") throw conflictWith("invalid_transition", "An archived employee keeps the department they left in.");
    const from = this.d.departmentId;
    this.d = { ...this.d, departmentId, updatedAt: at };
    this.raise("EmployeeDepartmentChanged", { from, to: departmentId });
  }

  revisedProfile(at: string, connectionId: string | null): number {
    this.d = { ...this.d, profileRevision: this.d.profileRevision + 1, connectionId, updatedAt: at };
    this.raise("EmployeeProfileRevised", { revision: this.d.profileRevision });
    return this.d.profileRevision;
  }

  revisedResources(at: string): number {
    this.d = { ...this.d, resourceRevision: this.d.resourceRevision + 1, updatedAt: at };
    this.raise("EmployeeResourcesRevised", { revision: this.d.resourceRevision });
    return this.d.resourceRevision;
  }

  private raise(type: RaisedEvent["type"], payload: RaisedEvent["payload"]): void {
    this.raised.push({ type, aggregateType: "employee", aggregateId: this.d.id, aggregateVersion: this.d.version + 1, payload });
  }
}

// The sandbox's lifecycle moves.
export function sandboxMove(from: SandboxState, to: SandboxState): void {
  const allowed: Record<SandboxState, readonly SandboxState[]> = {
    PROVISIONING: ["READY", "FAILED", "ARCHIVED"],
    FAILED: ["PROVISIONING", "ARCHIVED"],
    READY: ["ARCHIVED", "PROVISIONING"],
    // An archived employee's desk deleted by its owner: removed (tried again until it is gone), then gone.
    ARCHIVED: ["DELETING"],
    DELETING: ["DELETED"],
    DELETED: [],
  };
  if (!allowed[from].includes(to)) throw conflictWith("invalid_transition", `A sandbox that is ${from} cannot become ${to}.`);
}

// Manager relations: an employee's chain of managers never returns to itself, and stays within the account.
export function managerCycle(employeeId: string, newManagerId: string | null, managerOf: ReadonlyMap<string, string | null>, maxDepth = 32): boolean {
  let at = newManagerId;
  for (let depth = 0; at !== null && depth <= maxDepth; depth += 1) {
    if (at === employeeId) return true;
    at = managerOf.get(at) ?? null;
  }
  return at !== null;
}
