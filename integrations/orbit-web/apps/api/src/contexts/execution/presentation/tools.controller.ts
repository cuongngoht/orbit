// THE TOOL ENDPOINT: the one door an employee's attempt has into Orbit Web -- reached only by the `orbit_tools` bridge
// in its model plane, authenticated by the attempt's own run token (an ASSIGNMENT binding: a chat's or a research run's
// token is refused here, and an assignment's token is refused at the chats' agent gateway). It answers two things:
//
//   POST /api/runtime/tools/list    the tools (their names, descriptions and argument schemas)
//   POST /api/runtime/tools/call    { name, arguments } → { text, isError }
//
// A tool's refusal (a bad path, the shell not granted, an attempt replaced) is the tool's ANSWER, with isError set, so
// the model can read it and correct itself; only a missing or foreign token is an HTTP error.
import { Body, Controller, HttpCode, HttpStatus, Inject, Post, Req } from "@nestjs/common";
import type { Request } from "express";
import { ApiError } from "../../../common/errors.js";
import { AgentGateway } from "../../../modules/auth/decorators.js";
import { PrincipalResolver } from "../../../modules/auth/principals.js";
import { DomainError } from "../../shared/domain.js";
import { ToolsService, type ToolAnswer, type ToolSpec } from "../application/tools.service.js";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

@Controller("runtime/tools")
@AgentGateway()
export class ToolsController {
  constructor(
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(ToolsService) private readonly tools: ToolsService,
  ) {}

  private runOf(req: Request): string {
    const ctx = this.principals.context(req);
    if (ctx.principal.kind !== "agent" || ctx.principal.binding.kind !== "assignment") throw new ApiError(HttpStatus.UNAUTHORIZED, "run_token_required", "The tool endpoint answers an employee's running attempt's own token only.");
    return ctx.principal.binding.runId;
  }

  @Post("list")
  @HttpCode(HttpStatus.OK)
  async list(@Req() req: Request): Promise<{ tools: ToolSpec[] }> {
    return { tools: await this.tools.list(this.runOf(req)) };
  }

  @Post("call")
  @HttpCode(HttpStatus.OK)
  async call(@Req() req: Request, @Body() body: unknown): Promise<ToolAnswer> {
    const runId = this.runOf(req);
    if (!isRecord(body) || typeof body.name !== "string" || body.name.length > 64) return { text: "A tool call names a tool.", isError: true };
    const args = isRecord(body.arguments) ? body.arguments : {};
    try {
      return await this.tools.call(runId, body.name, args);
    } catch (err) {
      if (err instanceof DomainError) return { text: err.message, isError: true };
      throw err;
    }
  }
}
