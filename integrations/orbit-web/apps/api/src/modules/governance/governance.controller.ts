// THE GOVERNANCE CONSOLE'S ROUTES (each says the one permission it needs; the global gate enforces it):
//
//   GET  /api/governance/overview                                 governance.read
//   GET  /api/governance/constitution                             governance.read   the revision in effect, and all
//   GET  /api/governance/revisions/:id                            governance.read
//   POST /api/governance/revisions                                constitution.edit  { document } | { from } | {}
//   PUT  /api/governance/revisions/:id                            constitution.edit  { document, expectedDigest }
//   POST /api/governance/revisions/:id/validate                   constitution.edit
//   POST /api/governance/revisions/:id/request-approval           constitution.edit
//   POST /api/governance/revisions/:id/withdraw                   constitution.edit
//   POST /api/governance/revisions/:id/approve | reject           constitution.approve  { digest }
//   POST /api/governance/revisions/:id/publish                    constitution.publish  { digest }
//   POST /api/governance/simulate                                 governance.read   a decision asked, nothing recorded
//   GET  /api/governance/overlays                                 governance.read
//   PUT  /api/governance/overlays                                 constitution.publish  { overlay }
//   DELETE /api/governance/overlays/:level/:target                constitution.publish
//   GET  /api/governance/agents                                   governance.read
//   POST /api/governance/agents                                   agents.manage     { name }
//   POST /api/governance/agents/:id/suspend | reinstate           agents.manage
//   GET  /api/governance/workspaces                               governance.read
//   PUT  /api/governance/workspaces/:sessionId                    workspaces.govern  { agentId, profile }
//   DELETE /api/governance/workspaces/:sessionId                  agents.manage     (releasing loosens: an admin's)
//   GET  /api/governance/decisions?limit=&verdict=&workspace=     audit.read
//   GET  /api/governance/approvals | /:id                         approvals.read
//   POST /api/governance/approvals/:id/grant | reject             approvals.decide  { fingerprint }
//   POST /api/governance/approvals/:id/execute                    approvals.decide  (a granted one, once)
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type {
  AgentList,
  AgentView,
  ApprovalList,
  ApprovalView,
  ConstitutionOverview,
  DecisionList,
  DecisionView,
  GovernanceOverview,
  OverlayList,
  RevisionView,
  SimulateResult,
  WorkspaceGovernanceView,
  WorkspaceList,
} from "@orbit-web/contracts";
import type { AuditEvent } from "@orbit-web/governance-core";
import type { Request } from "express";
import { badRequest } from "../../common/errors.js";
import { AgentStore, ApprovalStore, AuditStore, GovernedWorkspaceStore, OperatorStore, RevisionStore } from "../../infra/governance/stores.js";
import { ApprovalService } from "./approvals.service.js";
import { AuditService } from "./audit.service.js";
import { ConstitutionService } from "./constitution.service.js";
import { RequirePermission } from "./decorators.js";
import { FindingsService } from "./findings.service.js";
import { IsolationService } from "./isolation.service.js";
import { PrincipalResolver } from "./principals.js";
import { RegistryService } from "./registry.service.js";

const decisionOf = (e: AuditEvent): DecisionView => ({
  decisionId: e.decisionId ?? e.eventId,
  eventId: e.eventId,
  at: e.occurredAt,
  principalType: e.principalType,
  principalId: e.principalId,
  agentId: e.agentId,
  workspaceId: e.workspaceId,
  runId: e.runId,
  action: String(e.data.action ?? ""),
  resource: String(e.data.resource ?? ""),
  environment: String(e.data.environment ?? ""),
  verdict: e.outcome,
  enforcement: String(e.data.enforcement ?? ""),
  policyRevision: e.policyRevision,
  matchedRules: typeof e.data.matchedRules === "string" && e.data.matchedRules.length > 0 ? e.data.matchedRules.split(",") : [],
  reasonCodes: e.reasonCodes,
  fingerprint: typeof e.data.fingerprint === "string" ? e.data.fingerprint : null,
  scope: typeof e.data.scope === "string" ? e.data.scope : null,
});

@Controller("governance")
export class GovernanceController {
  constructor(
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(ConstitutionService) private readonly constitution: ConstitutionService,
    @Inject(RegistryService) private readonly registry: RegistryService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuditStore) private readonly auditStore: AuditStore,
    @Inject(FindingsService) private readonly findings: FindingsService,
    @Inject(IsolationService) private readonly isolation: IsolationService,
    @Inject(OperatorStore) private readonly operators: OperatorStore,
    @Inject(RevisionStore) private readonly revisions: RevisionStore,
    @Inject(AgentStore) private readonly agents: AgentStore,
    @Inject(GovernedWorkspaceStore) private readonly governed: GovernedWorkspaceStore,
    @Inject(ApprovalStore) private readonly approvalStore: ApprovalStore,
  ) {}

  @Get("overview")
  @RequirePermission("governance.read")
  overview(): GovernanceOverview {
    const org = this.operators.organization();
    const effective = this.revisions.effective();
    const head = this.auditStore.head();
    return {
      organization: { id: org?.id ?? "uninitialized", name: org?.name ?? "" },
      effective: effective === null ? null : { id: effective.id, revision: effective.revision as number, digest: effective.digest, publishedAt: effective.publishedAt as string },
      counts: {
        operators: this.operators.list().filter((o) => o.status === "active").length,
        agents: this.agents.list().filter((a) => a.status === "active").length,
        governedWorkspaces: this.governed.list().length,
        pendingApprovals: this.approvalStore.pendingCount(new Date().toISOString()),
        openFindings: this.findings.openCount(),
        revisionsInReview: this.revisions.list().filter((r) => r.state === "PENDING_APPROVAL" || r.state === "APPROVED").length,
      },
      isolation: this.isolation.status(),
      audit: { count: this.auditStore.count(), head: head?.hash ?? null, lastVerification: this.audit.latestVerification() },
    };
  }

  // ---- the Constitution -----------------------------------------------------------------------------------------------

  @Get("constitution")
  @RequirePermission("governance.read")
  constitutionOverview(): ConstitutionOverview {
    return this.constitution.overview();
  }

  @Get("revisions/:id")
  @RequirePermission("governance.read")
  revision(@Param("id") id: string): RevisionView {
    return this.constitution.view(id);
  }

  @Post("revisions")
  @RequirePermission("constitution.edit")
  createRevision(@Req() req: Request, @Body() body: unknown): RevisionView {
    return this.constitution.create(this.principals.context(req), body);
  }

  @Put("revisions/:id")
  @RequirePermission("constitution.edit")
  updateRevision(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): RevisionView {
    return this.constitution.update(this.principals.context(req), id, body);
  }

  @Post("revisions/:id/validate")
  @RequirePermission("constitution.edit")
  @HttpCode(200)
  validate(@Req() req: Request, @Param("id") id: string): RevisionView {
    return this.constitution.validate(this.principals.context(req), id);
  }

  @Post("revisions/:id/request-approval")
  @RequirePermission("constitution.edit")
  @HttpCode(200)
  requestApproval(@Req() req: Request, @Param("id") id: string): RevisionView {
    return this.constitution.requestApproval(this.principals.context(req), id);
  }

  @Post("revisions/:id/withdraw")
  @RequirePermission("constitution.edit")
  @HttpCode(200)
  withdraw(@Req() req: Request, @Param("id") id: string): RevisionView {
    return this.constitution.withdraw(this.principals.context(req), id);
  }

  @Post("revisions/:id/approve")
  @RequirePermission("constitution.approve")
  @HttpCode(200)
  approve(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): RevisionView {
    return this.constitution.approve(this.principals.context(req), id, body);
  }

  @Post("revisions/:id/reject")
  @RequirePermission("constitution.approve")
  @HttpCode(200)
  reject(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): RevisionView {
    return this.constitution.reject(this.principals.context(req), id, body);
  }

  @Post("revisions/:id/publish")
  @RequirePermission("constitution.publish")
  @HttpCode(200)
  publish(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): RevisionView {
    return this.constitution.publish(this.principals.context(req), id, body);
  }

  @Post("simulate")
  @RequirePermission("governance.read")
  @HttpCode(200)
  simulate(@Body() body: unknown): SimulateResult {
    return this.constitution.simulate(body);
  }

  // ---- overlays ------------------------------------------------------------------------------------------------------

  @Get("overlays")
  @RequirePermission("governance.read")
  overlays(): OverlayList {
    return this.registry.overlayList();
  }

  @Put("overlays")
  @RequirePermission("constitution.publish")
  setOverlay(@Req() req: Request, @Body() body: unknown) {
    return this.registry.setOverlay(this.principals.context(req), body);
  }

  @Delete("overlays/:level/:target")
  @RequirePermission("constitution.publish")
  @HttpCode(204)
  removeOverlay(@Req() req: Request, @Param("level") level: string, @Param("target") target: string): void {
    this.registry.removeOverlay(this.principals.context(req), level, target);
  }

  // ---- agents and workspaces ---------------------------------------------------------------------------------------------

  @Get("agents")
  @RequirePermission("governance.read")
  agentList(): AgentList {
    return { agents: this.registry.agentList() };
  }

  @Post("agents")
  @RequirePermission("agents.manage")
  register(@Req() req: Request, @Body() body: unknown): AgentView {
    return this.registry.register(this.principals.context(req), body);
  }

  @Post("agents/:id/suspend")
  @RequirePermission("agents.manage")
  @HttpCode(200)
  suspendAgent(@Req() req: Request, @Param("id") id: string): AgentView {
    return this.registry.setAgentStatus(this.principals.context(req), id, "suspended");
  }

  @Post("agents/:id/reinstate")
  @RequirePermission("agents.manage")
  @HttpCode(200)
  reinstateAgent(@Req() req: Request, @Param("id") id: string): AgentView {
    return this.registry.setAgentStatus(this.principals.context(req), id, "active");
  }

  @Get("workspaces")
  @RequirePermission("governance.read")
  workspaces(): WorkspaceList {
    return { workspaces: this.registry.workspaceList() };
  }

  @Put("workspaces/:sessionId")
  @RequirePermission("workspaces.govern")
  govern(@Req() req: Request, @Param("sessionId") sessionId: string, @Body() body: unknown): WorkspaceGovernanceView {
    return this.registry.govern(this.principals.context(req), sessionId, body);
  }

  @Delete("workspaces/:sessionId")
  @RequirePermission("agents.manage")
  @HttpCode(204)
  release(@Req() req: Request, @Param("sessionId") sessionId: string): void {
    this.registry.release(this.principals.context(req), sessionId);
  }

  // ---- decisions and approvals ---------------------------------------------------------------------------------------------

  @Get("decisions")
  @RequirePermission("audit.read")
  decisions(@Query("limit") limit?: string, @Query("verdict") verdict?: string, @Query("workspace") workspace?: string): DecisionList {
    const n = limit === undefined ? 100 : Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw badRequest("limit must be 1-500");
    const events = this.auditStore.page({ limit: verdict === undefined && workspace === undefined ? n : 2000, types: ["policy.decision"] });
    const kept = events.filter((e) => (verdict === undefined || e.outcome === verdict) && (workspace === undefined || e.workspaceId === workspace));
    return { decisions: kept.slice(0, n).map(decisionOf) };
  }

  @Get("approvals")
  @RequirePermission("approvals.read")
  approvalList(): ApprovalList {
    return { approvals: this.approvals.list() };
  }

  @Get("approvals/:id")
  @RequirePermission("approvals.read")
  approval(@Param("id") id: string): ApprovalView {
    return this.approvals.view(id);
  }

  @Post("approvals/:id/grant")
  @RequirePermission("approvals.decide")
  @HttpCode(200)
  grant(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<ApprovalView> {
    return this.approvals.grant(this.principals.context(req), id, body);
  }

  @Post("approvals/:id/reject")
  @RequirePermission("approvals.decide")
  @HttpCode(200)
  rejectApproval(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): ApprovalView {
    return this.approvals.reject(this.principals.context(req), id, body);
  }

  @Post("approvals/:id/execute")
  @RequirePermission("approvals.decide")
  @HttpCode(200)
  execute(@Req() req: Request, @Param("id") id: string): Promise<ApprovalView> {
    return this.approvals.execute(this.principals.context(req), id);
  }
}
