// THE GOVERNED DEPLOYMENT'S BOUNDARY, started with the control plane: the egress proxy (the agent's only way out, each
// connection a recorded decision of the run's ACCOUNT policy, asked as the run it belongs to) and the isolation check of
// the agent's container (runner-attestor.ts). In the single deployment neither exists: there is no boundary to hold,
// and the isolation status says so.
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { Server } from "node:http";
import type { AppConfig } from "../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { isClaudeAccountHost } from "@orbit-web/governance-core";
import { allowedPrivate, startEgressProxy, type EgressAsk, type EgressVerdict } from "../../infra/egress/proxy.js";
import { SignInChannel } from "../../infra/egress/sign-in-channel.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import { RunnerProcessPort } from "../../infra/process/runner-port.js";
import { contextOf, systemContext, type Principal } from "../auth/principal.js";
import { fromNetwork, networkList, PrincipalResolver } from "../auth/principals.js";
import { AuditService } from "./audit.service.js";
import { IsolationService } from "./isolation.service.js";
import { PolicyService } from "./policy.service.js";
import { RunnerAttestor } from "./runner-attestor.js";
import { scopeOf } from "./run-governance.service.js";

@Injectable()
export class EgressService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Egress");
  private server: Server | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly agent: ProcessPort,
    @Inject(IsolationService) private readonly isolation: IsolationService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(PrincipalResolver) private readonly principals: PrincipalResolver,
    @Inject(SignInChannel) private readonly signIn: SignInChannel,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const g = this.config.governance;
    if (g.deployment !== "governed" || g.proxyPort === null) return;
    if (this.agent instanceof RunnerProcessPort) this.isolation.setAttestor(new RunnerAttestor(this.config, this.agent));
    const agentNetworks = networkList(g.agentNetworks);
    this.server = await startEgressProxy(g.proxyPort, { decide: (ask) => this.decide(ask), admit: (address) => fromNetwork(agentNetworks, address), privateAllowed: g.egressPrivateAllow.length > 0 ? allowedPrivate(g.egressPrivateAllow) : null });
    this.logger.log(`egress proxy for the agent's container listening on ${g.proxyPort}`);
  }

  async onApplicationShutdown(): Promise<void> {
    await new Promise<void>((resolve) => (this.server === null ? resolve() : this.server.close(() => resolve())));
  }

  // One connection out: a decision of the run's account policy in effect, as the run whose token the connection carries
  // -- and, without one, as nobody (which is never granted anything, and is recorded on the deployment's chain).
  async decide(ask: EgressAsk): Promise<EgressVerdict> {
    if (ask.token !== null && this.signIn.holds(ask.token)) return this.signInConnection(ask);
    const binding = ask.token === null ? null : await this.principals.binding(ask.token);
    const principal: Principal = binding === null ? { kind: "anonymous", agentNetwork: true } : { kind: "agent", binding };
    const ctx = contextOf(principal, `egress:${binding?.runId ?? "none"}`);
    const decision = await this.policy.decide(ctx, { action: "network.egress", resource: `${ask.host}:${ask.port}`, scope: binding === null ? "ACCOUNT" : scopeOf(binding), params: { host: ask.host, port: ask.port } });
    if (decision.verdict === "allow") return { allow: true, reason: "" };
    const why = binding === null ? "no run's token was given" : `the account's policy in effect does not allow ${ask.host}:${ask.port} (${decision.reasonCodes.join(", ")})`;
    return { allow: false, reason: `this connection is refused: ${why}. Decision ${decision.decisionId}.` };
  }

  // Orbit Web's own Claude sign-in (infra/egress/sign-in-channel.ts): the Claude account's hosts and nothing else --
  // never a policy's to grant or refuse, since the sign-in is what makes an account before one can exist. Recorded on the
  // deployment's chain: no account is signed in yet.
  private async signInConnection(ask: EgressAsk): Promise<EgressVerdict> {
    const resource = `${ask.host}:${ask.port}`;
    const allow = isClaudeAccountHost(ask.host, ask.port);
    await this.audit.record(systemContext("claude-sign-in"), { type: "egress.sign_in", outcome: allow ? "allow" : "deny", reasonCodes: ["SIGN_IN_CHANNEL"], data: { resource } });
    if (allow) return { allow: true, reason: "" };
    return { allow: false, reason: `this connection is refused: the Claude sign-in reaches the Claude account's own hosts only, and ${resource} is not one.` };
  }
}
