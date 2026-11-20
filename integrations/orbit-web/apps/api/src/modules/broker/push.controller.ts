// A PERSON'S PUSH of a chat's branch, to GitHub or Azure DevOps -- the same broker the agent asks (push.broker.ts), so
// the same decision, the same approval of the exact commit, the same push by Orbit Web with the source's sign-in:
//
//   POST /api/sessions/:id/push     an operator asks { branch?, commit? }: the push, decided and waiting for approval
//   GET  /api/sessions/:id/pushes   this chat's pushes (their approvals), newest first
//
// An operator because pushing is a protected action and the API is reachable from the agent's shell too: a request
// that is not a verified person's is never one. The approval itself is POST /api/governance/approvals/:id/grant
// (approvals.decide), with the fingerprint the person read.
import { Body, Controller, Get, HttpCode, Inject, Param, Post, Req } from "@nestjs/common";
import { isSessionId } from "../../common/workspace-path.js";
import type { AgentPushResult, ApprovalList, ApprovalView } from "@orbit-web/contracts";
import type { Request } from "express";
import { notFound } from "../../common/errors.js";
import { SessionStore } from "../../infra/storage/stores.js";
import { ApprovalService } from "../governance/approvals.service.js";
import { OperatorOnly } from "../governance/decorators.js";
import { PrincipalResolver } from "../governance/principals.js";
import { RegistryService } from "../governance/registry.service.js";
import { PushBroker } from "./push.broker.js";

@Controller("sessions")
export class PushController {
  constructor(
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(PushBroker) private readonly broker: PushBroker,
    @Inject(ApprovalService) private readonly approvals: ApprovalService,
    @Inject(RegistryService) private readonly registry: RegistryService,
    @Inject(SessionStore) private readonly sessions: SessionStore,
  ) {}

  @Post(":id/push")
  @OperatorOnly()
  @HttpCode(200)
  push(@Req() req: Request, @Param("id") id: string, @Body() body: unknown): Promise<AgentPushResult & { approval: ApprovalView | null }> {
    const session = isSessionId(id) ? this.sessions.get(id) : null;
    if (session === null) throw notFound("Session");
    return this.broker.request(this.principals.context(req), session, body ?? {}, this.registry.of(id).scope);
  }

  @Get(":id/pushes")
  @OperatorOnly()
  pushes(@Param("id") id: string): ApprovalList {
    return { approvals: this.approvals.list().filter((a) => a.workspaceId === id && a.action === "repository.push") };
  }
}
