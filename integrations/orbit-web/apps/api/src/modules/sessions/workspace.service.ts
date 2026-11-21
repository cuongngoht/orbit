// A session's own workspace: /data/workspaces/<session-id>/repository. Cloned from the branch a person chose (GitHub
// with `gh repo clone`, Azure DevOps with `git clone` and the image's one-shot credential helper) -- or, for a chat
// with no repository, an empty repository with one empty commit as its base. Then moved to a branch of its own
// (orbit-web/<short id>) so the chosen branch is never written directly, given a local commit identity, seated with
// Orbit (its project in the machine store; nothing is written into the checkout), and its project's skills and plugins
// read and loaded. Every step is a session event. Nothing is ever pushed from here.
import { Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import type { WorkspaceStep } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { contained, repositoryDir, sessionRoot } from "../../common/workspace-path.js";
import { AgentFs } from "../../infra/process/agent-fs.js";
import { endedHow, succeeded, type RunResult } from "../../infra/process/process.port.js";
import { Db } from "../../infra/db/db.js";
import { tail } from "../../infra/security/redact.js";
import { ImageStore, imageRefOf, SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import type { Principal } from "../auth/principal.js";
import { AzureAuthService } from "../azure-auth/azure-auth.service.js";
import { GitGateway } from "../changes/git.gateway.js";
import { ClaudeRunnerService } from "../claude-runner/claude-runner.service.js";
import { GithubAuthService } from "../github/github-auth.service.js";
import { OrbitGateway } from "../orbit/orbit.gateway.js";
import { ProjectService } from "../project/project.service.js";
import { MirrorService } from "../sources/mirror.service.js";
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
    @Inject(OrbitGateway) private readonly orbit: OrbitGateway,
    @Inject(ProjectService) private readonly project: ProjectService,
    @Inject(ClaudeRunnerService) private readonly runner: ClaudeRunnerService,
    @Inject(AgentFs) private readonly files: AgentFs,
    @Inject(MirrorService) private readonly mirror: MirrorService,
    @Inject(ImageStore) private readonly images: ImageStore,
    @Inject(Db) private readonly db: Db,
  ) {}

  // A preparation a restart cut short is not taken up again: the session says so and may be deleted.
  async onModuleInit(): Promise<void> {
    for (const s of await this.sessions.withStatus("preparing")) await this.failed(s.id, "restart", "Orbit Web restarted while this workspace was being prepared. Delete this chat and start a new one.");
  }

  pathFor(sessionId: string): string {
    return repositoryDir(this.config.data, sessionId);
  }

  // Runs in the background after the session is created; every step is an event the chat shows. The first message,
  // when one waits, is sent as `startedBy` -- the owner who started the chat.
  async prepare(session: SessionRecord, startedBy: Principal): Promise<void> {
    try {
      await (session.source === null ? this.init(session) : this.clone(session));
      const baseCommit = await this.branch(session);
      await this.identity(session);
      const orbitSeated = await this.seat(session);
      await this.step(session, "project");
      await this.project.load(session);
      const ready = await this.db.tx(async () => {
        const updated = await this.sessions.update(session.id, { status: "ready", statusReason: null, baseCommit, workBranch: workBranchOf(session.id) });
        await this.bus.publishSession(session.id, "workspace.ready", { repository: session.repository, branch: session.branch, workBranch: workBranchOf(session.id), baseCommit, orbitSeated });
        await this.bus.publishSession(session.id, "session.status", { status: "ready", reason: null });
        return updated;
      });
      await this.sendPending(ready, startedBy);
    } catch (err) {
      const step = err instanceof StepFailed ? err.step : "prepare";
      await this.failedQuietly(session.id, step, err instanceof Error ? err.message : String(err));
    }
  }

  // Runs in the background: a preparation that outlives the application (it is shutting down, its database closed)
  // is logged, never left as an unhandled rejection; the next start marks it failed (onModuleInit).
  private async failedQuietly(sessionId: string, step: string, message: string): Promise<void> {
    try {
      await this.failed(sessionId, step, message);
    } catch (err) {
      this.logger.warn(`workspace of ${sessionId} could not be marked failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async remove(sessionId: string): Promise<void> {
    const root = sessionRoot(this.config.data, sessionId);
    if (contained(this.config.data.workspaces, root)) await this.files.rmrf(root);
  }

  private async step(session: SessionRecord, step: WorkspaceStep): Promise<void> {
    await this.bus.publishSession(session.id, "workspace.preparing", { repository: session.repository, branch: session.branch, step });
  }

  private async root(session: SessionRecord, step: WorkspaceStep): Promise<string> {
    const root = sessionRoot(this.config.data, session.id);
    if (!contained(this.config.data.workspaces, root)) throw new StepFailed(step, "The workspace path is outside the workspaces directory.");
    await this.files.mkdirp(root);
    return root;
  }

  private async clone(session: SessionRecord): Promise<void> {
    const root = await this.root(session, "clone");
    await this.step(session, "clone");
    if (session.source === null || session.repositoryId === null || session.branch === null) throw new StepFailed("clone", "This chat names no repository to clone.");
    if (this.config.governance.deployment === "governed") return this.cloneThroughMirror(session, root);
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

  // GOVERNED: the credentialed clone goes into the control plane's own copy (/data/repos, read-only to the agent); the
  // workspace is a local clone of it, made by the agent's own git. No credential and no network reach the workspace.
  private async cloneThroughMirror(session: SessionRecord, root: string): Promise<void> {
    const how = session.source === "github" ? `gh repo clone ${session.repository}` : `git clone ${session.repository}`;
    let r: RunResult;
    try {
      r = await this.mirror.clone(session);
    } catch (err) {
      throw new StepFailed("clone", `${how}: ${err instanceof Error ? err.message : String(err)}`);
    }
    must("clone", r, how);
    must("clone", await this.git.cloneLocal(root, this.mirror.path(session.id), session.branch as string, "repository"), "git clone (from Orbit Web's copy)");
  }

  // No repository: an empty one, so the branch, the changes and Orbit work the same.
  private async init(session: SessionRecord): Promise<void> {
    await this.root(session, "init");
    await this.step(session, "init");
    await this.files.mkdirp(session.workspacePath);
    must("init", await this.git.init(session.workspacePath), "git init");
    must("init", await this.git.emptyCommit(session.workspacePath), "git commit --allow-empty");
  }

  private async branch(session: SessionRecord): Promise<string> {
    await this.step(session, "branch");
    const head = must("branch", await this.git.head(session.workspacePath), "git rev-parse HEAD").stdout.trim();
    must("branch", await this.git.createBranch(session.workspacePath, workBranchOf(session.id)), "git checkout -b");
    return head;
  }

  // Local commits carry the identity of the account the workspace came from: GitHub's name and private noreply
  // address, the Azure account's user name, or -- with no repository -- the address of the Claude identity whose account
  // owns the chat.
  private async identity(session: SessionRecord): Promise<void> {
    await this.step(session, "identity");
    const who = await this.identityOf(session);
    if (who === null) return;
    must("identity", await this.git.setConfig(session.workspacePath, "user.name", who.name), "git config user.name");
    must("identity", await this.git.setConfig(session.workspacePath, "user.email", who.email), "git config user.email");
  }

  private async identityOf(session: SessionRecord): Promise<Identity | null> {
    if (session.source === "github") {
      const account = (await this.github.connection()).account;
      if (account === null) return null;
      const id = await this.github.accountId();
      return { name: account.name ?? account.login, email: id !== null ? `${id}+${account.login}@users.noreply.github.com` : `${account.login}@users.noreply.github.com` };
    }
    const email = session.source === "azure" ? ((await this.azure.connection()).account?.user ?? null) : session.ownerEmail;
    return email !== null && email.includes("@") ? { name: email.split("@")[0] as string, email } : null;
  }

  private async seat(session: SessionRecord): Promise<boolean> {
    await this.step(session, "orbit");
    const r = await this.orbit.seat(session.workspacePath);
    if (!succeeded(r)) await this.bus.publishSession(session.id, "run.notice", { kind: "info", message: `Orbit could not seat this checkout (${endedHow(r)}); Claude Code still loads the plugin. ${tail(r.stderr, 2)}` });
    return succeeded(r);
  }

  private async sendPending(session: SessionRecord, startedBy: Principal): Promise<void> {
    if (session.pendingPrompt === null) return;
    const prompt = session.pendingPrompt;
    // Its images: those the new chat claimed when it was made, in the order they were uploaded.
    const images = (await this.images.pending(session.id)).map(imageRefOf);
    await this.sessions.update(session.id, { pendingPrompt: null });
    if (prompt.trim().length === 0 && images.length === 0) return;
    try {
      await this.runner.send(session.id, prompt, images, startedBy);
    } catch (err) {
      await this.bus.publishSession(session.id, "run.notice", { kind: "info", message: `The first message was not sent: ${err instanceof Error ? err.message : String(err)}` });
    }
  }

  private async failed(sessionId: string, step: string, message: string): Promise<void> {
    this.logger.warn(`workspace of ${sessionId} failed at ${step}`);
    await this.db.tx(async () => {
      await this.sessions.update(sessionId, { status: "setup_failed", statusReason: message.slice(0, 300) });
      await this.bus.publishSession(sessionId, "workspace.failed", { step, message });
      await this.bus.publishSession(sessionId, "session.status", { status: "setup_failed", reason: message.slice(0, 300) });
    });
  }
}
