// THE AUDIT RECORD, as the rest of Orbit Web writes and reads it. Writing is authoritative and comes FIRST: a record is
// sealed onto the hash chain and committed (stores.ts AuditStore.append), and only then is anything told -- the app
// stream's `governance.changed` is a notification that something may be read again, never the evidence itself. A
// privileged action whose record cannot be written does not happen: callers write the record inside the same
// transaction as the change, or before the action, and let a failure stop them.
//
// What a record may carry is the allow-list its type declares (governance-core AUDIT_EVENTS); a string is also masked
// by token shape before it is sealed, so a credential pasted into a username never reaches the record.
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { verifyChain, type AuditEvent, type AuditEventType } from "@orbit-web/governance-core";
import type { ChainVerification } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { EventBus } from "../../core/events/event-bus.js";
import { GovernanceDatabase } from "../../infra/governance/governance-db.js";
import { AuditStore, OperatorStore, sha256 } from "../../infra/governance/stores.js";
import { redactSecrets } from "../../infra/security/redact.js";
import { auditPrincipalOf, type GovernanceContext } from "./principal.js";

export interface AuditInput {
  type: AuditEventType;
  outcome?: string;
  data?: Record<string, unknown>;
  reasonCodes?: readonly string[];
  evidenceRefs?: readonly string[];
  agentId?: string | null;
  workspaceId?: string | null;
  runId?: string | null;
  decisionId?: string | null;
  policyRevision?: string | null;
  causationId?: string | null;
  eventId?: string;
  occurredAt?: string;
}

const masked = (data: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === "string" ? redactSecrets(v) : v]));

@Injectable()
export class AuditService implements OnApplicationBootstrap {
  private readonly logger = new Logger("GovernanceAudit");
  private lastVerification: ChainVerification | null = null;

  constructor(
    @Inject(GovernanceDatabase) private readonly database: GovernanceDatabase,
    @Inject(AuditStore) private readonly store: AuditStore,
    @Inject(OperatorStore) private readonly operators: OperatorStore,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  // At every start the chain is checked whole, and its head said in the log: a copy of the head kept anywhere else is
  // what shows later that nothing before it was rewritten.
  onApplicationBootstrap(): void {
    const v = this.verify();
    if (v.ok) this.logger.log(`audit record: ${v.count} record(s), chain holds, head ${v.head ?? "none"}`);
    else {
      this.logger.error(`audit record: the chain does NOT hold at record ${v.brokenAt} (${v.problem})`);
      this.record({ correlationId: randomUUID(), principal: { kind: "system", id: "orbit-web" } }, { type: "audit.integrity.failed", outcome: "failed", data: { brokenAt: v.brokenAt, cause: v.problem }, evidenceRefs: v.eventId ? [v.eventId] : [] });
    }
  }

  organizationId(): string {
    return this.operators.organization()?.id ?? "uninitialized";
  }

  // Writes one record (inside the caller's transaction when there is one) and returns it as sealed.
  record(ctx: GovernanceContext, input: AuditInput): AuditEvent {
    const who = auditPrincipalOf(ctx.principal);
    const binding = ctx.principal.kind === "agent" ? ctx.principal.binding : null;
    const event = this.store.append({
      eventId: input.eventId ?? `evt-${randomUUID()}`,
      eventType: input.type,
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      organizationId: this.organizationId(),
      principalId: who.principalId,
      principalType: who.principalType,
      agentId: input.agentId !== undefined ? input.agentId : who.agentId,
      workspaceId: input.workspaceId !== undefined ? input.workspaceId : (binding?.sessionId ?? null),
      runId: input.runId !== undefined ? input.runId : (binding?.runId ?? null),
      correlationId: ctx.correlationId,
      causationId: input.causationId ?? null,
      policyRevision: input.policyRevision !== undefined ? input.policyRevision : (binding?.policyRevision ?? null),
      decisionId: input.decisionId ?? null,
      outcome: input.outcome ?? "recorded",
      reasonCodes: [...(input.reasonCodes ?? [])],
      evidenceRefs: [...(input.evidenceRefs ?? [])],
      data: masked(input.data ?? {}) as AuditEvent["data"],
    });
    this.database.afterCommit(() => this.bus.publishApp("governance.changed", { area: "audit", id: event.eventId }));
    return event;
  }

  // The whole chain, checked again from its first record.
  verify(): ChainVerification {
    const check = verifyChain(this.store.all(), sha256);
    const checkedAt = new Date().toISOString();
    this.lastVerification = check.ok
      ? { ok: true, count: check.count, head: check.head, brokenAt: null, eventId: null, problem: null, checkedAt }
      : { ok: false, count: check.count, head: null, brokenAt: check.brokenAt, eventId: check.eventId, problem: check.problem, checkedAt };
    return this.lastVerification;
  }

  latestVerification(): ChainVerification | null {
    return this.lastVerification;
  }

  // A person asked for the check: its result is itself a record.
  verifyAndRecord(ctx: GovernanceContext): ChainVerification {
    const v = this.verify();
    if (v.ok) this.record(ctx, { type: "audit.verified", outcome: "holds", data: { count: v.count, head: v.head } });
    else this.record(ctx, { type: "audit.integrity.failed", outcome: "failed", data: { brokenAt: v.brokenAt, cause: v.problem }, evidenceRefs: v.eventId ? [v.eventId] : [] });
    return v;
  }
}
