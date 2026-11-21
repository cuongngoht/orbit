// WORKFORCE's read side for one employee: their card, the profile in effect and its history, the Personal Sandbox
// (areas with quotas, real use and how each is enforced), the resource revisions, what is queued for them, what they
// did, and the attempt running now. Read for the session's account; another account's employee is not found.
import { Inject, Injectable } from "@nestjs/common";
import { isWorkforceId, type AssignmentState, type AssignmentSummary, type EmployeeDetail, type EmployeeProfile, type SandboxView } from "@orbit-web/contracts";
import { Db, type Row } from "../../../infra/db/db.js";
import { RunViews } from "../../execution/application/run-views.js";
import { missing } from "../../shared/domain.js";
import { EmployeeRepository, SandboxRepository } from "../infrastructure/repositories.js";
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

@Injectable()
export class EmployeeQueries {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(OfficeService) private readonly office: OfficeService,
    @Inject(EmployeeRepository) private readonly employees: EmployeeRepository,
    @Inject(SandboxRepository) private readonly sandboxes: SandboxRepository,
    @Inject(RunViews) private readonly runViews: RunViews,
  ) {}

  async detail(orbitId: string, id: string): Promise<EmployeeDetail> {
    if (!isWorkforceId(id)) throw missing("Employee");
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
    const sandboxView: SandboxView = {
      id: sandbox?.id ?? "",
      state: sandbox?.state ?? "FAILED",
      reason: sandbox === null ? "This employee has no Personal Sandbox." : sandbox.reason,
      provider: sandbox?.provider ?? "process",
      areas: (sandbox?.areas ?? []).map((a) => ({ area: a.area, quotaMiB: a.quotaMiB, usedMiB: a.usedMiB, level: a.level, evidence: a.evidence })),
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
    };
  }

  async profileRevision(orbitId: string, id: string, revision: number): Promise<{ revision: number; profile: EmployeeProfile }> {
    if (!isWorkforceId(id) || !Number.isInteger(revision) || revision < 1) throw missing("Profile revision");
    const profile = await this.employees.profile(orbitId, id, revision);
    if (profile === null) throw missing("Profile revision");
    return { revision, profile };
  }
}
