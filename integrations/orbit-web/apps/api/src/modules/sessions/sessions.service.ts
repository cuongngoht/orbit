// Chat sessions: a workspace (cloned from a repository of either source, or empty), one model, effort and mode
// preference, one Claude Code conversation. A session publishes what happens to it on the event bus: its own stream
// (`session.status`) and, for every page, the app stream (`session.summary`, `session.removed`).
import { Inject, Injectable } from "@nestjs/common";
import { checkCreateSession, checkUpdateSession, CLAUDE_SIGN_IN_REQUIRED, type SessionDetail, type SessionSummary } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { isSessionId } from "../../common/workspace-path.js";
import { MessageStore, SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { ClaudeAuthService } from "../claude-auth/claude-auth.service.js";
import { ClaudeRunnerService } from "../claude-runner/claude-runner.service.js";
import { SettingsService } from "../settings/settings.module.js";
import { SourcesService } from "../sources/sources.module.js";
import { WorkspaceService } from "./workspace.service.js";

export const summaryOf = (s: SessionRecord): SessionSummary => ({
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
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

export const titleFrom = (prompt: string | undefined, repository: string | null): string => {
  const line = (prompt ?? "").trim().split("\n")[0]?.trim() ?? "";
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
  ) {}

  list(): SessionSummary[] {
    return this.sessions.list().map(summaryOf);
  }

  detail(id: string): SessionDetail {
    const s = this.record(id);
    return { ...summaryOf(s), baseCommit: s.baseCommit, claudeSessionId: s.turns > 0 ? s.claudeSessionId : null, turns: s.turns, lastSeq: s.lastSeq, messages: this.messages.list(id) };
  }

  // With a repository: it must be one its source lists, and the branch one of its branches (its default when none was
  // named). Without one: an empty workspace. Then the workspace is prepared in the background; the first prompt, when
  // given, is sent once it is ready.
  async create(body: unknown): Promise<SessionSummary> {
    const req = accepted(checkCreateSession(body));
    // The gate already holds every route to the Claude sign-in; this is the same rule, said where the account is used.
    if ((await this.claude.account()).state !== "connected") throw new ApiError(401, CLAUDE_SIGN_IN_REQUIRED, "Sign in to Orbit Web with your Claude account first.");
    const origin = req.repository ? await this.sources.open(req.repository, req.branch ?? null) : null;
    const prefs = this.settings.get();
    const id = randomUUID();
    const session = this.sessions.create({
      id,
      title: req.title ?? titleFrom(req.prompt, origin?.fullName ?? null),
      source: origin?.source ?? null,
      repository: origin?.fullName ?? null,
      repositoryId: origin?.id ?? null,
      branch: origin?.branch ?? null,
      model: req.model,
      effort: req.effort ?? prefs.defaultEffort,
      mode: req.mode ?? prefs.defaultMode,
      workspacePath: this.workspaces.pathFor(id),
      claudeSessionId: randomUUID(),
      status: "preparing",
      pendingPrompt: req.prompt ?? null,
    });
    this.bus.publishSession(id, "session.status", { status: "preparing", reason: null });
    void this.workspaces.prepare(session);
    return summaryOf(session);
  }

  update(id: string, body: unknown): SessionSummary {
    this.record(id);
    const change = accepted(checkUpdateSession(body));
    const summary = summaryOf(this.sessions.update(id, change));
    this.bus.publishApp("session.summary", { session: summary });
    return summary;
  }

  // Removes the chat, its events and its workspace. Claude Code's own transcript and Orbit's store keep what they
  // recorded, as each of them keeps it.
  delete(id: string): void {
    const s = this.record(id);
    if (s.status === "running" || this.runner.isRunning(id)) throw conflict("run_active", "Stop the run before deleting this chat.");
    if (s.status === "preparing") throw conflict("workspace_preparing", "Wait until the workspace is prepared (or fails) before deleting this chat.");
    this.sessions.delete(id);
    this.workspaces.remove(id);
    rmSync(join(this.config.data.sessions, id), { recursive: true, force: true });
    this.bus.publishApp("session.removed", { sessionId: id });
  }

  record(id: string): SessionRecord {
    if (!isSessionId(id)) throw notFound("Session");
    const s = this.sessions.get(id);
    if (!s) throw notFound("Session");
    return s;
  }
}
