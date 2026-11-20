import { Module } from "@nestjs/common";
import { ProjectModule } from "../project/project.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { ClaudeRunnerService } from "./claude-runner.service.js";
import { TranscriptProjection } from "./transcript.js";

@Module({
  imports: [SettingsModule, ProjectModule],
  providers: [ClaudeRunnerService, TranscriptProjection],
  exports: [ClaudeRunnerService],
})
export class ClaudeRunnerModule {}
