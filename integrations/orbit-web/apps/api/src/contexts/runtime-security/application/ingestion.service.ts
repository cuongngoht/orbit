// WHAT THE ALLOCATOR'S SECURITY PLANE REPORTED, TAKEN IN (ADR 0063): pulled from a cursor every two seconds (never
// pushed: what Orbit Web cannot keep up with stays in the allocator's bounded ring and is said lost when it falls out),
// kept by account, judged by the rules table, and acted on: an incident opened once per cause per attempt, its decision
// recorded on the account's audit chain (the raw events never are), its deterministic response carried out -- the
// attempt's run token ended, exactly ITS two containers stopped by its dispatch key and verified stopped. A response
// never reaches a newer attempt (another dispatch key), never an observed one, and never anything but an attempt.
// The response is kept with the incident in the same transaction that opens it and carried out again on every pull
// until each step is recorded done: a step that failed, a restart between the commit and the response, or a stop that
// could not be read back never leaves the attempt running while the incident says it was handled.
import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { IncidentSeverity, RuntimeOutcome } from "@orbit-web/contracts";
import type { RuntimeMode } from "@orbit-web/governance-core";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../../config/config.js";
import { loadSandboxConfig } from "../../../config/sandbox-config.js";
import { accountAudience, EventBus } from "../../../core/events/event-bus.js";
import { APP_CONFIG } from "../../../core/tokens.js";
import { Db } from "../../../infra/db/db.js";
import { systemContext } from "../../../modules/auth/principal.js";
import { AuditService } from "../../../modules/governance/audit.service.js";
import { RunGovernanceService } from "../../../modules/governance/run-governance.service.js";
import { SANDBOX_PROVIDER, type SandboxProvider } from "../../execution/application/sandbox.port.js";
import { SECURITY_STOP } from "../../execution/application/execution.worker.js";
import { RunRepository, type RunRecord } from "../../execution/infrastructure/runs.repository.js";
import type { RuntimePull, WireRuntimeEvent } from "../../execution/infrastructure/sandbox/runtime-security-wire.js";
import { classify, incidentFor, protectionIncident, type IncidentPlan } from "../domain/rules.js";
import { isUuid, SecurityRepository, type EventRow, type IncidentRecord } from "../infrastructure/security.repository.js";

const POLL_MS = 2_000;
const PRUNE_MS = 60 * 60_000;
const BATCH = 500;
// How many owed responses one pull carries out (the oldest first; the rest on the next pull).
const RESPONSES_PER_PULL = 20;
const STOPPED = "both planes stopped, read back";
const UNVERIFIED = "containment could not be verified";

interface Planned {
  accountId: string;
  plan: IncidentPlan;
  runId: string | null;
  assignmentId: string | null;
  employeeId: string | null;
  dispatchKey: string | null;
  evidence: Record<string, string | number | boolean | null>;
}

@Injectable()
export class RuntimeSecurityIngestion implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("RuntimeSecurity");
  private timers: NodeJS.Timeout[] = [];
  private busy = false;
  private readonly settings: { enabled: boolean; maxEventsPerRun: number; retentionDays: number };

  constructor(
    @Inject(APP_CONFIG) config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(SecurityRepository) private readonly repo: SecurityRepository,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(RunRepository) private readonly runs: RunRepository,
    @Inject(RunGovernanceService) private readonly governance: RunGovernanceService,
    @Optional() @Inject(SANDBOX_PROVIDER) private readonly provider: SandboxProvider | null = null,
  ) {
    let rs: { backend: string; maxEventsPerRun: number; retentionDays: number } = { backend: "off", maxEventsPerRun: 20_000, retentionDays: 14 };
    try {
      rs = loadSandboxConfig(config.sourceEnv).runtimeSecurity;
    } catch {
      // A sandbox configuration that does not load is said where the sandbox is made; here, nothing is pulled.
    }
    this.settings = { enabled: rs.backend !== "off", maxEventsPerRun: rs.maxEventsPerRun, retentionDays: rs.retentionDays };
  }

  onApplicationBootstrap(): void {
    if (!this.settings.enabled || this.provider === null || this.provider.kind !== "container") return;
    const every = (ms: number, fn: () => Promise<unknown>) => {
      const t = setInterval(() => void fn().catch((err: unknown) => this.logger.warn(`runtime security: ${err instanceof Error ? err.message : String(err)}`)), ms);
      t.unref();
      this.timers.push(t);
    };
    every(POLL_MS, () => this.tick());
    every(PRUNE_MS, () => this.prune());
  }

  onApplicationShutdown(): void {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // Telemetry older than the retention, gone (incidents and what was done about them stay).
  async prune(now = new Date()): Promise<number> {
    return this.repo.prune(new Date(now.getTime() - this.settings.retentionDays * 86_400_000).toISOString());
  }

  // One pull, taken in whole. Exposed for the tests.
  async tick(): Promise<{ events: number; incidents: number } | null> {
    if (this.busy || this.provider === null) return null;
    this.busy = true;
    try {
      const feed = await this.repo.feed();
      const pull = await this.provider.runtimeSecurityPull({ epoch: feed.epoch, seq: feed.seq }, BATCH);
      return pull === null ? null : await this.take(pull, feed.lost);
    } finally {
      // Whatever the pull brought, or if it failed: ending a run token needs no allocator, and a stop is tried again.
      await this.respondOwed();
      this.busy = false;
    }
  }

  private async take(pull: RuntimePull, lostBefore: number): Promise<{ events: number; incidents: number }> {
    const at = new Date().toISOString();
    const accounts = new Set<string>();
    const planned: Planned[] = [];
    let opened = 0;
    let kept = 0;
    await this.db.tx(async () => {
      for (const p of pull.protections) {
        const r = await this.repo.reportProtection(p);
        if (r === undefined) continue;
        accounts.add(p.accountId);
        const plan = protectionIncident({ runId: p.runId, mode: p.mode, from: r.from, to: p.state, detail: p.detail });
        if (plan !== null) planned.push({ accountId: p.accountId, plan, runId: p.runId, assignmentId: p.assignmentId, employeeId: p.employeeId, dispatchKey: p.dispatchKey, evidence: { detail: plan.detail.slice(0, 500), state: p.state, mode: p.mode, policy: p.policy } });
      }
      const modes = new Map<string, RuntimeMode | null>();
      const rows: EventRow[] = [];
      for (const e of pull.events) {
        if (!isUuid(e.accountId)) continue;
        const c = classify({ kind: e.kind, outcome: e.outcome, plane: e.plane, binary: e.binary, path: e.path, control: e.control, runKind: e.runKind });
        rows.push(this.rowOf(e, c.kind, c.severity, e.outcome));
        const key = `${e.accountId}:${e.runId}`;
        if (!modes.has(key)) modes.set(key, e.runKind === "assignment" ? ((await this.repo.protectionOf(e.accountId, e.runId))?.mode ?? null) : "observe");
        const plan = incidentFor({ kind: c.kind, severity: c.severity, mode: modes.get(key) ?? null, outcome: e.outcome, runKind: e.runKind, runId: e.runId, control: e.control, path: e.path, binary: e.binary });
        if (plan !== null) planned.push({ accountId: e.accountId, plan, runId: e.runKind === "assignment" ? e.runId : null, assignmentId: e.assignmentId, employeeId: e.employeeId, dispatchKey: e.dispatchKey, evidence: { kind: c.kind, binary: e.binary, path: e.path, plane: e.plane, control: e.control, runKind: e.runKind, run: e.runId, at: e.time } });
        accounts.add(e.accountId);
      }
      kept = await this.repo.insertEvents(rows, this.settings.maxEventsPerRun, at);
      const last = pull.events.at(-1)?.time ?? null;
      await this.repo.saveFeed({ epoch: pull.epoch, seq: pull.next, sensor: pull.sensor, lost: lostBefore + pull.lost, unattributed: pull.unattributed, gaps: pull.gaps, canaryProvenAt: pull.canaryProvenAt, lastEventAt: last }, at);
      for (const x of planned) {
        const { incident, created } = await this.repo.openIncident(x.accountId, { ...x.plan, runId: x.runId, assignmentId: x.assignmentId, employeeId: x.employeeId, dispatchKey: x.runId === null ? null : x.dispatchKey, evidence: x.evidence }, at, `inc-${randomUUID()}`);
        if (!created) continue;
        await this.repo.addAction(x.accountId, incident.id, { action: "opened", actor: "runtime-security", outcome: incident.state.toLowerCase(), detail: x.plan.title }, at);
        await this.audit.record(systemContext("runtime-security", x.accountId), { type: "runtime_security.incident.opened", outcome: incident.severity.toLowerCase(), accountId: x.accountId, data: { incidentId: incident.id, runId: x.runId, category: incident.category, severity: incident.severity, employeeId: x.employeeId } });
        opened += 1;
      }
    });
    for (const a of accounts) this.bus.publishApp("governance.changed", { area: "runtime-security", id: null }, accountAudience(a));
    return { events: kept, incidents: opened };
  }

  // Every response still owed (the oldest first), each carried out on its own: one that fails waits for the next pull.
  async respondOwed(): Promise<void> {
    const warn = (what: string) => (err: unknown) => this.logger.warn(`${what}: ${err instanceof Error ? err.message : String(err)}`);
    const due = await this.repo.dueResponses(RESPONSES_PER_PULL).catch((err: unknown) => (warn("the owed responses could not be read")(err), [] as IncidentRecord[]));
    for (const incident of due) await this.respond(incident).catch(warn(`the response to ${incident.id} failed`));
  }

  private rowOf(e: WireRuntimeEvent, kind: EventRow["kind"], severity: IncidentSeverity, outcome: RuntimeOutcome): EventRow {
    return { accountId: e.accountId, key: e.key, occurredAt: e.time || new Date().toISOString(), runKind: e.runKind, runId: e.runId, employeeId: e.employeeId, kind, outcome, severity, plane: e.plane, binary: e.binary, parentBinary: e.parentBinary, path: e.path, control: e.control, execId: e.execId, parentExecId: e.parentExecId, exitCode: e.exitCode, signal: e.signal };
  }

  // The incident's deterministic response, in its order, from what is still owed of it. Each step is recorded with how it
  // ended, once; a stop is verified from outside the attempt (both planes read back stopped -- an allocator that does not
  // answer verifies nothing), never assumed from an answer. The response is done only when every step is.
  private async respond(incident: IncidentRecord): Promise<void> {
    const accountId = incident.accountId;
    const at = () => new Date().toISOString();
    const done = await this.repo.actionsOf(accountId, incident.id);
    const owed = incident.respond.filter((step) => (step === "revoke" ? !done.some((a) => a.action === "revoke") : !done.some((a) => a.action === "stop" && a.outcome === STOPPED)));
    if (incident.state === "RESOLVED" || owed.length === 0) return this.repo.responseDone(accountId, incident.id, at());
    const run = incident.runId === null ? null : await this.runs.get(accountId, incident.runId);
    // The attempt the incident is about, and only it: one that is not here, or another dispatch key, is never touched.
    if (run === null || (incident.dispatchKey !== null && run.dispatchKey !== incident.dispatchKey)) {
      await this.repo.addAction(accountId, incident.id, { action: "response", actor: "runtime-security", outcome: "not carried out", detail: "the attempt it is about is not here" }, at());
      return this.repo.responseDone(accountId, incident.id, at());
    }
    if (owed.includes("revoke")) {
      await this.governance.abandoned(accountId, run.id, "security");
      await this.repo.addAction(accountId, incident.id, { action: "revoke", actor: "runtime-security", outcome: "run token ended", detail: "the attempt's proxy and tool door refuse it from now on" }, at());
    }
    if (owed.includes("stop") && !(await this.stop(incident, run, done.some((a) => a.action === "stop")))) return;
    await this.repo.responseDone(accountId, incident.id, at());
    this.bus.publishApp("governance.changed", { area: "runtime-security", id: incident.id }, accountAudience(accountId));
  }

  // Exactly the attempt's two containers stopped, then read back: true only when both read back stopped (or gone).
  private async stop(incident: IncidentRecord, run: RunRecord, tried: boolean): Promise<boolean> {
    const accountId = incident.accountId;
    const ctx = systemContext("runtime-security", accountId);
    const at = () => new Date().toISOString();
    if (!tried) await this.audit.record(ctx, { type: "runtime_security.containment.requested", outcome: "requested", accountId, data: { incidentId: incident.id, runId: run.id, reason: incident.category } });
    if (run.state === "starting" || run.state === "running") await this.runs.requestStopOf(accountId, run.id, SECURITY_STOP);
    if (run.handle !== null && this.provider !== null) await this.provider.stop(run.handle, 0).catch(() => undefined);
    const found = this.provider === null ? undefined : await this.provider.find(run.dispatchKey).catch(() => undefined);
    const stopped = found === null || (found !== undefined && !found.toolPlaneRunning && !found.modelPlaneRunning);
    if (!stopped) {
      if (!tried) await this.repo.addAction(accountId, incident.id, { action: "stop", actor: "runtime-security", outcome: UNVERIFIED, detail: found === undefined ? `the allocator did not answer (${run.dispatchKey})` : `a plane still runs (${run.dispatchKey})` }, at());
      return false;
    }
    await this.repo.addAction(accountId, incident.id, { action: "stop", actor: "runtime-security", outcome: STOPPED, detail: run.dispatchKey }, at());
    await this.repo.setIncidentState(accountId, incident.id, "CONTAINED", at());
    await this.audit.record(ctx, { type: "runtime_security.containment.confirmed", outcome: "contained", accountId, data: { incidentId: incident.id, runId: run.id, outcome: "stopped" } });
    return true;
  }
}
