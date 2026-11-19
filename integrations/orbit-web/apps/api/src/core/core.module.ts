// What every module shares: the configuration, the process port, the database and its stores, the event hub.
import { type DynamicModule, Global, Inject, Injectable, Module, type OnApplicationShutdown } from "@nestjs/common";
import { join } from "node:path";
import type { AppConfig } from "../config/config.js";
import { NodeProcessPort } from "../infra/process/node-process.js";
import { Database } from "../infra/storage/database.js";
import { EventStore, MessageStore, RunStore, SessionStore, SettingsStore } from "../infra/storage/stores.js";
import { EventHub } from "./event-hub.js";
import { APP_CONFIG, PROCESS_PORT } from "./tokens.js";

@Injectable()
class DatabaseCloser implements OnApplicationShutdown {
  constructor(@Inject(Database) private readonly database: Database) {}

  onApplicationShutdown(): void {
    this.database.close();
  }
}

const store = <T>(Store: new (db: Database) => T) => ({ provide: Store, useFactory: (db: Database) => new Store(db), inject: [Database] });

@Global()
@Module({})
export class CoreModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: CoreModule,
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: PROCESS_PORT, useValue: new NodeProcessPort() },
        { provide: Database, useFactory: () => new Database(join(config.data.app, "orbit-web.db")) },
        store(SettingsStore),
        store(SessionStore),
        store(MessageStore),
        store(EventStore),
        store(RunStore),
        EventHub,
        DatabaseCloser,
      ],
      exports: [APP_CONFIG, PROCESS_PORT, Database, SettingsStore, SessionStore, MessageStore, EventStore, RunStore, EventHub],
    };
  }
}
