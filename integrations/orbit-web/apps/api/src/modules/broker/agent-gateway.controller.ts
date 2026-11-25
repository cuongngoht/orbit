// THE AGENT GATEWAY: the one door a chat run's agent has into Orbit Web -- authenticated by that run's own token (minted
// when the run started, ended with it), never by anything else, and answering nothing but these:
//
//   GET  /api/agent/whoami                 the run's binding: its run, account, chat, agent and policy revision
//   POST /api/agent/decisions              ask the account's policy in effect about an action { action, resource } --
//                                          recorded
//   POST /api/agent/push                   ask for the chat's branch to be pushed { branch?, commit? }: a decision, and
//                                          the owner's approval waiting unless the policy simply allows it
//   GET  /api/agent/approvals/:id          one of THIS chat's approvals
//   POST /api/agent/approvals/:id/execute  carry out a granted approval of THIS chat, once -- a replay, or another chat's
//                                          approval, is refused and recorded
//   POST /api/agent/proposals              hand in a DRAFT of the account's policy { document, note? } for its owner
//
// Everything an agent asks here is decided as the agent (the run's binding: its account, its chat), never as a person;
// it can never reach an owner's route (the auth guard refuses it there and records it), decides no approval and holds no
// session. A research run's token is refused here outright (auth/principals.ts).
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Req } from "@nestjs/common";
import { checkAgentDecision, checkAgentProposal, type AgentDecisionResult, type AgentProposalResult, type AgentPushResult, type AgentWhoAmI, type ApprovalView } from "@orbit-web/contracts";
import type { Request } from "express";
import { accepted, ApiError, notFound } from "../../common/errors.js";
import { SessionStore } from "../../infra/storage/stores.js";
import type { RunBinding } from "../../infra/governance/stores.js";
import { AgentGateway } from "../auth/decorators.js";
import type { GovernanceContext } from "../auth/principal.js";
import { PrincipalResolver } from "../auth/principals.js";
import { ApprovalService } from "../governance/approvals.service.js";
import { AuditService } from "../governance/audit.service.js";
import { PolicyService } from "../governance/policy.service.js";
import { RevisionsService } from "../governance/revisions.service.js";
import { scopeOf } from "../governance/run-governance.service.js";
import { PushBroker } from "./push.broker.js";

@Controller("agent")
@AgentGateway()
export class AgentGatewayController {
  constructor(
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(RevisionsService) private readonly revisions: RevisionsService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(PushBroker) private readonly broker: PushBroker,
    @Inject(SessionStore) private readonly sessions: SessionStore,
  ) {}

  private bound(req: Request): { ctx: GovernanceContext; binding: RunBinding } {
    const ctx = this.principals.context(req);
    if (ctx.principal.kind !== "agent" || ctx.principal.binding.kind !== "chat") throw new ApiError(HttpStatus.UNAUTHORIZED, "run_token_required", "The agent gateway answers a running chat run's own token only.");
    return { ctx, binding: ctx.principal.binding };
  }

  @Get("whoami")
  whoami(@Req() req: Request): AgentWhoAmI {
    const { binding } = this.bound(req);
    return { runId: binding.runId, accountId: binding.accountId, kind: binding.kind as "chat" | "research", workspaceId: binding.resourceId, agentId: binding.agentId, policyRevision: binding.policyRevision, scope: scopeOf(binding) };
  }

  @Post("decisions")
  @HttpCode(200)
  async decide(@Req() req: Request, @Body() body: unknown): Promise<AgentDecisionResult> {
    const { ctx, binding } = this.bound(req);
    const ask = accepted(checkAgentDecision(body));
    const d = await this.policy.decide(ctx, { action: ask.action, resource: ask.resource, scope: scopeOf(binding), workspaceId: binding.resourceId });
    return { decisionId: d.decisionId, verdict: d.verdict, reasonCodes: d.reasonCodes, enforcement: d.enforcement, policyRevision: d.policyRevision };
  }

  @Post("push")
  @HttpCode(200)
  async push(@Req() req: Request, @Body() body: unknown): Promise<AgentPushResult> {
    const { ctx, binding } = this.bound(req);
    const session = await this.sessions.get(binding.resourceId);
    if (session === null || session.accountId !== binding.accountId) throw notFound("This run's chat");
    const { approval: _view, ...result } = await this.broker.request(ctx, session, body);
    return result;
  }

  @Get("approvals/:id")
  async approval(@Req() req: Request, @Param("id") id: string): Promise<ApprovalView> {
    const { ctx, binding } = this.bound(req);
    return this.own(ctx, binding, await this.viewOf(binding, id), req);
  }

  @Post("approvals/:id/execute")
  @HttpCode(200)
  async execute(@Req() req: Request, @Param("id") id: string): Promise<ApprovalView> {
    const { ctx, binding } = this.bound(req);
    await this.own(ctx, binding, await this.viewOf(binding, id), req);
    return this.approvals.execute(ctx, id);
  }

  @Post("proposals")
  async propose(@Req() req: Request, @Body() body: unknown): Promise<AgentProposalResult> {
    const { ctx, binding } = this.bound(req);
    const ask = accepted(checkAgentProposal(body));
    const d = await this.policy.decide(ctx, { action: "governance.policy.propose", resource: binding.accountId, scope: "ACCOUNT", params: { account: binding.accountId } });
    if (d.verdict !== "allow") throw new ApiError(HttpStatus.FORBIDDEN, "proposal_denied", `The account's policy in effect does not take drafts from this agent (${d.reasonCodes.join(", ")}).`);
    const draft = await this.revisions.propose(ctx, ask.document);
    return { revisionId: draft.id, state: draft.state };
  }

  // An approval of the run's own account (another account's is not found at all).
  private async viewOf(binding: RunBinding, id: string): Promise<ApprovalView> {
    return this.approvals.view(binding.accountId, id);
  }

  // An approval of another chat is not this run's to read or to use: refused, and recorded as a reach across.
  private async own(ctx: GovernanceContext, binding: RunBinding, approval: ApprovalView, req: Request): Promise<ApprovalView> {
    if (approval.workspaceId === binding.resourceId) return approval;
    await this.audit.record(ctx, { type: "boundary.violation", outcome: "refused", data: { kind: "cross_workspace", route: `${req.method} /api/agent/approvals`, target: approval.workspaceId ?? "none" } });
    throw new ApiError(HttpStatus.FORBIDDEN, "cross_workspace", "That approval is not this chat's.");
  }
}
