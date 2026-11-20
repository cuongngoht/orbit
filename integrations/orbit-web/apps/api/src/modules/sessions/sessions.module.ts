import { Body, Controller, Delete, Get, HttpCode, Inject, Module, Param, Patch, Post } from "@nestjs/common";
import type { SessionDetail, SessionSummary, WorkBranches } from "@orbit-web/contracts";
import { AzureAuthModule } from "../azure-auth/azure-auth.module.js";
import { ChangesModule } from "../changes/changes.module.js";
import { ClaudeAuthModule } from "../claude-auth/claude-auth.module.js";
import { ClaudeRunnerModule } from "../claude-runner/claude-runner.module.js";
import { GithubModule } from "../github/github.module.js";
import { OrbitModule } from "../orbit/orbit.module.js";
import { ProjectModule } from "../project/project.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { SourcesModule } from "../sources/sources.module.js";
import { BranchService } from "./branch.service.js";
import { SessionDirectory } from "./session-directory.js";
import { SessionsService } from "./sessions.service.js";
import { WorkspaceService } from "./workspace.service.js";

@Controller("sessions")
export class SessionsController {
  constructor(
    @Inject(SessionsService) private readonly sessions: SessionsService,
    @Inject(BranchService) private readonly branches: BranchService,
  ) {}

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

  // The working branch (branch.service.ts): the branches a chat can work on, and moving it to one.
  @Get(":id/branches")
  workBranches(@Param("id") id: string): Promise<WorkBranches> {
    return this.branches.list(this.sessions.record(id));
  }

  @Post(":id/branch")
  @HttpCode(200)
  moveBranch(@Param("id") id: string, @Body() body: unknown): Promise<SessionSummary> {
    return this.branches.change(this.sessions.record(id), body);
  }

  @Delete(":id")
  @HttpCode(204)
  remove(@Param("id") id: string): void {
    this.sessions.delete(id);
  }
}

@Module({
  imports: [ClaudeAuthModule, GithubModule, AzureAuthModule, SourcesModule, ChangesModule, ClaudeRunnerModule, OrbitModule, ProjectModule, SettingsModule],
  providers: [SessionsService, WorkspaceService, BranchService, SessionDirectory],
  controllers: [SessionsController],
  exports: [SessionsService],
})
export class SessionsModule {}
