// THE ISOLATION CHECK, asked of the agent container's runner (governed deployment). The control plane writes a fresh
// random value in each of its own rooms -- the chats' database, governance, both CLIs' sign-ins, its own HOME -- and in
// the rooms the agent shares (the sessions, the control plane's copies of the repositories), then asks the runner what
// it sees. The check holds only if every room of the control plane is ABSENT there, the shared ones are present with
// exactly what was written, the copies of the repositories cannot be written from there, a direct connection to the
// internet fails, and a public name does not resolve. Every file it wrote is created exclusively under a new name
// (never written through a link somebody left), and removed after.
import { randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IsolationCheck } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import type { RunnerProcessPort } from "../../infra/process/runner-port.js";
import type { Attestor } from "./isolation.service.js";

// The rooms the agent's container must never see, and those it must.
const CONTROL_ROOMS = ["app", "governance", "github", "azure", "control"] as const;
const SHARED_ROOMS = ["sessions", "repos"] as const;

// An address on the internet (no name to resolve) and a name every public resolver answers.
export const EGRESS_PROBE = { host: "1.1.1.1", port: 443 };
export const DNS_PROBE = "example.com";

export class RunnerAttestor implements Attestor {
  constructor(
    private readonly config: AppConfig,
    private readonly runner: Pick<RunnerProcessPort, "attest">,
    private readonly probes = { egress: EGRESS_PROBE, dnsName: DNS_PROBE },
  ) {}

  async attest(): Promise<{ checks: IsolationCheck[] }> {
    const written: string[] = [];
    const canary = (dir: string): { path: string; nonce: string } => {
      const nonce = randomBytes(16).toString("hex");
      const path = join(dir, `.orbit-attest-${randomBytes(8).toString("hex")}`);
      writeFileSync(path, nonce, { flag: "wx", mode: 0o600 });
      written.push(path);
      return { path, nonce };
    };
    try {
      const present = SHARED_ROOMS.map((room) => ({ name: `sees_${room}`, ...canary(this.config.data[room]) }));
      const absent = CONTROL_ROOMS.map((room) => ({ name: `no_${room}`, path: canary(this.config.data[room]).path }));
      const answer = await this.runner.attest({ present, absent, readOnly: [{ name: "repos_read_only", path: this.config.data.repos }], egress: this.probes.egress, dnsName: this.probes.dnsName });
      return { checks: answer.checks };
    } finally {
      for (const path of written) rmSync(path, { force: true });
    }
  }
}
