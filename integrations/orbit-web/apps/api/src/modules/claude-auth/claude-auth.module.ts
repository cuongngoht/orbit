import { Body, Controller, Get, HttpCode, Inject, Module, Post, Req, Res } from "@nestjs/common";
import { checkClaudeLoginMode, checkLoginCode, type ClaudeStatus, type LoginSnapshot } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { accepted } from "../../common/errors.js";
import { openSse } from "../../infra/sse/sse.js";
import { ClaudeAuthService } from "./claude-auth.service.js";

@Controller("claude")
export class ClaudeAuthController {
  constructor(@Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService) {}

  @Get("status")
  status(): Promise<ClaudeStatus> {
    return this.claude.status();
  }

  @Post("login")
  @HttpCode(202)
  login(@Body() body: unknown): LoginSnapshot {
    return this.claude.login(accepted(checkClaudeLoginMode(body)));
  }

  @Post("login/code")
  @HttpCode(202)
  code(@Body() body: unknown): LoginSnapshot {
    return this.claude.submitCode(accepted(checkLoginCode(body)).code);
  }

  @Post("login/cancel")
  @HttpCode(200)
  cancel(): LoginSnapshot {
    return this.claude.cancel();
  }

  @Get("login/events")
  events(@Req() req: Request, @Res() res: Response): void {
    let stop: () => void = () => undefined;
    const channel = openSse(req, res, () => stop());
    channel.send(this.claude.flowSnapshot());
    stop = this.claude.subscribe((s) => channel.send(s));
  }

  @Post("logout")
  @HttpCode(200)
  logout(): Promise<ClaudeStatus> {
    return this.claude.logout();
  }
}

@Module({
  providers: [ClaudeAuthService],
  controllers: [ClaudeAuthController],
  exports: [ClaudeAuthService],
})
export class ClaudeAuthModule {}
