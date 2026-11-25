// A run's own sandbox, for every module that starts a chat's or a research session's CLI (session-sandboxes.ts).
import { Global, Module } from "@nestjs/common";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import { SESSION_SANDBOXES, sessionSandboxesFor } from "./session-sandboxes.js";

@Global()
@Module({
  providers: [{ provide: SESSION_SANDBOXES, useFactory: (config: AppConfig, agent: ProcessPort) => sessionSandboxesFor(config, agent), inject: [APP_CONFIG, AGENT_PROCESS_PORT] }],
  exports: [SESSION_SANDBOXES],
})
export class SessionSandboxModule {}
