// THE GITHUB GATEWAY: every gh command Orbit Web runs, with its whole argument list written here. gh keeps its
// sign-in in GH_CONFIG_DIR (/data/github); this never asks gh for the token (no `gh auth token`, no
// `--show-token`) and never puts a credential into a URL or a git remote.
import { Inject, Injectable } from "@nestjs/common";
import type { Branch, Repository } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG, PROCESS_PORT } from "../../core/tokens.js";
import { ghEnv } from "../../infra/process/env.js";
import type { ProcessPort, RunResult } from "../../infra/process/process.port.js";

export const GITHUB_HOST = "github.com";

export interface GhHostEntry {
  state: string;
  active: boolean;
  login: string | null;
  error: string | null;
}

export interface GhUser {
  login: string;
  id: number | null;
  name: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

// `gh auth status --json hosts`: {"hosts":{"github.com":[{state, active, host, login, ...}]}}. Signed out: {"hosts":{}}.
export function parseAuthHosts(stdout: string): GhHostEntry[] | null {
  try {
    const json = JSON.parse(stdout) as unknown;
    if (!isRecord(json) || !isRecord(json.hosts)) return null;
    const entries = json.hosts[GITHUB_HOST];
    if (!Array.isArray(entries)) return [];
    return entries.filter(isRecord).map((e) => ({
      state: strOrNull(e.state) ?? "unknown",
      active: e.active === true,
      login: strOrNull(e.login),
      error: strOrNull(e.error),
    }));
  } catch {
    return null;
  }
}

export function parseUser(stdout: string): GhUser | null {
  try {
    const json = JSON.parse(stdout) as unknown;
    if (!isRecord(json) || typeof json.login !== "string") return null;
    return { login: json.login, id: typeof json.id === "number" ? json.id : null, name: strOrNull(json.name) };
  } catch {
    return null;
  }
}

// NDJSON, one object per line (what `gh api --paginate --jq '.[] | {...}'` prints).
export function ndjson(stdout: string): Record<string, unknown>[] {
  return stdout.split("\n").flatMap((line) => {
    if (line.trim().length === 0) return [];
    try {
      const v = JSON.parse(line) as unknown;
      return isRecord(v) ? [v] : [];
    } catch {
      return [];
    }
  });
}

export function repositoryFromApi(r: Record<string, unknown>): Repository | null {
  const fullName = strOrNull(r.full_name);
  const owner = strOrNull(r.owner);
  const name = strOrNull(r.name);
  if (!fullName || !owner || !name) return null;
  return {
    fullName,
    owner,
    name,
    private: r.private === true,
    defaultBranch: strOrNull(r.default_branch),
    updatedAt: strOrNull(r.updated_at),
    archived: r.archived === true,
    fork: r.fork === true,
  };
}

export function repositoryFromList(r: Record<string, unknown>): Repository | null {
  const fullName = strOrNull(r.nameWithOwner);
  if (!fullName || !fullName.includes("/")) return null;
  const [owner, name] = fullName.split("/") as [string, string];
  const ref = isRecord(r.defaultBranchRef) ? strOrNull(r.defaultBranchRef.name) : null;
  return { fullName, owner, name, private: r.isPrivate === true, defaultBranch: ref, updatedAt: strOrNull(r.updatedAt), archived: r.isArchived === true, fork: r.isFork === true };
}

export function branchFromApi(b: Record<string, unknown>, defaultBranch: string | null): Branch | null {
  const name = strOrNull(b.name);
  if (!name) return null;
  return { name, protected: b.protected === true, commit: strOrNull(b.sha), isDefault: name === defaultBranch };
}

const REPO_FIELDS = "{full_name, name, owner: .owner.login, private, default_branch, updated_at, archived, fork}";

@Injectable()
export class GhGateway {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
  ) {}

  private gh(args: string[], timeoutMs = this.config.limits.commandTimeoutMs, cwd = this.config.data.home): Promise<RunResult> {
    return this.process.run(this.config.binaries.gh, args, { cwd, env: ghEnv(this.config), timeoutMs, maxOutputBytes: 32 * 1024 * 1024 });
  }

  authStatus(): Promise<RunResult> {
    return this.gh(["auth", "status", "--hostname", GITHUB_HOST, "--json", "hosts"]);
  }

  user(): Promise<RunResult> {
    return this.gh(["api", "--hostname", GITHUB_HOST, "user"]);
  }

  logout(login: string): Promise<RunResult> {
    return this.gh(["auth", "logout", "--hostname", GITHUB_HOST, "--user", login]);
  }

  loginArgs(): string[] {
    return ["auth", "login", "--hostname", GITHUB_HOST, "--git-protocol", "https", "--web", "--skip-ssh-key", "--insecure-storage"];
  }

  // Every repository the account can reach: its own, those it collaborates on, and its organisations'.
  apiRepositories(): Promise<RunResult> {
    return this.gh(["api", "--hostname", GITHUB_HOST, "--paginate", "--jq", `.[] | ${REPO_FIELDS}`, "user/repos?affiliation=owner,collaborator,organization_member&per_page=100&sort=updated"], 120_000);
  }

  ownRepositories(): Promise<RunResult> {
    return this.gh(["repo", "list", "--limit", "1000", "--json", "nameWithOwner,isPrivate,defaultBranchRef,updatedAt,isArchived,isFork"], 120_000);
  }

  branches(owner: string, name: string): Promise<RunResult> {
    return this.gh(["api", "--hostname", GITHUB_HOST, "--paginate", "--jq", ".[] | {name, protected, sha: .commit.sha}", `repos/${owner}/${name}/branches?per_page=100`], 120_000);
  }

  // `gh repo clone` runs git with gh's own credential helper for this one command: nothing is written to a git
  // config, and the remote is the plain https URL.
  clone(owner: string, name: string, branch: string, destination: string, cwd: string): Promise<RunResult> {
    return this.gh(["repo", "clone", `https://${GITHUB_HOST}/${owner}/${name}.git`, destination, "--no-upstream", "--", "--branch", branch, "--no-recurse-submodules"], this.config.limits.cloneTimeoutMs, cwd);
  }
}
