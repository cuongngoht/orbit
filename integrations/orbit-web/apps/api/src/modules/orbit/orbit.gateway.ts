// THE ORBIT GATEWAY: Orbit's own commands, run from the plugin the image bundles, in a session's workspace, with the
// same store and session mark the session's Claude Code has. Only reads (and the seat, which writes the machine
// store and never the checkout): `help` seats a checkout; `live status`, `task show` and `autonomous-engineering
// context` say what Orbit knows. Orbit decides every word; nothing here judges a task.
import { Inject, Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG, PROCESS_PORT } from "../../core/tokens.js";
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
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
  ) {}

  private orbit(cli: string, args: string[], cwd: string, claudeSessionId: string | null, timeoutMs = 30_000): Promise<RunResult> {
    const file = join(this.config.pluginDir, "cli", `${cli}.mjs`);
    return this.process.run(this.config.binaries.node, [file, ...args], { cwd, env: orbitEnv(this.config, claudeSessionId ? orbitSessionOf(claudeSessionId) : null), timeoutMs, maxOutputBytes: 8 * 1024 * 1024 });
  }

  // Makes the checkout known to Orbit (its project in the machine store); writes nothing in the checkout.
  seat(cwd: string): Promise<RunResult> {
    return this.orbit("help", [], cwd, null, 120_000);
  }

  liveStatus(cwd: string, claudeSessionId: string): Promise<RunResult> {
    return this.orbit("live", ["status", "--json"], cwd, claudeSessionId);
  }

  taskShow(cwd: string, task: string, claudeSessionId: string): Promise<RunResult> {
    return this.orbit("task", ["show", task, "--json"], cwd, claudeSessionId);
  }

  engineeringContext(cwd: string, task: string, claudeSessionId: string): Promise<RunResult> {
    return this.orbit("autonomous-engineering", ["context", task, "--json"], cwd, claudeSessionId);
  }
}
