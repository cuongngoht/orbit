// A session's own checkout: /data/workspaces/<session-id>/repository. Cloned with `gh repo clone` from the branch a
// person chose, then moved to a branch of its own (orbit-web/<short id>) so the chosen branch is never written
// directly, given a local commit identity from the GitHub account (its noreply address), and seated with Orbit
// (its project in the machine store; nothing is written into the checkout). Nothing is ever pushed from here.
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { mkdirSync, rmSync } from "node:fs";
import type { AppConfig } from "../../config/config.js";
import { EventHub } from "../../core/event-hub.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { contained, repositoryDir, sessionRoot } from "../../common/workspace-path.js";
import { endedHow, succeeded, type RunResult } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import { SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { GitGateway } from "../changes/git.gateway.js";
import { ClaudeRunnerService } from "../claude-runner/claude-runner.service.js";
import { GhGateway } from "../github/gh.gateway.js";
import { GithubAuthService } from "../github/github-auth.service.js";
import { OrbitGateway } from "../orbit/orbit.gateway.js";

export const workBranchOf = (sessionId: string): string => `orbit-web/${sessionId.slice(0, 8)}`;

class StepFailed extends Error {
  constructor(readonly step: string, message: string) {
    super(message);
  }
}

const must = (step: string, r: RunResult, what: string): RunResult => {
  if (!succeeded(r)) throw new StepFailed(step, `${what} ${endedHow(r)}: ${tail(r.stderr || r.stdout, 4)}`);
  return r;
};

@Injectable()
export class WorkspaceService implements OnModuleInit {
  private readonly logger = new Logger("Workspace");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(EventHub) private readonly hub: EventHub,
    @Inject(GhGateway) private readonly gh: GhGateway,
    @Inject(GitGateway) private readonly git: GitGateway,
    @Inject(GithubAuthService) private readonly github: GithubAuthService,
    @Inject(OrbitGateway) private readonly orbit: OrbitGateway,
    @Inject(ClaudeRunnerService) private readonly runner: ClaudeRunnerService,
  ) {}

  // A preparation a restart cut short is not taken up again: the session says so and may be deleted.
  onModuleInit(): void {
    for (const s of this.sessions.withStatus("preparing")) this.failed(s.id, "restart", "Orbit Web restarted while this workspace was being prepared. Delete this chat and start a new one.");
  }

  pathFor(sessionId: string): string {
    return repositoryDir(this.config.data, sessionId);
  }

  // Runs in the background after the session is created; every step is an event the chat shows.
  async prepare(session: SessionRecord): Promise<void> {
    try {
      await this.clone(session);
      const baseCommit = await this.branch(session);
      await this.identity(session);
      const orbitSeated = await this.seat(session);
      const ready = this.sessions.update(session.id, { status: "ready", statusReason: null, baseCommit, workBranch: workBranchOf(session.id) });
      this.hub.emit(session.id, "workspace.ready", { repository: session.repository, branch: session.branch, workBranch: workBranchOf(session.id), baseCommit, orbitSeated }, null);
      this.hub.emit(session.id, "session.status", { status: "ready", reason: null }, null);
      this.sendPending(ready);
    } catch (err) {
      const step = err instanceof StepFailed ? err.step : "prepare";
      this.failed(session.id, step, err instanceof Error ? err.message : String(err));
    }
  }

  remove(sessionId: string): void {
    const root = sessionRoot(this.config.data, sessionId);
    if (contained(this.config.data.workspaces, root)) rmSync(root, { recursive: true, force: true });
  }

  private async clone(session: SessionRecord): Promise<void> {
    const root = sessionRoot(this.config.data, session.id);
    if (!contained(this.config.data.workspaces, root)) throw new StepFailed("clone", "The workspace path is outside the workspaces directory.");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    this.hub.emit(session.id, "workspace.preparing", { repository: session.repository, branch: session.branch, step: "clone" }, null);
    const [owner, name] = session.repository.split("/") as [string, string];
    must("clone", await this.gh.clone(owner, name, session.branch, "repository", root), `gh repo clone ${session.repository}`);
  }

  private async branch(session: SessionRecord): Promise<string> {
    this.hub.emit(session.id, "workspace.preparing", { repository: session.repository, branch: session.branch, step: "branch" }, null);
    const head = must("branch", await this.git.head(session.workspacePath), "git rev-parse HEAD").stdout.trim();
    must("branch", await this.git.createBranch(session.workspacePath, workBranchOf(session.id)), "git checkout -b");
    return head;
  }

  // Local commits made in the workspace carry the GitHub account's name and its private noreply address.
  private async identity(session: SessionRecord): Promise<void> {
    this.hub.emit(session.id, "workspace.preparing", { repository: session.repository, branch: session.branch, step: "identity" }, null);
    const account = (await this.github.connection()).account;
    if (account === null) return;
    const id = this.github.accountId();
    const email = id !== null ? `${id}+${account.login}@users.noreply.github.com` : `${account.login}@users.noreply.github.com`;
    must("identity", await this.git.setConfig(session.workspacePath, "user.name", account.name ?? account.login), "git config user.name");
    must("identity", await this.git.setConfig(session.workspacePath, "user.email", email), "git config user.email");
  }

  private async seat(session: SessionRecord): Promise<boolean> {
    this.hub.emit(session.id, "workspace.preparing", { repository: session.repository, branch: session.branch, step: "orbit" }, null);
    const r = await this.orbit.seat(session.workspacePath);
    if (!succeeded(r)) this.hub.emit(session.id, "run.notice", { kind: "info", message: `Orbit could not seat this checkout (${endedHow(r)}); Claude Code still loads the plugin. ${tail(r.stderr, 2)}` }, null);
    return succeeded(r);
  }

  private sendPending(session: SessionRecord): void {
    if (session.pendingPrompt === null) return;
    const prompt = session.pendingPrompt;
    this.sessions.update(session.id, { pendingPrompt: null });
    try {
      this.runner.send(session.id, prompt);
    } catch (err) {
      this.hub.emit(session.id, "run.notice", { kind: "info", message: `The first message was not sent: ${err instanceof Error ? err.message : String(err)}` }, null);
    }
  }

  private failed(sessionId: string, step: string, message: string): void {
    this.logger.warn(`workspace of ${sessionId} failed at ${step}`);
    this.sessions.update(sessionId, { status: "setup_failed", statusReason: message.slice(0, 300) });
    this.hub.emit(sessionId, "workspace.failed", { step, message }, null);
    this.hub.emit(sessionId, "session.status", { status: "setup_failed", reason: message.slice(0, 300) }, null);
  }
}
