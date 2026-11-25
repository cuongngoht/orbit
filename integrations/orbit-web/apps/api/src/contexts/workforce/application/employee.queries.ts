// WORKFORCE's read side for one employee: their card, the profile in effect and its history, the Personal Sandbox
// (areas with quotas, real use and how each is enforced), the resource revisions, what is queued for them, what they
// did, and the attempt running now. Read for the session's account; another account's employee is not found.
import { Inject, Injectable } from "@nestjs/common";
import { isWorkforceId, type AssignmentState, type AssignmentSummary, type EmployeeDesk, type EmployeeDetail, type EmployeeProfile, type SandboxState, type SandboxView } from "@orbit-web/contracts";
import { Db, type Row } from "../../../infra/db/db.js";
import { RunViews } from "../../execution/application/run-views.js";
import { missing } from "../../shared/domain.js";
import { EmployeeRepository, SandboxRepository } from "../infrastructure/repositories.js";
import { AppointmentsService } from "./appointments.service.js";
import { OfficeService } from "./office.service.js";

const s = (v: unknown): string => String(v);
const sn = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));

const summaryOf = (r: Row): AssignmentSummary => ({
  id: s(r.id),
  missionId: s(r.mission_id),
  title: s(r.mission_title),
  employeeId: s(r.employee_id),
  employeeName: s(r.employee_name),
  state: s(r.state) as AssignmentState,
  reason: sn(r.reason),
  waitingOn: sn(r.waiting_on),
  deadline: sn(r.deadline),
  version: Number(r.version),
  updatedAt: s(r.updated_at),
});

// A desk that exists to be looked into: a ready sandbox's, or an archived one's (read only).
export const deskReadable = (state: SandboxState): boolean => state === "READY" || state === "ARCHIVED";

@Injectable()
export class EmployeeQueries {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(OfficeService) private readonly office: OfficeService,
    @Inject(AppointmentsService) private readonly appointments: AppointmentsService,
    @Inject(EmployeeRepository) private readonly employees: EmployeeRepository,
    @Inject(SandboxRepository) private readonly sandboxes: SandboxRepository,
    @Inject(RunViews) private readonly runViews: RunViews,
  ) {}

  // Governance → Employee desks: every employee's desk -- those in the office first, then those who left (most recent
  // first), then the ones being deleted -- with what each commits of the account's storage and what was last measured
  // in it, and whether it may be looked into (a desk that exists) and cleaned up (its employee in the office, its
  // sandbox READY, and no work held, running or accepted and not yet on the desk).
  async desks(orbitId: string): Promise<EmployeeDesk[]> {
    const rows = await this.db.query(
      `SELECT e.id, e.name, e.employment, e.employment_reason, e.updated_at, e.version, s.state AS sandbox_state, s.reason AS sandbox_reason, s.desk_version,
              COALESCE(d.committed_mib, 0) AS desk_mib, d.used_mib AS desk_used, d.measured_at,
              COALESCE(c.committed_mib, 0) AS cache_mib, c.used_mib AS cache_used,
              EXISTS (SELECT 1 FROM workforce.reservations r WHERE r.account_id = e.account_id AND r.employee_id = e.id)
                OR EXISTS (SELECT 1 FROM workforce.runs x WHERE x.account_id = e.account_id AND x.employee_id = e.id AND x.state IN ('starting', 'running', 'unknown'))
                OR EXISTS (SELECT 1 FROM workforce.assignments a WHERE a.account_id = e.account_id AND a.employee_id = e.id AND a.state = 'COMPLETED'
                             AND NOT EXISTS (SELECT 1 FROM workforce.desk_publications p WHERE p.account_id = a.account_id AND p.assignment_id = a.id)) AS busy
       FROM workforce.employees e
       JOIN workforce.sandboxes s ON s.account_id = e.account_id AND s.employee_id = e.id
       LEFT JOIN workforce.storage_usage d ON d.account_id = e.account_id AND d.category = 'desk' AND d.owner_ref = e.id::text
       LEFT JOIN workforce.storage_usage c ON c.account_id = e.account_id AND c.category = 'cache' AND c.owner_ref = e.id::text
       WHERE e.account_id = $1 AND s.state <> 'DELETED' AND (e.employment <> 'deleted' OR s.state = 'DELETING')
       ORDER BY CASE e.employment WHEN 'deleted' THEN 2 WHEN 'archived' THEN 1 ELSE 0 END,
                CASE WHEN e.employment IN ('archived', 'deleted') THEN e.updated_at END DESC, e.name, e.id`,
      [orbitId],
    );
    return rows.map((r) => {
      const employment = String(r.employment) as EmployeeDesk["employment"];
      const left = employment === "archived" || employment === "deleted";
      const state = String(r.sandbox_state) as SandboxState;
      const busy = r.busy === true;
      return {
        employeeId: String(r.id),
        name: String(r.name),
        employment,
        reason: r.employment_reason === null ? null : String(r.employment_reason),
        leftAt: left ? String(r.updated_at) : null,
        sandbox: { state, reason: r.sandbox_reason === null ? null : String(r.sandbox_reason) },
        deskMiB: Number(r.desk_mib),
        cacheMiB: Number(r.cache_mib),
        deskUsedMiB: r.desk_used === null ? null : Number(r.desk_used),
        cacheUsedMiB: r.cache_used === null ? null : Number(r.cache_used),
        measuredAt: r.measured_at === null ? null : String(r.measured_at),
        deskVersion: Number(r.desk_version),
        busy,
        canBrowse: deskReadable(state),
        canClean: !left && state === "READY" && !busy,
        version: Number(r.version),
      };
    });
  }

  // One employee in full, read from ONE snapshot.
  async detail(orbitId: string, id: string): Promise<EmployeeDetail> {
    if (!isWorkforceId(id)) throw missing("Employee");
    return this.db.snapshot(() => this.read(orbitId, id));
  }

  private async read(orbitId: string, id: string): Promise<EmployeeDetail> {
    const [card] = await this.office.cards(orbitId, id);
    const e = await this.employees.get(orbitId, id);
    if (card === undefined || e === null) throw missing("Employee");
    const profile = (await this.employees.profile(orbitId, id, e.data.profileRevision)) as EmployeeProfile;
    const resources = await this.employees.resources(orbitId, id, e.data.resourceRevision);
    const sandbox = await this.sandboxes.ofEmployee(orbitId, id);
    const work = (states: string, order: string, limit: number) =>
      this.db.query(
        `SELECT a.*, m.title AS mission_title, e.name AS employee_name FROM workforce.assignments a
         JOIN workforce.missions m ON m.account_id = a.account_id AND m.id = a.mission_id
         JOIN workforce.employees e ON e.account_id = a.account_id AND e.id = a.employee_id
         WHERE a.account_id = $1 AND a.employee_id = $2 AND a.state IN (${states}) ORDER BY ${order} LIMIT ${limit}`,
        [orbitId, id],
      );
    const queue = (await work("'QUEUED'", "a.priority DESC, a.eligible_at, a.id", 100)).map(summaryOf);
    const history = (await work("'COMPLETED', 'CANCELLED', 'FAILED_FINAL'", "a.finished_at DESC NULLS LAST, a.id", 20)).map(summaryOf);
    const published = Number((await this.db.one("SELECT count(*) AS n FROM workforce.desk_publications WHERE account_id = $1 AND employee_id = $2 AND published", [orbitId, id]))?.n ?? 0);
    const usageRows = await this.db.query("SELECT category, used_mib, level, evidence FROM workforce.storage_usage WHERE account_id = $1 AND owner_ref = $2 AND category IN ('desk', 'cache')", [orbitId, id]);
    const usageByArea = new Map<string, { usedMiB: number | null; level: string | null; evidence: string | null }>(
      usageRows.map((u) => [String(u.category), { usedMiB: u.used_mib === null || u.used_mib === undefined ? null : Number(u.used_mib), level: sn(u.level), evidence: sn(u.evidence) }]),
    );
    const sandboxView: SandboxView = {
      id: sandbox?.id ?? "",
      state: sandbox?.state ?? "FAILED",
      reason: sandbox === null ? "This employee has no Personal Sandbox." : sandbox.reason,
      provider: sandbox?.provider ?? "process",
      areas: (sandbox?.areas ?? []).map((a) => {
        const live = usageByArea.get(a.area);
        return {
          area: a.area,
          quotaMiB: a.quotaMiB,
          usedMiB: live?.usedMiB ?? a.usedMiB,
          level: (live?.level as SandboxView["areas"][number]["level"] | null) ?? a.level,
          evidence: live?.evidence ?? a.evidence,
        };
      }),
      resourceRevision: e.data.resourceRevision,
      resources: resources ?? { presetId: null, cpuMillis: 0, memoryMiB: 0, deskStorageMiB: 0, scratchStorageMiB: 0, cacheStorageMiB: 0, pidsLimit: 0, timeoutMinutes: 0 },
      version: sandbox?.version ?? 0,
    };
    return {
      ...card,
      profile,
      profileRevision: e.data.profileRevision,
      revisions: await this.employees.profiles(orbitId, id),
      desk: { id: sandbox?.id ?? "", version: sandbox?.deskVersion ?? 0, files: published },
      queue,
      history,
      sandbox: sandboxView,
      resourceRevisions: await this.employees.resourceRevisions(orbitId, id),
      activeRun: await this.runViews.liveOfEmployee(orbitId, id),
      ...(await this.appointments.ofEmployee(orbitId, id)),
    };
  }

  async profileRevision(orbitId: string, id: string, revision: number): Promise<{ revision: number; profile: EmployeeProfile }> {
    if (!isWorkforceId(id) || !Number.isInteger(revision) || revision < 1) throw missing("Profile revision");
    const profile = await this.employees.profile(orbitId, id, revision);
    if (profile === null) throw missing("Profile revision");
    return { revision, profile };
  }
}
