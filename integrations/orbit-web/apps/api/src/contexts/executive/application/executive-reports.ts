// THE COMPANY'S RECORDS FOR CEO CHAT (Executive, application; ADR 0062): read from the owners' own read models -- the
// roster (office, departments, people and what they hold), the open missions, Needs me, the approvals that wait, the
// resources -- scoped by the account the session belongs to, never by anything a request or a model says. No model
// writes any of it: a quick action shows it as Orbit's report, and a CEO's answer is given it to stand on.
import { Inject, Injectable } from "@nestjs/common";
import { WORK_LABEL_TEXT, type EmployeeCard, type ExecutiveReport, type ExecutiveReportKind } from "@orbit-web/contracts";
import { Db } from "../../../infra/db/db.js";
import { ApprovalService } from "../../../modules/governance/approvals.service.js";
import { ResourcesService } from "../../execution/application/resources.service.js";
import { MissionQueries } from "../../work/application/mission.queries.js";
import { MissionsService } from "../../work/application/missions.service.js";
import { OfficeService } from "../../workforce/application/office.service.js";
import { recordLines, reportOf, type CompanyRecords, type PersonRecord } from "../domain/records.js";

const person = (e: EmployeeCard): PersonRecord => ({ name: e.name, state: WORK_LABEL_TEXT[e.workLabel] ?? e.workLabel, work: e.holding?.title ?? null });

const vcpu = (m: number): string => `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} vCPU`;

@Injectable()
export class ExecutiveReports {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(OfficeService) private readonly office: OfficeService,
    @Inject(MissionQueries) private readonly missions: MissionQueries,
    @Inject(ResourcesService) private readonly resources: ResourcesService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(MissionsService) private readonly giving: MissionsService,
  ) {}

  // One snapshot of the records, as of now.
  async records(orbitId: string): Promise<CompanyRecords> {
    const roster = await this.office.roster(orbitId, {});
    const ceoId = roster.ceo?.employeeId ?? null;
    const cards = roster.employees.filter((e) => e.employment !== "archived" && e.employment !== "deleted");
    const ceoCard = cards.find((e) => e.id === ceoId) ?? null;
    const departments = roster.departments
      .filter((d) => !d.archived)
      .map((d) => ({ name: d.name, manager: d.manager?.name ?? null, people: cards.filter((e) => e.departmentId === d.id).map(person) }));
    const open = await this.missions.list(orbitId, { state: "open" });
    const inbox = await this.missions.inbox(orbitId, { open: true, cursor: null });
    const reserved = await this.resources.reserved(orbitId);
    const budget = await this.resources.budget(orbitId);
    const waiting = await this.db.one("SELECT count(*)::int AS n FROM workforce.runs WHERE account_id = $1 AND state IN ('requested', 'waiting_for_resources')", [orbitId]);
    // Who would take work given to the CEO now (the preview the owner's own form reads), or why nobody would.
    const ceoSlot = await this.giving.preview(orbitId, { kind: "ceo" });
    return {
      at: new Date().toISOString(),
      company: roster.office?.name ?? "The company",
      ceo: ceoCard === null || roster.ceo === null ? null : { ...person(ceoCard), appointment: roster.ceo.state === "suspended" ? "suspended" : "active" },
      departments,
      unassigned: cards.filter((e) => e.departmentId === null && e.id !== ceoId).map(person),
      missions: open.missions.map((m) => ({ title: m.title, state: m.assignment.state.toLowerCase().replace(/_/g, " "), next: m.nextAction, responsible: m.assignment.employeeName, deadline: m.deadline, href: `#/office/mission/${m.id}` })),
      needsYou: inbox.items.map((i) => ({ title: i.title, detail: i.reason.slice(0, 300), href: `#/office/mission/${i.missionId}` })),
      approvals: await this.approvals.pendingCount(orbitId),
      resources: { running: reserved.running, maxConcurrent: budget.maxConcurrent, waiting: Number(waiting?.n ?? 0), cpu: `${vcpu(reserved.cpuMillis)} of ${vcpu(budget.cpuMillis)}`, memory: `${reserved.memoryMiB} of ${budget.memoryMiB} MiB` },
      assign: { ok: ceoSlot.responsible !== null, reason: ceoSlot.responsible !== null ? null : ceoSlot.reason },
    };
  }

  async report(orbitId: string, kind: ExecutiveReportKind): Promise<ExecutiveReport> {
    return reportOf(kind, await this.records(orbitId));
  }

  async lines(orbitId: string): Promise<string[]> {
    return recordLines(await this.records(orbitId));
  }
}
