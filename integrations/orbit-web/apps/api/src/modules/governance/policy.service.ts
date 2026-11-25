// THE POLICY DECISION POINT: the ACCOUNT's policy in effect (its last published revision) and the overrides that narrow it
// for one of its chats, research workspaces or employees, asked through governance-core's one deterministic function.
// Whose policy decides is the requester's own account -- an owner's, a run's -- never one a request names. A request
// names an action, a resource and an environment, never a role; a run's request is also said to be a chat's, a research
// session's or an employee's assignment's -- by its binding, never by the run. Every decision is an audit record on the
// account's chain, written BEFORE the caller acts on it, so an action whose decision could not be recorded does not happen.
import { Inject, Injectable } from "@nestjs/common";
import {
  ACTIONS,
  checkConstitution,
  checkDepartmentPolicy,
  checkOverlay,
  composeEmployeeModels,
  composeEmployeeNetwork,
  evaluate,
  type DepartmentPolicy,
  fingerprintOf,
  isActionKind,
  type Constitution,
  type EmployeeNetwork,
  type EnforcementScope,
  type Environment,
  type Evaluation,
  type GovernanceRequest,
  type Policy,
  type PolicyOverlay,
} from "@orbit-web/governance-core";
import { randomUUID } from "node:crypto";
import { DepartmentRevisionStore, OverrideStore, RevisionStore, sha256, type DepartmentRevisionRecord, type RevisionRecord } from "../../infra/governance/stores.js";
import { accountOf, type GovernanceContext, type Principal } from "../auth/principal.js";
import { AuditService } from "./audit.service.js";

export interface PolicyAsk {
  action: string;
  resource: string;
  environment?: Environment;
  // The chat, or the research workspace, the request is about (what an override targets). A run's own when absent.
  workspaceId?: string | null;
  researchWorkspaceId?: string | null;
  // The action's parameters, for its fingerprint (only those its row declares are bound).
  params?: Record<string, unknown>;
  scope: EnforcementScope;
  // Whether the principal holds the grant this action needs (a connector granted to this employee): established by the
  // caller outside the policy; "not_held" is a deny (NO_GRANT). Absent: no grant is part of this decision.
  grant?: "held" | "not_held";
}

export interface Decision extends Evaluation {
  decisionId: string;
  eventId: string | null;
  policyRevision: string | null;
  revision: number | null;
  fingerprint: string | null;
  // The employee network access of the revision that decided -- an employee's composed with its department's (its
  // limits are what its connection is held to); null when no policy is in effect.
  employeeNetwork: EmployeeNetwork | null;
  // The department policy revision that decided with the company's (an employee's request), or null.
  departmentRevision: string | null;
}

export interface Effective {
  record: RevisionRecord;
  constitution: Constitution;
}

export interface DepartmentEffective {
  record: DepartmentRevisionRecord;
  policy: DepartmentPolicy;
}

function requester(p: Principal): Pick<GovernanceRequest, "principalId" | "principalType"> {
  if (p.kind === "owner") return { principalId: `owner:${p.accountId}`, principalType: "human" };
  if (p.kind === "agent") return { principalId: p.binding.agentId, principalType: "agent" };
  if (p.kind === "system") return { principalId: p.id, principalType: "service" };
  // Nobody verified: never granted anything (evaluate denies NO_VERIFIED_IDENTITY). An agent's network is an agent's.
  return { principalId: null, principalType: p.agentNetwork ? "agent" : "human" };
}

const parsed = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

@Injectable()
export class PolicyService {
  constructor(
    @Inject(RevisionStore) private readonly revisions: RevisionStore,
    @Inject(DepartmentRevisionStore) private readonly departments: DepartmentRevisionStore,
    @Inject(OverrideStore) private readonly overrides: OverrideStore,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // The account's revision in effect. It was valid when it was published; one that no longer reads as valid governs
  // nothing (and every decision is then denied: NO_PUBLISHED_POLICY).
  async effective(accountId: string): Promise<Effective | null> {
    const record = await this.revisions.effective(accountId);
    if (record === null) return null;
    const checked = checkConstitution(parsed(record.document));
    return checked.ok ? { record, constitution: checked.value } : null;
  }

  // A department's policy in effect, as published (null: none -- its employees are held to the company's alone; one that
  // no longer reads as valid decides nothing either, and is shown as such where it is managed).
  async departmentEffective(accountId: string, departmentId: string): Promise<DepartmentEffective | null> {
    const record = await this.departments.effective(accountId, departmentId);
    if (record === null) return null;
    const checked = checkDepartmentPolicy(parsed(record.document));
    return checked.ok && checked.value.metadata.departmentId === departmentId ? { record, policy: checked.value } : null;
  }

  // Which models an employee of a department may run on now (null: any its connection's catalog offers).
  async employeeModels(accountId: string, departmentId: string | null): Promise<string[] | null> {
    const effective = await this.effective(accountId);
    if (effective === null) return null;
    const dept = departmentId === null ? null : await this.departmentEffective(accountId, departmentId);
    return composeEmployeeModels(effective.constitution, dept?.policy ?? null).allow;
  }

  // The account's overrides that still read as valid.
  async overrideList(accountId: string): Promise<PolicyOverlay[]> {
    return (await this.overrides.list(accountId)).flatMap((o) => {
      const checked = checkOverlay(parsed(o.document));
      return checked.ok ? [checked.value] : [];
    });
  }

  async policy(accountId: string, constitution?: Constitution | null): Promise<Policy> {
    const c = constitution !== undefined ? constitution : ((await this.effective(accountId))?.constitution ?? null);
    return { constitution: c, overlays: await this.overrideList(accountId) };
  }

  // A decision of the account's policy in effect, recorded on its chain. `principal` defaults to the context's; the
  // account is the principal's own (an anonymous caller's request is decided under no policy: denied).
  async decide(ctx: GovernanceContext, ask: PolicyAsk, principal: Principal = ctx.principal): Promise<Decision> {
    const accountId = accountOf(principal) ?? ctx.accountId;
    const effective = accountId === null ? null : await this.effective(accountId);
    const binding = principal.kind === "agent" ? principal.binding : null;
    const request: GovernanceRequest = {
      ...requester(principal),
      accountId: accountId ?? "none",
      workspaceId: ask.workspaceId !== undefined ? ask.workspaceId : binding?.resourceKind === "workspace" ? binding.resourceId : null,
      researchWorkspaceId: ask.researchWorkspaceId !== undefined ? ask.researchWorkspaceId : binding?.resourceKind === "research_workspace" ? binding.resourceId : null,
      action: ask.action,
      resource: ask.resource,
      environment: ask.environment ?? "local",
      ...(binding !== null ? { runKind: binding.kind, employeeId: binding.resourceKind === "employee" ? binding.resourceId : null } : {}),
      // An employee's attempt: its work, and the department whose CURRENT policy decides with the company's.
      ...(binding?.kind === "assignment" ? { assignmentId: binding.assignmentId ?? null, missionId: binding.missionId ?? null, departmentId: binding.departmentId ?? null } : {}),
    };
    const overlays = accountId === null ? [] : await this.overrideList(accountId);
    const dept = accountId !== null && request.departmentId !== undefined && request.departmentId !== null ? await this.departmentEffective(accountId, request.departmentId) : null;
    const evaluation = evaluate({ constitution: effective?.constitution ?? null, overlays, departments: dept === null ? [] : [dept.policy] }, request, ask.grant === undefined ? {} : { grant: ask.grant });
    const fingerprint = isActionKind(ask.action) ? fingerprintOf(ask.action, request.environment, ask.params ?? { [ACTIONS[ask.action].fingerprint[0] as string]: ask.resource }, sha256) : null;
    const decisionId = `dec-${randomUUID()}`;
    const policyRevision = effective?.record.id ?? null;
    const event = this.mustRecord(effective, evaluation, ask.action)
      ? await this.audit.record(
          { ...ctx, principal, accountId },
          {
            type: "policy.decision",
            outcome: evaluation.verdict,
            reasonCodes: evaluation.reasonCodes,
            decisionId,
            policyRevision,
            workspaceId: request.workspaceId ?? request.researchWorkspaceId,
            agentId: binding?.agentId ?? null,
            accountId,
            data: {
              action: ask.action,
              resource: ask.resource,
              environment: request.environment,
              enforcement: evaluation.enforcement,
              fingerprint,
              scope: ask.scope,
              matchedRules: evaluation.matchedRules.join(","),
              ...(binding?.kind === "assignment" ? { employeeId: request.employeeId ?? null, assignmentId: request.assignmentId ?? null, missionId: request.missionId ?? null, departmentId: request.departmentId ?? null, departmentRevision: dept?.record.id ?? null } : {}),
              ...(ask.grant !== undefined ? { grant: ask.grant } : {}),
            },
          },
        )
      : null;
    const employeeNetwork = effective === null ? null : composeEmployeeNetwork(effective.constitution, dept?.policy ?? null);
    return { ...evaluation, decisionId, eventId: event?.eventId ?? null, policyRevision, revision: effective?.record.revision ?? null, fingerprint, employeeNetwork, departmentRevision: dept?.record.id ?? null };
  }

  // A policy may let decisions that simply allow an ordinary action go unrecorded (obligations.auditDecisions
  // "non_allow"); a refusal, an approval asked for, and anything sensitive are always recorded.
  private mustRecord(effective: Effective | null, evaluation: Evaluation, action: string): boolean {
    if (effective === null || effective.constitution.obligations.auditDecisions === "all") return true;
    return evaluation.verdict !== "allow" || !isActionKind(action) || ACTIONS[action].sensitive;
  }
}
