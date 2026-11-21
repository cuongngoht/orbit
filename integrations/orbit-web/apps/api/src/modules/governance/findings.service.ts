// THE DETERMINISTIC AUDITOR, bound to an account's record: findings are worked out from the account's audit chain by
// governance-core's rules every time they are read -- nothing a model said, nothing stored that could drift from the
// record -- and every one names the records it stands on. What the owner decided about a finding (resolved, accepted,
// open again) is kept beside it and recorded.
//
// The DAILY REPORT is the same fold over one UTC day of one account's chain, frozen when it is generated: by the owner,
// or by Orbit Web itself shortly after a day ends when the account's policy asks for it (obligations.dailyReport) and the
// account recorded anything that day. Its text is generated from the counts and the ids -- no model writes a word of it.
// Nothing here reads another account's records: a report of account A is A's chain, its findings and its resolutions.
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import { dailyReport, findingsOf, renderReport, verifyChain, type DailyReport, type Finding } from "@orbit-web/governance-core";
import { checkGenerateReport, checkResolveFinding, type ChainVerification, type FindingList, type FindingView, type ReportSummary, type ReportView } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accountAudience, EventBus } from "../../core/events/event-bus.js";
import { accepted, ApiError, notFound } from "../../common/errors.js";
import { Db } from "../../infra/db/db.js";
import { AuditStore, FindingStore, ReportStore, sha256, type ReportRecord } from "../../infra/governance/stores.js";
import { labelOf, systemContext, type GovernanceContext } from "../auth/principal.js";
import { AuditService } from "./audit.service.js";
import { PolicyService } from "./policy.service.js";

// How often the scheduler looks whether yesterday's reports are owed.
const SCHEDULE_MS = 10 * 60 * 1000;

const dayOf = (iso: string): string => iso.slice(0, 10);
const nextDay = (day: string): string => new Date(Date.parse(`${day}T00:00:00.000Z`) + 86_400_000).toISOString().slice(0, 10);

const reportSummary = (r: ReportRecord): ReportSummary => {
  const report = JSON.parse(r.content) as DailyReport;
  return { id: r.id, day: r.day, generatedAt: r.generatedAt, generatedBy: r.generatedBy, head: r.head, findings: report.findings.length, denied: report.denied.length, integrityOk: report.integrity.ok };
};

@Injectable()
export class FindingsService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Auditor");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AuditStore) private readonly auditStore: AuditStore,
    @Inject(FindingStore) private readonly resolutions: FindingStore,
    @Inject(ReportStore) private readonly reports: ReportStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => void this.scheduled(), SCHEDULE_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  // ---- findings ------------------------------------------------------------------------------------------------------

  async current(accountId: string): Promise<FindingList> {
    const events = await this.auditStore.all(accountId);
    const check = verifyChain(events, sha256);
    const checkedAt = new Date().toISOString();
    const chain: ChainVerification = check.ok
      ? { ok: true, count: check.count, head: check.head, brokenAt: null, eventId: null, problem: null, checkedAt }
      : { ok: false, count: check.count, head: null, brokenAt: check.brokenAt, eventId: check.eventId, problem: check.problem, checkedAt };
    const findings = findingsOf({ events, chain: check, complete: true });
    const decided = await this.resolutions.all(accountId);
    return {
      findings: findings.map((f): FindingView => {
        const r = decided.get(f.id);
        return { ...f, resolution: r?.resolution ?? "open", resolvedBy: r?.resolvedBy ?? null, resolvedAt: r?.resolvedAt ?? null, note: r?.note ?? null };
      }),
      chain,
    };
  }

  async openCount(accountId: string): Promise<number> {
    return (await this.current(accountId)).findings.filter((f) => f.resolution === "open").length;
  }

  async resolve(ctx: GovernanceContext, id: string, body: unknown): Promise<FindingView> {
    const accountId = this.ownerOf(ctx);
    const req = accepted(checkResolveFinding(body));
    const finding = (await this.current(accountId)).findings.find((f) => f.id === id);
    if (finding === undefined) throw notFound("The finding");
    const at = new Date().toISOString();
    await this.db.tx(async () => {
      await this.resolutions.set(accountId, { findingId: id, resolution: req.resolution, note: req.note ?? null, resolvedBy: labelOf(ctx.principal), resolvedAt: at });
      await this.audit.record(ctx, { type: "finding.status.changed", outcome: req.resolution, accountId, evidenceRefs: finding.evidenceIds.slice(0, 20), data: { findingId: id, resolution: req.resolution } });
    });
    this.bus.publishApp("governance.changed", { area: "findings", id }, accountAudience(accountId));
    return { ...finding, resolution: req.resolution, resolvedBy: labelOf(ctx.principal), resolvedAt: at, note: req.note ?? null };
  }

  // ---- daily reports -------------------------------------------------------------------------------------------------

  async reportList(accountId: string): Promise<ReportSummary[]> {
    return (await this.reports.list(accountId)).map(reportSummary);
  }

  async report(accountId: string, id: string): Promise<ReportView> {
    const r = await this.reports.get(accountId, id);
    if (r === null) throw notFound("The report");
    return { ...reportSummary(r), report: JSON.parse(r.content) as DailyReport, markdown: r.markdown };
  }

  async generate(ctx: GovernanceContext, body: unknown): Promise<ReportView> {
    const accountId = this.ownerOf(ctx);
    const req = accepted(checkGenerateReport(body));
    return this.generateFor(ctx, accountId, req.day);
  }

  private async generateFor(ctx: GovernanceContext, accountId: string, day: string): Promise<ReportView> {
    const all = await this.auditStore.all(accountId);
    const chain = verifyChain(all, sha256);
    const ofDay = all.filter((e) => dayOf(e.occurredAt) === day);
    const ids = new Set(ofDay.map((e) => e.eventId));
    const findings: Finding[] = findingsOf({ events: all, chain, complete: true }).filter((f) => f.evidenceIds.some((id) => ids.has(id)) || f.kind === "AUDIT_INTEGRITY_FAILURE");
    const resolved = [...(await this.resolutions.all(accountId)).values()].filter((r) => r.resolution !== "open").map((r) => r.findingId);
    const report = dailyReport({ day, accountId, generatedAt: new Date().toISOString(), events: ofDay, chain, findings, resolved });
    const record: ReportRecord = { id: `rpt-${randomUUID()}`, accountId, day, generatedAt: report.generatedAt, generatedBy: labelOf(ctx.principal), head: report.integrity.head, content: JSON.stringify(report), markdown: renderReport(report) };
    await this.db.tx(async () => {
      await this.reports.insert(record);
      await this.audit.record(ctx, { type: "report.generated", outcome: report.integrity.ok ? "generated" : "generated_chain_broken", accountId, data: { reportId: record.id, day, head: report.integrity.head } });
    });
    this.bus.publishApp("governance.changed", { area: "reports", id: record.id }, accountAudience(accountId));
    return this.report(accountId, record.id);
  }

  // Yesterday's report of each account that recorded anything that day, once, when its policy asks for daily reports
  // and nobody generated it yet. Each is generated as Orbit Web itself, for that account, on that account's chain.
  async scheduled(now = new Date()): Promise<ReportView[]> {
    const done: ReportView[] = [];
    try {
      const yesterday = dayOf(new Date(now.getTime() - 86_400_000).toISOString());
      if (nextDay(yesterday) > dayOf(now.toISOString())) return done;
      const accounts = await this.auditStore.accountsActive(`${yesterday}T00:00:00.000Z`, `${nextDay(yesterday)}T00:00:00.000Z`);
      for (const accountId of accounts) {
        if ((await this.policy.effective(accountId))?.constitution.obligations.dailyReport !== true) continue;
        if ((await this.reports.ofDay(accountId, yesterday)).length > 0) continue;
        const view = await this.generateFor(systemContext("scheduler", accountId), accountId, yesterday);
        this.logger.log(`daily report ${yesterday} of account ${accountId}: ${view.findings} finding(s), audit head ${view.head ?? "none"}`);
        done.push(view);
      }
    } catch (err) {
      this.logger.error(`a daily report could not be generated: ${err instanceof Error ? err.message : String(err)}`);
    }
    return done;
  }

  private ownerOf(ctx: GovernanceContext): string {
    if (ctx.principal.kind !== "owner") throw new ApiError(403, "owner_required", "Only the account's owner does this.");
    return ctx.principal.accountId;
  }
}
