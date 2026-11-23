// THE MODEL PLANE'S WAY OUT (ADR 0061): where employees run in containers, an AI CLI's model plane reaches the AI
// providers' own hosts and nothing else -- port 443, a deployment-fixed list (employee-network.ts), private and internal
// addresses never -- through this proxy on the model network. It carries the CLI's login, so nothing else leaves by it:
// no page, no package, no other API (the tool plane has its own way out, decided as the run).
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { Server } from "node:http";
import type { AppConfig } from "../../../config/config.js";
import { loadSandboxConfig } from "../../../config/sandbox-config.js";
import { APP_CONFIG } from "../../../core/tokens.js";
import { startEgressProxy, type EgressAsk, type EgressVerdict } from "../../../infra/egress/proxy.js";
import { employeeNetworkOf } from "./employee-network.js";

// What a model plane may reach: one of the providers' hosts, on 443.
export function modelPlaneVerdict(hosts: ReadonlySet<string>, ask: Pick<EgressAsk, "host" | "port">): EgressVerdict {
  const host = ask.host.toLowerCase();
  if (ask.port === 443 && hosts.has(host)) return { allow: true, reason: "", run: null };
  return { allow: false, reason: `the model plane reaches the AI providers' own hosts only (port 443); ${host}:${ask.port} is not one of them.`, run: null };
}

@Injectable()
export class ModelPlaneEgress implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("ModelPlaneEgress");
  private server: Server | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  async onApplicationBootstrap(): Promise<void> {
    if (!this.containerProvider()) return;
    const net = employeeNetworkOf(this.config, true);
    this.server = await startEgressProxy(net.modelEgressPort, { decide: (ask) => modelPlaneVerdict(net.modelHosts, ask), admit: () => true, warn: (m) => this.logger.warn(m) });
    this.logger.log(`model-plane egress listening on ${net.modelEgressPort} (${net.modelHosts.size} provider hosts)`);
  }

  // Whether employees run in containers here (a sandbox configuration that does not load starts nothing).
  private containerProvider(): boolean {
    try {
      return loadSandboxConfig(this.config.sourceEnv).provider === "container";
    } catch {
      return false;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await new Promise<void>((resolve) => (this.server === null ? resolve() : this.server.close(() => resolve())));
  }
}
