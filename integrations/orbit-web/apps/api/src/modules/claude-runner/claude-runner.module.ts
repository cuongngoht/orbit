import { Module } from "@nestjs/common";
import { ProjectModule } from "../project/project.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { AutoModeService } from "./auto-mode.js";
import { ClaudeRunnerService } from "./claude-runner.service.js";
import { TranscriptProjection } from "./transcript.js";

@Module({
  imports: [SettingsModule, ProjectModule],
  providers: [ClaudeRunnerService, TranscriptProjection, AutoModeService],
  exports: [ClaudeRunnerService],
})
export class ClaudeRunnerModule {}
