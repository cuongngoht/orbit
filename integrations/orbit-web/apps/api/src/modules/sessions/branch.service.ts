// THE WORKING BRANCH of an open chat: the branch its workspace has checked out, where Claude Code commits. A chat starts
// on a branch of its own (orbit-web/<id>); a person moves it -- and only a person, through this service:
//
//   to a branch of its repository   fetched for it the way the workspace was cloned: through the source's own sign-in,
//                                    into a bare clone of Orbit Web's own (that one branch, borrowing what the workspace
//                                    has), outside the workspace, so nothing of the workspace's configuration is read
//                                    where a credential is; then into the workspace from that local clone, and removed
//   to a branch of the workspace    checked out again (the chat's own, or one Claude made)
//   to a new branch (create)        made from the work as it is: what is uncommitted comes along
//
// Never to the repository's default branch, never over uncommitted work (but for a new branch), and never while Claude
// works: the runner starts no run while a branch moves (`holding`). The chat's changes are then read against where its
// branch left the one the chat started from (a new branch keeps the base it had). Every move is an event.
import { Inject, Injectable } from "@nestjs/common";
import { ACCEPTS_MESSAGES, checkChangeBranch, type SessionSummary, type WorkBranch, type WorkBranches } from "@orbit-web/contracts";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { accepted, ApiError, conflict, notFound } from "../../common/errors.js";
import { endedHow, succeeded, type RunResult } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import { SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { parseStatus } from "../changes/git-parse.js";
import { GitGateway } from "../changes/git.gateway.js";
import { ClaudeRunnerService } from "../claude-runner/claude-runner.service.js";
import { MirrorService } from "../sources/mirror.service.js";
import { SourcesService } from "../sources/sources.module.js";
import { OwnershipService } from "../access/ownership.service.js";
import { summaryOf } from "./sessions.service.js";

const HEADS = "refs/heads/";
const SCRATCH = "branch-fetch";

const must = (r: RunResult, what: string): RunResult => {
  if (!succeeded(r)) throw new ApiError(502, "git_failed", `${what} ${endedHow(r)}: ${tail(r.stderr || r.stdout, 3)}`);
  return r;
};

const shortName = (ref: string): string => (ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref);

interface RemoteBranches {
  // The repository's branch names (its order: the default first), and its default; empty without a repository.
  names: string[];
  defaultName: string | null;
  error: string | null;
}

@Injectable()
export class BranchService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(SourcesService) private readonly sources: SourcesService,
    @Inject(GitGateway) private readonly git: GitGateway,
    @Inject(ClaudeRunnerService) private readonly runner: ClaudeRunnerService,
    @Inject(MirrorService) private readonly mirror: MirrorService,
    @Inject(OwnershipService) private readonly ownership: OwnershipService,
  ) {}

  // Read while Claude works too: listing changes nothing.
  async list(session: SessionRecord): Promise<WorkBranches> {
    this.prepared(session);
    const cwd = session.workspacePath;
    const [local, status, remote] = await Promise.all([this.localNames(cwd), this.git.status(cwd), this.remote(session)]);
    const defaultName = remote.defaultName ?? (await this.originHead(cwd));
    const names = [...new Set([...remote.names, ...local])];
    const branches: WorkBranch[] = names.map((name) => ({ name, local: local.includes(name), remote: remote.names.includes(name), isDefault: name === defaultName }));
    return { current: parseStatus(status.stdout).head, base: session.branch, branches, remoteError: remote.error };
  }

  async change(session: SessionRecord, body: unknown): Promise<SessionSummary> {
    const req = accepted(checkChangeBranch(body));
    this.prepared(session);
    if (session.status === "running" || this.runner.isRunning(session.id)) throw conflict("run_active", "Claude is still working on this chat: stop it or wait for it to finish, then choose the branch.");
    return this.runner.holding(session.id, () => (req.create ? this.create(session, req.branch) : this.switchTo(session, req.branch)));
  }

  private async switchTo(session: SessionRecord, name: string): Promise<SessionSummary> {
    const cwd = session.workspacePath;
    const list = await this.list(session);
    if (list.current === name) return summaryOf(session, this.ownership.levelNow(session) ?? "owner");
    const entry = this.known(list, name);
    if (entry.isDefault) throw this.defaultRefused(name);
    this.clean(must(await this.git.status(cwd), "git status").stdout);
    if (entry.local) must(await this.git.switchTo(cwd, name), "git switch");
    else {
      await this.fetch(session, name);
      must(await this.git.switchToNew(cwd, name, `refs/remotes/origin/${name}`), "git switch -c");
    }
    return this.moved(session, list.current, name, false, await this.baseOf(session));
  }

  private async create(session: SessionRecord, name: string): Promise<SessionSummary> {
    const list = await this.list(session);
    const existing = list.branches.find((b) => b.name === name);
    if (existing?.isDefault) throw this.defaultRefused(name);
    if (existing !== undefined) throw conflict("branch_exists", existing.remote ? `${name} is already a branch of ${session.repository}: choose it to work on it.` : `This workspace already has a branch ${name}: choose it to work on it.`);
    must(await this.git.switchToNew(session.workspacePath, name), "git switch -c");
    return this.moved(session, list.current, name, true, session.baseCommit ?? (await this.head(session.workspacePath)));
  }

  private known(list: WorkBranches, name: string): WorkBranch {
    const entry = list.branches.find((b) => b.name === name);
    if (entry !== undefined) return entry;
    if (list.remoteError !== null) throw conflict("branches_unavailable", `${name} is not a branch of this workspace, and the repository's branches could not be read: ${list.remoteError}`);
    throw notFound(`The branch ${name}`);
  }

  private defaultRefused(name: string): ApiError {
    return conflict("default_branch", `${name} is the repository's default branch: a chat never works on it directly. Make a new branch, or choose another.`);
  }

  // Uncommitted work would be carried to the other branch, or stop git halfway: it is committed (or discarded) first.
  private clean(status: string): void {
    const s = parseStatus(status);
    const count = s.changed.length + s.untracked.length + s.conflicted.length;
    if (count > 0) throw conflict("workspace_dirty", `The workspace has ${count} uncommitted ${count === 1 ? "change" : "changes"}: commit them (Claude can) or discard them first -- or make a new branch, which takes them along.`);
  }

  // A branch of the repository, fetched through the source into a clone of Orbit Web's own, then into the workspace.
  private async fetch(session: SessionRecord, name: string): Promise<void> {
    if (session.source === null || session.repositoryId === null) throw notFound(`The branch ${name}`);
    // GOVERNED: through the control plane's own copy -- the credentialed fetch there, then the agent's git fetches
    // from that copy (read-only to it). Nothing is written in a directory the agent can write but by the agent.
    if (this.config.governance.deployment === "governed") {
      await this.mirror.ensure(session.id);
      must(await this.mirror.fetch(session, name), `fetching ${name} from ${session.repository}`);
      must(await this.git.fetchLocal(session.workspacePath, this.mirror.path(session.id), name), "git fetch");
      return;
    }
    const room = join(this.config.data.sessions, session.id);
    const scratch = join(room, SCRATCH);
    mkdirSync(room, { recursive: true, mode: 0o700 });
    rmSync(scratch, { recursive: true, force: true });
    try {
      must(await this.sources.cloneBranch({ source: session.source, id: session.repositoryId, branch: name }, SCRATCH, room, session.workspacePath), `fetching ${name} from ${session.repository}`);
      must(await this.git.fetchLocal(session.workspacePath, scratch, name), "git fetch");
    } finally {
      if (existsSync(scratch)) rmSync(scratch, { recursive: true, force: true });
    }
  }

  // Where the working branch left the branch the chat started from; the start itself for a chat with no repository.
  private async baseOf(session: SessionRecord): Promise<string> {
    const cwd = session.workspacePath;
    if (session.source === null || session.branch === null) return session.baseCommit ?? (await this.head(cwd));
    const r = await this.git.mergeBase(cwd, "HEAD", `refs/remotes/origin/${session.branch}`);
    return succeeded(r) ? r.stdout.trim() : this.head(cwd);
  }

  private moved(session: SessionRecord, from: string | null, workBranch: string, created: boolean, baseCommit: string): SessionSummary {
    const updated = this.sessions.update(session.id, { workBranch, baseCommit });
    this.bus.publishSession(session.id, "workspace.branch", { from, workBranch, created, baseCommit });
    const summary = summaryOf(updated, this.ownership.levelNow(updated) ?? "owner");
    this.bus.publishApp("session.summary", { session: summary });
    return summary;
  }

  private prepared(session: SessionRecord): void {
    if (session.status === "preparing") throw conflict("workspace_not_ready", "The workspace is still being prepared.");
    const usable = session.status === "running" || ACCEPTS_MESSAGES.includes(session.status);
    if (!usable || !existsSync(session.workspacePath)) throw conflict("workspace_failed", "This chat's workspace could not be prepared.");
  }

  private async remote(session: SessionRecord): Promise<RemoteBranches> {
    if (session.source === null || session.repositoryId === null) return { names: [], defaultName: null, error: null };
    try {
      const branches = (await this.sources.branches(session.source, session.repositoryId)).branches;
      return { names: branches.map((b) => b.name), defaultName: branches.find((b) => b.isDefault)?.name ?? null, error: null };
    } catch (err) {
      return { names: [], defaultName: null, error: err instanceof Error ? err.message : String(err) };
    }
  }

  private async localNames(cwd: string): Promise<string[]> {
    const r = must(await this.git.localBranches(cwd), "git for-each-ref");
    return r.stdout.split("\n").filter((l) => l.startsWith(HEADS)).map(shortName);
  }

  // The repository's default as the clone recorded it: what is said when the source cannot be asked.
  private async originHead(cwd: string): Promise<string | null> {
    const r = await this.git.originHead(cwd);
    const ref = r.stdout.trim();
    return succeeded(r) && ref.startsWith("refs/remotes/origin/") ? ref.slice("refs/remotes/origin/".length) : null;
  }

  private async head(cwd: string): Promise<string> {
    return must(await this.git.head(cwd), "git rev-parse HEAD").stdout.trim();
  }
}
