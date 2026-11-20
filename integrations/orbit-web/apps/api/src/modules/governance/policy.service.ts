// THE POLICY DECISION POINT: the Constitution in effect (the last published revision) and the overlays that narrow it,
// asked through governance-core's one deterministic function. Who asks is the principal Orbit Web established; a
// request names an action, a resource and an environment, never a role. Every decision is an audit record written
// BEFORE the caller acts on it, so an action whose decision could not be recorded does not happen.
import { Inject, Injectable } from "@nestjs/common";
import {
  ACTIONS,
  checkConstitution,
  checkOverlay,
  evaluate,
  fingerprintOf,
  isActionKind,
  type Constitution,
  type EnforcementScope,
  type Environment,
  type Evaluation,
  type GovernanceRequest,
  type Policy,
  type PolicyOverlay,
} from "@orbit-web/governance-core";
import { randomUUID } from "node:crypto";
import { OverlayStore, RevisionStore, sha256, type RevisionRecord } from "../../infra/governance/stores.js";
import { AuditService } from "./audit.service.js";
import type { GovernanceContext, Principal } from "./principal.js";

export interface PolicyAsk {
  action: string;
  resource: string;
  environment?: Environment;
  workspaceId?: string | null;
  agentId?: string | null;
  projectId?: string | null;
  // The action's parameters, for its fingerprint (only those its row declares are bound).
  params?: Record<string, unknown>;
  scope: EnforcementScope;
}

export interface Decision extends Evaluation {
  decisionId: string;
  eventId: string | null;
  policyRevision: string | null;
  revision: number | null;
  fingerprint: string | null;
}

export interface Effective {
  record: RevisionRecord;
  constitution: Constitution;
}

function requester(p: Principal): Pick<GovernanceRequest, "principalId" | "principalType"> {
  if (p.kind === "operator") return { principalId: p.operatorId, principalType: "human" };
  if (p.kind === "agent") return { principalId: p.binding.agentId, principalType: "agent" };
  if (p.kind === "system") return { principalId: p.id, principalType: "service" };
  // Nobody verified: never granted anything (evaluate denies NO_VERIFIED_IDENTITY). An agent's network is an agent's.
  return { principalId: null, principalType: p.agentNetwork ? "agent" : "human" };
}

@Injectable()
export class PolicyService {
  constructor(
    @Inject(RevisionStore) private readonly revisions: RevisionStore,
    @Inject(OverlayStore) private readonly overlays: OverlayStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // The revision in effect. It was valid when it was published; one that no longer reads as valid governs nothing.
  effective(): Effective | null {
    const record = this.revisions.effective();
    if (record === null) return null;
    const checked = checkConstitution(JSON.parse(record.document) as unknown);
    return checked.ok ? { record, constitution: checked.value } : null;
  }

  overlayList(): PolicyOverlay[] {
    return this.overlays.list().flatMap((o) => {
      const checked = checkOverlay(JSON.parse(o.document) as unknown);
      return checked.ok ? [checked.value] : [];
    });
  }

  policy(constitution: Constitution | null = this.effective()?.constitution ?? null): Policy {
    return { constitution, overlays: this.overlayList() };
  }

  // A decision of the policy in effect, recorded. `principal` defaults to the context's.
  decide(ctx: GovernanceContext, ask: PolicyAsk, principal: Principal = ctx.principal): Decision {
    const effective = this.effective();
    const binding = principal.kind === "agent" ? principal.binding : null;
    const request: GovernanceRequest = {
      ...requester(principal),
      organizationId: effective?.constitution.metadata.organizationId ?? this.audit.organizationId(),
      projectId: ask.projectId ?? null,
      workspaceId: ask.workspaceId !== undefined ? ask.workspaceId : (binding?.sessionId ?? null),
      agentId: ask.agentId !== undefined ? ask.agentId : (binding?.agentId ?? null),
      action: ask.action,
      resource: ask.resource,
      environment: ask.environment ?? "local",
    };
    const evaluation = evaluate(this.policy(effective?.constitution ?? null), request);
    const fingerprint = isActionKind(ask.action) ? fingerprintOf(ask.action, request.environment, ask.params ?? { [ACTIONS[ask.action].fingerprint[0] as string]: ask.resource }, sha256) : null;
    const decisionId = `dec-${randomUUID()}`;
    const policyRevision = effective?.record.id ?? null;
    const recorded = this.mustRecord(effective, evaluation, ask.action);
    const event = recorded
      ? this.audit.record(
          { ...ctx, principal },
          {
            type: "policy.decision",
            outcome: evaluation.verdict,
            reasonCodes: evaluation.reasonCodes,
            decisionId,
            policyRevision,
            workspaceId: request.workspaceId,
            agentId: request.agentId,
            data: { action: ask.action, resource: ask.resource, environment: request.environment, enforcement: evaluation.enforcement, fingerprint, scope: ask.scope, matchedRules: evaluation.matchedRules.join(",") },
          },
        )
      : null;
    return { ...evaluation, decisionId, eventId: event?.eventId ?? null, policyRevision, revision: effective?.record.revision ?? null, fingerprint };
  }

  // A Constitution may let decisions that simply allow an ordinary action go unrecorded (obligations.auditDecisions
  // "non_allow"); a refusal, an approval asked for, and anything sensitive are always recorded.
  private mustRecord(effective: Effective | null, evaluation: Evaluation, action: string): boolean {
    if (effective === null || effective.constitution.obligations.auditDecisions === "all") return true;
    return evaluation.verdict !== "allow" || !isActionKind(action) || ACTIONS[action].sensitive;
  }
}
