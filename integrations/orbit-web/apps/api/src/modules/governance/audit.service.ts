// THE AUDIT RECORD, as the rest of Orbit Web writes and reads it. Writing is authoritative and comes FIRST: a record is
// sealed onto its ACCOUNT's hash chain and committed (infra/governance/stores.ts AuditStore.append), and only then is
// anything told -- the app stream's `governance.changed`, sent to that account alone, is a notification that something
// may be read again, never the evidence itself. A privileged action whose record cannot be written does not happen:
// callers write the record inside the same transaction as the change, or before the action, and let a failure stop them.
//
// Each account has a chain of its own; what concerns no account (a stranger refused at the gate, a check of the
// deployment) is on the deployment's chain, which the installation's terminal reads (cli/governance.ts).
//
// What a record may carry is the allow-list its type declares (governance-core AUDIT_EVENTS); a string is also masked
// by token shape before it is sealed, so a credential pasted somewhere never reaches the record -- and a NUL character,
// which the database cannot store, is replaced before the hash is taken over it, so what is hashed is what is kept.
import { Inject, Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { verifyChain, type AuditEvent, type AuditEventType } from "@orbit-web/governance-core";
import type { ChainVerification } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { accountAudience, EventBus } from "../../core/events/event-bus.js";
import { AuditStore, sha256 } from "../../infra/governance/stores.js";
import { redactSecrets } from "../../infra/security/redact.js";
import { auditPrincipalOf, systemContext, type GovernanceContext } from "../auth/principal.js";

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
  // The chain the record goes on, when it is not the context's own account (null: the deployment's).
  accountId?: string | null;
}

const NUL = "\u0000";

const clean = (v: string): string => redactSecrets(v.includes(NUL) ? v.split(NUL).join("�") : v);

const masked = (data: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === "string" ? clean(v) : v]));

const verificationOf = (events: readonly AuditEvent[]): ChainVerification => {
  const check = verifyChain(events, sha256);
  const checkedAt = new Date().toISOString();
  return check.ok
    ? { ok: true, count: check.count, head: check.head, brokenAt: null, eventId: null, problem: null, checkedAt }
    : { ok: false, count: check.count, head: null, brokenAt: check.brokenAt, eventId: check.eventId, problem: check.problem, checkedAt };
};

const chainName = (accountId: string | null): string => (accountId === null ? "the deployment's chain" : `account ${accountId}'s chain`);

@Injectable()
export class AuditService implements OnApplicationBootstrap {
  private readonly logger = new Logger("GovernanceAudit");
  // The last check of each chain (key: account id, or "" for the deployment's).
  private readonly lastVerification = new Map<string, ChainVerification>();

  constructor(
    @Inject(AuditStore) private readonly store: AuditStore,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  // At every start each chain is checked whole, and its head said in the log: a copy of the head kept anywhere else is
  // what shows later that nothing before it was rewritten.
  async onApplicationBootstrap(): Promise<void> {
    for (const accountId of await this.store.chains()) {
      const v = await this.verify(accountId);
      if (v.ok) this.logger.log(`audit record, ${chainName(accountId)}: ${v.count} record(s), the chain holds, head ${v.head ?? "none"}`);
      else {
        this.logger.error(`audit record, ${chainName(accountId)}: the chain does NOT hold at record ${v.brokenAt} (${v.problem})`);
        await this.record(systemContext("orbit-web", accountId), { type: "audit.integrity.failed", outcome: "failed", data: { brokenAt: v.brokenAt, cause: v.problem }, evidenceRefs: v.eventId ? [v.eventId] : [] });
      }
    }
  }

  // Writes one record onto its account's chain (inside the caller's transaction when there is one) and returns it as
  // sealed.
  async record(ctx: GovernanceContext, input: AuditInput): Promise<AuditEvent> {
    const accountId = input.accountId !== undefined ? input.accountId : ctx.accountId;
    const who = auditPrincipalOf(ctx.principal);
    const binding = ctx.principal.kind === "agent" ? ctx.principal.binding : null;
    if (accountId !== null && (await this.store.head(accountId)) === null) await this.store.openChain(accountId);
    const event = await this.store.append({
      eventId: input.eventId ?? `evt-${randomUUID()}`,
      eventType: input.type,
      // Exactly the string that is kept: what the database gives back is what the hash was taken over.
      occurredAt: new Date(input.occurredAt ?? Date.now()).toISOString(),
      accountId,
      principalId: clean(who.principalId),
      principalType: who.principalType,
      agentId: input.agentId !== undefined ? input.agentId : who.agentId,
      workspaceId: input.workspaceId !== undefined ? input.workspaceId : (binding?.resourceId ?? null),
      runId: input.runId !== undefined ? input.runId : (binding?.runId ?? null),
      correlationId: ctx.correlationId,
      causationId: input.causationId ?? null,
      policyRevision: input.policyRevision !== undefined ? input.policyRevision : (binding?.policyRevision ?? null),
      decisionId: input.decisionId ?? null,
      outcome: clean(input.outcome ?? "recorded"),
      reasonCodes: [...(input.reasonCodes ?? [])],
      evidenceRefs: [...(input.evidenceRefs ?? [])],
      data: masked(input.data ?? {}) as AuditEvent["data"],
    });
    if (accountId !== null) this.bus.publishApp("governance.changed", { area: "audit", id: event.eventId }, accountAudience(accountId));
    return event;
  }

  // A chain (an account's, or the deployment's: null), checked again from its first record.
  async verify(accountId: string | null): Promise<ChainVerification> {
    const v = verificationOf(await this.store.all(accountId));
    this.lastVerification.set(accountId ?? "", v);
    return v;
  }

  latestVerification(accountId: string | null): ChainVerification | null {
    return this.lastVerification.get(accountId ?? "") ?? null;
  }

  // The owner asked for the check: its result is itself a record, on the same chain.
  async verifyAndRecord(ctx: GovernanceContext, accountId: string): Promise<ChainVerification> {
    const v = await this.verify(accountId);
    if (v.ok) await this.record(ctx, { type: "audit.verified", outcome: "holds", accountId, data: { count: v.count, head: v.head } });
    else await this.record(ctx, { type: "audit.integrity.failed", outcome: "failed", accountId, data: { brokenAt: v.brokenAt, cause: v.problem }, evidenceRefs: v.eventId ? [v.eventId] : [] });
    return v;
  }
}
