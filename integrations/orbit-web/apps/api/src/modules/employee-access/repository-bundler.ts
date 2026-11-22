// AN ATTEMPT'S REPOSITORIES AS GIT BUNDLES. For each repository its mission brings in that its employee may STILL use
// (its grants now, not when the work was given), Orbit Web clones the branch -- bare, one commit deep, through the
// source's own sign-in, in a room of the control plane's own -- and bundles ONE commit holding that branch's files as
// they are: a shallow clone cannot be bundled whole, so the snapshot is a root commit of the same tree, its message
// naming the repository, the branch and the commit it was taken at. The sandbox provider reads each bundle once; the
// run's room is then removed (and every room left by a restart mid-start, when Orbit Web starts). The sign-in never
// leaves the control plane: the employee gets bytes, and clones them with its own git. A repository whose snapshot does
// not fit in what an attempt takes is not brought in, and the employee is told why.
import { mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { ACCESS_CONNECTOR_LABELS } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { REPO_BUNDLE_PREFIX, type AttemptRepository, type RepositoryBundles, type RepositoryInputs } from "../../contexts/execution/application/repository-bundles.port.js";
import { APP_CONFIG } from "../../core/tokens.js";
import { controlEnv, gitEnv } from "../../infra/process/env.js";
import { succeeded, type RunResult } from "../../infra/process/process.port.js";
import { redactSecrets } from "../../infra/security/redact.js";
import { GitGateway } from "../changes/git.gateway.js";
import { SourcesService } from "../sources/sources.module.js";
import { inScope } from "./connector-text.js";
import { ConnectionGrantStore } from "./grants.store.js";

// What an attempt's repositories may weigh together: its inputs travel to the allocator in one request (base64).
export const MAX_REPOSITORY_BYTES = 48 * 1024 * 1024;
const STORE_PATH = /^repo-bundle:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/(\d{1,2})$/;

const mib = (bytes: number): string => `${(bytes / 1048576).toFixed(1)} MiB`;
const safe = (name: string): string => name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[.-]+/, "").slice(0, 80) || "repository";
const said = (r: RunResult): string => redactSecrets((r.stderr || r.stdout).trim().split("\n").slice(-2).join(" ")).slice(0, 300);

interface Made {
  file: string;
  size: number;
  branch: string;
  commit: string;
}

@Injectable()
export class RepositoryBundler implements RepositoryBundles, OnModuleInit {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(ConnectionGrantStore) private readonly grants: ConnectionGrantStore,
    @Inject(SourcesService) private readonly sources: SourcesService,
    @Inject(GitGateway) private readonly git: GitGateway,
  ) {}

  onModuleInit(): void {
    rmSync(this.rooms(), { recursive: true, force: true });
  }

  async prepare(orbitId: string, employeeId: string, runId: string, repositories: readonly AttemptRepository[]): Promise<RepositoryInputs> {
    if (repositories.length === 0) return { inputs: [], lines: [] };
    const live = await this.grants.live(orbitId, employeeId);
    const room = this.room(runId);
    mkdirSync(room, { recursive: true, mode: 0o700 });
    const out: RepositoryInputs = { inputs: [], lines: [] };
    let left = MAX_REPOSITORY_BYTES;
    for (const [i, r] of repositories.entries()) {
      const label = ACCESS_CONNECTOR_LABELS[r.source];
      const grant = live.get(r.source);
      if (grant === undefined || !inScope(grant.repositories, r)) {
        out.lines.push(`- ${r.fullName}: not brought in -- you may no longer use it on ${label} (your Access page).`);
        continue;
      }
      const made = await this.bundle(room, i, r);
      if (typeof made === "string") {
        out.lines.push(`- ${r.fullName}: not brought in -- ${made}. Read it through your ${label} tools instead.`);
        continue;
      }
      if (made.size > left) {
        rmSync(made.file, { force: true });
        out.lines.push(`- ${r.fullName}: not brought in -- its snapshot (${mib(made.size)}) is larger than what an attempt takes (${mib(left)} left). Read it through your ${label} tools instead.`);
        continue;
      }
      left -= made.size;
      const base = `repo-${safe(r.name)}`;
      const name = out.inputs.some((x) => x.name === `${base}.bundle`) ? `${base}-${i + 1}.bundle` : `${base}.bundle`;
      out.inputs.push({ name, storePath: `${REPO_BUNDLE_PREFIX}${runId}/${i}` });
      out.lines.push(`- /input/${name}: ${r.fullName} at ${made.branch} (commit ${made.commit.slice(0, 12)}) -- open it with \`git clone /input/${name} ${safe(r.name)}\` (one commit: the branch's files as they were when this attempt started).`);
    }
    return out;
  }

  async read(storePath: string): Promise<Buffer> {
    const m = STORE_PATH.exec(storePath);
    if (m === null) throw new Error("not a repository bundle of an attempt");
    return readFileSync(join(this.room(m[1] as string), `${m[2]}.bundle`));
  }

  async release(runId: string): Promise<void> {
    rmSync(this.room(runId), { recursive: true, force: true });
  }

  private rooms(): string {
    return join(this.config.data.control, "repo-bundles");
  }

  private room(runId: string): string {
    if (!/^[0-9a-f-]{36}$/.test(runId)) throw new Error("a run's room is named by its id");
    return join(this.rooms(), runId);
  }

  // One repository's snapshot as a bundle, or why there is none.
  private async bundle(room: string, i: number, r: AttemptRepository): Promise<Made | string> {
    let branch = r.branch;
    try {
      branch ??= (await this.sources.authorized(r.source, r.id)).defaultBranch;
    } catch {
      return "the connector no longer lists it";
    }
    if (branch === null || branch === undefined || branch === "") return "it names no default branch";
    const dir = join(room, `${i}.git`);
    const cloned = await this.sources.clone({ source: r.source, id: r.id, branch }, `${i}.git`, room, ["--bare", "--depth=1", "--single-branch"]);
    if (!succeeded(cloned)) return `it could not be cloned (${said(cloned)})`;
    try {
      const env = gitEnv(this.config, controlEnv(this.config));
      const one = async (args: string[]): Promise<string> => {
        const res = await this.git.controlGit(dir, args, env);
        if (!succeeded(res)) throw new Error(said(res));
        return res.stdout.trim();
      };
      const commit = await one(["rev-parse", "--verify", `refs/heads/${branch}^{commit}`]);
      const tree = await one(["rev-parse", "--verify", `${commit}^{tree}`]);
      const snapshot = await one(["-c", "user.name=Orbit Web", "-c", "user.email=orbit-web@localhost", "commit-tree", tree, "-m", `${r.fullName} ${branch} at ${commit}`]);
      await one(["update-ref", `refs/heads/${branch}`, snapshot]);
      await one(["symbolic-ref", "HEAD", `refs/heads/${branch}`]);
      const file = join(room, `${i}.bundle`);
      await one(["bundle", "create", "--quiet", file, "HEAD", `refs/heads/${branch}`]);
      return { file, size: statSync(file).size, branch, commit };
    } catch (err) {
      return `its snapshot could not be made (${(err as Error).message})`;
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
