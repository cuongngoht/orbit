// Chat sessions: a workspace (cloned from a repository of either source, or empty), one model, effort and mode
// preference, one Claude Code conversation. A session publishes what happens to it on the event bus: its own stream
// (`session.status`) and, for every page, the app stream (`session.summary`, `session.removed`).
import { Inject, Injectable } from "@nestjs/common";
import { checkCreateSession, checkUpdateSession, CLAUDE_SIGN_IN_REQUIRED, type AccessLevel, type SessionDetail, type SessionSummary } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { AgentFs } from "../../infra/process/agent-fs.js";
import { MirrorService } from "../sources/mirror.service.js";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { isSessionId } from "../../common/workspace-path.js";
import { redactSecrets } from "../../infra/security/redact.js";
import { MessageStore, SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { OwnershipService, requireIdentity } from "../access/ownership.service.js";
import { ClaudeAuthService } from "../claude-auth/claude-auth.service.js";
import { ClaudeModelsService } from "../claude-auth/claude-models.service.js";
import { ClaudeRunnerService } from "../claude-runner/claude-runner.service.js";
import { SettingsService } from "../settings/settings.module.js";
import { SourcesService } from "../sources/sources.module.js";
import { AuditService } from "../governance/audit.service.js";
import type { GovernanceContext } from "../governance/principal.js";
import { RegistryService } from "../governance/registry.service.js";
import { WorkspaceService } from "./workspace.service.js";

// A chat as an account sees it: `access` is that account's (its own, or shared with it).
export const summaryOf = (s: SessionRecord, access: AccessLevel = "owner"): SessionSummary => ({
  id: s.id,
  title: s.title,
  source: s.source,
  repository: s.repository,
  branch: s.branch,
  workBranch: s.workBranch,
  model: s.model,
  effort: s.effort,
  mode: s.mode,
  status: s.status,
  statusReason: s.statusReason,
  access,
  owner: s.ownerEmail,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

// The first line of the first message, masked by token shape BEFORE it is cut: a credential cut in half no longer has
// its shape, and a title is shown everywhere (the sidebar, a shared chat's page).
export const titleFrom = (prompt: string | undefined, repository: string | null): string => {
  const line = redactSecrets((prompt ?? "").trim().split("\n")[0]?.trim() ?? "");
  if (line.length === 0) return repository === null ? "New chat" : `Chat on ${repository}`;
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

@Injectable()
export class SessionsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(MessageStore) private readonly messages: MessageStore,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SourcesService) private readonly sources: SourcesService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(ClaudeRunnerService) private readonly runner: ClaudeRunnerService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(RegistryService) private readonly registry: RegistryService,
    @Inject(AgentFs) private readonly files: AgentFs,
    @Inject(MirrorService) private readonly mirror: MirrorService,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
    @Inject(ClaudeModelsService) private readonly models: ClaudeModelsService,
  ) {}

  // The chats of the account signed in now: its own, and those shared with it.
  async list(): Promise<SessionSummary[]> {
    const identity = await this.ownership.viewer();
    return this.ownership.visible(identity).map((s) => summaryOf(s, this.ownership.levelOf(s, identity) ?? "shared"));
  }

  detail(id: string): SessionDetail {
    const s = this.record(id);
    return { ...this.summary(s), baseCommit: s.baseCommit, claudeSessionId: s.turns > 0 ? s.claudeSessionId : null, turns: s.turns, lastSeq: s.lastSeq, messages: this.messages.list(id) };
  }

  // As the account signed in now sees it.
  summary(s: SessionRecord): SessionSummary {
    return summaryOf(s, this.ownership.levelNow(s) ?? "owner");
  }

  // With a repository: it must be one its source lists, and the branch one of its branches (its default when none was
  // named). Without one: an empty workspace. Then the workspace is prepared in the background; the first prompt, when
  // given, is sent once it is ready.
  async create(body: unknown): Promise<SessionSummary> {
    const req = accepted(checkCreateSession(body));
    // The gate already holds every route to the Claude sign-in; this is the same rule, said where the account is used.
    if ((await this.claude.account()).state !== "connected") throw new ApiError(401, CLAUDE_SIGN_IN_REQUIRED, "Sign in to Orbit Web with your Claude account first.");
    const owner = requireIdentity(await this.ownership.viewer());
    const prefs = this.settings.get();
    // The model, effort and mode, held to what this account may use.
    const run = await this.models.settle({ model: req.model, effort: prefs.defaultEffort, mode: prefs.defaultMode }, { ...(req.effort ? { effort: req.effort } : {}), ...(req.mode ? { mode: req.mode } : {}) });
    const origin = req.repository ? await this.sources.open(req.repository, req.branch ?? null) : null;
    const id = randomUUID();
    const session = this.sessions.create({
      id,
      title: req.title ?? titleFrom(req.prompt, origin?.fullName ?? null),
      source: origin?.source ?? null,
      repository: origin?.fullName ?? null,
      repositoryId: origin?.id ?? null,
      branch: origin?.branch ?? null,
      model: run.model,
      effort: run.effort,
      mode: run.mode ?? prefs.defaultMode,
      workspacePath: this.workspaces.pathFor(id),
      claudeSessionId: randomUUID(),
      status: "preparing",
      pendingPrompt: req.prompt ?? null,
      ownerEmail: owner.email,
      ownerOrg: owner.org,
    });
    this.bus.publishSession(id, "session.status", { status: "preparing", reason: null });
    void this.workspaces.prepare(session);
    return summaryOf(session, "owner");
  }

  // A rename, or the model, effort or mode of the next message -- held to what this account may use (an effort the new
  // model does not take moves to one it does).
  async update(id: string, body: unknown): Promise<SessionSummary> {
    const s = this.record(id);
    const change = accepted(checkUpdateSession(body));
    const runChanged = change.model !== undefined || change.effort !== undefined || change.mode !== undefined;
    const run = runChanged ? await this.models.settle({ model: s.model, effort: s.effort, mode: s.mode }, change) : null;
    const updated = this.sessions.update(id, { ...change, ...(run !== null ? { model: run.model, effort: run.effort, mode: run.mode ?? s.mode } : {}) });
    const summary = this.summary(updated);
    this.bus.publishApp("session.summary", { session: summary });
    return summary;
  }

  // Removes the chat, its events and its workspace. Claude Code's own transcript and Orbit's store keep what they
  // recorded, as each of them keeps it -- and so does governance: its records are in a database of their own, which a
  // chat's deletion never reaches. The deletion itself is recorded there first; if it cannot be, nothing is deleted.
  async delete(id: string, ctx: GovernanceContext): Promise<void> {
    const s = this.record(id);
    if (s.status === "running" || this.runner.isRunning(id)) throw conflict("run_active", "Stop the run before deleting this chat.");
    if (this.runner.isBusy(id)) throw conflict("workspace_busy", "Wait until the working branch has moved before deleting this chat.");
    if (s.status === "preparing") throw conflict("workspace_preparing", "Wait until the workspace is prepared (or fails) before deleting this chat.");
    this.audit.record(ctx, { type: "session.deleted", outcome: "deleted", workspaceId: id, data: { scope: this.registry.of(id).scope } });
    this.sessions.delete(id);
    await this.workspaces.remove(id);
    await this.files.rmrf(join(this.config.data.sessions, id));
    // The control plane's own copy of the repository: its own to remove.
    rmSync(this.mirror.path(id), { recursive: true, force: true });
    this.bus.publishApp("session.removed", { sessionId: id });
  }

  record(id: string): SessionRecord {
    if (!isSessionId(id)) throw notFound("Session");
    const s = this.sessions.get(id);
    if (!s) throw notFound("Session");
    return s;
  }
}
