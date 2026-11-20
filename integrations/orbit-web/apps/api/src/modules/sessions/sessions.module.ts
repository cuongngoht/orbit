import { Body, Controller, Delete, Get, HttpCode, Inject, Module, Param, Patch, Post } from "@nestjs/common";
import type { SessionDetail, SessionSummary } from "@orbit-web/contracts";
import { AzureAuthModule } from "../azure-auth/azure-auth.module.js";
import { ChangesModule } from "../changes/changes.module.js";
import { ClaudeAuthModule } from "../claude-auth/claude-auth.module.js";
import { ClaudeRunnerModule } from "../claude-runner/claude-runner.module.js";
import { GithubModule } from "../github/github.module.js";
import { OrbitModule } from "../orbit/orbit.module.js";
import { ProjectModule } from "../project/project.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { SourcesModule } from "../sources/sources.module.js";
import { SessionDirectory } from "./session-directory.js";
import { SessionsService } from "./sessions.service.js";
import { WorkspaceService } from "./workspace.service.js";

@Controller("sessions")
export class SessionsController {
  constructor(@Inject(SessionsService) private readonly sessions: SessionsService) {}

  @Get()
  list(): SessionSummary[] {
    return this.sessions.list();
  }

  @Post()
  @HttpCode(201)
  create(@Body() body: unknown): Promise<SessionSummary> {
    return this.sessions.create(body);
  }

  @Get(":id")
  detail(@Param("id") id: string): SessionDetail {
    return this.sessions.detail(id);
  }

  @Patch(":id")
  update(@Param("id") id: string, @Body() body: unknown): SessionSummary {
    return this.sessions.update(id, body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id") id: string): void {
    this.sessions.delete(id);
  }
}

@Module({
  imports: [ClaudeAuthModule, GithubModule, AzureAuthModule, SourcesModule, ChangesModule, ClaudeRunnerModule, OrbitModule, ProjectModule, SettingsModule],
  providers: [SessionsService, WorkspaceService, SessionDirectory],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
