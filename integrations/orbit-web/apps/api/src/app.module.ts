import { type DynamicModule, Module } from "@nestjs/common";
import type { AppConfig } from "./config/config.js";
import { CoreModule } from "./core/core.module.js";
import { AccessModule } from "./modules/access/access.module.js";
import { AuthModule } from "./modules/auth/auth.module.js";
import { AzureAuthModule } from "./modules/azure-auth/azure-auth.module.js";
import { BrokerModule } from "./modules/broker/broker.module.js";
import { ChangesModule } from "./modules/changes/changes.module.js";
import { ChatModule } from "./modules/chat/chat.module.js";
import { ConnectionsModule } from "./modules/connections/connections.module.js";
import { ClaudeRunnerModule } from "./modules/claude-runner/claude-runner.module.js";
import { GithubModule } from "./modules/github/github.module.js";
import { HealthModule } from "./modules/health/health.module.js";
import { EventsModule } from "./modules/events/events.module.js";
import { OrbitModule } from "./modules/orbit/orbit.module.js";
import { ProjectModule } from "./modules/project/project.module.js";
import { ImagesModule } from "./modules/images/images.module.js";
import { ResearchModule } from "./modules/research/research.module.js";
import { SessionsModule } from "./modules/sessions/sessions.module.js";
import { SettingsModule } from "./modules/settings/settings.module.js";
import { SetupModule } from "./modules/setup/setup.module.js";
import { ShareModule } from "./modules/share/share.module.js";
import { SourcesModule } from "./modules/sources/sources.module.js";

@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        CoreModule.forRoot(config),
        // Right after the core: its gate is the first every route passes.
        AuthModule,
        HealthModule,
        SetupModule,
        ConnectionsModule,
        AccessModule,
        GithubModule,
        AzureAuthModule,
        SettingsModule,
        SourcesModule,
        ProjectModule,
        EventsModule,
        OrbitModule,
        ClaudeRunnerModule,
        ChangesModule,
        SessionsModule,
        ChatModule,
        ShareModule,
        BrokerModule,
        ImagesModule,
        ResearchModule,
      ],
    };
  }
}
