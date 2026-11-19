// Chat sessions: one repository, one branch, one model preference, one workspace, one Claude Code conversation.
import { Inject, Injectable } from "@nestjs/common";
import { checkCreateSession, checkUpdateSession, type SessionDetail, type SessionSummary } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { EventHub } from "../../core/event-hub.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, badRequest, conflict, notFound } from "../../common/errors.js";
import { isSessionId } from "../../common/workspace-path.js";
import { MessageStore, SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { ClaudeAuthService } from "../claude-auth/claude-auth.service.js";
import { ClaudeRunnerService } from "../claude-runner/claude-runner.service.js";
import { GithubAuthService } from "../github/github-auth.service.js";
import { OrbitService } from "../orbit/orbit.service.js";
import { RepositoriesService } from "../repositories/repositories.module.js";
import { WorkspaceService } from "./workspace.service.js";

export const summaryOf = (s: SessionRecord): SessionSummary => ({
  id: s.id,
  title: s.title,
  repository: s.repository,
  branch: s.branch,
  workBranch: s.workBranch,
  model: s.model,
  status: s.status,
  statusReason: s.statusReason,
  createdAt: s.createdAt,
  updatedAt: s.updatedAt,
});

const titleFrom = (prompt: string | undefined, repository: string): string => {
  const line = (prompt ?? "").trim().split("\n")[0]?.trim() ?? "";
  if (line.length === 0) return `Chat on ${repository}`;
  return line.length > 60 ? `${line.slice(0, 59)}…` : line;
};

@Injectable()
export class SessionsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(MessageStore) private readonly messages: MessageStore,
    @Inject(EventHub) private readonly hub: EventHub,
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(GithubAuthService) private readonly github: GithubAuthService,
    @Inject(RepositoriesService) private readonly repositories: RepositoriesService,
    @Inject(WorkspaceService) private readonly workspaces: WorkspaceService,
    @Inject(ClaudeRunnerService) private readonly runner: ClaudeRunnerService,
    @Inject(OrbitService) private readonly orbit: OrbitService,
  ) {}

  list(): SessionSummary[] {
    return this.sessions.list().map(summaryOf);
  }

  detail(id: string): SessionDetail {
    const s = this.record(id);
    return { ...summaryOf(s), baseCommit: s.baseCommit, claudeSessionId: s.turns > 0 ? s.claudeSessionId : null, turns: s.turns, lastSeq: s.lastSeq, messages: this.messages.list(id) };
  }

  // Checks both accounts, the repository (it must be one the account can reach) and the branch, then prepares the
  // workspace in the background; the first prompt, when given, is sent once the workspace is ready.
  async create(body: unknown): Promise<SessionSummary> {
    const req = accepted(checkCreateSession(body));
    if ((await this.claude.account()).state !== "connected") throw conflict("claude_not_connected", "Connect your Claude account first.");
    if ((await this.github.connection()).state !== "connected") throw conflict("github_not_connected", "Connect GitHub first.");
    const repo = await this.repositories.authorized(req.repository);
    const [owner, name] = [repo.owner, repo.name];
    const branches = await this.repositories.branches(owner, name);
    if (!branches.branches.some((b) => b.name === req.branch)) throw badRequest(`${req.branch} is not a branch of ${repo.fullName}`);
    const id = randomUUID();
    const session = this.sessions.create({
      id,
      title: req.title ?? titleFrom(req.prompt, repo.fullName),
      repository: repo.fullName,
      branch: req.branch,
      model: req.model,
      workspacePath: this.workspaces.pathFor(id),
      claudeSessionId: randomUUID(),
      status: "preparing",
      pendingPrompt: req.prompt ?? null,
    });
    this.hub.emit(id, "session.status", { status: "preparing", reason: null }, null);
    void this.workspaces.prepare(session);
    return summaryOf(session);
  }

  update(id: string, body: unknown): SessionSummary {
    this.record(id);
    const change = accepted(checkUpdateSession(body));
    return summaryOf(this.sessions.update(id, change));
  }

  // Removes the chat, its events and its workspace. Claude Code's own transcript and Orbit's store keep what they
  // recorded, as each of them keeps it.
  delete(id: string): void {
    const s = this.record(id);
    if (s.status === "running" || this.runner.isRunning(id)) throw conflict("run_active", "Stop the run before deleting this chat.");
    if (s.status === "preparing") throw conflict("workspace_preparing", "Wait until the workspace is prepared (or fails) before deleting this chat.");
    this.orbit.forget(id);
    this.hub.dropLive(id);
    this.sessions.delete(id);
    this.workspaces.remove(id);
    rmSync(join(this.config.data.sessions, id), { recursive: true, force: true });
  }

  record(id: string): SessionRecord {
    if (!isSessionId(id)) throw notFound("Session");
    const s = this.sessions.get(id);
    if (!s) throw notFound("Session");
    return s;
  }
}
