// RUNTIME SECURITY, AS THE ACCOUNT'S OWNER READS IT (ADR 0063): the summary, the host's probe, the attempts by what
// holds them, the events, the incidents -- all of the session's account, never another's -- and a person's review of an
// incident, which names the version it read and is recorded on the account's chain. Nothing here makes a policy, lowers
// a mode or releases a contained attempt by itself: the policy is published through its own lifecycle, and a retry is a
// person's, only once a review authorized it.
import { Inject, Injectable } from "@nestjs/common";
import { checkReviewIncident, protectionBadge, type CapabilityResult, type EmployeeRuntimeSecurityView, type HostKind, type IncidentView, type RuntimeEventPage, type RuntimeHostView, type RuntimeSecurityOverview, type RuntimeWorkloadList, type IncidentList, type WorkloadProtectionView } from "@orbit-web/contracts";
import { composeRuntimeSecurity, isRuntimeMode, runtimeSecurityOf, type RuntimeMode } from "@orbit-web/governance-core";
import { accepted, ApiError, notFound } from "../../../common/errors.js";
import type { AppConfig } from "../../../config/config.js";
import { loadSandboxConfig } from "../../../config/sandbox-config.js";
import { accountAudience, EventBus } from "../../../core/events/event-bus.js";
import { APP_CONFIG } from "../../../core/tokens.js";
import { Db } from "../../../infra/db/db.js";
import { labelOf, type GovernanceContext } from "../../../modules/auth/principal.js";
import { AuditService } from "../../../modules/governance/audit.service.js";
import { PolicyService } from "../../../modules/governance/policy.service.js";
import type { RuntimeHostProbe } from "../../execution/infrastructure/sandbox/runtime-security-wire.js";
import { isUuid, SecurityRepository, type IncidentRecord } from "../infrastructure/security.repository.js";

const DAY = 86_400_000;

@Injectable()
export class RuntimeSecurityService {
  private readonly rs: { backend: "off" | "tetragon"; floor: RuntimeMode; retentionDays: number };

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(SecurityRepository) private readonly repo: SecurityRepository,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {
    let rs = { backend: "off" as "off" | "tetragon", floor: "disabled" as RuntimeMode, retentionDays: 14 };
    try {
      const c = loadSandboxConfig(config.sourceEnv).runtimeSecurity;
      rs = { backend: c.backend, floor: c.floor, retentionDays: c.retentionDays };
    } catch {
      // Said where the sandbox is made.
    }
    this.rs = rs;
  }

  private async effectiveOf(accountId: string, departmentId: string | null) {
    const company = (await this.policy.effective(accountId))?.constitution ?? null;
    const dept = departmentId === null ? null : ((await this.policy.departmentEffective(accountId, departmentId))?.policy ?? null);
    const configured = company === null ? { mode: "disabled" as RuntimeMode, controls: [] } : runtimeSecurityOf(company);
    return { configured, effective: composeRuntimeSecurity(company ?? {}, dept, this.rs.floor) };
  }

  async host(): Promise<RuntimeHostView> {
    const probe = (await this.repo.runtimeProbe()) as RuntimeHostProbe | null;
    const feed = await this.repo.feed();
    const sensor = feed.sensor ?? probe?.sensor ?? null;
    const disabled = this.rs.backend === "off";
    return {
      backend: disabled ? "disabled" : "tetragon",
      backendVersion: sensor?.version ?? probe?.backendVersion ?? null,
      backendImage: sensor?.image ?? probe?.backendImage ?? null,
      hostKind: (probe?.hostKind ?? "unknown") as HostKind,
      kernel: probe?.kernel ?? null,
      arch: probe?.arch ?? null,
      // UNKNOWN is never healthy: no report from the allocator is said as such.
      sensor: { state: disabled ? "DISABLED" : (sensor?.state ?? "UNKNOWN"), generation: sensor?.generation ?? null, since: sensor?.since ?? null, detail: disabled ? "No runtime security backend is configured on this host (ORBIT_WEB_RUNTIME_SECURITY=off)." : (sensor?.detail ?? "The allocator has not reported the sensor yet."), cpuPercent: probe?.resources.cpuPercent ?? null, memoryMiB: probe?.resources.memoryMiB ?? null },
      capabilities: (probe?.capabilities ?? []) as CapabilityResult[],
      probedAt: probe?.probedAt ?? null,
      floor: this.rs.floor,
      telemetry: { lastEventAt: feed.lastEventAt, lost: feed.lost, unattributed: feed.unattributed, retentionDays: this.rs.retentionDays },
    };
  }

  async overview(accountId: string): Promise<RuntimeSecurityOverview> {
    return this.db.snapshot(async () => {
      const { configured, effective } = await this.effectiveOf(accountId, null);
      const cov = await this.repo.coverage(accountId);
      const by = (s: string) => cov.byState[s] ?? 0;
      const counted = Object.values(cov.byState).reduce((a, b) => a + b, 0);
      const since = new Date(Date.now() - DAY).toISOString();
      const c = await this.repo.counts(accountId, since);
      return {
        configured,
        effective: { mode: effective.mode, controls: effective.controls, floor: effective.floor, from: effective.from.mode },
        host: await this.host(),
        coverage: { protected: by("PROTECTED"), observing: by("OBSERVING"), degraded: by("DEGRADED") + by("UNKNOWN"), contained: by("CONTAINED") + by("CONTAINING"), unprotected: Math.max(0, cov.running - counted) + by("UNREGISTERED"), running: cov.running },
        openIncidents: await this.repo.openCount(accountId),
        prevented24h: c.prevented,
        detected24h: c.detected,
        sessions: this.rs.backend !== "off" && this.rs.floor !== "disabled" ? "observed" : "not_observed",
      };
    });
  }

  async workloads(accountId: string, q: { employeeId?: string; live?: boolean }): Promise<RuntimeWorkloadList> {
    return { workloads: await this.repo.workloads(accountId, { ...q, limit: 200 }) };
  }

  async events(accountId: string, q: Record<string, string | undefined>): Promise<RuntimeEventPage> {
    const limit = Math.min(500, Math.max(1, Number(q.limit ?? 200) || 200));
    const before = q.before !== undefined && /^\d+$/.test(q.before) ? Number(q.before) : undefined;
    const minSeverity = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(q.severity ?? "") ? (q.severity as "INFO") : undefined;
    const events = await this.repo.events(accountId, { runId: q.run, employeeId: q.employee, kind: q.kind, outcome: q.outcome, minSeverity, since: q.since !== undefined && !Number.isNaN(Date.parse(q.since)) ? q.since : undefined, before, limit });
    return { events, next: events.length === limit ? (events.at(-1)?.id ?? null) : null };
  }

  private async viewOf(r: IncidentRecord, actions: IncidentView["actions"] = []): Promise<IncidentView> {
    const name = r.employeeId === null ? null : ((await this.db.one("SELECT name FROM workforce.employees WHERE account_id = $1 AND id = $2", [r.accountId, r.employeeId]))?.name ?? null);
    const { accountId: _a, fingerprint: _f, ...view } = r;
    return { ...view, employeeName: name === null ? null : String(name), actions };
  }

  async incidents(accountId: string, q: { open?: boolean; employeeId?: string }): Promise<IncidentList> {
    const rows = await this.repo.incidents(accountId, { ...q, limit: 200 });
    return { incidents: await Promise.all(rows.map((r) => this.viewOf(r))) };
  }

  async incident(accountId: string, id: string): Promise<IncidentView> {
    const found = await this.repo.incident(accountId, id);
    if (found === null) throw notFound("The incident");
    return this.viewOf(found.incident, found.actions);
  }

  // A person's review, against the version they read: investigate, resolve, or authorize the held work to run again.
  async review(ctx: GovernanceContext, id: string, body: unknown, expectedVersion: number | null): Promise<IncidentView> {
    if (ctx.principal.kind !== "owner") throw new ApiError(403, "owner_required", "Only the account's owner reviews an incident.");
    const accountId = ctx.principal.accountId;
    const req = accepted(checkReviewIncident(body));
    if (expectedVersion === null) throw new ApiError(428, "version_required", "Name the version of the incident you read (If-Match).");
    const at = new Date().toISOString();
    const by = labelOf(ctx.principal);
    const updated = await this.db.tx(async () => {
      const r = await this.repo.review(accountId, id, expectedVersion, req.decision, req.note, by, at);
      if (r === null) return null;
      await this.repo.addAction(accountId, id, { action: `review:${req.decision}`, actor: by, outcome: r.state.toLowerCase(), detail: req.note || null }, at);
      await this.audit.record(ctx, { type: req.decision === "authorize_retry" ? "runtime_security.retry.authorized" : "runtime_security.incident.reviewed", outcome: req.decision, accountId, data: req.decision === "authorize_retry" ? { incidentId: id, assignmentId: r.assignmentId } : { incidentId: id, state: r.state, decision: req.decision } });
      return r;
    });
    if (updated === null) {
      if ((await this.repo.incident(accountId, id)) === null) throw notFound("The incident");
      throw new ApiError(412, "stale_version", "The incident changed since you read it: read it again.");
    }
    this.bus.publishApp("governance.changed", { area: "runtime-security", id }, accountAudience(accountId));
    return this.incident(accountId, id);
  }

  async employee(accountId: string, employeeId: string): Promise<EmployeeRuntimeSecurityView> {
    if (!isUuid(employeeId)) throw notFound("The employee");
    const e = await this.db.one("SELECT department_id FROM workforce.employees WHERE account_id = $1 AND id = $2", [accountId, employeeId]);
    if (e === null) throw notFound("The employee");
    const { effective } = await this.effectiveOf(accountId, e.department_id === null ? null : String(e.department_id));
    const recent = await this.repo.workloads(accountId, { employeeId, limit: 6 });
    // Only an attempt that RUNS is current: an employee with none shows no process -- its desk is storage.
    const current: WorkloadProtectionView | null = recent.find((w) => w.runState === "running" || w.runState === "starting") ?? null;
    const events = await this.repo.events(accountId, { employeeId, limit: 100 });
    const incidents = (await this.incidents(accountId, { employeeId })).incidents.slice(0, 50);
    return { employeeId, current, recent, events, incidents, effective: { mode: effective.mode, controls: effective.controls, from: effective.from.mode } };
  }

  // Said once, for the tests and the badge: "protected" only on fresh proof.
  badge(w: WorkloadProtectionView): string {
    return protectionBadge(w, Date.now());
  }

  floorIs(mode: string): boolean {
    return isRuntimeMode(mode) && mode === this.rs.floor;
  }
}
