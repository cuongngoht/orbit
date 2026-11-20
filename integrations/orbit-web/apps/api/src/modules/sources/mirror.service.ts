// THE CONTROL PLANE'S OWN COPY OF A CHAT'S REPOSITORY: /data/repos/<session>.git, a bare repository only the control
// plane writes (read-only to the agent in the governed deployment). Everything that needs the repository's credential
// happens HERE and nowhere else: cloning it, fetching a branch into it, asking the remote where a branch stands, and
// pushing a commit a person approved. The agent's workspace is a local clone of it, made by the agent's own git; a
// commit comes back as a bundle the agent's git writes (git.gateway.ts bundle), fetched into this copy with every
// object checked. The workspace's own .git is never read here.
import { Inject, Injectable } from "@nestjs/common";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { azureGitEnv, controlEnv, gitEnv, githubGitEnv } from "../../infra/process/env.js";
import type { RunResult } from "../../infra/process/process.port.js";
import type { SessionRecord } from "../../infra/storage/stores.js";
import { GitGateway } from "../changes/git.gateway.js";
import { AzureSource } from "./azure.source.js";
import { GithubSource } from "./github.source.js";

export interface Remote {
  url: string;
  // What the session's source names the repository as (owner/name, or organization/<id>), for a person to read.
  name: string;
  env: Record<string, string>;
  // Git's options for this remote's credential helper (Azure's one-shot helper; GitHub's is in the environment).
  helper: string[];
}

// Never a fetch of tags, submodules or anything but the refs named, and every object checked as it arrives.
const SAFE_FETCH = ["-c", "transfer.fsckObjects=true", "-c", "protocol.allow=never", "-c", "protocol.https.allow=always", "-c", "protocol.file.allow=always"];

@Injectable()
export class MirrorService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(GithubSource) private readonly github: GithubSource,
    @Inject(AzureSource) private readonly azure: AzureSource,
    @Inject(GitGateway) private readonly git: GitGateway,
  ) {}

  path(sessionId: string): string {
    return join(this.config.data.repos, `${sessionId}.git`);
  }

  exists(sessionId: string): boolean {
    return existsSync(this.path(sessionId));
  }

  // The session's repository at its source, and how git reaches it with the source's credential.
  async remoteOf(session: SessionRecord): Promise<Remote> {
    if (session.source === "github" && session.repositoryId !== null) return { url: `${this.config.githubUrl}/${session.repositoryId}.git`, name: session.repositoryId, env: githubGitEnv(this.config), helper: [] };
    if (session.source === "azure" && session.repositoryId !== null) {
      const repo = await this.azure.authorized(session.repositoryId);
      return { url: repo.cloneUrl, name: repo.fullName, env: azureGitEnv(this.config), helper: ["-c", "credential.helper=", "-c", `credential.helper=${this.config.binaries.azureGitHelper}`] };
    }
    throw new Error("this chat has no repository");
  }

  // The first clone, through the source's own sign-in, into the control plane's copy (bare: no working tree here).
  clone(session: SessionRecord): Promise<RunResult> {
    if (session.source === null || session.repositoryId === null || session.branch === null) throw new Error("this chat names no repository");
    const extra = ["--bare"];
    return session.source === "github" ? this.github.clone(session.repositoryId, session.branch, `${session.id}.git`, this.config.data.repos, extra) : this.azure.clone(session.repositoryId, session.branch, `${session.id}.git`, this.config.data.repos, extra);
  }

  // The control plane's copy, made empty if the chat has none yet (a chat cloned before it had one).
  async ensure(sessionId: string): Promise<RunResult | null> {
    if (this.exists(sessionId)) return null;
    return this.git.controlGit(this.config.data.repos, ["init", "--bare", "--quiet", `${sessionId}.git`], this.plainEnv());
  }

  // One branch of the repository, fetched through the source's sign-in into the copy (refs/heads/<branch>).
  async fetch(session: SessionRecord, branch: string): Promise<RunResult> {
    const remote = await this.remoteOf(session);
    return this.git.controlGit(this.path(session.id), [...remote.helper, ...SAFE_FETCH, "fetch", "--no-tags", "--no-recurse-submodules", "--", remote.url, `+refs/heads/${branch}:refs/heads/${branch}`], remote.env);
  }

  // A bundle the agent's git wrote, into a ref of the copy's own; every object is checked as it is unpacked.
  fetchBundle(sessionId: string, bundleFile: string, branch: string, intoRef: string): Promise<RunResult> {
    return this.git.controlGit(this.path(sessionId), [...SAFE_FETCH, "fetch", "--no-tags", "--", bundleFile, `+refs/heads/${branch}:${intoRef}`], this.plainEnv());
  }

  // Where a branch stands at the remote now: its commit, or null when it does not exist there.
  async remoteHead(session: SessionRecord, branch: string): Promise<{ ok: boolean; oid: string | null; detail: string }> {
    const remote = await this.remoteOf(session);
    const r = await this.git.controlGit(this.path(session.id), [...remote.helper, "ls-remote", "--heads", "--", remote.url, `refs/heads/${branch}`], remote.env, this.config.limits.commandTimeoutMs);
    if (r.code !== 0) return { ok: false, oid: null, detail: (r.stderr || r.stdout).trim().slice(-300) };
    const line = r.stdout.split("\n").find((l) => l.endsWith(`\trefs/heads/${branch}`));
    return { ok: true, oid: line ? (line.split("\t")[0] as string) : null, detail: "" };
  }

  // The commit a person approved, pushed to exactly the branch they approved -- and only if the remote's branch is still
  // where it was when they approved it (or still does not exist).
  async push(session: SessionRecord, commit: string, branch: string, expectedOid: string | null): Promise<RunResult> {
    const remote = await this.remoteOf(session);
    const lease = `--force-with-lease=refs/heads/${branch}:${expectedOid ?? ""}`;
    return this.git.controlGit(this.path(session.id), [...remote.helper, "push", "--no-verify", lease, "--", remote.url, `${commit}:refs/heads/${branch}`], remote.env);
  }

  revParse(sessionId: string, ref: string): Promise<RunResult> {
    return this.git.controlGit(this.path(sessionId), ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], this.plainEnv(), this.config.limits.commandTimeoutMs);
  }

  // What a change is, read from the control plane's own copy: commits and files between `base` and `commit`.
  async changeOf(sessionId: string, base: string | null, commit: string): Promise<{ files: number; insertions: number; deletions: number; commits: number; diffstat: string }> {
    const range = base === null ? commit : `${base}..${commit}`;
    const env = this.plainEnv();
    const dir = this.path(sessionId);
    const count = await this.git.controlGit(dir, ["rev-list", "--count", range], env, this.config.limits.commandTimeoutMs);
    const stat = base === null ? null : await this.git.controlGit(dir, ["diff", "--no-ext-diff", "--no-textconv", "--stat=120", base, commit], env, this.config.limits.commandTimeoutMs);
    const short = base === null ? null : await this.git.controlGit(dir, ["diff", "--no-ext-diff", "--no-textconv", "--shortstat", base, commit], env, this.config.limits.commandTimeoutMs);
    const n = (re: RegExp) => Number(re.exec(short?.stdout ?? "")?.[1] ?? 0);
    return { commits: Number(count.stdout.trim()) || 0, files: n(/(\d+) files? changed/), insertions: n(/(\d+) insertions?/), deletions: n(/(\d+) deletions?/), diffstat: (stat?.stdout ?? "").slice(0, 8_000) };
  }

  // Git on the copy alone (no remote): the control plane's HOME, no credential.
  private plainEnv(): Record<string, string> {
    return gitEnv(this.config, controlEnv(this.config));
  }
}
