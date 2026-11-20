// GitHub CLI's sign-in, driven from Settings → Connectors. The flow's progress travels on the app stream
// (`connector.flow`, `connector.status`), not a stream of its own.
import { Controller, Get, HttpCode, Inject, Module, Post } from "@nestjs/common";
import type { GitHubStatus, LoginSnapshot } from "@orbit-web/contracts";
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
