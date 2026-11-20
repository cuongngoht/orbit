// WHO WORKS UNDER GOVERNANCE, and where: agents a person registered, the workspaces (chats) a person placed under
// governance -- each with ONE registered agent and the strict profile -- and the overlays that narrow the Constitution
// for a project, a workspace or an agent. A workspace no person governed is LEGACY_ORBIT and runs as Orbit Web always
// did; a governed one is GOVERNED_WORKSPACE, says so in everything it records, and runs only as the Constitution allows.
// An agent's identity is never what an agent says: it is this registration, bound by Orbit Web to the run it starts.
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { canonicalJson, checkOverlay, lintRules, OVERLAY_LEVELS, type EnforcementScope } from "@orbit-web/governance-core";
import {
  checkGovernWorkspace,
  checkRegisterAgent,
  checkSetOverlay,
  type AgentView,
  type OverlayList,
  type OverlayView,
  type WorkspaceGovernanceView,
} from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { EventBus } from "../../core/events/event-bus.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { GovernanceDatabase } from "../../infra/governance/governance-db.js";
import { AgentStore, GovernedWorkspaceStore, OperatorStore, OverlayStore, sha256, type AgentRecord, type GovernedWorkspaceRecord } from "../../infra/governance/stores.js";
import { SessionStore } from "../../infra/storage/stores.js";
import { AuditService } from "./audit.service.js";
import { labelOf, type GovernanceContext } from "./principal.js";

const agentView = (a: AgentRecord): AgentView => ({ id: a.id, name: a.name, runtime: a.runtime, status: a.status, createdAt: a.createdAt, createdBy: a.createdBy });

export interface WorkspaceGovernance {
  scope: EnforcementScope;
  record: GovernedWorkspaceRecord | null;
  agent: AgentRecord | null;
}

@Injectable()
export class RegistryService {
  constructor(
    @Inject(GovernanceDatabase) private readonly database: GovernanceDatabase,
    @Inject(AgentStore) private readonly agents: AgentStore,
    @Inject(GovernedWorkspaceStore) private readonly governed: GovernedWorkspaceStore,
    @Inject(OverlayStore) private readonly overlays: OverlayStore,
    @Inject(OperatorStore) private readonly operators: OperatorStore,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  // ---- agents -------------------------------------------------------------------------------------------------------

  agentList(): AgentView[] {
    return this.agents.list().map(agentView);
  }

  register(ctx: GovernanceContext, body: unknown): AgentView {
    const req = accepted(checkRegisterAgent(body));
    const agent: AgentRecord = { id: `agt-${randomUUID().slice(0, 13)}`, name: req.name, runtime: "claude-code", status: "active", createdAt: new Date().toISOString(), createdBy: labelOf(ctx.principal) };
    return this.database.transaction(() => {
      this.agents.insert(agent);
      this.audit.record(ctx, { type: "agent.registered", outcome: "registered", agentId: agent.id, data: { runtime: agent.runtime, name: agent.name } });
      this.changed("agents", agent.id);
      return agentView(agent);
    });
  }

  setAgentStatus(ctx: GovernanceContext, id: string, status: "active" | "suspended"): AgentView {
    const agent = this.agents.get(id);
    if (agent === null) throw notFound("The agent");
    if (agent.status === status) return agentView(agent);
    return this.database.transaction(() => {
      this.agents.setStatus(id, status);
      this.audit.record(ctx, { type: status === "suspended" ? "agent.suspended" : "agent.reinstated", outcome: status, agentId: id });
      this.changed("agents", id);
      return agentView({ ...agent, status });
    });
  }

  // ---- workspaces -----------------------------------------------------------------------------------------------------

  of(sessionId: string): WorkspaceGovernance {
    const record = this.governed.get(sessionId);
    return { scope: record === null ? "LEGACY_ORBIT" : "GOVERNED_WORKSPACE", record, agent: record === null ? null : this.agents.get(record.agentId) };
  }

  workspaceList(): WorkspaceGovernanceView[] {
    const records = new Map(this.governed.list().map((g) => [g.sessionId, g]));
    const live = this.sessions.list().map((s) => {
      const g = records.get(s.id) ?? null;
      return { sessionId: s.id, title: s.title, repository: s.repository, status: s.status, scope: g === null ? ("LEGACY_ORBIT" as const) : ("GOVERNED_WORKSPACE" as const), agentId: g?.agentId ?? null, profile: g?.profile ?? null, governedAt: g?.governedAt ?? null, governedBy: g?.governedBy ?? null };
    });
    // A governed workspace whose chat was deleted is still listed: what governed it stays on record.
    const gone = [...records.values()].filter((g) => this.sessions.get(g.sessionId) === null).map((g) => ({ sessionId: g.sessionId, title: "(chat deleted)", repository: null, status: "deleted", scope: "GOVERNED_WORKSPACE" as const, agentId: g.agentId, profile: g.profile, governedAt: g.governedAt, governedBy: g.governedBy }));
    return [...live, ...gone];
  }

  govern(ctx: GovernanceContext, sessionId: string, body: unknown): WorkspaceGovernanceView {
    const req = accepted(checkGovernWorkspace(body));
    const session = this.sessions.get(sessionId);
    if (session === null) throw notFound("The chat");
    const agent = this.agents.get(req.agentId);
    if (agent === null) throw notFound("The agent");
    if (agent.status !== "active") throw conflict("agent_suspended", `${agent.name} is suspended: a workspace is governed by an active agent.`);
    if (session.status === "running") throw conflict("run_active", "Claude is working in this chat: stop it or wait for it to finish, then govern it.");
    const previous = this.governed.get(sessionId);
    // Handing a governed workspace to ANOTHER agent takes it out from under the first agent's overlays: it is an
    // administrator's move, as releasing it is -- never the workspace operator's alone.
    if (previous !== null && previous.agentId !== agent.id && !(ctx.principal.kind === "operator" && ctx.principal.permissions.includes("agents.manage"))) {
      this.audit.record(ctx, { type: "authz.denied", outcome: "refused", workspaceId: sessionId, data: { permission: "agents.manage", route: `govern ${sessionId}`, cause: "reassign_agent" } });
      throw new ApiError(HttpStatus.FORBIDDEN, "permission_required", "This workspace is governed by another agent: moving it to a different agent needs the agents.manage permission.");
    }
    const record: GovernedWorkspaceRecord = { sessionId, agentId: agent.id, profile: req.profile, governedAt: new Date().toISOString(), governedBy: labelOf(ctx.principal) };
    return this.database.transaction(() => {
      this.governed.set(record);
      this.audit.record(ctx, { type: "workspace.governed", outcome: previous === null || previous.agentId === agent.id ? "governed" : "reassigned", workspaceId: sessionId, agentId: agent.id, data: { profile: req.profile, previousAgentId: previous?.agentId ?? null } });
      this.changed("workspaces", sessionId);
      return { sessionId, title: session.title, repository: session.repository, status: session.status, scope: "GOVERNED_WORKSPACE", agentId: agent.id, profile: req.profile, governedAt: record.governedAt, governedBy: record.governedBy };
    });
  }

  release(ctx: GovernanceContext, sessionId: string): void {
    const record = this.governed.get(sessionId);
    if (record === null) throw notFound("A governed workspace");
    if (this.sessions.get(sessionId)?.status === "running") throw conflict("run_active", "Claude is working in this chat: stop it or wait for it to finish first.");
    this.database.transaction(() => {
      this.governed.remove(sessionId);
      this.audit.record(ctx, { type: "workspace.released", outcome: "released", workspaceId: sessionId, agentId: record.agentId });
      this.changed("workspaces", sessionId);
    });
  }

  // ---- overlays ------------------------------------------------------------------------------------------------------

  overlayList(): OverlayList {
    return { overlays: this.overlays.list().map((o) => ({ overlay: JSON.parse(o.document) as OverlayView["overlay"], digest: o.digest, setAt: o.setAt, setBy: o.setBy })) };
  }

  setOverlay(ctx: GovernanceContext, body: unknown): OverlayView & { warnings: ReturnType<typeof lintRules> } {
    const req = accepted(checkSetOverlay(body));
    const checked = checkOverlay(req.overlay);
    if (!checked.ok) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_overlay", `This is not a valid overlay: ${checked.errors.join("; ")}`, { errors: checked.errors });
    const org = this.operators.organization()?.id ?? "uninitialized";
    if (checked.value.metadata.organizationId !== org) throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, "invalid_overlay", `metadata.organizationId must be this organization's id, ${org}`);
    const text = canonicalJson(checked.value);
    const record = { level: checked.value.metadata.level, target: checked.value.metadata.target, document: text, digest: sha256(text), setAt: new Date().toISOString(), setBy: labelOf(ctx.principal) };
    return this.database.transaction(() => {
      this.overlays.set(record);
      this.audit.record(ctx, { type: "overlay.set", outcome: "set", data: { level: record.level, target: record.target, digest: record.digest } });
      this.changed("overlays", `${record.level}:${record.target}`);
      return { overlay: checked.value, digest: record.digest, setAt: record.setAt, setBy: record.setBy, warnings: lintRules(checked.value.rules, true) };
    });
  }

  removeOverlay(ctx: GovernanceContext, level: string, target: string): void {
    if (!(OVERLAY_LEVELS as readonly string[]).includes(level)) throw notFound("The overlay");
    this.database.transaction(() => {
      if (!this.overlays.remove(level, target)) throw notFound("The overlay");
      this.audit.record(ctx, { type: "overlay.removed", outcome: "removed", data: { level, target } });
      this.changed("overlays", `${level}:${target}`);
    });
  }

  private changed(area: "agents" | "workspaces" | "overlays", id: string): void {
    this.database.afterCommit(() => this.bus.publishApp("governance.changed", { area, id }));
  }
}
