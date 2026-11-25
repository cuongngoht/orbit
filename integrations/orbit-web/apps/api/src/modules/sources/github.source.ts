// GITHUB AS A REPOSITORY SOURCE, through GitHub CLI only: the REST listing of the account's own, collaborator and
// organisation-member repositories (all pages), merged with `gh repo list`. A repository can be opened only if it is
// in that listing; its branches are read the same way, and it is cloned with `gh repo clone` (gh's own credential
// helper for that one command).
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { splitFullName, type Branch, type BranchList, type Repository, type RepositoryList, type SourceState } from "@orbit-web/contracts";
import { ApiError, badRequest, conflict, forbidden } from "../../common/errors.js";
import { endedHow, succeeded, type RunResult } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import { branchFromApi, GhGateway, ndjson, repositoryFromApi, repositoryFromList } from "../github/gh.gateway.js";
import { GithubAuthService } from "../github/github-auth.service.js";

const CACHE_MS = 5 * 60_000;

export function mergeRepositories(lists: Repository[][]): Repository[] {
  const byName = new Map<string, Repository>();
  for (const list of lists) for (const r of list) byName.set(r.fullName.toLowerCase(), { ...byName.get(r.fullName.toLowerCase()), ...r });
  return [...byName.values()].sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? "") || a.fullName.localeCompare(b.fullName));
}

export function orderBranches(branches: Branch[]): Branch[] {
  return [...branches].sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.name.localeCompare(b.name));
}

const upstream = (what: string, detail: string) => new ApiError(HttpStatus.BAD_GATEWAY, "github_unavailable", `GitHub CLI could not ${what}: ${detail}`);

@Injectable()
export class GithubSource {
  private cache: { at: number; login: string; value: RepositoryList } | null = null;

  constructor(
    @Inject(GhGateway) private readonly gh: GhGateway,
    @Inject(GithubAuthService) private readonly github: GithubAuthService,
  ) {}

  async state(): Promise<SourceState> {
    const c = await this.github.connection();
    return { source: "github", state: c.state, account: c.account?.login ?? null };
  }

  async list(refresh: boolean): Promise<RepositoryList> {
    const login = await this.connectedLogin();
    if (!refresh && this.cache && this.cache.login === login && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const [api, own] = await Promise.all([this.gh.apiRepositories(), this.gh.ownRepositories()]);
    if (!succeeded(api) && !succeeded(own)) throw upstream("list repositories", `${endedHow(api)} ${tail(api.stderr, 2)}`);
    const fromApi = succeeded(api) ? ndjson(api.stdout).map(repositoryFromApi).filter((r): r is Repository => r !== null) : [];
    const fromList = succeeded(own) ? this.parseList(own.stdout) : [];
    const value: RepositoryList = { source: "github", repositories: mergeRepositories([fromList, fromApi]), fetchedAt: new Date().toISOString(), partial: !succeeded(api) || !succeeded(own) || api.truncated };
    this.cache = { at: Date.now(), login, value };
    return value;
  }

  // The listed repository a name refers to, or a refusal: only what the account can reach may be opened.
  async authorized(fullName: string): Promise<Repository> {
    if (splitFullName(fullName) === null) throw badRequest("a GitHub repository is owner/name");
    const find = (list: RepositoryList) => list.repositories.find((r) => r.fullName.toLowerCase() === fullName.toLowerCase());
    const found = find(await this.list(false)) ?? find(await this.list(true));
    if (!found) throw forbidden("repository_not_listed", `${fullName} is not among the repositories this GitHub account can reach.`);
    return found;
  }

  async branches(fullName: string): Promise<BranchList> {
    const repo = await this.authorized(fullName);
    const r = await this.gh.branches(repo.owner, repo.name);
    if (!succeeded(r)) throw upstream(`list the branches of ${repo.fullName}`, `${endedHow(r)} ${tail(r.stderr, 2)}`);
    const branches = ndjson(r.stdout).map((b) => branchFromApi(b, repo.defaultBranch)).filter((b): b is Branch => b !== null);
    return { source: "github", repository: repo.fullName, branches: orderBranches(branches) };
  }

  async clone(fullName: string, branch: string, destination: string, cwd: string, extra: string[] = []): Promise<RunResult> {
    const repo = await this.authorized(fullName);
    return this.gh.clone(repo.owner, repo.name, branch, destination, cwd, extra);
  }

  private parseList(stdout: string): Repository[] {
    try {
      const rows = JSON.parse(stdout) as unknown;
      return Array.isArray(rows) ? rows.map((r) => repositoryFromList(r as Record<string, unknown>)).filter((r): r is Repository => r !== null) : [];
    } catch {
      return [];
    }
  }

  private async connectedLogin(): Promise<string> {
    const c = await this.github.connection();
    if (c.state !== "connected" || c.account === null) throw conflict("github_not_connected", "Connect GitHub first (Settings → Connectors): repositories are read with the GitHub CLI's sign-in.");
    return c.account.login;
  }
}
