// APPROVALS OF PROTECTED ACTIONS. An approval is of ONE action: it is bound to the action's fingerprint (the parameters
// its row declares, hashed -- governance-core approval.ts), asked for once (asking again for the same action is the same
// request), decided once by an operator who read that fingerprint, and SPENT once -- consumed, in one transaction,
// BEFORE the action starts, against a fingerprint taken again from the action as it stands just before it runs. It is
// never a standing permission: presenting it again is refused and recorded (a replay), and so is presenting it for
// another action.
//
// What carries an action out is an EXECUTOR registered for its kind (the push broker for repository.push). An action
// with no executor is never approved into anything: the policy denies it (NO_EXECUTOR).
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { askRefusal, consumeRefusal, decideRefusal, stateAt, type ActionKind } from "@orbit-web/governance-core";
import { checkApprovalDecision, type ApprovalView } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { EventBus } from "../../core/events/event-bus.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { GovernanceDatabase } from "../../infra/governance/governance-db.js";
import { ApprovalStore, type ApprovalRecord } from "../../infra/governance/stores.js";
import { AuditService } from "./audit.service.js";
import { labelOf, type GovernanceContext } from "./principal.js";

// How long a request waits for a person, and a granted approval for its action.
export const APPROVAL_TTL_MS = 24 * 60 * 60 * 1000;

export interface ExecutionResult {
  ok: boolean;
  // One line: what happened (scrubbed by the executor).
  outcome: string;
}

export interface Executor {
  // The fingerprint of the action as it stands NOW: what it would do if it ran this moment.
  fingerprintNow(approval: ApprovalRecord): Promise<string>;
  run(ctx: GovernanceContext, approval: ApprovalRecord): Promise<ExecutionResult>;
}

export interface ApprovalAsk {
  action: ActionKind;
  environment: string;
  fingerprint: string;
  params: ApprovalRecord["params"];
  summary: string;
  decisionId: string | null;
  workspaceId: string | null;
  agentId: string | null;
  runId: string | null;
  change: ApprovalRecord["change"];
}

const viewOf = (a: ApprovalRecord, now: string): ApprovalView => ({ ...a, state: stateAt(a, now) });

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger("Approvals");
  private readonly executors = new Map<string, Executor>();

  constructor(
    @Inject(GovernanceDatabase) private readonly database: GovernanceDatabase,
    @Inject(ApprovalStore) private readonly store: ApprovalStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  registerExecutor(action: ActionKind, executor: Executor): void {
    this.executors.set(action, executor);
  }

  list(): ApprovalView[] {
    const now = new Date().toISOString();
    return this.store.list().map((a) => viewOf(this.expireIfDue(a, now), now));
  }

  view(id: string): ApprovalView {
    const now = new Date().toISOString();
    return viewOf(this.expireIfDue(this.existing(id), now), now);
  }

  // A request for a person's approval of one action; the open one when that very action was already asked for.
  request(ctx: GovernanceContext, ask: ApprovalAsk): ApprovalRecord {
    const now = new Date().toISOString();
    return this.database.transaction(() => {
      const same = this.store.byFingerprint(ask.fingerprint);
      if (askRefusal(same, ask.fingerprint, now) === "ALREADY_ASKED") return same.find((a) => ["pending", "granted"].includes(stateAt(a, now))) as ApprovalRecord;
      const record: ApprovalRecord = {
        id: `apr-${randomUUID()}`,
        action: ask.action,
        environment: ask.environment,
        fingerprint: ask.fingerprint,
        params: ask.params,
        summary: ask.summary,
        state: "pending",
        requestedAt: now,
        requestedBy: labelOf(ctx.principal),
        agentId: ask.agentId,
        workspaceId: ask.workspaceId,
        runId: ask.runId,
        decisionId: ask.decisionId,
        expiresAt: new Date(Date.parse(now) + APPROVAL_TTL_MS).toISOString(),
        decidedBy: null,
        decidedAt: null,
        consumedAt: null,
        outcome: null,
        change: ask.change,
      };
      this.store.insert(record);
      this.audit.record(ctx, { type: "approval.requested", outcome: "pending", decisionId: ask.decisionId, workspaceId: ask.workspaceId, agentId: ask.agentId, runId: ask.runId, data: { approvalId: record.id, action: ask.action, fingerprint: ask.fingerprint, expiresAt: record.expiresAt } });
      this.changed(record.id, "pending");
      return record;
    });
  }

  // A person's decision on the fingerprint they read. A granted action with an executor is carried out at once -- its
  // approval spent first.
  async grant(ctx: GovernanceContext, id: string, body: unknown): Promise<ApprovalView> {
    const req = accepted(checkApprovalDecision(body));
    this.decide(ctx, id, req.fingerprint, "granted");
    const approval = this.existing(id);
    if (this.executors.has(approval.action)) await this.execute(ctx, id);
    return this.view(id);
  }

  reject(ctx: GovernanceContext, id: string, body: unknown): ApprovalView {
    const req = accepted(checkApprovalDecision(body));
    this.decide(ctx, id, req.fingerprint, "rejected");
    return this.view(id);
  }

  private decide(ctx: GovernanceContext, id: string, fingerprint: string, to: "granted" | "rejected"): void {
    const now = new Date().toISOString();
    this.database.transaction(() => {
      const a = this.expireIfDue(this.existing(id), now);
      if (a.fingerprint !== fingerprint) throw conflict("fingerprint_mismatch", "This is not the action you read: read the approval again.");
      const refusal = decideRefusal(a, now);
      if (refusal !== null) throw conflict(refusal.toLowerCase(), refusal === "APPROVAL_EXPIRED" ? "This request ran out of time: the agent asks again." : "This approval was already decided.");
      if (!this.store.transition(id, "pending", to, { decidedBy: labelOf(ctx.principal), decidedAt: now })) throw conflict("approval_decided", "This approval was already decided.");
      this.audit.record(ctx, { type: to === "granted" ? "approval.granted" : "approval.rejected", outcome: to, decisionId: a.decisionId, workspaceId: a.workspaceId, agentId: a.agentId, runId: a.runId, data: { approvalId: id, fingerprint: a.fingerprint } });
      this.changed(id, to);
    });
  }

  // Spends the approval -- once, on the fingerprint of the action as it stands now -- then carries the action out.
  // Whoever presents it a second time, or for another action, is refused and recorded.
  async execute(ctx: GovernanceContext, id: string): Promise<ApprovalView> {
    const approval = this.existing(id);
    const executor = this.executors.get(approval.action);
    if (executor === undefined) throw new ApiError(HttpStatus.CONFLICT, "no_executor", `Nothing in Orbit Web carries out ${approval.action}.`);
    let fingerprint: string;
    try {
      fingerprint = await executor.fingerprintNow(approval);
    } catch (err) {
      fingerprint = `unavailable:${err instanceof Error ? err.message.slice(0, 80) : "error"}`;
    }
    const consumed = this.consume(ctx, id, fingerprint);
    this.audit.record(ctx, { type: "protected.executing", outcome: "executing", decisionId: consumed.decisionId, workspaceId: consumed.workspaceId, agentId: consumed.agentId, runId: consumed.runId, data: { approvalId: id, action: consumed.action, fingerprint: consumed.fingerprint } });
    let result: ExecutionResult;
    try {
      result = await executor.run(ctx, consumed);
    } catch (err) {
      result = { ok: false, outcome: err instanceof Error ? err.message.slice(0, 300) : "failed" };
    }
    this.store.setOutcome(id, result.outcome);
    this.audit.record(ctx, { type: result.ok ? "protected.completed" : "protected.failed", outcome: result.ok ? "completed" : "failed", decisionId: consumed.decisionId, workspaceId: consumed.workspaceId, agentId: consumed.agentId, runId: consumed.runId, data: { approvalId: id, action: consumed.action, fingerprint: consumed.fingerprint, ...(result.ok ? {} : { cause: result.outcome }) } });
    this.changed(id, result.ok ? "completed" : "failed");
    if (!result.ok) this.logger.warn(`approval ${id}: ${result.outcome}`);
    return this.view(id);
  }

  private consume(ctx: GovernanceContext, id: string, fingerprint: string): ApprovalRecord {
    const now = new Date().toISOString();
    const outcome = this.database.transaction((): ApprovalRecord | { refused: string } => {
      const a = this.existing(id);
      const refusal = consumeRefusal(a, fingerprint, now);
      if (refusal !== null) {
        this.audit.record(ctx, { type: "approval.consume.refused", outcome: "refused", decisionId: a.decisionId, workspaceId: a.workspaceId, agentId: a.agentId, runId: a.runId, data: { approvalId: id, fingerprint: a.fingerprint, cause: refusal } });
        return { refused: refusal };
      }
      if (!this.store.transition(id, "granted", "consumed", { consumedAt: now })) {
        this.audit.record(ctx, { type: "approval.consume.refused", outcome: "refused", decisionId: a.decisionId, data: { approvalId: id, fingerprint: a.fingerprint, cause: "APPROVAL_CONSUMED" } });
        return { refused: "APPROVAL_CONSUMED" };
      }
      this.audit.record(ctx, { type: "approval.consumed", outcome: "consumed", decisionId: a.decisionId, workspaceId: a.workspaceId, agentId: a.agentId, runId: a.runId, data: { approvalId: id, fingerprint: a.fingerprint } });
      return { ...a, state: "consumed", consumedAt: now };
    });
    if ("refused" in outcome) throw new ApiError(HttpStatus.CONFLICT, outcome.refused.toLowerCase(), REFUSALS[outcome.refused] ?? "This approval cannot be spent.");
    return outcome;
  }

  // A pending or granted approval past its time is EXPIRED, and recorded so once.
  private expireIfDue(a: ApprovalRecord, now: string): ApprovalRecord {
    if (stateAt(a, now) !== "expired" || a.state === "expired") return a;
    return this.database.transaction(() => {
      if (this.store.transition(a.id, a.state, "expired", {})) this.audit.record({ correlationId: randomUUID(), principal: { kind: "system", id: "orbit-web" } }, { type: "approval.expired", outcome: "expired", workspaceId: a.workspaceId, agentId: a.agentId, data: { approvalId: a.id } });
      return { ...a, state: "expired" };
    });
  }

  private existing(id: string): ApprovalRecord {
    const a = this.store.get(id);
    if (a === null) throw notFound("The approval");
    return a;
  }

  private changed(approvalId: string, state: string): void {
    this.database.afterCommit(() => this.bus.publishApp("approval.changed", { approvalId, state }));
  }
}

const REFUSALS: Record<string, string> = {
  APPROVAL_CONSUMED: "This approval was already spent on its action: an approval is used once. The action is asked for, and approved, again.",
  APPROVAL_EXPIRED: "This approval ran out of time.",
  APPROVAL_NOT_GRANTED: "This approval was not granted.",
  FINGERPRINT_MISMATCH: "The action is no longer the one that was approved (its commit, branch or remote moved): it is asked for, and approved, again.",
};
