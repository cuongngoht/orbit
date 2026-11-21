// APPROVALS OF PROTECTED ACTIONS, an account's own. An approval is of ONE action: it is bound to the action's
// fingerprint (the parameters its row declares, hashed -- governance-core approval.ts), asked for once (asking again for
// the same action is the same request), decided once by the account's OWNER on the fingerprint they read -- never by an
// agent, never by the run that asked (the database itself refuses a decision recorded as anybody's but a person's) --
// and SPENT once: consumed, in one transaction, BEFORE the action starts, against a fingerprint taken again from the
// action as it stands just before it runs. It is never a standing permission: presenting it again is refused and
// recorded (a replay), and so is presenting it for another action.
//
// What carries an action out is an EXECUTOR registered for its kind (the push broker for repository.push). An action
// with no executor is never approved into anything: the policy denies it (NO_EXECUTOR).
import { HttpStatus, Inject, Injectable, Logger } from "@nestjs/common";
import { askRefusal, consumeRefusal, decideRefusal, stateAt, type ActionKind } from "@orbit-web/governance-core";
import { checkApprovalDecision, type ApprovalView } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accountAudience, EventBus } from "../../core/events/event-bus.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { Db } from "../../infra/db/db.js";
import { ApprovalStore, type ApprovalRecord } from "../../infra/governance/stores.js";
import { auditPrincipalOf, labelOf, systemContext, type GovernanceContext } from "../auth/principal.js";
import { AuditService } from "./audit.service.js";

// How long a request waits for the owner, and a granted approval for its action.
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

const viewOf = (a: ApprovalRecord, now: string): ApprovalView => {
  const { accountId: _account, ...rest } = a;
  return { ...rest, state: stateAt(a, now) };
};

const REFUSALS: Record<string, string> = {
  APPROVAL_CONSUMED: "This approval was already spent on its action: an approval is used once. The action is asked for, and approved, again.",
  APPROVAL_EXPIRED: "This approval ran out of time.",
  APPROVAL_NOT_GRANTED: "This approval was not granted.",
  FINGERPRINT_MISMATCH: "The action is no longer the one that was approved (its commit, branch or remote moved): it is asked for, and approved, again.",
};

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger("Approvals");
  private readonly executors = new Map<string, Executor>();

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ApprovalStore) private readonly store: ApprovalStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  registerExecutor(action: ActionKind, executor: Executor): void {
    this.executors.set(action, executor);
  }

  async list(accountId: string, o: { workspaceId?: string; action?: string; limit?: number } = {}): Promise<ApprovalView[]> {
    const now = new Date().toISOString();
    const out: ApprovalView[] = [];
    for (const a of await this.store.list(accountId, o)) out.push(viewOf(await this.expireIfDue(a, now), now));
    return out;
  }

  async view(accountId: string, id: string): Promise<ApprovalView> {
    const now = new Date().toISOString();
    return viewOf(await this.expireIfDue(await this.existing(accountId, id), now), now);
  }

  async pendingCount(accountId: string): Promise<number> {
    return this.store.pendingCount(accountId, new Date().toISOString());
  }

  // A request for the owner's approval of one action of the context's account; the open one when that very action was
  // already asked for.
  async request(ctx: GovernanceContext, ask: ApprovalAsk): Promise<ApprovalRecord> {
    const accountId = this.accountOf(ctx);
    const now = new Date().toISOString();
    return this.db.tx(async () => {
      const same = await this.store.byFingerprint(accountId, ask.fingerprint);
      if (askRefusal(same, ask.fingerprint, now) === "ALREADY_ASKED") return same.find((a) => ["pending", "granted"].includes(stateAt(a, now))) as ApprovalRecord;
      const record: ApprovalRecord = {
        id: `apr-${randomUUID()}`,
        accountId,
        action: ask.action,
        environment: ask.environment,
        fingerprint: ask.fingerprint,
        params: ask.params,
        summary: ask.summary,
        state: "pending",
        requestedAt: now,
        requestedBy: labelOf(ctx.principal),
        requestedByType: auditPrincipalOf(ctx.principal).principalType,
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
      await this.store.insert(record);
      await this.audit.record(ctx, { type: "approval.requested", outcome: "pending", accountId, decisionId: ask.decisionId, workspaceId: ask.workspaceId, agentId: ask.agentId, runId: ask.runId, data: { approvalId: record.id, action: ask.action, fingerprint: ask.fingerprint, expiresAt: record.expiresAt } });
      this.changed(accountId, record.id, "pending");
      return record;
    });
  }

  // The owner's decision on the fingerprint they read. A granted action with an executor is carried out at once -- its
  // approval spent first.
  async grant(ctx: GovernanceContext, id: string, body: unknown): Promise<ApprovalView> {
    const req = accepted(checkApprovalDecision(body));
    const accountId = this.accountOf(ctx);
    await this.decide(ctx, accountId, id, req.fingerprint, "granted");
    const approval = await this.existing(accountId, id);
    if (this.executors.has(approval.action)) await this.execute(ctx, id);
    return this.view(accountId, id);
  }

  async reject(ctx: GovernanceContext, id: string, body: unknown): Promise<ApprovalView> {
    const req = accepted(checkApprovalDecision(body));
    const accountId = this.accountOf(ctx);
    await this.decide(ctx, accountId, id, req.fingerprint, "rejected");
    return this.view(accountId, id);
  }

  private async decide(ctx: GovernanceContext, accountId: string, id: string, fingerprint: string, to: "granted" | "rejected"): Promise<void> {
    const now = new Date().toISOString();
    const decider = auditPrincipalOf(ctx.principal).principalType;
    const a = await this.expireIfDue(await this.existing(accountId, id), now);
    if (decider !== "human" || ctx.principal.kind !== "owner") {
      await this.audit.record(ctx, { type: "authz.denied", outcome: "refused", accountId, workspaceId: a.workspaceId, data: { action: "governance.approval.decide", route: `decide ${id}`, cause: "not_a_person" } });
      throw new ApiError(HttpStatus.FORBIDDEN, "decider_not_a_person", "Only the account's owner decides an approval: never an agent, never the run that asked.");
    }
    await this.db.tx(async () => {
      if (a.fingerprint !== fingerprint) throw conflict("fingerprint_mismatch", "This is not the action you read: read the approval again.");
      const refusal = decideRefusal(a, now, decider);
      if (refusal !== null) throw conflict(refusal.toLowerCase(), refusal === "APPROVAL_EXPIRED" ? "This request ran out of time: it is asked for again." : "This approval was already decided.");
      if (!(await this.store.transition(accountId, id, "pending", to, { decidedBy: labelOf(ctx.principal), decidedByType: "human", decidedAt: now }))) throw conflict("approval_decided", "This approval was already decided.");
      await this.audit.record(ctx, { type: to === "granted" ? "approval.granted" : "approval.rejected", outcome: to, accountId, decisionId: a.decisionId, workspaceId: a.workspaceId, agentId: a.agentId, runId: a.runId, data: { approvalId: id, fingerprint: a.fingerprint } });
      this.changed(accountId, id, to);
    });
  }

  // Spends the approval -- once, on the fingerprint of the action as it stands now -- then carries the action out.
  // Whoever presents it a second time, or for another action, is refused and recorded.
  async execute(ctx: GovernanceContext, id: string): Promise<ApprovalView> {
    const accountId = this.accountOf(ctx);
    const approval = await this.existing(accountId, id);
    const executor = this.executors.get(approval.action);
    if (executor === undefined) throw new ApiError(HttpStatus.CONFLICT, "no_executor", `Nothing in Orbit Web carries out ${approval.action}.`);
    let fingerprint: string;
    try {
      fingerprint = await executor.fingerprintNow(approval);
    } catch (err) {
      fingerprint = `unavailable:${err instanceof Error ? err.message.slice(0, 80) : "error"}`;
    }
    const consumed = await this.consume(ctx, accountId, id, fingerprint);
    const about = { accountId, decisionId: consumed.decisionId, workspaceId: consumed.workspaceId, agentId: consumed.agentId, runId: consumed.runId };
    await this.audit.record(ctx, { type: "protected.executing", outcome: "executing", ...about, data: { approvalId: id, action: consumed.action, fingerprint: consumed.fingerprint } });
    let result: ExecutionResult;
    try {
      result = await executor.run(ctx, consumed);
    } catch (err) {
      result = { ok: false, outcome: err instanceof Error ? err.message.slice(0, 300) : "failed" };
    }
    await this.store.setOutcome(accountId, id, result.outcome);
    await this.audit.record(ctx, { type: result.ok ? "protected.completed" : "protected.failed", outcome: result.ok ? "completed" : "failed", ...about, data: { approvalId: id, action: consumed.action, fingerprint: consumed.fingerprint, ...(result.ok ? {} : { cause: result.outcome }) } });
    this.changed(accountId, id, result.ok ? "completed" : "failed");
    if (!result.ok) this.logger.warn(`approval ${id}: ${result.outcome}`);
    return this.view(accountId, id);
  }

  private async consume(ctx: GovernanceContext, accountId: string, id: string, fingerprint: string): Promise<ApprovalRecord> {
    const now = new Date().toISOString();
    const outcome = await this.db.tx(async (): Promise<ApprovalRecord | { refused: string }> => {
      const a = await this.existing(accountId, id);
      const about = { accountId, decisionId: a.decisionId, workspaceId: a.workspaceId, agentId: a.agentId, runId: a.runId };
      const refusal = consumeRefusal(a, fingerprint, now);
      if (refusal !== null) {
        await this.audit.record(ctx, { type: "approval.consume.refused", outcome: "refused", ...about, data: { approvalId: id, fingerprint: a.fingerprint, cause: refusal } });
        return { refused: refusal };
      }
      if (!(await this.store.transition(accountId, id, "granted", "consumed", { consumedAt: now }))) {
        await this.audit.record(ctx, { type: "approval.consume.refused", outcome: "refused", ...about, data: { approvalId: id, fingerprint: a.fingerprint, cause: "APPROVAL_CONSUMED" } });
        return { refused: "APPROVAL_CONSUMED" };
      }
      await this.audit.record(ctx, { type: "approval.consumed", outcome: "consumed", ...about, data: { approvalId: id, fingerprint: a.fingerprint } });
      return { ...a, state: "consumed", consumedAt: now };
    });
    if ("refused" in outcome) throw new ApiError(HttpStatus.CONFLICT, outcome.refused.toLowerCase(), REFUSALS[outcome.refused] ?? "This approval cannot be spent.");
    return outcome;
  }

  // A pending or granted approval past its time is EXPIRED, and recorded so once.
  private async expireIfDue(a: ApprovalRecord, now: string): Promise<ApprovalRecord> {
    if (stateAt(a, now) !== "expired" || a.state === "expired") return a;
    return this.db.tx(async () => {
      if (await this.store.transition(a.accountId, a.id, a.state, "expired", {})) {
        await this.audit.record(systemContext("orbit-web", a.accountId), { type: "approval.expired", outcome: "expired", workspaceId: a.workspaceId, agentId: a.agentId, data: { approvalId: a.id } });
      }
      return { ...a, state: "expired" };
    });
  }

  private accountOf(ctx: GovernanceContext): string {
    if (ctx.accountId === null) throw new ApiError(HttpStatus.FORBIDDEN, "no_account", "An approval is an account's: this request is no account's.");
    return ctx.accountId;
  }

  private async existing(accountId: string, id: string): Promise<ApprovalRecord> {
    const a = await this.store.get(accountId, id);
    if (a === null) throw notFound("The approval");
    return a;
  }

  private changed(accountId: string, approvalId: string, state: string): void {
    this.bus.publishApp("approval.changed", { approvalId, state }, accountAudience(accountId));
  }
}
