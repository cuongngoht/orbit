// GET /api/setup/status: everything the first-run page shows -- versions, both accounts, the system checks -- and
// whether the chat workspace may open (both accounts connected).
import { Controller, Get, Inject, Injectable, Module } from "@nestjs/common";
import type { SetupStatus } from "@orbit-web/contracts";
import { ClaudeAuthModule } from "../claude-auth/claude-auth.module.js";
import { ClaudeAuthService } from "../claude-auth/claude-auth.service.js";
import { GithubModule } from "../github/github.module.js";
import { GithubAuthService } from "../github/github-auth.service.js";
import { HealthModule, HealthService } from "../health/health.module.js";
import { ToolchainService } from "../health/toolchain.service.js";

@Injectable()
export class SetupService {
  constructor(
    @Inject(ToolchainService) private readonly toolchain: ToolchainService,
    @Inject(HealthService) private readonly health: HealthService,
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(GithubAuthService) private readonly github: GithubAuthService,
  ) {}

  async status(): Promise<SetupStatus> {
    const [tools, health, claude, github] = await Promise.all([this.toolchain.get(), this.health.report(), this.claude.status(), this.github.status()]);
    return { versions: tools.versions, claude, github, health, ready: claude.state === "connected" && github.state === "connected" };
  }
}

@Controller("setup")
export class SetupController {
  constructor(@Inject(SetupService) private readonly setup: SetupService) {}

  @Get("status")
  status(): Promise<SetupStatus> {
    return this.setup.status();
  }
}

@Module({
  imports: [HealthModule, ClaudeAuthModule, GithubModule],
  providers: [SetupService],
  controllers: [SetupController],
  exports: [SetupService],
})
export class SetupModule {}
