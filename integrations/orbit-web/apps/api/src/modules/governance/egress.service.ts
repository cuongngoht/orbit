// THE GOVERNED DEPLOYMENT'S BOUNDARY, started with the control plane: the egress proxy (the agent's only way out, each
// connection a recorded decision of the run's ACCOUNT policy, asked as the run it belongs to) and the isolation check of
// the agent's container (runner-attestor.ts). In the single deployment neither exists: there is no boundary to hold,
// and the isolation status says so.
//
// An employee's assignment run is decided as one: its connections by its account's employee network access (AUTONOMOUS
// or RESTRICTED, governance-core network.ts), on ports 80 and 443 only, held to the limits that policy sets -- read again
// at EACH connection, so a policy published while the run works applies from its next connection on -- and every one
// kept in the run's network log (workforce.run_connections). An address the proxy refuses after the policy allowed the
// host (one that is not on the public internet) is recorded on the account's chain as the run's. Orbit Web relays no
// sign-in through the proxy: a CLI's login is made from an operator's terminal, never by a run.
//
// Runtime security (ADR 0063): an attempt held to enforce reaches nothing while its protection is not proven and fresh
// (protectionHolds -- the allocator's own gate, held again here), so a lost proof is refused at its next connection,
// before the allocator's containment deadline. Such a refusal is no policy decision: it is kept in the run's network log.
import { Inject, Injectable, Logger, type OnApplicationBootstrap, type OnApplicationShutdown } from "@nestjs/common";
import type { Server } from "node:http";
import { protectionHolds } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { egressConfig } from "../../config/egress-config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { Db } from "../../infra/db/db.js";
import { RunConnectionLog } from "../../infra/egress/connection-log.js";
import { loadSandboxConfig } from "../../config/sandbox-config.js";
import { employeeNetworkOf } from "../../contexts/execution/infrastructure/employee-network.js";
import { allowedPrivate, startEgressProxy, type ConnectionSink, type EgressAsk, type EgressRun, type EgressVerdict } from "../../infra/egress/proxy.js";
import { RunBindingStore, sha256, type RunBinding } from "../../infra/governance/stores.js";
import { SecurityRepository } from "../../contexts/runtime-security/infrastructure/security.repository.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import { RunnerProcessPort } from "../../infra/process/runner-port.js";
import { contextOf, type Principal } from "../auth/principal.js";
import { fromNetwork, networkList } from "../auth/principals.js";
import { AuditService } from "./audit.service.js";
import { IsolationService } from "./isolation.service.js";
import { PolicyService, type Decision } from "./policy.service.js";
import { RunnerAttestor } from "./runner-attestor.js";
import { scopeOf } from "./run-governance.service.js";

// How many runs' bindings are kept for recording a refused address as the run's (the newest).
const KEPT_BINDINGS = 1024;

@Injectable()
export class EgressService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("Egress");
  private server: Server | null = null;
  private readonly log: RunConnectionLog;
  private readonly security: SecurityRepository;
  // The bindings of the employees' runs the proxy decided for lately.
  private readonly recent = new Map<string, RunBinding>();
  private employees: Server | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly agent: ProcessPort,
    @Inject(IsolationService) private readonly isolation: IsolationService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(RunBindingStore) private readonly bindings: RunBindingStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(Db) db: Db,
  ) {
    this.log = new RunConnectionLog(db);
    this.security = new SecurityRepository(db);
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.startForEmployees();
    const g = this.config.governance;
    if (g.deployment !== "governed" || g.proxyPort === null) return;
    if (this.agent instanceof RunnerProcessPort) this.isolation.setAttestor(new RunnerAttestor(this.config, this.agent));
    const agentNetworks = networkList(g.agentNetworks);
    const { maxConnectionsPerRun } = egressConfig(process.env);
    this.server = await startEgressProxy(g.proxyPort, {
      decide: (ask) => this.decide(ask),
      admit: (address) => fromNetwork(agentNetworks, address),
      privateAllowed: g.egressPrivateAllow.length > 0 ? allowedPrivate(g.egressPrivateAllow) : null,
      sink: this.sink(),
      maxConnectionsPerRun,
      warn: (message) => this.logger.warn(message),
    });
    this.logger.log(`egress proxy for the agent's container listening on ${g.proxyPort} (at most ${maxConnectionsPerRun} open connections a run)`);
  }

  async onApplicationShutdown(): Promise<void> {
    for (const server of [this.server, this.employees]) await new Promise<void>((resolve) => (server === null ? resolve() : server.close(() => resolve())));
  }

  // Where employees' container sandboxes run, their tool planes' only way out: this proxy on the sandbox network, each
  // connection decided as the run whose token it carries (a connection with none is refused). In the governed
  // deployment the agent's proxy already listening on that port serves them too.
  private async startForEmployees(): Promise<void> {
    let container = false;
    try {
      container = loadSandboxConfig(this.config.sourceEnv).provider === "container";
    } catch (err) {
      this.logger.warn(`The sandbox's configuration is not valid, so no egress is offered to employees: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!container) return;
    const g = this.config.governance;
    const net = employeeNetworkOf(this.config, true);
    if (g.deployment === "governed" && g.proxyPort === net.toolEgressPort) return;
    const { maxConnectionsPerRun } = egressConfig(process.env);
    this.employees = await startEgressProxy(net.toolEgressPort, { decide: (ask) => this.decide(ask), admit: () => true, sink: this.sink(), maxConnectionsPerRun, warn: (message) => this.logger.warn(message) });
    this.logger.log(`egress proxy for the employees' sandboxes listening on ${net.toolEgressPort}`);
  }

  // One connection out: a decision of the run's account policy in effect, as the run whose token the connection carries
  // -- and, without a live one, as nobody (which is never granted anything, and is recorded on the deployment's chain).
  async decide(ask: EgressAsk): Promise<EgressVerdict> {
    const binding = ask.token === null ? null : await this.bindings.live(sha256(ask.token));
    const unprotected = binding?.kind === "assignment" ? await this.unprotected(binding) : null;
    if (binding !== null && unprotected !== null) return { allow: false, reason: unprotected, run: { id: binding.runId, accountId: binding.accountId, employee: true, limits: null } };
    const principal: Principal = binding === null ? { kind: "anonymous", agentNetwork: true } : { kind: "agent", binding };
    const ctx = contextOf(principal, `egress:${binding?.runId ?? "none"}`);
    const decision = await this.policy.decide(ctx, { action: "network.egress", resource: `${ask.host}:${ask.port}`, scope: binding === null ? "ACCOUNT" : scopeOf(binding), params: { host: ask.host, port: ask.port } });
    const run = binding === null ? null : this.runOf(binding, decision);
    if (decision.verdict === "allow") return { allow: true, reason: "", run };
    const why = binding === null ? "no run's token was given" : `the account's policy in effect does not allow ${ask.host}:${ask.port} (${decision.reasonCodes.join(", ")})`;
    return { allow: false, reason: `this connection is refused: ${why}. Decision ${decision.decisionId}.`, run };
  }

  // Why an employee's attempt may not connect now for its runtime protection, or null when nothing holds it back.
  private async unprotected(binding: RunBinding): Promise<string | null> {
    const p = await this.security.protectionOf(binding.accountId, binding.runId);
    if (p === null || protectionHolds(p, Date.now())) return null;
    return `this connection is refused: the attempt's runtime protection is not established (${p.state}); under enforce it reaches nothing until its protection is proven again.`;
  }

  // What the proxy says about each connection of a run: kept in an employee's run's network log, and -- an address the
  // boundary refused after the policy allowed the host -- recorded on the account's chain as that run's.
  sink(): ConnectionSink {
    return {
      opened: async (run, host, port, verdict, reason) => {
        if (run.employee && reason?.cause === "address") await this.addressRefused(run, `${host}:${port}${reason.address !== undefined ? ` (${reason.address})` : ""}`);
        return this.log.opened(run, host, port, verdict, reason);
      },
      closed: (id, bytesIn, bytesOut, cut) => this.log.closed(id, bytesIn, bytesOut, cut),
      downloadedSince: (accountId, since) => this.log.downloadedSince(accountId, since),
    };
  }

  // The run a connection is decided as: an employee's assignment is held to its account's employee network access, with
  // the limits of the revision that decided this very connection.
  private runOf(binding: RunBinding, decision: Decision): EgressRun {
    const employee = binding.kind === "assignment";
    if (employee) this.keep(binding);
    return { id: binding.runId, accountId: binding.accountId, employee, limits: employee ? (decision.employeeNetwork?.limits ?? null) : null };
  }

  private keep(binding: RunBinding): void {
    this.recent.delete(binding.runId);
    this.recent.set(binding.runId, binding);
    if (this.recent.size > KEPT_BINDINGS) this.recent.delete(this.recent.keys().next().value as string);
  }

  private async addressRefused(run: EgressRun, target: string): Promise<void> {
    const binding = this.recent.get(run.id);
    if (binding === undefined) return;
    await this.audit.record(contextOf({ kind: "agent", binding }, `egress:${run.id}`), { type: "boundary.violation", outcome: "refused", data: { kind: "egress_address", route: "egress", target } });
  }
}
