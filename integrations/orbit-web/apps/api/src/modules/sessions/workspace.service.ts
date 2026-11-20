// A session's own workspace: /data/workspaces/<session-id>/repository. Cloned from the branch a person chose (GitHub
// with `gh repo clone`, Azure DevOps with `git clone` and the image's one-shot credential helper) -- or, for a chat
// with no repository, an empty repository with one empty commit as its base. Then moved to a branch of its own
// (orbit-web/<short id>) so the chosen branch is never written directly, given a local commit identity, seated with
// Orbit (its project in the machine store; nothing is written into the checkout), and its project's skills and plugins
// read and loaded. Every step is a session event. Nothing is ever pushed from here.
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { WorkspaceStep } from "@orbit-web/contracts";
import { mkdirSync, rmSync } from "node:fs";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { contained, repositoryDir, sessionRoot } from "../../common/workspace-path.js";
import { endedHow, succeeded, type RunResult } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import { SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { AzureAuthService } from "../azure-auth/azure-auth.service.js";
import { GitGateway } from "../changes/git.gateway.js";
import { ClaudeAuthService } from "../claude-auth/claude-auth.service.js";
import { ClaudeRunnerService } from "../claude-runner/claude-runner.service.js";
import { GithubAuthService } from "../github/github-auth.service.js";
import { OrbitGateway } from "../orbit/orbit.gateway.js";
import { ProjectService } from "../project/project.service.js";
import { SourcesService } from "../sources/sources.module.js";

export const workBranchOf = (sessionId: string): string => `orbit-web/${sessionId.slice(0, 8)}`;

class StepFailed extends Error {
  constructor(
    readonly step: string,
    message: string,
  ) {
    super(message);
  }
}

const must = (step: string, r: RunResult, what: string): RunResult => {
  if (!succeeded(r)) throw new StepFailed(step, `${what} ${endedHow(r)}: ${tail(r.stderr || r.stdout, 4)}`);
  return r;
};

interface Identity {
  name: string;
  email: string;
}

@Injectable()
export class WorkspaceService implements OnModuleInit {
  private readonly logger = new Logger("Workspace");

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(SourcesService) private readonly sources: SourcesService,
    @Inject(GitGateway) private readonly git: GitGateway,
    @Inject(GithubAuthService) private readonly github: GithubAuthService,
    @Inject(AzureAuthService) private readonly azure: AzureAuthService,
    @Inject(ClaudeAuthService) private readonly claude: ClaudeAuthService,
    @Inject(OrbitGateway) private readonly orbit: OrbitGateway,
    @Inject(ProjectService) private readonly project: ProjectService,
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
      await (session.source === null ? this.init(session) : this.clone(session));
      const baseCommit = await this.branch(session);
      await this.identity(session);
      const orbitSeated = await this.seat(session);
      this.step(session, "project");
      await this.project.load(session);
      const ready = this.sessions.update(session.id, { status: "ready", statusReason: null, baseCommit, workBranch: workBranchOf(session.id) });
      this.bus.publishSession(session.id, "workspace.ready", { repository: session.repository, branch: session.branch, workBranch: workBranchOf(session.id), baseCommit, orbitSeated });
      this.bus.publishSession(session.id, "session.status", { status: "ready", reason: null });
      this.sendPending(ready);
    } catch (err) {
      const step = err instanceof StepFailed ? err.step : "prepare";
      this.failedQuietly(session.id, step, err instanceof Error ? err.message : String(err));
    }
  }

  // Runs in the background: a preparation that outlives the application (it is shutting down, its database closed)
  // is logged, never left as an unhandled rejection; the next start marks it failed (onModuleInit).
  private failedQuietly(sessionId: string, step: string, message: string): void {
    try {
      this.failed(sessionId, step, message);
    } catch (err) {
      this.logger.warn(`workspace of ${sessionId} could not be marked failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  remove(sessionId: string): void {
    const root = sessionRoot(this.config.data, sessionId);
    if (contained(this.config.data.workspaces, root)) rmSync(root, { recursive: true, force: true });
  }

  private step(session: SessionRecord, step: WorkspaceStep): void {
    this.bus.publishSession(session.id, "workspace.preparing", { repository: session.repository, branch: session.branch, step });
  }

  private root(session: SessionRecord, step: WorkspaceStep): string {
    const root = sessionRoot(this.config.data, session.id);
    if (!contained(this.config.data.workspaces, root)) throw new StepFailed(step, "The workspace path is outside the workspaces directory.");
    mkdirSync(root, { recursive: true, mode: 0o700 });
    return root;
  }

  private async clone(session: SessionRecord): Promise<void> {
    const root = this.root(session, "clone");
    this.step(session, "clone");
    if (session.source === null || session.repositoryId === null || session.branch === null) throw new StepFailed("clone", "This chat names no repository to clone.");
    const origin = { source: session.source, id: session.repositoryId, branch: session.branch };
    const how = origin.source === "github" ? `gh repo clone ${session.repository}` : `git clone ${session.repository}`;
    let r: RunResult;
    try {
      r = await this.sources.clone(origin, "repository", root);
    } catch (err) {
      throw new StepFailed("clone", `${how}: ${err instanceof Error ? err.message : String(err)}`);
    }
    must("clone", r, how);
  }

  // No repository: an empty one, so the branch, the changes and Orbit work the same.
  private async init(session: SessionRecord): Promise<void> {
    this.root(session, "init");
    this.step(session, "init");
    mkdirSync(session.workspacePath, { recursive: true, mode: 0o700 });
    must("init", await this.git.init(session.workspacePath), "git init");
    must("init", await this.git.emptyCommit(session.workspacePath), "git commit --allow-empty");
  }

  private async branch(session: SessionRecord): Promise<string> {
    this.step(session, "branch");
    const head = must("branch", await this.git.head(session.workspacePath), "git rev-parse HEAD").stdout.trim();
    must("branch", await this.git.createBranch(session.workspacePath, workBranchOf(session.id)), "git checkout -b");
    return head;
  }

  // Local commits carry the identity of the account the workspace came from: GitHub's name and private noreply
  // address, the Azure account's user name, or -- with no repository -- the Claude account's address.
  private async identity(session: SessionRecord): Promise<void> {
    this.step(session, "identity");
    const who = await this.identityOf(session);
    if (who === null) return;
    must("identity", await this.git.setConfig(session.workspacePath, "user.name", who.name), "git config user.name");
    must("identity", await this.git.setConfig(session.workspacePath, "user.email", who.email), "git config user.email");
  }

  private async identityOf(session: SessionRecord): Promise<Identity | null> {
    if (session.source === "github") {
      const account = (await this.github.connection()).account;
      if (account === null) return null;
      const id = this.github.accountId();
      return { name: account.name ?? account.login, email: id !== null ? `${id}+${account.login}@users.noreply.github.com` : `${account.login}@users.noreply.github.com` };
    }
    const email = session.source === "azure" ? ((await this.azure.connection()).account?.user ?? null) : ((await this.claude.account()).account?.email ?? null);
    return email !== null && email.includes("@") ? { name: email.split("@")[0] as string, email } : null;
  }

  private async seat(session: SessionRecord): Promise<boolean> {
    this.step(session, "orbit");
    const r = await this.orbit.seat(session.workspacePath);
    if (!succeeded(r)) this.bus.publishSession(session.id, "run.notice", { kind: "info", message: `Orbit could not seat this checkout (${endedHow(r)}); Claude Code still loads the plugin. ${tail(r.stderr, 2)}` });
    return succeeded(r);
  }

  private sendPending(session: SessionRecord): void {
    if (session.pendingPrompt === null) return;
    const prompt = session.pendingPrompt;
    this.sessions.update(session.id, { pendingPrompt: null });
    try {
      this.runner.send(session.id, prompt);
    } catch (err) {
      this.bus.publishSession(session.id, "run.notice", { kind: "info", message: `The first message was not sent: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private failed(sessionId: string, step: string, message: string): void {
    this.logger.warn(`workspace of ${sessionId} failed at ${step}`);
    this.sessions.update(sessionId, { status: "setup_failed", statusReason: message.slice(0, 300) });
    this.bus.publishSession(sessionId, "workspace.failed", { step, message });
    this.bus.publishSession(sessionId, "session.status", { status: "setup_failed", reason: message.slice(0, 300) });
  }
}
