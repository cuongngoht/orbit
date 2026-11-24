// THE COMPANY'S APPOINTMENTS (Workforce): its CEO and each department's manager, appointed, replaced, suspended,
// reinstated and revoked by a person of the account (office.roster.manage, a people-only action), each against the
// version it read (If-Match), decided and recorded. Authority is the appointment alone: canDelegate, a title or
// instructions grant none. Replacing a manager moves none of the open work it holds -- that is a handover, an act of its
// own -- and an appointment that ended stays as history.
//
// DELEGATION GRANTS are the other source of authority: a person lets an employee who holds no appointment give work to
// named colleagues, or to a department's members.
//
// Lock order, the same in every command: the slot's row (the office for the CEO, the department for its manager), then
// the appointment, then the employee.
import { Inject, Injectable } from "@nestjs/common";
import {
  checkAppoint,
  checkAppointmentChange,
  checkGrantDelegation,
  checkReplaceAppointment,
  isWorkforceId,
  type AppointmentView,
  type AppointmentsView,
  type DelegationGrantView,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accepted } from "../../../common/errors.js";
import { OfficeGovernance, type Actor } from "../../shared/application/commands.js";
import { conflictWith, missing, stale } from "../../shared/domain.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { Appointment, type AppointmentData, type AppointmentMove } from "../domain/appointment.js";
import { WORKING } from "../domain/employee.js";
import { AppointmentRepository, grantView, type DelegationGrantRecord, type Slot } from "../infrastructure/appointments.repository.js";
import { DepartmentRepository, EmployeeRepository, OfficeRepository } from "../infrastructure/repositories.js";

const ROLE_TEXT = { ceo: "CEO", manager: "manager" } as const;

@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(AppointmentRepository) private readonly appointments: AppointmentRepository,
    @Inject(EmployeeRepository) private readonly employees: EmployeeRepository,
    @Inject(DepartmentRepository) private readonly departments: DepartmentRepository,
    @Inject(OfficeRepository) private readonly offices: OfficeRepository,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
  ) {}

  // ---- reading -----------------------------------------------------------------------------------------------------

  async view(orbitId: string): Promise<AppointmentsView> {
    const all = await this.views(orbitId, await this.appointments.all(orbitId));
    const incumbent = (a: AppointmentView) => a.state === "active" || a.state === "suspended";
    return { ceo: all.find((a) => a.role === "ceo" && incumbent(a)) ?? null, managers: all.filter((a) => a.role === "manager" && incumbent(a)), history: all, asOf: new Date().toISOString() };
  }

  async one(orbitId: string, id: string): Promise<AppointmentView> {
    const a = isWorkforceId(id) ? await this.appointments.get(orbitId, id) : null;
    if (a === null) throw missing("Appointment");
    return (await this.views(orbitId, [a.data]))[0] as AppointmentView;
  }

  // An employee's appointment now, every one it held, and its delegation grants (the employee's page).
  async ofEmployee(orbitId: string, employeeId: string): Promise<{ appointment: AppointmentView | null; appointments: AppointmentView[]; delegationGrants: DelegationGrantView[] }> {
    const appointments = await this.views(orbitId, await this.appointments.ofEmployee(orbitId, employeeId));
    return { appointment: appointments.find((a) => a.state === "active" || a.state === "suspended") ?? null, appointments, delegationGrants: await this.grantViews(orbitId, await this.appointments.grantsOf(orbitId, employeeId)) };
  }

  // ---- commands ----------------------------------------------------------------------------------------------------

  async appoint(actor: Actor, body: unknown): Promise<AppointmentView> {
    const req = accepted(checkAppoint(body));
    const orbitId = actor.command.orbitId;
    const id = randomUUID();
    const slot: Slot = { role: req.role, departmentId: req.departmentId };
    const saved = await this.governance.command(actor, "appointment.appoint", id, async () => {
      await this.governance.authorize(actor, "office.roster.manage", `appointment:${req.role}`, { employee: req.employeeId, role: req.role, department: req.departmentId });
      await this.slotOpen(orbitId, slot);
      const holder = await this.appointments.incumbent(orbitId, slot);
      if (holder !== null) throw conflictWith("appointment_conflict", `This ${ROLE_TEXT[req.role]} slot has an incumbent already: replace it, or end it first.`, { appointmentId: holder.id });
      await this.appointable(orbitId, req.employeeId, slot);
      const at = new Date().toISOString();
      const a = Appointment.appoint({ id, orbitId, role: req.role, departmentId: req.departmentId, employeeId: req.employeeId, slotRevision: await this.appointments.nextSlotRevision(orbitId, slot), replaces: null, reason: req.reason, by: actor.command.actor, at });
      await this.appointments.insert(a);
      await this.outbox.append(actor.command, a.pullEvents());
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, "appointment.appoint", "appointment", id, 1, `${ROLE_TEXT[req.role]}${req.departmentId ? ` of ${req.departmentId}` : ""}: ${req.employeeId} (slot revision ${a.data.slotRevision})`);
      return a.data;
    });
    return (await this.views(orbitId, [saved]))[0] as AppointmentView;
  }

  // The incumbent ends `replaced` and the next one starts, in one transaction: the slot is never empty in between, and
  // the open work of the one replaced stays with it until a person hands it over.
  async replace(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<AppointmentView> {
    const req = accepted(checkReplaceAppointment(body));
    const orbitId = actor.command.orbitId;
    const nextId = randomUUID();
    const saved = await this.governance.command(actor, "appointment.replace", id, async () => {
      const current = await this.existing(orbitId, id);
      const slot: Slot = { role: current.data.role, departmentId: current.data.departmentId };
      await this.governance.authorize(actor, "office.roster.manage", `appointment:${slot.role}`, { employee: req.employeeId, role: slot.role, department: slot.departmentId, replaces: id });
      await this.slotOpen(orbitId, slot);
      const old = await this.locked(orbitId, id, expectedVersion);
      if (old.data.employeeId === req.employeeId) throw conflictWith("same_appointee", "That employee holds this appointment already.");
      await this.appointable(orbitId, req.employeeId, slot);
      const at = new Date().toISOString();
      old.move("replace", actor.command.actor, req.reason, at);
      const oldVersion = await this.appointments.save(old, expectedVersion);
      const next = Appointment.appoint({ id: nextId, orbitId, role: slot.role, departmentId: slot.departmentId, employeeId: req.employeeId, slotRevision: await this.appointments.nextSlotRevision(orbitId, slot), replaces: old.id, reason: req.reason, by: actor.command.actor, at });
      await this.appointments.insert(next);
      await this.outbox.append(actor.command, [...old.pullEvents().map((e) => ({ ...e, aggregateVersion: oldVersion })), ...next.pullEvents()]);
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, "appointment.replace", "appointment", nextId, 1, `${ROLE_TEXT[slot.role]}: ${old.data.employeeId} → ${req.employeeId} (slot revision ${next.data.slotRevision})`);
      return next.data;
    });
    return (await this.views(orbitId, [saved]))[0] as AppointmentView;
  }

  async change(actor: Actor, id: string, command: Exclude<AppointmentMove, "replace">, body: unknown, expectedVersion: number): Promise<AppointmentView> {
    const req = accepted(checkAppointmentChange(body));
    const orbitId = actor.command.orbitId;
    const saved = await this.governance.command(actor, `appointment.${command}`, id, async () => {
      const current = await this.existing(orbitId, id);
      const slot: Slot = { role: current.data.role, departmentId: current.data.departmentId };
      await this.governance.authorize(actor, "office.roster.manage", `appointment:${slot.role}`, { employee: current.data.employeeId, role: slot.role, department: slot.departmentId, command });
      await this.appointments.lockSlot(orbitId, slot, "update");
      const a = await this.locked(orbitId, id, expectedVersion);
      a.move(command, actor.command.actor, req.reason, new Date().toISOString());
      const v = await this.appointments.save(a, expectedVersion);
      await this.outbox.append(actor.command, a.pullEvents().map((e) => ({ ...e, aggregateVersion: v })));
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, `appointment.${command}`, "appointment", id, v, req.reason);
      return { ...a.data, version: v };
    });
    return (await this.views(orbitId, [saved]))[0] as AppointmentView;
  }

  // ---- delegation grants -------------------------------------------------------------------------------------------

  async grants(orbitId: string, employeeId: string): Promise<DelegationGrantView[]> {
    if (!isWorkforceId(employeeId) || (await this.employees.get(orbitId, employeeId)) === null) throw missing("Employee");
    return this.grantViews(orbitId, await this.appointments.grantsOf(orbitId, employeeId));
  }

  async grantDelegation(actor: Actor, employeeId: string, body: unknown): Promise<DelegationGrantView> {
    const req = accepted(checkGrantDelegation(body));
    const orbitId = actor.command.orbitId;
    const id = randomUUID();
    const saved = await this.governance.command(actor, "delegation.grant", id, async () => {
      await this.governance.authorize(actor, "office.roster.manage", `employee:${employeeId}`, { employee: employeeId, target: req.target.kind === "employee" ? req.target.employeeId : req.target.departmentId });
      const grantee = isWorkforceId(employeeId) ? await this.employees.get(orbitId, employeeId, true) : null;
      if (grantee === null || grantee.data.employment === "archived" || grantee.data.employment === "deleted") throw missing("Employee");
      if (req.target.kind === "employee") {
        if (req.target.employeeId === employeeId) throw conflictWith("delegation_to_self", "An employee gives work to others, never to itself.");
        const target = await this.employees.get(orbitId, req.target.employeeId);
        if (target === null || target.data.employment === "archived" || target.data.employment === "deleted") throw missing("Colleague");
      } else {
        const d = await this.departments.get(orbitId, req.target.departmentId, "share");
        if (d === null || d.archivedAt !== null) throw missing("Department");
      }
      const at = new Date().toISOString();
      const g: DelegationGrantRecord = { id, orbitId, employeeId, target: req.target, state: "active", note: req.note, grantedBy: actor.command.actor, grantedAt: at, revokedBy: null, revokedAt: null, version: 1 };
      await this.appointments.insertGrant(g);
      await this.outbox.append(actor.command, [{ type: "DelegationGrantChanged", aggregateType: "delegation", aggregateId: id, aggregateVersion: 1, payload: { employeeId, targetKind: req.target.kind, state: "active" } }]);
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, "delegation.grant", "delegation", id, 1, `${employeeId} → ${req.target.kind}`);
      return g;
    });
    return (await this.grantViews(orbitId, [saved]))[0] as DelegationGrantView;
  }

  async revokeDelegation(actor: Actor, grantId: string, expectedVersion: number): Promise<void> {
    const orbitId = actor.command.orbitId;
    await this.governance.command(actor, "delegation.revoke", grantId, async () => {
      const g = isWorkforceId(grantId) ? await this.appointments.grant(orbitId, grantId, true) : null;
      if (g === null) throw missing("Delegation grant");
      await this.governance.authorize(actor, "office.roster.manage", `employee:${g.employeeId}`, { employee: g.employeeId, grant: grantId });
      const v = await this.appointments.revokeGrant(orbitId, grantId, actor.command.actor, new Date().toISOString(), expectedVersion);
      await this.outbox.append(actor.command, [{ type: "DelegationGrantChanged", aggregateType: "delegation", aggregateId: grantId, aggregateVersion: v, payload: { employeeId: g.employeeId, targetKind: g.target.kind, state: "revoked" } }]);
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, "delegation.revoke", "delegation", grantId, v);
    });
  }

  // ---- the rules a slot holds --------------------------------------------------------------------------------------

  // The slot exists and is locked for this command: an active company for its CEO, a department not archived for its
  // manager.
  private async slotOpen(orbitId: string, slot: Slot): Promise<void> {
    if (slot.role === "ceo" && (await this.offices.get(orbitId)) === null) throw conflictWith("office_not_set_up", "Activate the company first.");
    if (!(await this.appointments.lockSlot(orbitId, slot, "update"))) throw slot.role === "ceo" ? conflictWith("office_not_set_up", "Activate the company first.") : conflictWith("department_archived", "That department does not exist or is archived: it holds no manager.");
  }

  // An employee may take this appointment: it exists, works (on trial or active), holds no other appointment, and a
  // manager is a member of its department.
  private async appointable(orbitId: string, employeeId: string, slot: Slot): Promise<void> {
    const e = await this.employees.get(orbitId, employeeId, true);
    if (e === null) throw missing("Employee");
    if (!WORKING.includes(e.data.employment)) throw conflictWith("employee_not_working", `${e.data.name} is ${e.data.employment}: only an employee on trial or active is appointed.`);
    if (slot.role === "manager" && e.data.departmentId !== slot.departmentId) throw conflictWith("manager_not_member", `A manager is a member of its department: move ${e.data.name} into it first.`);
    const other = await this.appointments.heldBy(orbitId, employeeId);
    if (other !== null) throw conflictWith("employee_appointed", `${e.data.name} holds another appointment (${ROLE_TEXT[other.data.role]}): end it first.`, { appointmentId: other.id });
  }

  private async existing(orbitId: string, id: string): Promise<Appointment> {
    const a = isWorkforceId(id) ? await this.appointments.get(orbitId, id) : null;
    if (a === null) throw missing("Appointment");
    return a;
  }

  private async locked(orbitId: string, id: string, expectedVersion: number): Promise<Appointment> {
    const a = await this.appointments.get(orbitId, id, true);
    if (a === null) throw missing("Appointment");
    if (a.data.version !== expectedVersion) throw stale("This appointment changed since it was read: read it again.", { appointmentId: id });
    return a;
  }

  private async views(orbitId: string, list: readonly AppointmentData[]): Promise<AppointmentView[]> {
    const names = await this.names(orbitId);
    return list.map((d) => ({ id: d.id, role: d.role, departmentId: d.departmentId, departmentName: d.departmentId === null ? null : (names.departments.get(d.departmentId) ?? null), employeeId: d.employeeId, employeeName: names.employees.get(d.employeeId) ?? "", state: d.state, slotRevision: d.slotRevision, replaces: d.replaces, reason: d.reason, appointedBy: d.appointedBy, appointedAt: d.appointedAt, endedBy: d.endedBy, endedAt: d.endedAt, endReason: d.endReason, version: d.version }));
  }

  private async grantViews(orbitId: string, list: readonly DelegationGrantRecord[]): Promise<DelegationGrantView[]> {
    const names = await this.names(orbitId);
    return list.map((g) => grantView(g, g.target.kind === "employee" ? (names.employees.get(g.target.employeeId) ?? "") : (names.departments.get(g.target.departmentId) ?? "")));
  }

  private async names(orbitId: string): Promise<{ employees: Map<string, string>; departments: Map<string, string> }> {
    const departments = new Map((await this.departments.list(orbitId, true)).map((d) => [d.id, d.name]));
    const employees = await this.employees.names(orbitId);
    return { employees, departments };
  }
}
