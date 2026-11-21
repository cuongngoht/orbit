// GET /api/setup/status: what Settings → System shows -- versions, this browser's Claude account and both connectors,
// the system checks (the database and pgvector among them). The chat never waits on it: once signed in, the chat is open.
import { Controller, Get, Inject, Injectable, Module } from "@nestjs/common";
import type { SetupStatus } from "@orbit-web/contracts";
import { viewer } from "../../common/request-scope.js";
import { AzureAuthModule } from "../azure-auth/azure-auth.module.js";
import { AzureAuthService } from "../azure-auth/azure-auth.service.js";
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
    @Inject(AzureAuthService) private readonly azure: AzureAuthService,
  ) {}

  async status(): Promise<SetupStatus> {
    const [tools, health, claude, github, azure] = await Promise.all([this.toolchain.get(), this.health.report(), this.claude.status(viewer(), null), this.github.status(), this.azure.status()]);
    return { versions: tools.versions, claude, github, azure, health };
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
  imports: [HealthModule, ClaudeAuthModule, GithubModule, AzureAuthModule],
  providers: [SetupService],
  controllers: [SetupController],
  exports: [SetupService],
})
export class SetupModule {}
