// What every module shares: the configuration, the process port, THE DATABASE and its stores, and the event layer (the
// bus every producer publishes to, the live-text subscriber, the SSE gateway).
//
// The database is opened, brought to this build's schema and checked (pgvector included) BEFORE any module that uses
// it is made: a module's own start (reconciling runs a restart cut short, say) never meets a database that is not
// ready. One that cannot be reached, or cannot be migrated, stops the start with what is wrong -- there is no other
// store to fall back to.
import { type DynamicModule, Global, Inject, Injectable, Logger, Module, type OnApplicationShutdown, type Provider } from "@nestjs/common";
import { join } from "node:path";
import type { AppConfig } from "../config/config.js";
import { AccountSettingsStore, AccountStore, BrowserSessionStore, LoginThrottleStore, SetupCodeStore, UserStore } from "../infra/accounts/stores.js";
import { ConnectionStore, InstallationStore, PluginGrantStore } from "../infra/connections/stores.js";
import { Db } from "../infra/db/db.js";
import { migrate } from "../infra/db/migrate.js";
import { NodeProcessPort } from "../infra/process/node-process.js";
import { AGENT_PROCESS_PORT, type ProcessPort } from "../infra/process/process.port.js";
import { RunnerProcessPort } from "../infra/process/runner-port.js";
import { AgentFs } from "../infra/process/agent-fs.js";
import { ApprovalStore, AuditStore, DepartmentRevisionStore, FindingStore, IsolationStore, OverrideStore, ReportStore, ResourceStore, RevisionStore, RunBindingStore } from "../infra/governance/stores.js";
import { ImageFiles } from "../infra/storage/image-files.js";
import { EventStore, ImageStore, MessageStore, ProjectStore, RunStore, SessionAccessStore, SessionStore, SettingsStore, ShareStore } from "../infra/storage/stores.js";
import { EventBus } from "./events/event-bus.js";
import { LiveText } from "./events/live-text.js";
import { StreamGateway } from "./events/stream-gateway.js";
import { APP_CONFIG, PROCESS_PORT } from "./tokens.js";

// The schemas unqualified names resolve in, in order (`public` last: pgvector's types live there).
// `workforce` after the older schemas: its `events` and `runs` are always written schema-qualified.
export const SEARCH_PATH = ["app", "research", "governance", "workforce", "public"] as const;

@Injectable()
class DatabaseCloser implements OnApplicationShutdown {
  constructor(@Inject(Db) private readonly db: Db) {}

  async onApplicationShutdown(): Promise<void> {
    await this.db.close();
  }
}

export async function openDatabase(config: AppConfig): Promise<Db> {
  const db = new Db({ url: config.database.url, poolMax: config.database.poolMax, connectTimeoutMs: config.database.connectTimeoutMs, statementTimeoutMs: config.database.statementTimeoutMs, searchPath: SEARCH_PATH });
  try {
    const state = await migrate(db);
    new Logger("Database").log(`PostgreSQL ${state.server}, schema version ${state.version}, pgvector ${state.vector ?? "missing"}`);
    return db;
  } catch (err) {
    await db.close();
    throw err;
  }
}

const STORES: (new (db: Db) => unknown)[] = [
  SettingsStore,
  SessionStore,
  SessionAccessStore,
  MessageStore,
  EventStore,
  RunStore,
  ProjectStore,
  ShareStore,
  ImageStore,
  AccountStore,
  UserStore,
  SetupCodeStore,
  LoginThrottleStore,
  BrowserSessionStore,
  AccountSettingsStore,
  ConnectionStore,
  InstallationStore,
  PluginGrantStore,
  ResourceStore,
  AuditStore,
  RevisionStore,
  DepartmentRevisionStore,
  OverrideStore,
  RunBindingStore,
  ApprovalStore,
  FindingStore,
  ReportStore,
  IsolationStore,
];

const store = (Store: new (db: Db) => unknown): Provider => ({ provide: Store, useFactory: (db: Db) => new Store(db), inject: [Db] });

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
        { provide: Db, useFactory: () => openDatabase(config) },
        ...STORES.map(store),
        // Chat images' bytes: the control plane's own room, beside the database's data directory.
        { provide: ImageFiles, useFactory: () => new ImageFiles(join(config.data.app, "images")) },
        EventBus,
        LiveText,
        StreamGateway,
        DatabaseCloser,
      ],
      exports: [APP_CONFIG, PROCESS_PORT, AGENT_PROCESS_PORT, AgentFs, Db, ...STORES, ImageFiles, EventBus, LiveText, StreamGateway],
    };
  }
}
