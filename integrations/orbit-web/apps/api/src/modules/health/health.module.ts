// GET /api/health: whether the API answers, the programs run, the plugin is present and the storage is writable.
// It names no path, variable or account, so it is safe to leave open in token mode (the container's health check).
import { Controller, Get, Inject, Injectable, Module, Res } from "@nestjs/common";
import type { HealthReport } from "@orbit-web/contracts";
import type { Response } from "express";
import type { AppConfig } from "../../config/config.js";
import { storageProblems } from "../../config/data-dirs.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { ToolchainService } from "./toolchain.service.js";

@Injectable()
export class HealthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ToolchainService) private readonly toolchain: ToolchainService,
  ) {}

  async report(): Promise<HealthReport> {
    const tools = await this.toolchain.get();
    const problems = storageProblems(this.config.data);
    const storage = { ok: problems.length === 0, detail: problems.length === 0 ? null : problems.join("; ") };
    const parts = [tools.claude, tools.gh, tools.git, tools.orbitPlugin, storage];
    return {
      status: parts.every((p) => p.ok) ? "ok" : "degraded",
      api: { ok: true, detail: null },
      claude: tools.claude,
      gh: tools.gh,
      git: tools.git,
      orbitPlugin: tools.orbitPlugin,
      storage,
    };
  }
}

@Controller("health")
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  // 200 when everything is usable, 503 when something is not: the body says which.
  @Get()
  async get(@Res({ passthrough: true }) res: Response): Promise<HealthReport> {
    const report = await this.health.report();
    res.status(report.status === "ok" ? 200 : 503);
    return report;
  }
}

@Module({
  providers: [ToolchainService, HealthService],
  controllers: [HealthController],
  exports: [ToolchainService, HealthService],
})
export class HealthModule {}
