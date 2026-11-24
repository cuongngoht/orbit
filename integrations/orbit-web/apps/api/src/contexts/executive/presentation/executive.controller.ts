// CEO CHAT's routes (ADR 0062), behind the session like every office route, scoped by its account:
//
//   GET   /api/executive                                               what CEO Chat is now (answers without a company)
//   GET   /api/executive/conversations?cursor=                         the company's conversations, newest first
//   POST  /api/executive/conversations                (Idempotency-Key) { text } | { report } | { mission, expectedAssignee }
//   GET   /api/executive/conversations/:id                             its last page, open answers, missions, stream head
//   GET   /api/executive/conversations/:id/messages?before=<position>  an older page
//   POST  /api/executive/conversations/:id/messages       (Idempotency-Key) { text }: a message, answered by the CEO
//   POST  /api/executive/conversations/:id/turns/:turnId/stop          stop an answer
//   POST  /api/executive/conversations/:id/turns/:turnId/retry         ask again (the CEO in office now)
//   POST  /api/executive/conversations/:id/reports                     { kind }: Orbit's records, as a report
//   POST  /api/executive/conversations/:id/missions       (Idempotency-Key) { proposalMessageId, mission, expectedAssignee }
//   POST  /api/executive/conversations/:id/proposals/:messageId/dismiss set a proposal aside
//   GET   /api/executive/conversations/:id/events                      the conversation's stream (Last-Event-ID)
//
// Every route but the first answers 409 office_not_set_up when the account has no company.
import { Body, Controller, Get, HttpCode, HttpStatus, Inject, Param, Post, Query, Req, Res } from "@nestjs/common";
import type { ExecutiveConversationDetail, ExecutiveConversationList, ExecutiveMessage, ExecutiveMessagePage, ExecutiveState, ExecutiveTurn } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { viewer } from "../../../common/request-scope.js";
import { ownerActor } from "../../shared/application/commands.js";
import { sendStored } from "../../shared/presentation/http.js";
import { ExecutiveService } from "../application/executive.service.js";

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

@Controller("executive")
export class ExecutiveController {
  constructor(@Inject(ExecutiveService) private readonly executive: ExecutiveService) {}

  @Get()
  state(): Promise<ExecutiveState> {
    return this.executive.state(ownerActor().command.orbitId);
  }

  @Get("conversations")
  conversations(@Query("cursor") cursor: unknown): Promise<ExecutiveConversationList> {
    return this.executive.conversations(ownerActor().command.orbitId, str(cursor));
  }

  @Post("conversations")
  async start(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const actor = ownerActor();
    return sendStored(res, await this.executive.start(actor, viewer(), body, req.headers["idempotency-key"]));
  }

  @Get("conversations/:id")
  detail(@Param("id") id: string): Promise<ExecutiveConversationDetail> {
    return this.executive.detail(ownerActor().command.orbitId, id);
  }

  @Get("conversations/:id/messages")
  older(@Param("id") id: string, @Query("before") before: unknown): Promise<ExecutiveMessagePage> {
    return this.executive.older(ownerActor().command.orbitId, id, before);
  }

  @Post("conversations/:id/messages")
  async send(@Param("id") id: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const actor = ownerActor();
    return sendStored(res, await this.executive.send(actor, viewer(), id, body, req.headers["idempotency-key"]));
  }

  @Post("conversations/:id/turns/:turnId/stop")
  @HttpCode(HttpStatus.ACCEPTED)
  stop(@Param("id") id: string, @Param("turnId") turnId: string): Promise<{ turn: ExecutiveTurn }> {
    return this.executive.stop(ownerActor(), id, turnId);
  }

  @Post("conversations/:id/turns/:turnId/retry")
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@Param("id") id: string, @Param("turnId") turnId: string): Promise<{ turn: ExecutiveTurn }> {
    return this.executive.retry(ownerActor(), id, turnId);
  }

  @Post("conversations/:id/reports")
  @HttpCode(HttpStatus.CREATED)
  report(@Param("id") id: string, @Body() body: unknown): Promise<{ message: ExecutiveMessage }> {
    return this.executive.report(ownerActor(), id, body);
  }

  @Post("conversations/:id/missions")
  async mission(@Param("id") id: string, @Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<unknown> {
    const actor = ownerActor();
    return sendStored(res, await this.executive.giveMission(actor, viewer(), id, body, req.headers["idempotency-key"]));
  }

  @Post("conversations/:id/proposals/:messageId/dismiss")
  @HttpCode(HttpStatus.OK)
  dismiss(@Param("id") id: string, @Param("messageId") messageId: string): Promise<{ message: ExecutiveMessage }> {
    return this.executive.dismiss(ownerActor(), id, messageId);
  }

  @Get("conversations/:id/events")
  async events(@Param("id") id: string, @Req() req: Request, @Res() res: Response): Promise<void> {
    await this.executive.events(viewer(), id, req, res);
  }
}
