// A RUN, AS GOVERNANCE SEES IT. Every run of an agent -- a chat's (Claude Code in its workspace) and a research
// session's -- in BOTH deployments is decided under its ACCOUNT's policy before it starts, and bound to it:
//
//   1. the account's policy in effect is read; with none, nothing runs (fail closed);
//   2. the isolation it obliges: where the policy requires isolation and the agent's runtime was not proven isolated
//      just now (always so in the single deployment), the run is refused, said and recorded;
//   3. the run is BOUND -- its run, its account, the chat or research workspace it works in, the revision in effect, who
//      started it -- and given a token of its own (kept as its SHA-256, handed to that run's process alone, ended with the
//      run); then `agent.run.start` is decided as the run's agent, and a refusal ends the binding there;
//   4. what the policy says about the web tools, the workspace's commands and each connector the owner chose for it
//      (`tool.connector`, one decision each) becomes the runtime's configuration -- defence in depth: the runtime's own
//      tools are not the boundary. In the governed deployment the run is ISOLATED: it holds no credential, reaches no
//      connector, and its only way out is the egress proxy, each connection decided as this run.
//
// Every decision, the start and the end are records on the account's chain. The agent runtime is never asked anything:
// what it runs as is a fixed profile (`claude-code` for a chat, `claude-research` for research), not a registration.
// A research run's token opens the egress proxy alone: the agent gateway refuses it (auth/principals.ts).
import { Inject, Injectable, type OnApplicationBootstrap } from "@nestjs/common";
import { RUN_SCOPES, type EnforcementScope } from "@orbit-web/governance-core";
import type { IsolationState } from "@orbit-web/contracts";
import { randomBytes } from "node:crypto";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { Db } from "../../infra/db/db.js";
import { RunBindingStore, sha256, type RunBinding } from "../../infra/governance/stores.js";
import { egressProxyEnv } from "../../infra/process/env.js";
import type { SessionRecord } from "../../infra/storage/stores.js";
import { contextOf, labelOf, type GovernanceContext, type Principal } from "../auth/principal.js";
import type { RunConnector } from "../connections/claude-connectors.service.js";
import { ToolchainService } from "../health/toolchain.service.js";
import { AuditService } from "./audit.service.js";
import { IsolationService } from "./isolation.service.js";
import { PolicyService, type Decision } from "./policy.service.js";
import { GovernedResources } from "./resources.service.js";
import type { RuntimeKind } from "@orbit-web/contracts";

// How long a run's token may live at most (a run ends sooner; its token ends with it).
const RUN_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// The agent profiles a run is bound as.
export const CHAT_AGENT = "claude-code";

// How the audit record names the CLI an employee's attempt ran.
const AUDIT_RUNTIME: Record<RuntimeKind, string> = { claude: "claude-code", codex: "openai-codex", agy: "google-antigravity" };
export const RESEARCH_AGENT = "claude-research";
export const EMPLOYEE_AGENT = "orbit-employee";

// What a run's decisions are about: a chat's, a research workspace's, or an employee's (an assignment's run).
export const scopeOf = (b: Pick<RunBinding, "kind">): EnforcementScope => RUN_SCOPES[b.kind];

export interface RunPlan {
  scope: EnforcementScope;
  binding: RunBinding;
  // Added to the run's environment: the gateway and the run's token (a chat), the egress proxy (governed deployment).
  env: Record<string, string>;
  // What the account's policy allows the runtime (the person's own preferences may narrow it further).
  webTools: boolean;
  execute: boolean;
  // The connectors the owner chose for this run that the policy allows (one decision each); none when isolated.
  connectors: RunConnector[];
  // The governed deployment: no credential, no connector (--strict-mcp-config), the gateway the only way to push.
  isolated: boolean;
  // Said to Claude Code after its system prompt, beside the workspace's own note (a chat's; null for research).
  note: string | null;
  isolation: IsolationState | "not_applicable";
  // The number of the account's revision in effect the run is bound to.
  revision: number | null;
}

export type Refusal = { ok: false; message: string; reasonCodes: string[] };
export type Prepared = { ok: true; plan: RunPlan } | Refusal;
// An employee's attempt: its plan, the run's token (the tool bridge's and the egress proxy's credential) and whether the
// account's policy obliges isolation.
export type PreparedAssignment = { ok: true; plan: RunPlan; token: string; isolationRequired: boolean; network: EmployeeNetwork } | Refusal;

// How an employee's sandbox reaches the internet, as the account's policy in effect says (a policy published before the
// setting existed says nothing: AUTONOMOUS). Enforced by the egress proxy, each connection decided as the run.
export interface EmployeeNetwork {
  mode: "AUTONOMOUS" | "RESTRICTED";
  allow: string[];
}

const networkOf = (constitution: unknown): EmployeeNetwork => {
  const n = (constitution as { employeeNetwork?: { mode?: unknown; allow?: unknown } }).employeeNetwork;
  const allow = Array.isArray(n?.allow) ? n.allow.filter((x): x is string => typeof x === "string") : [];
  return { mode: n?.mode === "RESTRICTED" ? "RESTRICTED" : "AUTONOMOUS", allow };
};

interface Bound {
  kind: RunBinding["kind"];
  accountId: string;
  resourceKind: RunBinding["resourceKind"];
  resourceId: string;
  researchSessionId: string | null;
  agentId: string;
  policyRevision: string;
  startedBy: string;
  workBranch: string | null;
}

export const gatewayNote = (isolated: boolean, revision: number | null): string =>
  [
    `This chat runs under its account's policy${revision !== null ? ` (revision ${revision})` : ""}.`,
    isolated
      ? "You hold no repository credential and cannot push or open a pull request yourself. Orbit Web's agent gateway is at $ORBIT_AGENT_GATEWAY; your run's own token is in $ORBIT_AGENT_TOKEN, sent as the x-orbit-run-token header (never print it or write it anywhere)."
      : "Orbit Web's agent gateway is at $ORBIT_AGENT_GATEWAY; your run's own token is in $ORBIT_AGENT_TOKEN, sent as the x-orbit-run-token header (never print it or write it anywhere).",
    "When the work is committed and should be pushed, ask the gateway: curl -s -X POST -H \"x-orbit-run-token: $ORBIT_AGENT_TOKEN\" -H 'content-type: application/json' -d '{}' \"$ORBIT_AGENT_GATEWAY/push\" -- Orbit Web pushes the branch you work on for you. Its answer says what happened: \"state\": \"pushed\" (the account's policy allows it: it is pushed, go on), \"pending\" (the account's owner approves that exact commit first, then Orbit Web pushes it: say so, and stop there), or an error saying why nothing was pushed.",
    "To ask whether an action is allowed: POST $ORBIT_AGENT_GATEWAY/decisions with {\"action\": \"...\", \"resource\": \"...\"}. Orbit Web's other routes, its records and the sign-ins are not yours to reach: every attempt is refused and recorded.",
  ].join(" ");

@Injectable()
export class RunGovernanceService implements OnApplicationBootstrap {
  private runtimeVersion: string | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(RunBindingStore) private readonly bindings: RunBindingStore,
    @Inject(PolicyService) private readonly policy: PolicyService,
    @Inject(IsolationService) private readonly isolation: IsolationService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(GovernedResources) private readonly resources: GovernedResources,
    @Inject(ToolchainService) private readonly toolchain: ToolchainService,
  ) {}

  // At a start nothing runs: every run token still open ends.
  async onApplicationBootstrap(): Promise<void> {
    await this.bindings.endAll(new Date().toISOString());
  }

  // A CHAT's run: decided, bound and configured -- or refused, said and recorded. Its account is the chat's.
  async prepare(session: SessionRecord, runId: string, o: { mode: string; startedBy: Principal; connectors: readonly RunConnector[] }): Promise<Prepared> {
    const accountId = session.accountId;
    const ctx = contextOf({ kind: "system", id: "run-start", accountId });
    const scope: EnforcementScope = "ACCOUNT_WORKSPACE";
    const checked = await this.precheck(ctx, scope, session.id, runId);
    if (!checked.ok) return checked;
    await this.resources.register("workspace", { accountId, id: session.id, title: session.title });
    return this.db.tx(async () => {
      const { binding, token } = await this.mint({ kind: "chat", accountId, resourceKind: "workspace", resourceId: session.id, researchSessionId: null, agentId: CHAT_AGENT, policyRevision: checked.revisionId, startedBy: labelOf(o.startedBy), workBranch: session.workBranch }, runId);
      const agent: Principal = { kind: "agent", binding };
      const actx: GovernanceContext = { ...ctx, principal: agent, accountId };
      const decide = (action: string, resource: string, params: Record<string, unknown>): Promise<Decision> => this.policy.decide(actx, { action, resource, scope, workspaceId: session.id, params }, agent);
      const start = await decide("agent.run.start", session.id, { workspace: session.id, agent: binding.agentId });
      if (start.verdict !== "allow") return this.refusedStart(ctx, scope, binding, start);
      const isolated = this.config.governance.deployment === "governed";
      const plan: RunPlan = {
        scope,
        binding,
        env: this.envFor(token, "chat"),
        webTools: (await decide("tool.web", session.id, { workspace: session.id })).verdict === "allow",
        execute: (await decide("workspace.execute", session.id, { workspace: session.id })).verdict === "allow",
        connectors: isolated ? [] : await this.allowed(o.connectors, (c) => decide("tool.connector", c.name, { connector: c.name })),
        isolated,
        note: gatewayNote(isolated, checked.revision),
        isolation: checked.isolation,
        revision: checked.revision,
      };
      await this.started(actx, plan, o.mode, binding.startedBy);
      return { ok: true, plan };
    });
  }

  // A RESEARCH run, held the same way: decided under its account's policy, bound to its research workspace and session.
  // It has no tool of its own and no gateway; in the governed deployment its only way out is the egress proxy (its token
  // is the proxy's credential) and it reaches no connector.
  async prepareResearch(subject: { accountId: string; researchWorkspaceId: string; researchSessionId: string }, runId: string, o: { startedBy: Principal; connectors: readonly RunConnector[] }): Promise<Prepared> {
    const { accountId, researchWorkspaceId, researchSessionId } = subject;
    const ctx = contextOf({ kind: "system", id: "run-start", accountId });
    const scope: EnforcementScope = "ACCOUNT_RESEARCH";
    const checked = await this.precheck(ctx, scope, researchWorkspaceId, runId);
    if (!checked.ok) return checked;
    await this.resources.ensure("research_workspace", { accountId, id: researchWorkspaceId, title: "(research workspace)" });
    return this.db.tx(async () => {
      const { binding, token } = await this.mint({ kind: "research", accountId, resourceKind: "research_workspace", resourceId: researchWorkspaceId, researchSessionId, agentId: RESEARCH_AGENT, policyRevision: checked.revisionId, startedBy: labelOf(o.startedBy), workBranch: null }, runId);
      const agent: Principal = { kind: "agent", binding };
      const actx: GovernanceContext = { ...ctx, principal: agent, accountId };
      const decide = (action: string, resource: string, params: Record<string, unknown>): Promise<Decision> => this.policy.decide(actx, { action, resource, scope, researchWorkspaceId, params }, agent);
      const start = await decide("agent.run.start", researchWorkspaceId, { workspace: researchWorkspaceId, agent: binding.agentId });
      if (start.verdict !== "allow") return this.refusedStart(ctx, scope, binding, start);
      const isolated = this.config.governance.deployment === "governed";
      const plan: RunPlan = {
        scope,
        binding,
        env: this.envFor(token, "research"),
        webTools: false,
        execute: false,
        connectors: isolated ? [] : await this.allowed(o.connectors, (c) => decide("tool.connector", c.name, { connector: c.name })),
        isolated,
        note: null,
        isolation: checked.isolation,
        revision: checked.revision,
      };
      await this.started(actx, plan, "research", binding.startedBy);
      return { ok: true, plan };
    });
  }

  // An EMPLOYEE's attempt (the virtual office), held the same way: decided under its account's policy, bound to the
  // employee it works for (resource kind `employee`). Its token is the tool bridge's credential and the egress proxy's
  // (each connection decided as this run); it opens neither the agent gateway nor any owner route. Whether the account's
  // policy obliges isolation is returned: the worker holds the attempt to it once the sandbox's attestation is known.
  async prepareAssignment(subject: { accountId: string; employeeId: string; title: string; assignmentId: string }, runId: string, o: { startedBy: Principal; webSearch: boolean; runtime?: RuntimeKind }): Promise<PreparedAssignment> {
    const { accountId, employeeId } = subject;
    const ctx = contextOf({ kind: "system", id: "run-start", accountId });
    const scope: EnforcementScope = RUN_SCOPES.assignment;
    const effective = await this.policy.effective(accountId);
    if (effective === null) return this.refused(ctx, scope, employeeId, runId, "This account has no policy in effect, so nothing may run: publish one under Governance → Policy.", ["NO_PUBLISHED_POLICY"]);
    await this.resources.ensure("employee", { accountId, id: employeeId, title: subject.title });
    return this.db.tx(async () => {
      const { binding, token } = await this.mint({ kind: "assignment", accountId, resourceKind: "employee", resourceId: employeeId, researchSessionId: null, agentId: EMPLOYEE_AGENT, policyRevision: effective.record.id, startedBy: labelOf(o.startedBy), workBranch: null }, runId);
      const agent: Principal = { kind: "agent", binding };
      const actx: GovernanceContext = { ...ctx, principal: agent, accountId };
      // Decided as the run's agent: its binding names the employee (an employee override applies), never a chat.
      const decide = (action: string, params: Record<string, unknown>): Promise<Decision> => this.policy.decide(actx, { action, resource: employeeId, scope, params }, agent);
      const start = await decide("agent.run.start", { workspace: employeeId, agent: binding.agentId });
      if (start.verdict !== "allow") return this.refusedStart(ctx, scope, binding, start);
      const plan: RunPlan = {
        scope,
        binding,
        env: {},
        webTools: o.webSearch ? (await decide("tool.web", { workspace: employeeId })).verdict === "allow" : false,
        execute: (await decide("workspace.execute", { workspace: employeeId })).verdict === "allow",
        connectors: [],
        isolated: true,
        note: null,
        isolation: "not_applicable",
        revision: effective.record.revision,
      };
      const runtime = o.runtime ?? "claude";
      await this.audit.record(actx, { type: "run.started", outcome: "started", workspaceId: employeeId, data: { scope, runtime: AUDIT_RUNTIME[runtime], runtimeVersion: runtime === "claude" ? this.runtimeVersion : ((await this.toolchain.get()).versions[runtime] ?? null), mode: "employee", isolation: "per-attempt sandbox", startedBy: binding.startedBy } });
      return { ok: true as const, plan, token, isolationRequired: effective.constitution.obligations.isolation === "required", network: networkOf(effective.constitution) };
    });
  }

  // The run ended (however it did): recorded, and its token ends.
  async finished(plan: RunPlan, runId: string, status: string, exitCode: number | null): Promise<void> {
    await this.endBinding(plan.binding, runId, status, exitCode);
  }

  // A run whose worker is gone, ended by the worker that recovered it: its token ends (if it had not), recorded the same way.
  async abandoned(accountId: string, runId: string, status: string): Promise<void> {
    const binding = await this.bindings.get(accountId, runId);
    if (binding !== null && binding.endedAt === null) await this.endBinding(binding, runId, status, null);
  }

  private async endBinding(binding: RunBinding, runId: string, status: string, exitCode: number | null): Promise<void> {
    await this.db.tx(async () => {
      await this.bindings.end(runId, new Date().toISOString());
      await this.audit.record(contextOf({ kind: "agent", binding }), { type: "run.finished", outcome: status, data: { status, exitCode } });
    });
  }

  // What must hold before anything is bound: a policy in effect, and the isolation it obliges.
  private async precheck(ctx: GovernanceContext, scope: EnforcementScope, resourceId: string, runId: string): Promise<{ ok: true; revisionId: string; revision: number | null; isolation: IsolationState | "not_applicable" } | { ok: false; message: string; reasonCodes: string[] }> {
    const accountId = ctx.accountId as string;
    const effective = await this.policy.effective(accountId);
    if (effective === null) return this.refused(ctx, scope, resourceId, runId, "This account has no policy in effect, so nothing may run: publish one under Governance → Policy.", ["NO_PUBLISHED_POLICY"]);
    const isolation = await this.isolationFor(effective.constitution.obligations.isolation);
    if (isolation.refused) return this.refused(ctx, scope, resourceId, runId, isolation.message, ["ISOLATION_NOT_PROVEN"]);
    this.runtimeVersion ??= (await this.toolchain.get()).versions.claude;
    return { ok: true, revisionId: effective.record.id, revision: effective.record.revision, isolation: isolation.state };
  }

  private async refused(ctx: GovernanceContext, scope: EnforcementScope, resourceId: string, runId: string, message: string, reasonCodes: string[]): Promise<Refusal> {
    await this.audit.record(ctx, { type: "run.refused", outcome: "refused", workspaceId: resourceId, runId, reasonCodes, data: { scope, cause: reasonCodes.join(",") } });
    return { ok: false, message, reasonCodes };
  }

  // The policy does not let this agent start a run here: the binding ends at once, and the refusal is recorded.
  private async refusedStart(ctx: GovernanceContext, scope: EnforcementScope, binding: RunBinding, start: Decision): Promise<Refusal> {
    await this.bindings.end(binding.runId, new Date().toISOString());
    return this.refused(ctx, scope, binding.resourceId, binding.runId, `The account's policy in effect does not let this agent start a run here (${start.reasonCodes.join(", ")}).`, start.reasonCodes);
  }

  private async allowed(connectors: readonly RunConnector[], decide: (c: RunConnector) => Promise<Decision>): Promise<RunConnector[]> {
    const out: RunConnector[] = [];
    for (const c of connectors) if ((await decide(c)).verdict === "allow") out.push(c);
    return out;
  }

  private async isolationFor(obligation: "required" | "optional"): Promise<{ refused: boolean; state: IsolationState; message: string }> {
    if (obligation === "optional") return { refused: false, state: (await this.isolation.status()).state, message: "" };
    const status = await this.isolation.attest();
    if (status.state === "attested") return { refused: false, state: status.state, message: "" };
    const message =
      status.deployment === "single"
        ? "This account's policy requires the agent to run isolated from Orbit Web, and here Claude Code runs in the same container as Orbit Web: isolation is not proven. Run Orbit Web as the governed deployment (docker/compose.governed.yaml), or make isolation optional in the policy."
        : `This account's policy requires the agent to run isolated, and the agent's container did not pass its isolation check just now: ${status.detail}`;
    return { refused: true, state: status.state, message };
  }

  private async mint(b: Bound, runId: string): Promise<{ binding: RunBinding; token: string }> {
    const token = randomBytes(32).toString("base64url");
    const now = Date.now();
    const binding: RunBinding = { runId, ...b, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + RUN_TOKEN_TTL_MS).toISOString(), endedAt: null };
    await this.bindings.insert({ ...binding, tokenHash: sha256(token) });
    return { binding, token };
  }

  // What the run's process is given. A chat: the gateway and its own token. In the governed deployment: its only way out
  // (the proxy, with the token as its credential, so each connection is decided as this run), and no claude.ai connector
  // or non-essential traffic -- nothing that would leave by another door. Research has no gateway.
  private envFor(token: string, kind: RunBinding["kind"]): Record<string, string> {
    const g = this.config.governance;
    const gateway: Record<string, string> = kind === "chat" ? { ORBIT_AGENT_GATEWAY: `http://${g.agentControlHost}:${this.config.port}/api/agent`, ORBIT_AGENT_TOKEN: token } : {};
    if (g.deployment !== "governed" || g.proxyPort === null) return gateway;
    return { ...gateway, ...egressProxyEnv(g.agentControlHost, g.proxyPort, "run", token), ENABLE_CLAUDEAI_MCP_SERVERS: "false" };
  }

  private async started(ctx: GovernanceContext, plan: RunPlan, mode: string, startedBy: string): Promise<void> {
    await this.audit.record(ctx, { type: "run.started", outcome: "started", workspaceId: plan.binding.resourceId, data: { scope: plan.scope, runtime: "claude-code", runtimeVersion: this.runtimeVersion, mode, isolation: plan.isolation, startedBy } });
  }
}
