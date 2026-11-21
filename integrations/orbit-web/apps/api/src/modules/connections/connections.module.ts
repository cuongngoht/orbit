// THE CONNECTIONS CONTEXT: an account's AI connections (Claude Code, Codex, Antigravity), each with a config home of its
// own; what is installed here; the Orbit plugin's grants; which connection a run uses (RunConnections); and the Claude
// Code catalogs a connection's own CLI gives (its models, its connectors). Other contexts hear a connection move through
// ConnectionHooks.
import { Module } from "@nestjs/common";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { CredentialStore } from "../../infra/connections/credentials.js";
import { ConnectionStore, InstallationStore } from "../../infra/connections/stores.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import { GovernanceModule } from "../governance/governance.module.js";
import { ClaudeConnectorsService } from "./claude-connectors.service.js";
import { ClaudeModelsService } from "./claude-models.service.js";
import { ConnectionHooks } from "./connection-hooks.js";
import { ClaudeController, ConnectionsController } from "./connections.controller.js";
import { ConnectionsService } from "./connections.service.js";
import { ConnectionProbe } from "./probe.js";
import { RunConnections } from "./run-connections.js";

@Module({
  imports: [GovernanceModule],
  providers: [
    { provide: CredentialStore, useFactory: (config: AppConfig) => new CredentialStore(join(config.data.control, "credentials")), inject: [APP_CONFIG] },
    {
      provide: ConnectionProbe,
      useFactory: (config: AppConfig, process: ProcessPort, connections: ConnectionStore, installations: InstallationStore, credentials: CredentialStore) => new ConnectionProbe({ config, process, connections, installations, credentials }),
      inject: [APP_CONFIG, AGENT_PROCESS_PORT, ConnectionStore, InstallationStore, CredentialStore],
    },
    ConnectionHooks,
    RunConnections,
    ClaudeModelsService,
    ClaudeConnectorsService,
    ConnectionsService,
  ],
  controllers: [ConnectionsController, ClaudeController],
  exports: [CredentialStore, ConnectionProbe, ConnectionHooks, RunConnections, ClaudeModelsService, ClaudeConnectorsService, ConnectionsService],
})
export class ConnectionsModule {}
