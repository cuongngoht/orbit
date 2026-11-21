// THE ACCOUNT'S RESOURCES, as its governance sees them -- two groups, the owner's own and nobody else's:
//
//   GET    /api/governance/workspaces                 its chats (Claude Code workspaces), deleted ones included
//   GET    /api/governance/workspaces/:id             one: the policy it inherits, its override, runs, approvals, activity
//   PUT    /api/governance/workspaces/:id/override    { rules, name? }   narrows the account's policy for it
//   DELETE /api/governance/workspaces/:id/override
//   GET    /api/governance/research                   its research workspaces, the same way
//   GET    /api/governance/research/:id
//   PUT    /api/governance/research/:id/override
//   DELETE /api/governance/research/:id/override
//
// A chat or research workspace of another account is not found: every read names the session's account.
import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Put, Req } from "@nestjs/common";
import type { ResourceGovernanceList, ResourceGovernanceSummary, ResourceGovernanceView } from "@orbit-web/contracts";
import type { Request } from "express";
import { notFound } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
import { AuditStore, ResourceStore, RevisionStore, RunBindingStore, type ResourceKind, type ResourceRecord } from "../../infra/governance/stores.js";
import { PrincipalResolver } from "../auth/principals.js";
import { ApprovalService } from "./approvals.service.js";
import { OverridesService } from "./overrides.service.js";

const ACTIVITY = 20;

@Controller("governance")
export class ResourcesController {
  constructor(
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(ResourceStore) private readonly resources: ResourceStore,
    @Inject(RunBindingStore) private readonly runs: RunBindingStore,
    @Inject(RevisionStore) private readonly revisions: RevisionStore,
    @Inject(AuditStore) private readonly audit: AuditStore,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(OverridesService) private readonly overrides: OverridesService,
  ) {}

  @Get("workspaces")
  workspaces(): Promise<ResourceGovernanceList> {
    return this.list("workspace");
  }

  @Get("workspaces/:id")
  workspace(@Param("id") id: string): Promise<ResourceGovernanceView> {
    return this.view("workspace", id);
  }

  @Put("workspaces/:id/override")
  async overrideWorkspace(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<ResourceGovernanceView> {
    await this.overrides.set(this.principals.context(req), "workspace", id, body);
    return this.view("workspace", id);
  }

  @Delete("workspaces/:id/override")
  @HttpCode(204)
  async releaseWorkspace(@Req() req: Request, @Param("id") id: string): Promise<void> {
    await this.overrides.remove(this.principals.context(req), "workspace", id);
  }

  @Get("research")
  research(): Promise<ResourceGovernanceList> {
    return this.list("research_workspace");
  }

  @Get("research/:id")
  researchWorkspace(@Param("id") id: string): Promise<ResourceGovernanceView> {
    return this.view("research_workspace", id);
  }

  @Put("research/:id/override")
  async overrideResearch(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<ResourceGovernanceView> {
    await this.overrides.set(this.principals.context(req), "research_workspace", id, body);
    return this.view("research_workspace", id);
  }

  @Delete("research/:id/override")
  @HttpCode(204)
  async releaseResearch(@Req() req: Request, @Param("id") id: string): Promise<void> {
    await this.overrides.remove(this.principals.context(req), "research_workspace", id);
  }

  private async list(kind: ResourceKind): Promise<ResourceGovernanceList> {
    const accountId = viewer().accountId;
    const running = await this.runs.running(accountId);
    const pending = (await this.approvals.list(accountId)).filter((a) => a.state === "pending");
    const overridden = new Set((await this.overrides.list(accountId)).filter((o) => o.kind === kind).map((o) => o.resourceId));
    const summary = (r: ResourceRecord): ResourceGovernanceSummary => ({
      kind,
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      deletedAt: r.deletedAt,
      overridden: overridden.has(r.id),
      runningRuns: running.filter((b) => b.resourceKind === kind && b.resourceId === r.id).length,
      pendingApprovals: pending.filter((a) => a.workspaceId === r.id).length,
    });
    return { resources: (await this.resources.list(accountId, kind)).map(summary) };
  }

  private async view(kind: ResourceKind, id: string): Promise<ResourceGovernanceView> {
    const accountId = viewer().accountId;
    const r = await this.resources.get(accountId, kind, id);
    if (r === null) throw notFound(kind === "workspace" ? "The chat" : "The research workspace");
    const effective = await this.revisions.effective(accountId);
    const override = await this.overrides.get(accountId, kind, id);
    const running = (await this.runs.running(accountId)).filter((b) => b.resourceKind === kind && b.resourceId === id).length;
    const pending = (await this.approvals.list(accountId, { workspaceId: id })).filter((a) => a.state === "pending").length;
    return {
      kind,
      id: r.id,
      title: r.title,
      createdAt: r.createdAt,
      deletedAt: r.deletedAt,
      overridden: override !== null,
      runningRuns: running,
      pendingApprovals: pending,
      policy: effective === null ? null : { revisionId: effective.id, revision: effective.revision, digest: effective.digest },
      override,
      activity: await this.audit.page(accountId, { limit: ACTIVITY, workspaceId: id }),
    };
  }
}
