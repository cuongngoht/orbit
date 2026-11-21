// GET /api/health: whether the API answers, the programs run, the plugin is present, the storage is writable and the
// DATABASE answers at this build's schema with pgvector enabled. It names no path, variable, address or account, so it
// is safe to leave open in token mode (the container's health check) and before the Claude sign-in.
import { Controller, Get, Inject, Injectable, Module, Res } from "@nestjs/common";
import type { DatabaseCheck, HealthReport } from "@orbit-web/contracts";
import type { Response } from "express";
import type { AppConfig } from "../../config/config.js";
import { Public } from "../auth/decorators.js";
import { storageProblems } from "../../config/data-dirs.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { DatabaseUnavailable, Db, pgCode } from "../../infra/db/db.js";
import { schemaState } from "../../infra/db/migrate.js";
import { MIGRATIONS } from "../../infra/db/migrations.js";
import { ToolchainService } from "./toolchain.service.js";

const LATEST_SCHEMA = Math.max(...MIGRATIONS.map((m) => m.version));

// What the database is now, said without its address, its user or its password.
export async function databaseCheck(db: Db): Promise<DatabaseCheck> {
  try {
    const state = await schemaState(db);
    const problems = [...(state.vector === null ? ["pgvector is not enabled"] : []), ...(state.version !== state.latest ? [`the schema is at version ${state.version}, this build needs ${state.latest}`] : [])];
    return { ok: problems.length === 0, detail: problems.length === 0 ? null : problems.join("; "), server: state.server, schema: state.version, latestSchema: state.latest, pgvector: state.vector };
  } catch (err) {
    const code = pgCode(err);
    const detail = err instanceof DatabaseUnavailable ? "PostgreSQL could not be reached" : `PostgreSQL could not be asked${code !== null ? ` (${code})` : ""}`;
    return { ok: false, detail, server: null, schema: null, latestSchema: LATEST_SCHEMA, pgvector: null };
  }
}

@Injectable()
export class HealthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ToolchainService) private readonly toolchain: ToolchainService,
    @Inject(Db) private readonly db: Db,
  ) {}

  async report(): Promise<HealthReport> {
    const [tools, database] = await Promise.all([this.toolchain.get(), databaseCheck(this.db)]);
    const problems = storageProblems(this.config.data);
    const storage = { ok: problems.length === 0, detail: problems.length === 0 ? null : problems.join("; ") };
    // The Azure CLI is optional (an image may be built without it): reported, never what makes the status degraded.
    const parts = [tools.claude, tools.gh, tools.git, tools.orbitPlugin, storage, database];
    return {
      status: parts.every((p) => p.ok) ? "ok" : "degraded",
      api: { ok: true, detail: null },
      claude: tools.claude,
      gh: tools.gh,
      git: tools.git,
      az: tools.az,
      python: tools.python,
      orbitPlugin: tools.orbitPlugin,
      storage,
      database,
    };
  }
}

@Controller("health")
@Public()
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
