// THE GOVERNANCE CONSOLE'S ROUTES -- the account owner's, every one (the auth guard holds each to a browser session of
// the account, and a change to that session's CSRF token). The account is ALWAYS the session's: no route, body or query
// names one, and another account's revision, approval or decision is simply not found.
//
//   GET  /api/governance/overview                           the account: its policy in effect, counts, isolation, audit
//   GET  /api/governance/policy                             the revision in effect, and every revision
//   GET  /api/governance/revisions/:id
//   POST /api/governance/revisions                          { document } | { from } | {}   a draft
//   PUT  /api/governance/revisions/:id                      { document, expectedDigest }
//   POST /api/governance/revisions/:id/validate
//   POST /api/governance/revisions/:id/publish              { digest, base, acknowledgedRisk }   the owner's confirmation
//   POST /api/governance/revisions/:id/discard              { digest }
//   POST /api/governance/simulate                           a decision asked, nothing recorded
//   GET  /api/governance/decisions?limit=&verdict=&workspace=
//   GET  /api/governance/approvals | /:id
//   POST /api/governance/approvals/:id/grant | reject       { fingerprint }
//   POST /api/governance/approvals/:id/execute              (a granted one, once)
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Put, Query, Req } from "@nestjs/common";
import type { ApprovalList, ApprovalView, DecisionList, DecisionView, GovernanceOverview, PolicyOverview, RevisionView, SimulateResult } from "@orbit-web/contracts";
import type { AuditEvent } from "@orbit-web/governance-core";
import type { Request } from "express";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { badRequest, notFound } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
import { AuditStore, OverrideStore, ResourceStore, RevisionStore, RunBindingStore } from "../../infra/governance/stores.js";
import { AccountsService } from "../auth/accounts.service.js";
import { PrincipalResolver } from "../auth/principals.js";
import { ApprovalService } from "./approvals.service.js";
import { AuditService } from "./audit.service.js";
import { FindingsService } from "./findings.service.js";
import { IsolationService } from "./isolation.service.js";
import { RevisionsService } from "./revisions.service.js";

export const decisionOf = (e: AuditEvent): DecisionView => ({
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

const VERDICTS = ["allow", "require_approval", "deny"];

@Controller("governance")
export class GovernanceController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(AccountsService) private readonly accounts: AccountsService,
    @Inject(RevisionsService) private readonly revisions: RevisionsService,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(AuditStore) private readonly auditStore: AuditStore,
    @Inject(FindingsService) private readonly findings: FindingsService,
    @Inject(IsolationService) private readonly isolation: IsolationService,
    @Inject(RevisionStore) private readonly revisionStore: RevisionStore,
    @Inject(OverrideStore) private readonly overrides: OverrideStore,
    @Inject(ResourceStore) private readonly resources: ResourceStore,
    @Inject(RunBindingStore) private readonly runs: RunBindingStore,
  ) {}

  @Get("overview")
  async overview(): Promise<GovernanceOverview> {
    const owner = viewer();
    const accountId = owner.accountId;
    const account = await this.accounts.account(accountId);
    const effective = await this.revisionStore.effective(accountId);
    const head = await this.auditStore.head(accountId);
    const live = (kind: "workspace" | "research_workspace") => this.resources.list(accountId, kind).then((rs) => rs.filter((r) => r.deletedAt === null).length);
    return {
      account: { id: accountId, displayName: account?.displayName ?? "", email: owner.email },
      deployment: this.config.governance.deployment,
      effective: effective === null ? null : { id: effective.id, revision: effective.revision as number, digest: effective.digest, publishedAt: effective.publishedAt as string, source: effective.source },
      counts: {
        workspaces: await live("workspace"),
        researchWorkspaces: await live("research_workspace"),
        runningRuns: (await this.runs.running(accountId)).length,
        pendingApprovals: await this.approvals.pendingCount(accountId),
        openFindings: await this.findings.openCount(accountId),
        draftRevisions: (await this.revisionStore.list(accountId)).filter((r) => r.state === "DRAFT" || r.state === "VALIDATED").length,
        overrides: (await this.overrides.list(accountId)).length,
      },
      isolation: await this.isolation.status(),
      audit: { count: await this.auditStore.count(accountId), head: head?.hash ?? null, lastVerification: this.audit.latestVerification(accountId) },
    };
  }

  // ---- the account's policy -------------------------------------------------------------------------------------------

  @Get("policy")
  policy(): Promise<PolicyOverview> {
    return this.revisions.overview(viewer().accountId);
  }

  @Get("revisions/:id")
  revision(@Param("id") id: string): Promise<RevisionView> {
    return this.revisions.view(viewer().accountId, id);
  }

  @Post("revisions")
  createRevision(@Req() req: Request, @Body() body: unknown): Promise<RevisionView> {
    return this.revisions.create(this.principals.context(req), body);
  }

  @Put("revisions/:id")
  updateRevision(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<RevisionView> {
    return this.revisions.update(this.principals.context(req), id, body);
  }

  @Post("revisions/:id/validate")
  @HttpCode(200)
  validate(@Req() req: Request, @Param("id") id: string): Promise<RevisionView> {
    return this.revisions.validate(this.principals.context(req), id);
  }

  @Post("revisions/:id/publish")
  @HttpCode(200)
  publish(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<RevisionView> {
    return this.revisions.publish(this.principals.context(req), id, body);
  }

  @Post("revisions/:id/discard")
  @HttpCode(200)
  discard(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<RevisionView> {
    return this.revisions.discard(this.principals.context(req), id, body);
  }

  @Post("simulate")
  @HttpCode(200)
  simulate(@Body() body: unknown): Promise<SimulateResult> {
    return this.revisions.simulate(viewer().accountId, body);
  }

  // ---- decisions and approvals ---------------------------------------------------------------------------------------------

  @Get("decisions")
  async decisions(@Query("limit") limit?: string, @Query("verdict") verdict?: string, @Query("workspace") workspace?: string): Promise<DecisionList> {
    const n = limit === undefined ? 100 : Number(limit);
    if (!Number.isInteger(n) || n < 1 || n > 500) throw badRequest("limit must be 1-500");
    if (verdict !== undefined && !VERDICTS.includes(verdict)) throw badRequest("verdict must be allow, require_approval or deny");
    if (workspace !== undefined && (workspace.length === 0 || workspace.length > 128)) throw badRequest("workspace must name a chat or a research workspace");
    const events = await this.auditStore.page(viewer().accountId, { limit: n, types: ["policy.decision"], ...(verdict !== undefined ? { outcome: verdict } : {}), ...(workspace !== undefined ? { workspaceId: workspace } : {}) });
    return { decisions: events.map(decisionOf) };
  }

  @Get("approvals")
  async approvalList(): Promise<ApprovalList> {
    return { approvals: await this.approvals.list(viewer().accountId) };
  }

  @Get("approvals/:id")
  approval(@Param("id") id: string): Promise<ApprovalView> {
    return this.approvals.view(viewer().accountId, id);
  }

  @Post("approvals/:id/grant")
  @HttpCode(200)
  grant(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<ApprovalView> {
    return this.approvals.grant(this.principals.context(req), id, body);
  }

  @Post("approvals/:id/reject")
  @HttpCode(200)
  rejectApproval(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<ApprovalView> {
    return this.approvals.reject(this.principals.context(req), id, body);
  }

  @Post("approvals/:id/execute")
  @HttpCode(200)
  async execute(@Req() req: Request, @Param("id") id: string): Promise<ApprovalView> {
    const ctx = this.principals.context(req);
    if (ctx.accountId === null) throw notFound("The approval");
    return this.approvals.execute(ctx, id);
  }
}
