// THE ORBIT GATEWAY: Orbit's own commands, run from the plugin the image bundles, in a session's workspace, with the
// same store and session mark the session's Claude Code has. Only reads (and the seat, which writes the machine
// store and never the checkout): `help` seats a checkout; `live status`, `task show` and `autonomous-engineering
// context` say what Orbit knows. Orbit decides every word; nothing here judges a task.
import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { orbitEnv } from "../../infra/process/env.js";
import type { ProcessPort, RunResult } from "../../infra/process/process.port.js";

// The mark Orbit's SessionStart hook gives a Claude Code session (src/memory/session.mjs hostSession): the host name
// and the first 16 hex characters of the SHA-256 of the session id.
export const orbitSessionOf = (claudeSessionId: string): string => `claude:${createHash("sha256").update(claudeSessionId).digest("hex").slice(0, 16)}`;

export const isTaskId = (v: unknown): v is string => typeof v === "string" && /^tsk-[0-9a-z-]{4,64}$/.test(v);

@Injectable()
export class OrbitGateway {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
  ) {}

  private orbit(cli: string, args: string[], cwd: string, accountId: string, claudeSessionId: string | null, timeoutMs = 30_000): Promise<RunResult> {
    const file = join(this.config.pluginDir, "cli", `${cli}.mjs`);
    return this.process.run(this.config.binaries.node, [file, ...args], { cwd, env: orbitEnv(this.config, accountId, claudeSessionId ? orbitSessionOf(claudeSessionId) : null), timeoutMs, maxOutputBytes: 8 * 1024 * 1024 });
  }

  // Makes the checkout known to Orbit (its project in the account's machine store); writes nothing in the checkout.
  seat(cwd: string, accountId: string): Promise<RunResult> {
    return this.orbit("help", [], cwd, accountId, null, 120_000);
  }

  liveStatus(cwd: string, accountId: string, claudeSessionId: string): Promise<RunResult> {
    return this.orbit("live", ["status", "--json"], cwd, accountId, claudeSessionId);
  }

  taskShow(cwd: string, accountId: string, task: string, claudeSessionId: string): Promise<RunResult> {
    return this.orbit("task", ["show", task, "--json"], cwd, accountId, claudeSessionId);
  }

  engineeringContext(cwd: string, accountId: string, task: string, claudeSessionId: string): Promise<RunResult> {
    return this.orbit("autonomous-engineering", ["context", task, "--json"], cwd, accountId, claudeSessionId);
  }
}
