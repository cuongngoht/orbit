// THE DETERMINISTIC AUDITOR, bound to the record: findings are worked out from the audit record by governance-core's
// rules every time they are read -- nothing a model said, nothing stored that could drift from the record -- and every
// one names the records it stands on. What a person decided about a finding (resolved, accepted, open again) is kept
// beside it and recorded.
//
// The DAILY REPORT is the same fold over one UTC day, frozen when it is generated: by a person (reports.generate), or
// by Orbit Web itself shortly after a day ends when the Constitution in effect asks for it (obligations.dailyReport).
// Its text is generated from the counts and the ids -- no model writes a word of it.
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { dailyReport, findingsOf, renderReport, verifyChain, type AuditEvent, type DailyReport, type Finding } from "@orbit-web/governance-core";
import { checkGenerateReport, checkResolveFinding, type ChainVerification, type FindingList, type FindingView, type ReportSummary, type ReportView } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { EventBus } from "../../core/events/event-bus.js";
import { accepted, notFound } from "../../common/errors.js";
import { GovernanceDatabase } from "../../infra/governance/governance-db.js";
import { AuditStore, FindingStore, OperatorStore, ReportStore, sha256, type ReportRecord } from "../../infra/governance/stores.js";
import { AuditService } from "./audit.service.js";
import { labelOf, systemContext, type GovernanceContext } from "./principal.js";
import { PolicyService } from "./policy.service.js";

// How often the scheduler looks whether yesterday's report is owed.
const SCHEDULE_MS = 10 * 60 * 1000;

const dayOf = (iso: string): string => iso.slice(0, 10);
const nextDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);

function verification(events: readonly AuditEvent[]): ChainVerification {
  const c = verifyChain(events, sha256);
  const checkedAt = new Date().toISOString();
  return c.ok ? { ok: true, count: c.count, head: c.head, brokenAt: null, eventId: null, problem: null, checkedAt } : { ok: false, count: c.count, head: null, brokenAt: c.brokenAt, eventId: c.eventId, problem: c.problem, checkedAt };
}

const reportSummary = (r: ReportRecord): ReportSummary => {
  const report = JSON.parse(r.content) as DailyReport;
  return { id: r.id, day: r.day, generatedAt: r.generatedAt, generatedBy: r.generatedBy, head: r.head, findings: report.findings.length, denied: report.denied.length, integrityOk: report.integrity.ok };
};

@Injectable()
export class FindingsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Auditor");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(GovernanceDatabase) private readonly database: GovernanceDatabase,
    @Inject(AuditStore) private readonly auditStore: AuditStore,
    @Inject(FindingStore) private readonly resolutions: FindingStore,
    @Inject(ReportStore) private readonly reports: ReportStore,
    @Inject(OperatorStore) private readonly operators: OperatorStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => this.scheduled(), SCHEDULE_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  // ---- findings ------------------------------------------------------------------------------------------------------

  current(): FindingList {
    const events = this.auditStore.all();
    const chain = verification(events);
    const findings = findingsOf({ events, chain: verifyChain(events, sha256), complete: true });
    const decided = this.resolutions.all();
    return {
      findings: findings.map((f): FindingView => {
        const r = decided.get(f.id);
        return { ...f, resolution: r?.resolution ?? "open", resolvedBy: r?.resolvedBy ?? null, resolvedAt: r?.resolvedAt ?? null, note: r?.note ?? null };
      }),
      chain,
    };
  }

  openCount(): number {
    return this.current().findings.filter((f) => f.resolution === "open").length;
  }

  resolve(ctx: GovernanceContext, id: string, body: unknown): FindingView {
    const req = accepted(checkResolveFinding(body));
    const finding = this.current().findings.find((f) => f.id === id);
    if (finding === undefined) throw notFound("The finding");
    return this.database.transaction(() => {
      const at = new Date().toISOString();
      this.resolutions.set({ findingId: id, resolution: req.resolution, note: req.note ?? null, resolvedBy: labelOf(ctx.principal), resolvedAt: at });
      this.audit.record(ctx, { type: "finding.status.changed", outcome: req.resolution, evidenceRefs: finding.evidenceIds.slice(0, 20), data: { findingId: id, resolution: req.resolution } });
      this.database.afterCommit(() => this.bus.publishApp("governance.changed", { area: "findings", id }));
      return { ...finding, resolution: req.resolution, resolvedBy: labelOf(ctx.principal), resolvedAt: at, note: req.note ?? null };
    });
  }

  // ---- daily reports -------------------------------------------------------------------------------------------------

  reportList(): ReportSummary[] {
    return this.reports.list().map(reportSummary);
  }

  report(id: string): ReportView {
    const r = this.reports.get(id);
    if (r === null) throw notFound("The report");
    return { ...reportSummary(r), report: JSON.parse(r.content) as DailyReport, markdown: r.markdown };
  }

  generate(ctx: GovernanceContext, body: unknown): ReportView {
    const req = accepted(checkGenerateReport(body));
    return this.generateFor(ctx, req.day);
  }

  private generateFor(ctx: GovernanceContext, day: string): ReportView {
    const all = this.auditStore.all();
    const chain = verifyChain(all, sha256);
    const ofDay = all.filter((e) => dayOf(e.occurredAt) === day);
    const ids = new Set(ofDay.map((e) => e.eventId));
    const findings: Finding[] = findingsOf({ events: all, chain, complete: true }).filter((f) => f.evidenceIds.some((id) => ids.has(id)) || f.kind === "AUDIT_INTEGRITY_FAILURE");
    const resolved = [...this.resolutions.all().values()].filter((r) => r.resolution !== "open").map((r) => r.findingId);
    const report = dailyReport({ day, organizationId: this.operators.organization()?.id ?? "uninitialized", generatedAt: new Date().toISOString(), events: ofDay, chain, findings, resolved });
    const record: ReportRecord = { id: `rpt-${randomUUID()}`, day, generatedAt: report.generatedAt, generatedBy: labelOf(ctx.principal), head: report.integrity.head, content: JSON.stringify(report), markdown: renderReport(report) };
    return this.database.transaction(() => {
      this.reports.insert(record);
      this.audit.record(ctx, { type: "report.generated", outcome: report.integrity.ok ? "generated" : "generated_chain_broken", data: { reportId: record.id, day, head: report.integrity.head } });
      this.database.afterCommit(() => this.bus.publishApp("governance.changed", { area: "reports", id: record.id }));
      return this.report(record.id);
    });
  }

  // Yesterday's report, once, when the Constitution in effect asks for daily reports and nobody generated it yet.
  scheduled(now = new Date()): ReportView | null {
    try {
      if (this.operators.organization() === null || this.policy.effective()?.constitution.obligations.dailyReport !== true) return null;
      const yesterday = dayOf(new Date(now.getTime() - 86_400_000).toISOString());
      if (this.reports.ofDay(yesterday).length > 0 || nextDay(yesterday) > dayOf(now.toISOString())) return null;
      const view = this.generateFor(systemContext("scheduler"), yesterday);
      this.logger.log(`daily report ${yesterday}: ${view.findings} finding(s), audit head ${view.head ?? "none"}`);
      return view;
    } catch (err) {
      this.logger.error(`the daily report could not be generated: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }
}
