// What every application command of the office does around its domain work: it acts for the account of the session that
// asked (never an account a request names), is decided under that account's policy before anything changes, and leaves
// an audit record -- a refusal too, in a transaction of its own so it outlives the rollback of the refused change.
import { Inject, Injectable } from "@nestjs/common";
import type { EnforcementScope } from "@orbit-web/governance-core";
import { currentCorrelation, viewer } from "../../../common/request-scope.js";
import { Db } from "../../../infra/db/db.js";
import { contextOf, labelOf, type GovernanceContext, type Owner, type Principal } from "../../../modules/auth/principal.js";
import { AuditService } from "../../../modules/governance/audit.service.js";
import { PolicyService } from "../../../modules/governance/policy.service.js";
import { DomainError, refused } from "../domain.js";
import type { CommandContext } from "../infrastructure/outbox.js";

export interface Actor {
  owner: Owner | null;
  principal: Principal;
  command: CommandContext;
  governance: GovernanceContext;
}

// The person whose browser asked.
export function ownerActor(): Actor {
  const owner = viewer();
  const correlationId = currentCorrelation();
  return { owner, principal: owner, command: { orbitId: owner.accountId, actor: labelOf(owner), correlationId }, governance: contextOf(owner, correlationId) };
}

// Orbit Web itself, for an account (a worker, a scheduler, a consumer).
export function systemActor(orbitId: string, id: string, correlationId: string, causationId: string | null = null): Actor {
  const principal: Principal = { kind: "system", id, accountId: orbitId };
  return { owner: null, principal, command: { orbitId, actor: labelOf(principal), correlationId, causationId }, governance: contextOf(principal, correlationId) };
}

@Injectable()
export class OfficeGovernance {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // The account's policy decides the action (and records the decision); anything but allow refuses the command.
  async authorize(actor: Actor, action: string, resource: string, params: Record<string, unknown> = {}, scope: EnforcementScope = "ACCOUNT"): Promise<void> {
    const decision = await this.policy.decide(actor.governance, { action, resource, scope, params });
    if (decision.verdict === "allow") return;
    const why = decision.verdict === "require_approval" ? "needs an approval the office does not ask for yet" : `is not allowed (${decision.reasonCodes.join(", ")})`;
    throw refused("policy_denied", `The account's policy ${why}: ${action}. Decision ${decision.decisionId}.`, { decisionId: decision.decisionId, action });
  }

  async recorded(actor: Actor, command: string, aggregate: string, aggregateId: string, version: number, detail = ""): Promise<void> {
    await this.audit.record(actor.governance, { type: "office.command", outcome: "done", data: { command, aggregate, aggregateId, version, detail: detail.slice(0, 300) } });
  }

  // A person's look into what an employee keeps (Governance → Employee desks): what was looked at -- the folder or the
  // file, its size, the desk's version -- never what it holds.
  async looked(actor: Actor, look: { employeeId: string; path: string; kind: "dir" | "file"; bytes: number; deskVersion: number }): Promise<void> {
    await this.audit.record(actor.governance, { type: "office.desk.read", outcome: "done", data: { ...look } });
  }

  // Runs `work` in one transaction; when it is refused, the refusal is recorded in a transaction of its own.
  async command<T>(actor: Actor, name: string, aggregateId: string, work: () => Promise<T>): Promise<T> {
    try {
      return await this.db.tx(work);
    } catch (err) {
      if (err instanceof DomainError && err.code !== "not_found") {
        await this.db
          .tx(() => this.audit.record(actor.governance, { type: "office.refused", outcome: "refused", data: { command: name, aggregateId, cause: err.code } }))
          .catch(() => undefined);
      }
      throw err;
    }
  }
}
