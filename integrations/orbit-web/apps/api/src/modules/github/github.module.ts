import { Controller, Get, HttpCode, Inject, Module, Post, Req, Res } from "@nestjs/common";
import type { GitHubStatus, LoginSnapshot } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { openSse } from "../../infra/sse/sse.js";
import { GhGateway } from "./gh.gateway.js";
import { GithubAuthService } from "./github-auth.service.js";

@Controller("github")
export class GithubController {
  constructor(@Inject(GithubAuthService) private readonly github: GithubAuthService) {}

  @Get("status")
  status(): Promise<GitHubStatus> {
    return this.github.status();
  }

  @Post("login")
  @HttpCode(202)
  login(): LoginSnapshot {
    return this.github.login();
  }

  @Post("login/cancel")
  @HttpCode(200)
  cancel(): LoginSnapshot {
    return this.github.cancel();
  }

  @Get("login/events")
  events(@Req() req: Request, @Res() res: Response): void {
    let stop: () => void = () => undefined;
    const channel = openSse(req, res, () => stop());
    channel.send(this.github.flowSnapshot());
    stop = this.github.subscribe((s) => channel.send(s));
  }

  @Post("logout")
  @HttpCode(200)
  logout(): Promise<GitHubStatus> {
    return this.github.logout();
  }
}

@Module({
  providers: [GhGateway, GithubAuthService],
  controllers: [GithubController],
  exports: [GhGateway, GithubAuthService],
})
export class GithubModule {}
