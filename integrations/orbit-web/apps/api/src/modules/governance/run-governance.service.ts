// A RUN, AS GOVERNANCE SEES IT. Before Claude Code starts in a chat, Orbit Web works out which scope the run is in and
// what follows from it -- the agent runtime is never asked:
//
//   LEGACY_ORBIT, single deployment   exactly as Orbit Web always ran: nothing here changes, nothing is recorded.
//   LEGACY_ORBIT, governed deployment the run still has no way out but the egress proxy, so it is BOUND: a run token
//                                      (for the proxy and the agent gateway), its start and end recorded. What it may
//                                      reach is the Constitution's.
//   GOVERNED_WORKSPACE                 refused unless every one of these holds, each recorded: the workspace's agent is
//                                      registered and active; a Constitution is published; the agent's isolation was
//                                      checked just now and held (or the Constitution says isolation is optional);
//                                      a decision of `agent.run.start` allows it. Then the run is bound to its agent, its
//                                      workspace and the revision in effect, and what the Constitution says about the
//                                      web tools and the workspace's commands becomes the runtime's configuration
//                                      (defence in depth: the runtime's own tools are not the boundary).
//
// A run's token is minted here, kept as its SHA-256, handed to that run's process alone, and ends with the run.
import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import type { EnforcementScope } from "@orbit-web/governance-core";
import type { IsolationState } from "@orbit-web/contracts";
import { randomBytes, randomUUID } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { GovernanceDatabase } from "../../infra/governance/governance-db.js";
import { egressProxyEnv } from "../../infra/process/env.js";
import { RunBindingStore, sha256, type RunBinding } from "../../infra/governance/stores.js";
import type { SessionRecord } from "../../infra/storage/stores.js";
import { ToolchainService } from "../health/toolchain.service.js";
import { AuditService } from "./audit.service.js";
import { IsolationService } from "./isolation.service.js";
import { PolicyService } from "./policy.service.js";
import { RESEARCH_AGENT, systemContext, type GovernanceContext, type Principal } from "./principal.js";
import { RegistryService } from "./registry.service.js";

// How long a run's token may live at most (a run ends sooner; its token ends with it).
const RUN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export interface RunPlan {
  scope: EnforcementScope;
  binding: RunBinding | null;
  // Added to the run's environment: the gateway, the run's token, the proxy (governed deployment).
  env: Record<string, string>;
  // What the Constitution allows the runtime (null: as the person's settings say).
  webTools: boolean | null;
  execute: boolean;
  // Said to Claude Code after its system prompt, beside the workspace's own note.
  note: string | null;
  governed: boolean;
  isolation: IsolationState | "not_applicable";
}

export type Prepared = { ok: true; plan: RunPlan } | { ok: false; message: string; reasonCodes: string[] };

const LEGACY: RunPlan = { scope: "LEGACY_ORBIT", binding: null, env: {}, webTools: null, execute: true, note: null, governed: false, isolation: "not_applicable" };


// What a run is minted for: a chat, or a research session (which has no working branch).
interface Bindable {
  id: string;
  workBranch: string | null;
}

export const gatewayNote = (governed: boolean, revision: number | null): string =>
  [
    governed ? `This chat is GOVERNED by your organization's Constitution${revision !== null ? ` (revision ${revision})` : ""}.` : "This chat runs under Orbit Web's governed deployment.",
    "You hold no repository credential and cannot push or open a pull request yourself. Orbit Web's agent gateway is at $ORBIT_AGENT_GATEWAY; your run's own token is in $ORBIT_AGENT_TOKEN, sent as the x-orbit-run-token header (never print it or write it anywhere).",
    "When the work is committed and should be pushed, ask the gateway: curl -s -X POST -H \"x-orbit-run-token: $ORBIT_AGENT_TOKEN\" -H 'content-type: application/json' -d '{}' \"$ORBIT_AGENT_GATEWAY/push\" -- Orbit Web pushes the branch you work on for you. Its answer says what happened: \"state\": \"pushed\" (the Constitution allows it: it is pushed, go on), \"pending\" (a person approves that exact commit first, then Orbit Web pushes it: say so, and stop there), or an error saying why nothing was pushed.",
    "To ask whether an action is allowed: POST $ORBIT_AGENT_GATEWAY/decisions with {\"action\": \"...\", \"resource\": \"...\"}. Orbit Web's other routes, its records and the sign-ins are not yours to reach: every attempt is refused and recorded.",
  ].join(" ");

@Injectable()
export class RunGovernanceService implements OnApplicationBootstrap {
  private runtimeVersion: string | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GovernanceDatabase) private readonly database: GovernanceDatabase,
    @Inject(RunBindingStore) private readonly bindings: RunBindingStore,
    @Inject(RegistryService) private readonly registry: RegistryService,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(IsolationService) private readonly isolation: IsolationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(ToolchainService) private readonly toolchain: ToolchainService,
  ) {}

  // At a start nothing runs: every run token still open ends.
  onApplicationBootstrap(): void {
    this.bindings.endAll(new Date().toISOString());
  }

  // Whether a run of this chat is governed at all (cheap, synchronous): what decides whether its start may wait.
  bound(session: SessionRecord): boolean {
    return this.config.governance.deployment === "governed" || this.registry.of(session.id).scope === "GOVERNED_WORKSPACE";
  }

  async prepare(session: SessionRecord, runId: string, mode: string): Promise<Prepared> {
    if (!this.bound(session)) return { ok: true, plan: LEGACY };
    const w = this.registry.of(session.id);
    const ctx = systemContext("run-start");
    if (w.scope === "LEGACY_ORBIT") return { ok: true, plan: await this.legacyGoverned(ctx, session, runId, mode) };
    const refused = (message: string, reasonCodes: string[]): Prepared => {
      this.audit.record(ctx, { type: "run.refused", outcome: "refused", workspaceId: session.id, agentId: w.agent?.id ?? null, runId, reasonCodes, data: { scope: "GOVERNED_WORKSPACE", cause: reasonCodes.join(",") } });
      return { ok: false, message, reasonCodes };
    };
    if (w.agent === null || w.agent.status !== "active") return refused("This chat is governed, and its agent is not registered or is suspended: an operator registers it (Governance → Agents & Workspaces).", ["AGENT_NOT_REGISTERED"]);
    const effective = this.policy.effective();
    if (effective === null) return refused("This chat is governed, and no Constitution is published yet: nothing may run until one is (Governance → Company Constitution).", ["NO_PUBLISHED_POLICY"]);
    const isolation = await this.isolationFor(effective.constitution.obligations.isolation);
    if (isolation.refused) return refused(isolation.message, ["ISOLATION_NOT_PROVEN"]);
    const { binding, token } = this.mint(session, runId, w.agent.id, effective.record.id);
    const agent: Principal = { kind: "agent", binding };
    const decide = (action: string) => this.policy.decide({ ...ctx, principal: agent }, { action, resource: session.id, scope: "GOVERNED_WORKSPACE", workspaceId: session.id, agentId: binding.agentId, params: { workspace: session.id, agent: binding.agentId } }, agent);
    const start = decide("agent.run.start");
    if (start.verdict !== "allow") {
      this.bindings.end(runId, new Date().toISOString());
      return refused(`The Constitution in effect does not let this agent start a run here (${start.reasonCodes.join(", ")}).`, start.reasonCodes);
    }
    const plan: RunPlan = {
      scope: "GOVERNED_WORKSPACE",
      binding,
      env: this.envFor(token),
      webTools: decide("tool.web").verdict === "allow",
      execute: decide("workspace.execute").verdict === "allow",
      note: gatewayNote(true, effective.record.revision),
      governed: true,
      isolation: isolation.state,
    };
    await this.started(ctx, plan, session, mode);
    return { ok: true, plan };
  }

  // A RESEARCH run. In the single deployment nothing changes and nothing is recorded, as for a chat. In the governed
  // deployment it runs in the agent's container too, whose only way out is the egress proxy: it is bound (a token for
  // the proxy, its start and end recorded), the Constitution decides each of its connections, and it is given no
  // gateway -- nothing to push, nothing to ask.
  async prepareResearch(researchSessionId: string, runId: string): Promise<RunPlan> {
    if (this.config.governance.deployment !== "governed") return LEGACY;
    const effective = this.policy.effective();
    const { binding, token } = this.mint({ id: researchSessionId, workBranch: null }, runId, RESEARCH_AGENT, effective?.record.id ?? "none");
    const g = this.config.governance;
    const env = g.proxyPort === null ? {} : { ...egressProxyEnv(g.agentControlHost, g.proxyPort, "run", token), ENABLE_CLAUDEAI_MCP_SERVERS: "false" };
    const plan: RunPlan = { scope: "LEGACY_ORBIT", binding, env, webTools: false, execute: false, note: null, governed: false, isolation: this.isolation.status().state };
    await this.started(systemContext("run-start"), plan, { id: researchSessionId }, "research");
    return plan;
  }

  // The run ended (however it did): recorded, and its token ends.
  finished(plan: RunPlan, runId: string, status: string, exitCode: number | null): void {
    if (plan.binding === null) return;
    this.database.transaction(() => {
      this.bindings.end(runId, new Date().toISOString());
      this.audit.record({ correlationId: randomUUID(), principal: { kind: "agent", binding: plan.binding as RunBinding } }, { type: "run.finished", outcome: status, data: { status, exitCode } });
    });
  }

  private async legacyGoverned(ctx: GovernanceContext, session: SessionRecord, runId: string, mode: string): Promise<RunPlan> {
    const effective = this.policy.effective();
    const { binding, token } = this.mint(session, runId, "unregistered", effective?.record.id ?? "none");
    const plan: RunPlan = { scope: "LEGACY_ORBIT", binding, env: this.envFor(token), webTools: null, execute: true, note: gatewayNote(false, effective?.record.revision ?? null), governed: false, isolation: this.isolation.status().state };
    await this.started(ctx, plan, session, mode);
    return plan;
  }

  private async isolationFor(obligation: "required" | "optional"): Promise<{ refused: boolean; state: IsolationState; message: string }> {
    const status = await this.isolation.attest();
    if (status.state === "attested" || obligation === "optional") return { refused: false, state: status.state, message: "" };
    const message =
      status.deployment === "single"
        ? "This chat is governed, and Claude Code runs in the same container as Orbit Web's records here: isolation is not proven, and the Constitution in effect requires it. Run it in the governed deployment (docker/compose.governed.yaml)."
        : `This chat is governed, and the agent's container did not pass its isolation check just now: ${status.detail}`;
    return { refused: true, state: status.state, message };
  }

  private mint(session: Bindable, runId: string, agentId: string, policyRevision: string): { binding: RunBinding; token: string } {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const binding: RunBinding = { runId, sessionId: session.id, agentId, organizationId: this.audit.organizationId(), policyRevision, workBranch: session.workBranch, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + RUN_TOKEN_TTL_MS).toISOString(), endedAt: null };
    this.bindings.insert({ ...binding, tokenHash: sha256(token) });
    return { binding, token };
  }

  // What the run's process is given: the gateway and its own token; in the governed deployment its only way out (the
  // proxy, with the token as its credential, so each connection is decided as this run), and no claude.ai connector
  // or non-essential traffic -- nothing that would leave by another door.
  private envFor(token: string): Record<string, string> {
    const g = this.config.governance;
    const gateway = `http://${g.agentControlHost}:${this.config.port}/api/agent`;
    const base = { ORBIT_AGENT_GATEWAY: gateway, ORBIT_AGENT_TOKEN: token };
    if (g.deployment !== "governed" || g.proxyPort === null) return base;
    return { ...base, ...egressProxyEnv(g.agentControlHost, g.proxyPort, "run", token), ENABLE_CLAUDEAI_MCP_SERVERS: "false" };
  }

  private async started(ctx: GovernanceContext, plan: RunPlan, session: Pick<SessionRecord, "id">, mode: string): Promise<void> {
    this.runtimeVersion ??= (await this.toolchain.get()).versions.claude;
    const binding = plan.binding as RunBinding;
    this.audit.record({ ...ctx, principal: { kind: "agent", binding } }, { type: "run.started", outcome: "started", workspaceId: session.id, data: { scope: plan.scope, runtime: "claude-code", runtimeVersion: this.runtimeVersion, mode, isolation: plan.isolation } });
  }
}
