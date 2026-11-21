// THE ISOLATION CHECK, asked of the agent container's runner (governed deployment). The control plane writes a fresh
// random value in each of its own rooms -- the chats' images, the research sources, both CLIs' sign-ins, its own HOME
// -- and in the rooms the agent shares (the sessions, the control plane's copies of the repositories), then asks the
// runner what it sees. The database is not a room but a server on a network the agent's container is not on, so the
// runner is asked to connect to it. The check holds only if every room of the control plane is ABSENT there, the
// shared ones are present with exactly what was written, the copies of the repositories cannot be written from there,
// the database cannot be reached, a direct connection to the internet fails, and a public name does not resolve. Every file it wrote is created exclusively under a new name
// (never written through a link somebody left), and removed after.
import { randomBytes } from "node:crypto";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IsolationCheck } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import type { AttestFrame } from "../../infra/process/runner-protocol.js";
import type { RunnerProcessPort } from "../../infra/process/runner-port.js";
import type { Attestor } from "./isolation.service.js";

// The rooms the agent's container must never see, and those it must.
const CONTROL_ROOMS = ["app", "github", "azure", "control", "research"] as const;
const SHARED_ROOMS = ["sessions", "repos"] as const;

// An address on the internet (no name to resolve) and a name every public resolver answers.
export const EGRESS_PROBE = { host: "1.1.1.1", port: 443 };
export const DNS_PROBE = "example.com";

// Where the control plane reaches its database, as an address the runner can try: a URL with no host (a local socket)
// names nothing the runner can try, and that is a failed check, never a skipped one.
export function databaseAddress(url: string): AttestFrame["closed"][number] | IsolationCheck {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[(.*)\]$/, "$1");
  if (host === "") return { name: "no_database", ok: false, detail: "the database is reached through a local socket, which this check cannot try from the agent's container" };
  return { name: "no_database", host, port: u.port === "" ? 5432 : Number(u.port) };
}

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
      const database = databaseAddress(this.config.database.url);
      const closed = "host" in database ? [database] : [];
      const answer = await this.runner.attest({ present, absent, readOnly: [{ name: "repos_read_only", path: this.config.data.repos }], closed, egress: this.probes.egress, dnsName: this.probes.dnsName });
      return { checks: "host" in database ? answer.checks : [...answer.checks, database] };
    } finally {
      for (const path of written) rmSync(path, { force: true });
    }
  }
}
