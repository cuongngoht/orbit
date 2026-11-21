// THE OWNER'S PUSH of a chat's branch, to GitHub or Azure DevOps -- the same broker the agent asks (push.broker.ts), so
// the same decision of the account's policy, the same approval of the exact commit when it asks for one, the same push
// by Orbit Web with the source's sign-in:
//
//   POST /api/sessions/:id/push     { branch?, commit? }: the push, decided -- made at once where the policy allows it,
//                                   otherwise waiting for the owner's approval
//   GET  /api/sessions/:id/pushes   this chat's pushes (their approvals), newest first
//
// The account's OWNER's: pushing is a protected action, and the chat's repository is its account's. Somebody a chat was
// shared with opens it and talks in it, but does not push it; an agent never reaches this route (its gateway is its door).
// The approval itself is POST /api/governance/approvals/:id/grant, with the fingerprint the owner read.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import type { AgentPushResult, ApprovalList, ApprovalView } from "@orbit-web/contracts";
import type { Request } from "express";
import { forbidden, notFound } from "../../common/errors.js";
import { viewer } from "../../common/request-scope.js";
import { isSessionId } from "../../common/workspace-path.js";
import { SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { PrincipalResolver } from "../auth/principals.js";
import { ApprovalService } from "../governance/approvals.service.js";
import { PushBroker } from "./push.broker.js";

@Controller("sessions")
export class PushController {
  constructor(
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(PushBroker) private readonly broker: PushBroker,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(SessionStore) private readonly sessions: SessionStore,
  ) {}

  @Post(":id/push")
  @HttpCode(200)
  async push(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<AgentPushResult & { approval: ApprovalView | null }> {
    const session = await this.owned(id);
    return this.broker.request(this.principals.context(req), session, body ?? {});
  }

  @Get(":id/pushes")
  async pushes(@Param("id") id: string): Promise<ApprovalList> {
    const session = await this.owned(id);
    return { approvals: await this.approvals.list(session.accountId, { workspaceId: session.id, action: "repository.push" }) };
  }

  // The chat, when it is the session's account's own (a chat shared with this account is not its to push).
  private async owned(id: string): Promise<SessionRecord> {
    const session = isSessionId(id) ? await this.sessions.get(id) : null;
    if (session === null) throw notFound("Session");
    if (session.accountId !== viewer().accountId) throw forbidden("owner_only", "Only the account that owns this chat pushes it.");
    return session;
  }
}
