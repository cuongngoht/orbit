// AZURE DEVOPS AS A REPOSITORY SOURCE, through the Azure CLI only: `az rest` calls the Azure DevOps REST API with the
// Azure CLI's own sign-in (Orbit Web's profile, /data/azure) -- the CLI holds the token, Orbit Web never sees one --
// to list the organizations the account belongs to, their repositories and a repository's branches. A repository can
// be opened only if this listing has it, and it is cloned from the URL the listing gave, never from one a browser sent.
import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { splitAzureId, type Branch, type BranchList, type RepositoryList, type SourceState } from "@orbit-web/contracts";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG, PROCESS_PORT } from "../../core/tokens.js";
import { ApiError, badRequest, conflict, forbidden } from "../../common/errors.js";
import { azureEnv } from "../../infra/process/env.js";
import { endedHow, succeeded, type ProcessPort, type RunResult } from "../../infra/process/process.port.js";
import { tail } from "../../infra/security/redact.js";
import { AzureAuthService } from "../azure-auth/azure-auth.service.js";
import { GitGateway } from "../changes/git.gateway.js";
import { AZURE_DEVOPS_RESOURCE, azureUrls, parseAccounts, parseProfile, parseRefs, parseRepositories, type AzureRepository } from "./azure-parse.js";
import { orderBranches } from "./github.source.js";

const CACHE_MS = 5 * 60_000;
const MAX_ORGANIZATIONS = 50;
const PARALLEL = 4;

// The listing as the server keeps it: each repository with its clone URL.
type AzureListing = Omit<RepositoryList, "repositories"> & { repositories: AzureRepository[] };

const upstream = (what: string, r: RunResult) => new ApiError(HttpStatus.BAD_GATEWAY, "azure_unavailable", `The Azure CLI could not ${what}: ${endedHow(r)} ${tail(r.stderr || r.stdout, 2)}`);

// Runs `work` over `items`, at most `limit` at a time, keeping the order of `items`.
async function inBatches<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += limit) out.push(...(await Promise.all(items.slice(i, i + limit).map(work))));
  return out;
}

@Injectable()
export class AzureSource {
  private cache: { at: number; user: string; value: AzureListing } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(AzureAuthService) private readonly azure: AzureAuthService,
    @Inject(GitGateway) private readonly git: GitGateway,
  ) {}

  async state(): Promise<SourceState> {
    const c = await this.azure.connection();
    return { source: "azure", state: c.state, account: c.account?.user ?? null };
  }

  // What a browser is shown: the listing without the clone URLs, which stay on the server.
  async list(refresh: boolean): Promise<RepositoryList> {
    const all = await this.listed(refresh);
    return { ...all, repositories: all.repositories.map(({ cloneUrl: _kept, ...repo }) => repo) };
  }

  private async listed(refresh: boolean): Promise<AzureListing> {
    const user = await this.connectedUser();
    if (!refresh && this.cache && this.cache.user === user && Date.now() - this.cache.at < CACHE_MS) return this.cache.value;
    const profileRun = await this.rest(azureUrls.profile());
    const profile = succeeded(profileRun) ? parseProfile(profileRun.stdout) : null;
    if (profile === null) throw upstream("read your Azure DevOps profile", profileRun);
    const accountsRun = await this.rest(azureUrls.accounts(profile.id));
    if (!succeeded(accountsRun)) throw upstream("list your Azure DevOps organizations", accountsRun);
    const organizations = parseAccounts(accountsRun.stdout).slice(0, MAX_ORGANIZATIONS);
    const runs = await inBatches(organizations, PARALLEL, (org) => this.rest(azureUrls.repositories(org)));
    const repositories = runs.flatMap((r, i) => (succeeded(r) ? parseRepositories(r.stdout, organizations[i] as string) : []));
    repositories.sort((a, b) => a.fullName.localeCompare(b.fullName));
    const value = { source: "azure" as const, repositories, fetchedAt: new Date().toISOString(), partial: runs.some((r) => !succeeded(r)) };
    this.cache = { at: Date.now(), user, value };
    return value;
  }

  // The listed repository an id names, or a refusal: only what the account can reach may be opened.
  async authorized(id: string): Promise<AzureRepository> {
    if (splitAzureId(id) === null) throw badRequest("an Azure DevOps repository is organization/<repository id>");
    const find = (list: { repositories: AzureRepository[] }) => list.repositories.find((r) => r.id.toLowerCase() === id.toLowerCase());
    const found = find(await this.listed(false)) ?? find(await this.listed(true));
    if (!found) throw forbidden("repository_not_listed", "That repository is not among the Azure DevOps repositories this account can reach.");
    return found;
  }

  async branches(id: string): Promise<BranchList> {
    const repo = await this.authorized(id);
    const parts = splitAzureId(repo.id) as { organization: string; repositoryId: string };
    const r = await this.rest(azureUrls.refs(parts.organization, parts.repositoryId));
    if (!succeeded(r)) throw upstream(`list the branches of ${repo.fullName}`, r);
    return { source: "azure", repository: repo.id, branches: orderBranches(parseRefs(r.stdout, repo.defaultBranch) as Branch[]) };
  }

  async clone(id: string, branch: string, destination: string, cwd: string, extra: string[] = []): Promise<RunResult> {
    const repo = await this.authorized(id);
    return this.git.cloneAzure(cwd, repo.cloneUrl, branch, destination, extra);
  }

  private rest(url: string): Promise<RunResult> {
    return this.process.run(this.config.binaries.az, ["rest", "--method", "get", "--url", url, "--resource", AZURE_DEVOPS_RESOURCE, "--output", "json"], {
      cwd: this.config.controlHome,
      env: azureEnv(this.config),
      timeoutMs: 60_000,
    });
  }

  private async connectedUser(): Promise<string> {
    const c = await this.azure.connection();
    if (c.state !== "connected" || c.account === null) throw conflict("azure_not_connected", "Connect Azure DevOps first (Settings → Connectors): its repositories are read with the Azure CLI's sign-in.");
    return c.account.user;
  }
}
