// THE AGENT GATEWAY: the one door a run of an agent has into Orbit Web -- authenticated by that run's own token (minted
// when the run started, ended with it), never by anything else, and answering nothing but these:
//
//   GET  /api/agent/whoami                 the run's binding: its run, workspace, agent and policy revision
//   POST /api/agent/decisions              ask the Constitution in effect about an action { action, resource } -- recorded
//   POST /api/agent/push                   ask for the workspace's branch to be pushed { branch?, commit? }: a decision,
//                                          and a person's approval waiting; nothing is pushed by asking
//   GET  /api/agent/approvals/:id          one of THIS workspace's approvals
//   POST /api/agent/approvals/:id/execute  carry out a granted approval of THIS workspace, once -- a replay, or another
//                                          workspace's approval, is refused and recorded
//   POST /api/agent/proposals              hand in a DRAFT of the Constitution { document, note? } for people to consider
//
// Everything an agent asks here is decided as the agent (its registration, bound to the run), never as a person; it
// can never reach an operator's route (governance.guard.ts) and holds no role.
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { checkAgentDecision, checkAgentProposal, type AgentDecisionResult, type AgentProposalResult, type AgentPushResult, type AgentWhoAmI, type ApprovalView } from "@orbit-web/contracts";
import type { Request } from "express";
import { accepted, ApiError, notFound } from "../../common/errors.js";
import { SessionStore } from "../../infra/storage/stores.js";
import type { RunBinding } from "../../infra/governance/stores.js";
import { ApprovalService } from "../governance/approvals.service.js";
import { AuditService } from "../governance/audit.service.js";
import { ConstitutionService } from "../governance/constitution.service.js";
import { AgentGateway } from "../governance/decorators.js";
import type { GovernanceContext } from "../governance/principal.js";
import { PrincipalResolver } from "../governance/principals.js";
import { PolicyService } from "../governance/policy.service.js";
import { RegistryService } from "../governance/registry.service.js";
import { PushBroker } from "./push.broker.js";

@Controller("agent")
@AgentGateway()
export class AgentGatewayController {
  constructor(
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(RegistryService) private readonly registry: RegistryService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(ConstitutionService) private readonly constitution: ConstitutionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PushBroker) private readonly broker: PushBroker,
    @Inject(SessionStore) private readonly sessions: SessionStore,
  ) {}

  private bound(req: Request): { ctx: GovernanceContext; binding: RunBinding } {
    const ctx = this.principals.context(req);
    if (ctx.principal.kind !== "agent") throw new ApiError(HttpStatus.UNAUTHORIZED, "run_token_required", "The agent gateway answers a governed run's own token only.");
    return { ctx, binding: ctx.principal.binding };
  }

  @Get("whoami")
  whoami(@Req() req: Request): AgentWhoAmI {
    const { binding } = this.bound(req);
    return { runId: binding.runId, sessionId: binding.sessionId, workspaceId: binding.sessionId, agentId: binding.agentId, organizationId: binding.organizationId, policyRevision: binding.policyRevision, scope: this.registry.of(binding.sessionId).scope };
  }

  @Post("decisions")
  @HttpCode(200)
  decide(@Req() req: Request, @Body() body: unknown): AgentDecisionResult {
    const { ctx, binding } = this.bound(req);
    const ask = accepted(checkAgentDecision(body));
    const d = this.policy.decide(ctx, { action: ask.action, resource: ask.resource, scope: this.registry.of(binding.sessionId).scope, workspaceId: binding.sessionId, agentId: binding.agentId });
    return { decisionId: d.decisionId, verdict: d.verdict, reasonCodes: d.reasonCodes, enforcement: d.enforcement, policyRevision: d.policyRevision };
  }

  @Post("push")
  @HttpCode(200)
  async push(@Req() req: Request, @Body() body: unknown): Promise<AgentPushResult> {
    const { ctx, binding } = this.bound(req);
    const session = this.sessions.get(binding.sessionId);
    if (session === null) throw notFound("This run's chat");
    const { approval: _view, ...result } = await this.broker.request(ctx, session, body, this.registry.of(binding.sessionId).scope);
    return result;
  }

  @Get("approvals/:id")
  approval(@Req() req: Request, @Param("id") id: string): ApprovalView {
    const { ctx, binding } = this.bound(req);
    return this.own(ctx, binding, this.approvals.view(id), req);
  }

  @Post("approvals/:id/execute")
  @HttpCode(200)
  async execute(@Req() req: Request, @Param("id") id: string): Promise<ApprovalView> {
    const { ctx, binding } = this.bound(req);
    this.own(ctx, binding, this.approvals.view(id), req);
    return this.approvals.execute(ctx, id);
  }

  @Post("proposals")
  propose(@Req() req: Request, @Body() body: unknown): AgentProposalResult {
    const { ctx, binding } = this.bound(req);
    const ask = accepted(checkAgentProposal(body));
    const d = this.policy.decide(ctx, { action: "governance.policy.propose", resource: binding.organizationId, scope: this.registry.of(binding.sessionId).scope, workspaceId: binding.sessionId, params: { organization: binding.organizationId } });
    if (d.verdict !== "allow") throw new ApiError(HttpStatus.FORBIDDEN, "proposal_denied", `The Constitution in effect does not take drafts from this agent (${d.reasonCodes.join(", ")}).`);
    const draft = this.constitution.propose(ctx, ask.document);
    return { revisionId: draft.id, state: draft.state };
  }

  // An approval of another workspace is not this run's to read or to use: refused, and recorded as a reach across.
  private own(ctx: GovernanceContext, binding: RunBinding, approval: ApprovalView, req: Request): ApprovalView {
    if (approval.workspaceId === binding.sessionId) return approval;
    this.audit.record(ctx, { type: "boundary.violation", outcome: "refused", data: { kind: "cross_workspace", route: `${req.method} /api/agent/approvals`, target: approval.workspaceId ?? "none" } });
    throw new ApiError(HttpStatus.FORBIDDEN, "cross_workspace", "That approval is not this workspace's.");
  }
}
