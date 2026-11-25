// GET /api/setup/status: what Settings → System shows -- versions, the AI CLIs installed here (as each one's own
// `--version` says), both repository connectors, the system checks (the database and pgvector among them). The chat
// never waits on it. An account's own AI connections are GET /api/connections.
import { Controller, Get, Inject, Injectable, Module } from "@nestjs/common";
import type { SetupStatus } from "@orbit-web/contracts";
import { AzureAuthModule } from "../azure-auth/azure-auth.module.js";
import { AzureAuthService } from "../azure-auth/azure-auth.service.js";
import { ConnectionsModule } from "../connections/connections.module.js";
import { ConnectionProbe } from "../connections/probe.js";
import { GithubModule } from "../github/github.module.js";
import { GithubAuthService } from "../github/github-auth.service.js";
import { HealthModule, HealthService } from "../health/health.module.js";
import { ToolchainService } from "../health/toolchain.service.js";

@Injectable()
export class SetupService {
  constructor(
    @Inject(ToolchainService) private readonly toolchain: ToolchainService,
    @Inject(HealthService) private readonly health: HealthService,
    @Inject(ConnectionProbe) private readonly probe: ConnectionProbe,
    @Inject(GithubAuthService) private readonly github: GithubAuthService,
    @Inject(AzureAuthService) private readonly azure: AzureAuthService,
  ) {}

  async status(): Promise<SetupStatus> {
    const [tools, health, runtimes, github, azure] = await Promise.all([this.toolchain.get(), this.health.report(), this.probe.installations(), this.github.status(), this.azure.status()]);
    return { versions: tools.versions, runtimes, github, azure, health };
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
  imports: [HealthModule, ConnectionsModule, GithubModule, AzureAuthModule],
  providers: [SetupService],
  controllers: [SetupController],
  exports: [SetupService],
})
export class SetupModule {}
