// AN APPOINTMENT (Workforce context): the company's authority, held by an existing employee -- its CEO, or a department's
// MANAGER. Authority is this record and nothing else: a title, instructions or a profile switch grant none.
//
//   active ⇄ suspended          (a suspended incumbent still holds the slot, and acts for nothing)
//   active | suspended → revoked   (the slot is left empty)
//   active | suspended → replaced  (by the next appointment of the same slot, in the same transaction)
//
// An appointment never changes who, where or when (the database refuses it too); one that ended stays as history. The
// rules a slot holds -- one incumbent per slot and per employee, a manager in its own department -- are the database's
// as well (partial unique indexes, and a check at commit), so no path around this class can break them.
import type { AppointmentRole, AppointmentState } from "@orbit-web/contracts";
import { AccountOwned, conflictWith, type OrbitId, type RaisedEvent } from "../../shared/domain.js";

export interface AppointmentData {
  id: string;
  orbitId: OrbitId;
  role: AppointmentRole;
  departmentId: string | null;
  employeeId: string;
  state: AppointmentState;
  slotRevision: number;
  replaces: string | null;
  reason: string;
  appointedBy: string;
  appointedAt: string;
  endedBy: string | null;
  endedAt: string | null;
  endReason: string | null;
  updatedAt: string;
  version: number;
}

// Which moves an appointment allows, from which states.
const MOVES = {
  suspend: { from: ["active"], to: "suspended" },
  reinstate: { from: ["suspended"], to: "active" },
  revoke: { from: ["active", "suspended"], to: "revoked" },
  replace: { from: ["active", "suspended"], to: "replaced" },
} as const satisfies Record<string, { from: readonly AppointmentState[]; to: AppointmentState }>;

export type AppointmentMove = keyof typeof MOVES;

export class Appointment extends AccountOwned {
  private readonly raised: RaisedEvent[] = [];

  private constructor(private d: AppointmentData) {
    super(d.orbitId);
  }

  static restore(d: AppointmentData): Appointment {
    return new Appointment({ ...d });
  }

  static appoint(o: { id: string; orbitId: OrbitId; role: AppointmentRole; departmentId: string | null; employeeId: string; slotRevision: number; replaces: string | null; reason: string; by: string; at: string }): Appointment {
    const a = new Appointment({ id: o.id, orbitId: o.orbitId, role: o.role, departmentId: o.role === "ceo" ? null : o.departmentId, employeeId: o.employeeId, state: "active", slotRevision: o.slotRevision, replaces: o.replaces, reason: o.reason, appointedBy: o.by, appointedAt: o.at, endedBy: null, endedAt: null, endReason: null, updatedAt: o.at, version: 1 });
    a.raise("appointed");
    return a;
  }

  get id(): string {
    return this.d.id;
  }

  get data(): Readonly<AppointmentData> {
    return this.d;
  }

  get incumbent(): boolean {
    return this.d.state === "active" || this.d.state === "suspended";
  }

  move(command: AppointmentMove, by: string, reason: string, at: string): void {
    const m = MOVES[command];
    if (!(m.from as readonly AppointmentState[]).includes(this.d.state)) throw conflictWith("invalid_transition", `An appointment that is ${this.d.state} cannot be ${m.to === "active" ? "reinstated" : m.to}.`, { state: this.d.state });
    const ends = m.to === "revoked" || m.to === "replaced";
    this.d = { ...this.d, state: m.to, updatedAt: at, ...(ends ? { endedBy: by, endedAt: at, endReason: reason } : {}) };
    this.raise(command);
  }

  pullEvents(): RaisedEvent[] {
    return this.raised.splice(0);
  }

  private raise(change: "appointed" | AppointmentMove): void {
    this.raised.push({
      type: "AppointmentChanged",
      aggregateType: "appointment",
      aggregateId: this.d.id,
      aggregateVersion: this.d.version,
      payload: { change, role: this.d.role, departmentId: this.d.departmentId, employeeId: this.d.employeeId, state: this.d.state, slotRevision: this.d.slotRevision },
    });
  }
}
