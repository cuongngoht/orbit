// What every module shares: the configuration, the process port, the database and its stores, and the event layer
// (the bus every producer publishes to, the live-text subscriber, the SSE gateway).
import { type DynamicModule, Global, Inject, Injectable, Module, type OnApplicationShutdown, type Provider } from "@nestjs/common";
import { join } from "node:path";
import type { AppConfig } from "../config/config.js";
import { NodeProcessPort } from "../infra/process/node-process.js";
import { AGENT_PROCESS_PORT, type ProcessPort } from "../infra/process/process.port.js";
import { RunnerProcessPort } from "../infra/process/runner-port.js";
import { AgentFs } from "../infra/process/agent-fs.js";
import { SignInChannel } from "../infra/egress/sign-in-channel.js";
import { GovernanceDatabase } from "../infra/governance/governance-db.js";
import { AgentStore, ApprovalStore, AuditStore, FindingStore, GovernedWorkspaceStore, IsolationStore, OperatorStore, OverlayStore, ReportStore, RevisionStore, RunBindingStore } from "../infra/governance/stores.js";
import { Database } from "../infra/storage/database.js";
import { ImageFiles } from "../infra/storage/image-files.js";
import { EventStore, ImageStore, MessageStore, ProjectStore, RunStore, SessionAccessStore, SessionStore, SettingsStore, ShareStore } from "../infra/storage/stores.js";
import { EventBus } from "./events/event-bus.js";
import { LiveText } from "./events/live-text.js";
import { StreamGateway } from "./events/stream-gateway.js";
import { APP_CONFIG, PROCESS_PORT } from "./tokens.js";

@Injectable()
class DatabaseCloser implements OnApplicationShutdown {
  constructor(
    @Inject(Database) private readonly database: Database,
    @Inject(GovernanceDatabase) private readonly governance: GovernanceDatabase,
  ) {}

  onApplicationShutdown(): void {
    this.database.close();
    this.governance.close();
  }
}

const store = <T>(Store: new (db: Database) => T) => ({ provide: Store, useFactory: (db: Database) => new Store(db), inject: [Database] });

const GOVERNANCE_STORES: (new (db: GovernanceDatabase) => unknown)[] = [OperatorStore, AuditStore, RevisionStore, OverlayStore, AgentStore, GovernedWorkspaceStore, RunBindingStore, ApprovalStore, FindingStore, ReportStore, IsolationStore];

const governanceStore = (Store: new (db: GovernanceDatabase) => unknown): Provider => ({ provide: Store, useFactory: (db: GovernanceDatabase) => new Store(db), inject: [GovernanceDatabase] });

@Global()
@Module({})
export class CoreModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: PROCESS_PORT, useValue: new NodeProcessPort() },
        // Where the agent's programs run: this container (single), or the agent container's runner (governed).
        {
          provide: AGENT_PROCESS_PORT,
          useFactory: (control: ProcessPort) => (config.governance.runner === null ? control : new RunnerProcessPort(config.governance.runner.host, config.governance.runner.port)),
          inject: [PROCESS_PORT],
        },
        AgentFs,
        // The Claude sign-in's own way out of the agent's container (governed deployment): the sign-in and the proxy share it.
        SignInChannel,
        { provide: Database, useFactory: () => new Database(join(config.data.app, "orbit-web.db")) },
        // Governance's own database, apart from the chats': deleting a chat never reaches it.
        { provide: GovernanceDatabase, useFactory: () => new GovernanceDatabase(join(config.data.governance, "governance.db")) },
        ...GOVERNANCE_STORES.map(governanceStore),
        store(SettingsStore),
        store(SessionStore),
        store(SessionAccessStore),
        store(MessageStore),
        store(EventStore),
        store(RunStore),
        store(ProjectStore),
        store(ShareStore),
        store(ImageStore),
        // Chat images' bytes: the control plane's own room, beside the database.
        { provide: ImageFiles, useFactory: () => new ImageFiles(join(config.data.app, "images")) },
        EventBus,
        LiveText,
        StreamGateway,
        DatabaseCloser,
      ],
      exports: [APP_CONFIG, PROCESS_PORT, AGENT_PROCESS_PORT, AgentFs, SignInChannel, Database, SettingsStore, SessionStore, SessionAccessStore, MessageStore, EventStore, RunStore, ProjectStore, ShareStore, ImageStore, ImageFiles, EventBus, LiveText, StreamGateway, GovernanceDatabase, ...GOVERNANCE_STORES],
    };
  }
}
