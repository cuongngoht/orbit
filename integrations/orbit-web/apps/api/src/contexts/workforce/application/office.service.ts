// THE OFFICE (Workforce context): an account's one virtual office -- its company -- its departments, and the roster the
// office shows.
//
// ACTIVATING the company is idempotent (one per account, a unique constraint behind it) and starts it EMPTY: no
// department, employee, mission or CEO. It needs the account's owner, the company's name, governance that can decide,
// one AI connection of the account usable for a function Orbit Web supports, and the resource budget; once active, a
// company stays active whatever happens to its connections (readiness changes, never the company). A department is archived only
// once its members moved -- to another department or to "Unassigned" -- and the move and the archive cannot race: the
// archive holds the department's row FOR UPDATE, a move into it FOR SHARE, so one waits for the other and the second
// sees what the first did. History keeps the department an assignment was claimed under (its pin), whatever happens
// to the department later.
import { Inject, Injectable } from "@nestjs/common";
import {
  checkUpdateOfficeDefaults,
  type ExecutionDefaults,
  checkArchiveDepartment,
  checkCreateDepartment,
  checkSetUpOffice,
  checkUpdateDepartment,
  isWorkforceId,
  type ArchiveDepartmentRequest,
  type Department,
  type EmployeeCard,
  type EmployeeProfile,
  type EmployeeTemplate,
  type Office,
  type Roster,
  type RunState,
  type WorkLabel,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { Db, type Row } from "../../../infra/db/db.js";
import { accepted } from "../../../common/errors.js";
import { OfficeGovernance, type Actor } from "../../shared/application/commands.js";
import { conflictWith, missing, refused, stale, unprocessable } from "../../shared/domain.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { workLabelOf } from "../domain/work-label.js";
import { RevisionsService } from "../../../modules/governance/revisions.service.js";
import { activationOf } from "../../../modules/connections/uses.js";
import { ResourcesService } from "../../execution/application/resources.service.js";
import { AppointmentRepository } from "../infrastructure/appointments.repository.js";
import { ConnectionsReader, employeeUse, usesOf } from "../infrastructure/connections.reader.js";
import { DepartmentRepository, departmentView, EmployeeRepository, OfficeRepository, type DepartmentRecord } from "../infrastructure/repositories.js";

const PAGE = 100;

// Starting points a hire may copy. Data, not roles: every field is the owner's to change, and a new template never
// changes an employee already hired.
const TEMPLATE_PROFILES: { id: string; name: string; description: string; title: string; duties: string; skills: string[] }[] = [
  { id: "accountant", name: "Accountant", description: "Bookkeeping, reconciliations and period reports with every figure traced to its document.", title: "Accountant", duties: "Prepare reconciliations and period reports. Trace every figure to the document it comes from; say plainly what has no document.", skills: ["bookkeeping", "reconciliation", "spreadsheets"] },
  { id: "legal-assistant", name: "Legal assistant", description: "Reads contracts and policies, summarizes obligations and flags open questions.", title: "Legal assistant", duties: "Read the documents given, summarize obligations and deadlines, quote the clauses relied on, and list what needs a lawyer's decision.", skills: ["contract review", "summaries"] },
  { id: "sales-assistant", name: "Sales assistant", description: "Prepares account notes, proposals and follow-ups from the sources given.", title: "Sales assistant", duties: "Prepare account notes, proposals and follow-up drafts from the sources given; never invent a price or a commitment.", skills: ["proposals", "account research"] },
  { id: "researcher", name: "Researcher", description: "Answers questions from sources, cites passages, says what is not supported.", title: "Research analyst", duties: "Answer from the sources given and public sources; cite each claim; mark what is not supported.", skills: ["research", "citations", "python"] },
  { id: "developer", name: "Software developer", description: "Writes and tests code in its own workspace.", title: "Software developer", duties: "Write, run and test code in your workspace; hand in the files and how they were tested.", skills: ["python", "node", "git", "testing"] },
];

export interface RosterQuery {
  department?: string;
  q?: string;
  status?: string;
  cursor?: string;
}

@Injectable()
export class OfficeService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(OfficeRepository) private readonly offices: OfficeRepository,
    @Inject(DepartmentRepository) private readonly departments: DepartmentRepository,
    @Inject(EmployeeRepository) private readonly employees: EmployeeRepository,
    @Inject(ConnectionsReader) private readonly connections: ConnectionsReader,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
    @Inject(RevisionsService) private readonly policies: RevisionsService,
    @Inject(ResourcesService) private readonly resources: ResourcesService,
    @Inject(AppointmentRepository) private readonly appointments: AppointmentRepository,
  ) {}

  templates(): EmployeeTemplate[] {
    return TEMPLATE_PROFILES.map((t) => ({ id: t.id, name: t.name, description: t.description, profile: this.templateProfile(t) }));
  }

  templateProfile(t: (typeof TEMPLATE_PROFILES)[number]): EmployeeProfile {
    return {
      title: t.title,
      duties: t.duties,
      instructions: "",
      skills: [...t.skills],
      languages: ["English"],
      knowledge: [],
      execution: { runtime: "claude", connectionId: null, model: "sonnet", effort: "medium", webSearch: false, orbitPlugin: false },
      handoffStandard: "Hand in every required deliverable as a file, with a summary of what was done and how it was checked.",
      reportingRule: "Say what is not supported by a source, and ask when something blocks the work.",
      canDelegate: false,
      maxAssistants: 0,
      canHirePermanent: false,
    };
  }

  // Activates the company -- or answers the one already active (a refresh, a retry, a second tab: one office, one
  // OfficeSetUp). Its checks, in this order, inside one transaction: no example departments, the owner, a name, the
  // policy in effect (provisioned once if missing, BEFORE the decision: with none every decision is a deny), the policy's
  // decision, then -- only for a company not yet active -- a usable AI connection and the budget made from the capacity.
  async activate(actor: Actor, body: unknown): Promise<Office> {
    const req = accepted(checkSetUpOffice(body));
    if (req.departments.length > 0)
      throw unprocessable("departments_not_accepted", "A company is activated empty: departments are made after it is (New department), never with its activation.", { departments: req.departments });
    const orbitId = actor.command.orbitId;
    return this.governance.command(actor, "office.setup", orbitId, async () => {
      if (actor.owner === null) throw refused("owner_required", "Only the account's owner activates its company.");
      const name = (req.name ?? (await this.offices.companyName(orbitId)) ?? "").trim();
      if (name === "") throw unprocessable("company_name_required", "Name the company first: type its name, or set it in Settings → Account.");
      if ((await this.policies.ensureReady(orbitId)) === "invalid")
        throw conflictWith("governance_not_ready", "The account's policy in effect no longer reads as valid, so nothing can be decided: publish a valid revision in Governance → Policy first.");
      await this.governance.authorize(actor, "office.department.manage", orbitId, { account: orbitId });
      const existing = await this.offices.get(orbitId);
      if (existing !== null) return existing;
      const activation = activationOf((await this.connections.all(orbitId)).map(usesOf));
      if (!activation.ready) throw conflictWith("connection_required", activation.reason ?? "Connect an AI CLI first (Settings → AI Connections).", { where: activation.where, uses: activation.uses });
      await this.resources.budget(orbitId);
      const at = new Date().toISOString();
      const { office, created } = await this.offices.ensure(orbitId, randomUUID(), name, actor.command.actor, at);
      if (!created) return office;
      await this.outbox.append(actor.command, [{ type: "OfficeSetUp", aggregateType: "office", aggregateId: office.id, aggregateVersion: 1, payload: { name: office.name } }]);
      await this.outbox.touched(orbitId, ["roster"]);
      const usable = Object.entries(activation.uses)
        .filter(([, ok]) => ok)
        .map(([use]) => use)
        .join(", ");
      await this.governance.recorded(actor, "office.setup", "office", office.id, 1, `activated empty; a connection usable for ${usable}`);
      return office;
    });
  }

  async createDepartment(actor: Actor, body: unknown): Promise<Department> {
    const req = accepted(checkCreateDepartment(body));
    return this.governance.command(actor, "department.create", actor.command.orbitId, async () => {
      await this.requireOffice(actor.command.orbitId);
      await this.governance.authorize(actor, "office.department.manage", actor.command.orbitId, { account: actor.command.orbitId });
      const at = new Date().toISOString();
      const position = (await this.departments.list(actor.command.orbitId)).length;
      const d: DepartmentRecord = { id: randomUUID(), orbitId: actor.command.orbitId, name: req.name, position, archivedAt: null, version: 1 };
      await this.departments.insert(d, at);
      await this.outbox.append(actor.command, [{ type: "DepartmentCreated", aggregateType: "department", aggregateId: d.id, aggregateVersion: 1, payload: { name: d.name } }]);
      await this.outbox.touched(actor.command.orbitId, ["roster"]);
      await this.governance.recorded(actor, "department.create", "department", d.id, 1, d.name);
      return departmentView(d, 0);
    });
  }

  async updateDepartment(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<Department> {
    const req = accepted(checkUpdateDepartment(body));
    return this.governance.command(actor, "department.update", id, async () => {
      await this.governance.authorize(actor, "office.department.manage", actor.command.orbitId, { account: actor.command.orbitId });
      const d = await this.department(actor.command.orbitId, id, "update");
      if (d.archivedAt !== null) throw conflictWith("department_archived", "This department is archived.");
      if (d.version !== expectedVersion) throw stale("This department changed since it was read: read it again.");
      if (req.defaults !== undefined) await this.checkDefaults(actor.command.orbitId, req.defaults);
      const next = { ...d, name: req.name ?? d.name, position: req.position ?? d.position, ...(req.defaults !== undefined ? { defaults: req.defaults } : {}) };
      const version = await this.departments.save(next, expectedVersion, new Date().toISOString());
      await this.outbox.append(actor.command, [{ type: "DepartmentChanged", aggregateType: "department", aggregateId: d.id, aggregateVersion: version, payload: { name: next.name, position: next.position, defaults: req.defaults !== undefined } }]);
      await this.outbox.touched(actor.command.orbitId, ["roster"]);
      await this.governance.recorded(actor, "department.update", "department", d.id, version, next.name);
      return departmentView({ ...next, version }, (await this.departments.members(actor.command.orbitId)).get(d.id) ?? 0, (await this.appointments.incumbents(actor.command.orbitId)).managers.get(d.id) ?? null);
    });
  }

  // Archive: refused while members remain, unless they are moved first (to another department, or Unassigned) in the
  // same transaction. Holding the row FOR UPDATE serializes it with every move into this department.
  async archiveDepartment(actor: Actor, id: string, body: unknown, expectedVersion: number): Promise<Department> {
    const req: ArchiveDepartmentRequest = accepted(checkArchiveDepartment(body));
    return this.governance.command(actor, "department.archive", id, async () => {
      await this.governance.authorize(actor, "office.department.manage", actor.command.orbitId, { account: actor.command.orbitId });
      const d = await this.department(actor.command.orbitId, id, "update");
      if (d.archivedAt !== null) throw conflictWith("department_archived", "This department is already archived.");
      if (d.version !== expectedVersion) throw stale("This department changed since it was read: read it again.");
      const manager = await this.appointments.incumbent(actor.command.orbitId, { role: "manager", departmentId: id });
      if (manager !== null) throw conflictWith("department_has_manager", "This department has a manager: revoke (or end) the appointment before archiving it -- a manager is never moved out by an archive.", { appointmentId: manager.id });
      const members = await this.employees.inDepartment(actor.command.orbitId, id);
      if (members.length > 0 && req.moveTo === undefined) throw conflictWith("department_not_empty", `This department still has ${members.length} employee(s): choose where they go first (another department, or Unassigned).`, { members: members.length });
      const at = new Date().toISOString();
      if (req.moveTo !== undefined && req.moveTo !== null) {
        if (req.moveTo === id) throw conflictWith("department_archived", "Members cannot move into the department being archived.");
        const target = await this.department(actor.command.orbitId, req.moveTo, "share");
        if (target.archivedAt !== null) throw conflictWith("department_archived", "The department to move the members to is archived.");
      }
      for (const e of members) {
        const before = e.data.version;
        e.moveToDepartment(req.moveTo ?? null, at);
        const v = await this.employees.save(e, before);
        await this.outbox.append(actor.command, e.pullEvents().map((x) => ({ ...x, aggregateVersion: v })));
      }
      const version = await this.departments.save({ ...d, archivedAt: at }, expectedVersion, at);
      await this.outbox.append(actor.command, [{ type: "DepartmentArchived", aggregateType: "department", aggregateId: d.id, aggregateVersion: version, payload: { movedTo: req.moveTo ?? null, members: members.length } }]);
      await this.outbox.touched(actor.command.orbitId, ["roster"]);
      await this.governance.recorded(actor, "department.archive", "department", d.id, version, `${members.length} member(s) moved`);
      return departmentView({ ...d, archivedAt: at, version }, 0);
    });
  }

  // The company's execution defaults (whole), against the version read: what an employee of a runtime runs on where its
  // profile and its department leave a field to the company. Work already claimed keeps what it pinned.
  async updateDefaults(actor: Actor, body: unknown, expectedVersion: number): Promise<Office> {
    const req = accepted(checkUpdateOfficeDefaults(body));
    const orbitId = actor.command.orbitId;
    return this.governance.command(actor, "office.defaults", orbitId, async () => {
      const office = await this.requireOffice(orbitId);
      await this.governance.authorize(actor, "office.roster.manage", office.id, { account: orbitId });
      await this.checkDefaults(orbitId, req.defaults);
      const version = await this.offices.setDefaults(orbitId, req.defaults, expectedVersion, new Date().toISOString());
      await this.outbox.touched(orbitId, ["roster"]);
      await this.governance.recorded(actor, "office.defaults", "office", office.id, version, Object.keys(req.defaults).join(", ") || "none");
      return { ...office, defaults: req.defaults, version };
    });
  }

  // A default names a connection of this account of its own runtime (its model is held to that connection's catalog
  // when work is claimed, never here: a catalog moves).
  private async checkDefaults(orbitId: string, defaults: ExecutionDefaults): Promise<void> {
    for (const [runtime, d] of Object.entries(defaults)) {
      if (d?.connectionId === undefined || d.connectionId === null) continue;
      const c = await this.connections.get(orbitId, d.connectionId);
      if (c === null) throw unprocessable("default_connection", `The ${runtime} default names a connection this account does not have.`);
      if (c.runtime !== runtime) throw unprocessable("default_connection", `The ${runtime} default names a ${c.runtime} connection: a default never switches an employee's provider.`);
    }
  }

  // THE ROSTER: one read of the account's office -- departments, employee cards with their work label, counts -- filtered
  // and paged by a stable cursor (department position, name, id).
  async roster(orbitId: string, q: RosterQuery): Promise<Roster> {
    return this.db.snapshot(() => this.rosterOf(orbitId, q));
  }

  private async rosterOf(orbitId: string, q: RosterQuery): Promise<Roster> {
    const office = await this.offices.get(orbitId);
    const version = await this.outbox.version(orbitId);
    const asOf = new Date().toISOString();
    const empty = { employees: 0, ready: 0, busy: 0, notReady: 0, queued: 0, inbox: 0 };
    if (office === null) return { office: null, ceo: null, departments: [], employees: [], nextCursor: null, version, asOf, counts: empty };
    const departments = await this.departments.list(orbitId);
    const incumbents = await this.appointments.incumbents(orbitId);
    const members = await this.departments.members(orbitId);
    const cards = await this.cards(orbitId);
    const inbox = Number((await this.db.one("SELECT count(*) AS n FROM workforce.decisions WHERE account_id = $1 AND state = 'open'", [orbitId]))?.n ?? 0);
    const counts = {
      employees: cards.length,
      ready: cards.filter((c) => c.availability === "available").length,
      busy: cards.filter((c) => c.availability === "busy").length,
      notReady: cards.filter((c) => c.availability === "ineligible").length,
      queued: cards.reduce((n, c) => n + c.queued, 0),
      inbox,
    };
    const position = new Map(departments.map((d) => [d.id, d.position]));
    const text = (q.q ?? "").trim().toLowerCase();
    const filtered = cards
      .filter((c) => q.department === undefined || (q.department === "none" ? c.departmentId === null : c.departmentId === q.department))
      .filter((c) => text === "" || c.name.toLowerCase().includes(text) || c.title.toLowerCase().includes(text))
      .filter((c) => q.status === undefined || c.workLabel === (q.status as WorkLabel))
      .sort((a, b) => (position.get(a.departmentId ?? "") ?? 1e9) - (position.get(b.departmentId ?? "") ?? 1e9) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    const start = q.cursor !== undefined && isWorkforceId(q.cursor) ? filtered.findIndex((c) => c.id === q.cursor) + 1 : 0;
    const page = filtered.slice(start, start + PAGE);
    return {
      office,
      ceo: incumbents.ceo,
      departments: departments.map((d) => departmentView(d, members.get(d.id) ?? 0, incumbents.managers.get(d.id) ?? null)),
      employees: page,
      nextCursor: start + PAGE < filtered.length ? (page.at(-1)?.id ?? null) : null,
      version,
      asOf,
      counts,
    };
  }

  // Every employee card of the account (archived ones are not on the roster).
  async cards(orbitId: string, only: string | null = null): Promise<EmployeeCard[]> {
    const rows = await this.db.query(
      `SELECT e.*, p.profile, s.state AS sandbox_state, s.reason AS sandbox_reason,
              a.id AS held_id, a.mission_id AS held_mission, a.state AS held_state, a.waiting_on AS held_waiting, a.claimed_at AS held_since, m.title AS held_title,
              (SELECT r.state FROM workforce.runs r WHERE r.account_id = e.account_id AND r.assignment_id = a.id ORDER BY r.attempt_no DESC LIMIT 1) AS run_state,
              (SELECT count(*) FROM workforce.assignments q WHERE q.account_id = e.account_id AND q.employee_id = e.id AND q.state = 'QUEUED') AS queued,
              (SELECT ap.role FROM workforce.appointments ap WHERE ap.account_id = e.account_id AND ap.employee_id = e.id AND ap.state IN ('active', 'suspended')) AS appointed_role
       FROM workforce.employees e
       JOIN workforce.employee_profiles p ON p.account_id = e.account_id AND p.employee_id = e.id AND p.revision = e.profile_revision
       LEFT JOIN workforce.sandboxes s ON s.account_id = e.account_id AND s.employee_id = e.id
       LEFT JOIN workforce.reservations rv ON rv.account_id = e.account_id AND rv.employee_id = e.id
       LEFT JOIN workforce.assignments a ON a.account_id = rv.account_id AND a.id = rv.assignment_id
       LEFT JOIN workforce.missions m ON m.account_id = a.account_id AND m.id = a.mission_id
       WHERE e.account_id = $1 AND ${only !== null ? "e.id = $2" : "e.employment NOT IN ('archived', 'deleted')"}`,
      only !== null ? [orbitId, only] : [orbitId],
    );
    const connections = new Map((await this.connections.all(orbitId)).map((c) => [c.id, c]));
    const defaults = new Map((await this.connections.all(orbitId)).filter((c) => c.isDefault).map((c) => [c.runtime, c]));
    return rows.map((r) => this.cardOf(r, connections, defaults));
  }

  private cardOf(r: Row, connections: Map<string, Awaited<ReturnType<ConnectionsReader["all"]>>[number]>, defaults: Map<string, Awaited<ReturnType<ConnectionsReader["all"]>>[number]>): EmployeeCard {
    const profile = r.profile as EmployeeProfile;
    const connection = r.connection_id !== null ? (connections.get(String(r.connection_id)) ?? null) : (defaults.get(profile.execution.runtime) ?? null);
    const expiresAt = r.expires_at === null ? null : String(r.expires_at);
    const use = employeeUse(connection);
    const label = workLabelOf({
      employment: String(r.employment) as EmployeeCard["employment"],
      expired: expiresAt !== null && Date.parse(expiresAt) <= Date.now(),
      sandbox: r.sandbox_state === null ? null : (String(r.sandbox_state) as never),
      sandboxReason: r.sandbox_reason === null ? null : String(r.sandbox_reason),
      connectionUsable: use.ready,
      connectionReason:
        connection === null
          ? "No AI connection: connect one in Settings → AI Connections."
          : connection.auth !== "connected"
            ? `The ${connection.label} connection is ${connection.auth.replace("_", " ")}${connection.reason ? `: ${connection.reason}` : ""}.`
            : connection.catalog.source !== "account"
              ? `The ${connection.label} connection has no model catalog from its CLI yet.`
              : use.ready
                ? null
                : `The ${connection.label} connection cannot run employees: ${use.reason}.`,
      held: r.held_id === null ? null : { state: String(r.held_state) as never, waitingOn: r.held_waiting === null ? null : String(r.held_waiting) },
      liveRun: r.run_state === null ? null : (String(r.run_state) as RunState),
    });
    return {
      id: String(r.id),
      name: String(r.name),
      title: profile.title,
      kind: String(r.kind) as EmployeeCard["kind"],
      departmentId: r.department_id === null ? null : String(r.department_id),
      managerId: r.manager_id === null ? null : String(r.manager_id),
      employment: String(r.employment) as EmployeeCard["employment"],
      availability: label.availability,
      workLabel: label.label,
      notReadyReason: label.notReadyReason,
      holding: r.held_id === null ? null : { assignmentId: String(r.held_id), missionId: String(r.held_mission), title: String(r.held_title), state: String(r.held_state) as never, since: String(r.held_since ?? r.updated_at) },
      queued: Number(r.queued),
      execution: profile.execution,
      connectionWarning: label.connectionWarning,
      expiresAt,
      role: r.appointed_role === null || r.appointed_role === undefined ? null : (String(r.appointed_role) as EmployeeCard["role"]),
      version: Number(r.version),
      updatedAt: String(r.updated_at),
    };
  }

  private async requireOffice(orbitId: string): Promise<Office> {
    const office = await this.offices.get(orbitId);
    if (office === null) throw conflictWith("office_not_set_up", "Set up the office first.");
    return office;
  }

  private async department(orbitId: string, id: string, lock: "update" | "share"): Promise<DepartmentRecord> {
    const d = isWorkforceId(id) ? await this.departments.get(orbitId, id, lock) : null;
    if (d === null) throw missing("Department");
    return d;
  }
}
