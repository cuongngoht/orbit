// FILES WHERE THE AGENT CAN WRITE, made and removed in the agent's placement. In the governed deployment the control
// plane never creates, writes or deletes anything in a directory the agent can write (a link the agent planted there
// would resolve in the CONTROL PLANE's mounts, where the sign-ins and governance's records are): it asks the agent's
// runner to, with mkdir and rm as argument lists. In the single deployment it is this container either way.
import { Inject, Injectable } from "@nestjs/common";
import { mkdirSync, rmSync } from "node:fs";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { baseEnv } from "./env.js";
import { AGENT_PROCESS_PORT, endedHow, succeeded, type ProcessPort } from "./process.port.js";

@Injectable()
export class AgentFs {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly agent: ProcessPort,
  ) {}

  private get governed(): boolean {
    return this.config.governance.deployment === "governed";
  }

  async mkdirp(path: string): Promise<void> {
    if (!this.governed) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
      return;
    }
    const r = await this.agent.run("/bin/mkdir", ["-p", "-m", "700", "--", path], { cwd: "/", env: baseEnv(this.config), timeoutMs: this.config.limits.commandTimeoutMs });
    if (!succeeded(r)) throw new Error(`mkdir ${path} ${endedHow(r)}`);
  }

  async rmrf(path: string): Promise<void> {
    if (!this.governed) {
      rmSync(path, { recursive: true, force: true });
      return;
    }
    const r = await this.agent.run("/bin/rm", ["-rf", "--", path], { cwd: "/", env: baseEnv(this.config), timeoutMs: this.config.limits.cloneTimeoutMs });
    if (!succeeded(r)) throw new Error(`rm ${path} ${endedHow(r)}`);
  }
}
