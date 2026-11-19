// What changed in a session's workspace, read from git in that workspace -- never from what the model said it did:
// added, modified, deleted and renamed files against the commit the session started from (committed and uncommitted
// alike), files git does not track yet, conflicts, line counts, and one file's diff on request.
import { Inject, Injectable } from "@nestjs/common";
import type { ChangedFile, ChangesReport, FileDiff } from "@orbit-web/contracts";
import { existsSync } from "node:fs";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { badRequest, conflict, notFound } from "../../common/errors.js";
import { contained } from "../../common/workspace-path.js";
import { redactShapes } from "../../infra/security/redact.js";
import { SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { changedFiles, languageOf, parseNameStatus, parseNumstat, parseStatus, totalsOf, type Numstat } from "./git-parse.js";
import { GitGateway } from "./git.gateway.js";

const UNTRACKED_COUNTED = 200;

@Injectable()
export class ChangesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(GitGateway) private readonly git: GitGateway,
  ) {}

  async report(sessionId: string): Promise<ChangesReport> {
    const session = this.ready(sessionId);
    const cwd = session.workspacePath;
    const status = parseStatus((await this.git.status(cwd)).stdout);
    const base = session.baseCommit;
    const names = base ? parseNameStatus((await this.git.nameStatus(cwd, base)).stdout) : [];
    const counts = base ? parseNumstat((await this.git.numstat(cwd, base)).stdout) : [];
    const untracked = await this.untrackedCounts(cwd, status.untracked);
    const files = changedFiles(names, counts, status, untracked);
    return {
      sessionId,
      repository: session.repository,
      baseBranch: session.branch,
      workBranch: session.workBranch,
      currentBranch: status.head,
      baseCommit: base,
      headCommit: status.oid,
      upstream: status.upstream,
      files,
      totals: totalsOf(files),
      checkedAt: new Date().toISOString(),
    };
  }

  // One file's diff, for a path git itself listed as changed: nothing else of the disk is readable through here.
  async file(sessionId: string, path: unknown): Promise<FileDiff> {
    if (typeof path !== "string" || path.length === 0 || path.includes("\0")) throw badRequest("path must name a changed file");
    const report = await this.report(sessionId);
    const file = report.files.find((f) => f.path === path);
    if (!file) throw notFound(`A change to ${path}`);
    const session = this.ready(sessionId);
    return this.diffOf(session, file);
  }

  private async diffOf(session: SessionRecord, file: ChangedFile): Promise<FileDiff> {
    const cwd = session.workspacePath;
    const r = file.kind === "untracked" ? await this.git.untrackedDiff(cwd, file.path) : await this.git.fileDiff(cwd, session.baseCommit ?? "HEAD", file.path, file.oldPath);
    const binary = file.binary || /^Binary files .* differ$/m.test(r.stdout);
    const base = { path: file.path, kind: file.kind, language: languageOf(file.path) };
    if (binary) return { ...base, binary: true, tooLarge: false, diff: null };
    if (r.truncated) return { ...base, binary: false, tooLarge: true, diff: null };
    return { ...base, binary: false, tooLarge: false, diff: redactShapes(r.stdout) };
  }

  private async untrackedCounts(cwd: string, paths: string[]): Promise<Map<string, Numstat>> {
    const counted = new Map<string, Numstat>();
    for (const path of paths.slice(0, UNTRACKED_COUNTED)) {
      const n = parseNumstat((await this.git.untrackedNumstat(cwd, path)).stdout)[0];
      if (n) counted.set(path, { ...n, path });
    }
    return counted;
  }

  private ready(sessionId: string): SessionRecord {
    const session = this.sessions.get(sessionId);
    if (!session) throw notFound("Session");
    if (!existsSync(session.workspacePath) || session.baseCommit === null) throw conflict("workspace_not_ready", "This session's workspace is not ready yet.");
    if (!contained(this.config.data.workspaces, session.workspacePath)) throw conflict("workspace_outside", "This session's workspace is not inside the workspaces directory.");
    return session;
  }
}
