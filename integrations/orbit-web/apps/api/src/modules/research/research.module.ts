// RESEARCH: workspaces of sources, notes and findings, and sessions that ask Claude questions answered only from passages
// the server retrieved from the sources a session selected -- with citations the server verified. Independent of
// repositories and of the chats' records; the account's own, like its chats (access.ts).
import { Inject, Injectable, Module, type OnModuleInit, type Provider } from "@nestjs/common";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { Database } from "../../infra/storage/database.js";
import { AccessModule } from "../access/access.module.js";
import { ClaudeAuthModule } from "../claude-auth/claude-auth.module.js";
import { ClaudeAuthService } from "../claude-auth/claude-auth.service.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { SettingsModule } from "../settings/settings.module.js";
import { ResearchAccess } from "./access.js";
import { ResearchEvidenceService } from "./evidence.service.js";
import { IngestionService, OBJECT_STORE } from "./ingestion/ingestion.service.js";
import { publicWebPolicy, URL_ADDRESS_POLICY } from "./ingestion/url-fetcher.js";
import { ResearchController } from "./research.controller.js";
import { FtsRetriever, RETRIEVER } from "./retrieval/retriever.js";
import { ResearchRunnerService } from "./runner/research-runner.service.js";
import { ResearchSessionsService } from "./sessions.service.js";
import { ResearchSourcesService } from "./sources.service.js";
import { ObjectStore } from "./sources/object-store.js";
import { EvidenceStore } from "./store/evidence.js";
import { ResearchRunStore, ResearchSessionStore } from "./store/sessions.js";
import { SourceStore } from "./store/sources.js";
import { WorkspaceStore } from "./store/workspaces.js";
import { ResearchStream } from "./stream.js";
import { ResearchViews } from "./views.js";
import { ResearchWorkspacesService } from "./workspaces.service.js";

const store = <T>(Store: new (db: Database) => T): Provider => ({ provide: Store, useFactory: (db: Database) => new Store(db), inject: [Database] });

// Signing out is refused while a research run answers for the account, as while a chat's run works for it.
@Injectable()
class ResearchSignOutCheck implements OnModuleInit {
  constructor(
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(ResearchRunnerService) private readonly runner: ResearchRunnerService,
  ) {}

  onModuleInit(): void {
    this.claude.workCheck(() => (this.runner.anyRunning() > 0 ? "Claude is still answering in a research session. Stop it before signing out." : null));
  }
}

@Module({
  imports: [AccessModule, ClaudeAuthModule, GovernanceModule, SettingsModule],
  providers: [
    store(WorkspaceStore),
    store(SourceStore),
    store(ResearchSessionStore),
    store(ResearchRunStore),
    store(EvidenceStore),
    { provide: OBJECT_STORE, useFactory: (config: AppConfig) => new ObjectStore(config.data.research), inject: [APP_CONFIG] },
    { provide: URL_ADDRESS_POLICY, useFactory: () => publicWebPolicy() },
    { provide: RETRIEVER, useClass: FtsRetriever },
    ResearchAccess,
    ResearchViews,
    ResearchStream,
    IngestionService,
    ResearchRunnerService,
    ResearchWorkspacesService,
    ResearchSourcesService,
    ResearchSessionsService,
    ResearchEvidenceService,
    ResearchSignOutCheck,
  ],
  controllers: [ResearchController],
})
export class ResearchModule {}
