import { type DynamicModule, Module } from "@nestjs/common";
import type { AppConfig } from "./config/config.js";
import { CoreModule } from "./core/core.module.js";
import { AzureAuthModule } from "./modules/azure-auth/azure-auth.module.js";
import { ChangesModule } from "./modules/changes/changes.module.js";
import { ChatModule } from "./modules/chat/chat.module.js";
import { ClaudeAuthModule } from "./modules/claude-auth/claude-auth.module.js";
import { ClaudeRunnerModule } from "./modules/claude-runner/claude-runner.module.js";
import { GithubModule } from "./modules/github/github.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { OrbitModule } from "./modules/orbit/orbit.module.js";
import { RepositoriesModule } from "./modules/repositories/repositories.module.js";
import { SessionsModule } from "./modules/sessions/sessions.module.js";
import { SettingsModule } from "./modules/settings/settings.module.js";
import { SetupModule } from "./modules/setup/setup.module.js";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config),
        HealthModule,
        SetupModule,
        ClaudeAuthModule,
        GithubModule,
        AzureAuthModule,
        SettingsModule,
        RepositoriesModule,
        OrbitModule,
        ClaudeRunnerModule,
        ChangesModule,
        SessionsModule,
        ChatModule,
      ],
    };
  }
}
