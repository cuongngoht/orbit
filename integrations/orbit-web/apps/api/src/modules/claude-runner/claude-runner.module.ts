import { Module } from "@nestjs/common";
import { OrbitModule } from "../orbit/orbit.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { ClaudeRunnerService } from "./claude-runner.service.js";

@Module({
  imports: [SettingsModule, OrbitModule],
  providers: [ClaudeRunnerService],
  exports: [ClaudeRunnerService],
})
export class ClaudeRunnerModule {}
