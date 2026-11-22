// REPOSITORY SOURCES: where a chat's workspace can be cloned from -- GitHub (through GitHub CLI) and Azure DevOps
// (through the Azure CLI). One service in front of both, so a chat names a repository by its source and id and nothing
// else cares which one it is.
//
//   GET /api/sources                                     which sources can list repositories now, and as whom
//   GET /api/repositories?source=<s>[&refresh=1]         a source's repositories (cached a few minutes)
//   GET /api/repositories/branches?source=<s>&id=<id>    a listed repository's branches, the default first
import { Controller, Get, Inject, Injectable, Module, Query } from "@nestjs/common";
import { isRepositorySource, type BranchList, type Repository, type RepositoryList, type RepositoryRef, type RepositorySource, type SourcesStatus } from "@orbit-web/contracts";
import { badRequest } from "../../common/errors.js";
import type { RunResult } from "../../infra/process/process.port.js";
import { AzureAuthModule } from "../azure-auth/azure-auth.module.js";
import { ChangesModule } from "../changes/changes.module.js";
import { GithubModule } from "../github/github.module.js";
import { AzureSource } from "./azure.source.js";
import { GithubSource } from "./github.source.js";
import { MirrorService } from "./mirror.service.js";

// What a new chat's workspace is cloned from: a listed repository and one of its branches.
export interface RepositoryOrigin {
  source: RepositorySource;
  id: string;
  fullName: string;
  branch: string;
}

@Injectable()
export class SourcesService {
  constructor(
    @Inject(GithubSource) private readonly github: GithubSource,
    @Inject(AzureSource) private readonly azure: AzureSource,
  ) {}

  async status(): Promise<SourcesStatus> {
    return { sources: await Promise.all([this.github.state(), this.azure.state()]) };
  }

  list(source: RepositorySource, refresh: boolean): Promise<RepositoryList> {
    return source === "github" ? this.github.list(refresh) : this.azure.list(refresh);
  }

  branches(source: RepositorySource, id: string): Promise<BranchList> {
    return source === "github" ? this.github.branches(id) : this.azure.branches(id);
  }

  // A repository as the source lists it now (its clone URL stays here), or a refusal: one it does not list.
  async authorized(source: RepositorySource, id: string): Promise<Repository> {
    if (source === "github") return this.github.authorized(id);
    const { cloneUrl: _kept, ...repo } = await this.azure.authorized(id);
    return repo;
  }

  // The repository a chat asked for, if the source lists it, and the branch to start from: the one asked for if the
  // repository has it, else the repository's default.
  async open(ref: RepositoryRef, branch: string | null): Promise<RepositoryOrigin> {
    const repo = ref.source === "github" ? await this.github.authorized(ref.id) : await this.azure.authorized(ref.id);
    const branches = (await this.branches(ref.source, repo.id)).branches;
    const chosen = branch ?? repo.defaultBranch ?? branches[0]?.name ?? null;
    if (chosen === null || !branches.some((b) => b.name === chosen)) throw badRequest(`${chosen ?? "a branch"} is not a branch of ${repo.fullName}`);
    return { source: ref.source, id: repo.id, fullName: repo.fullName, branch: chosen };
  }

  clone(origin: Pick<RepositoryOrigin, "source" | "id" | "branch">, destination: string, cwd: string, extra: string[] = []): Promise<RunResult> {
    return origin.source === "github" ? this.github.clone(origin.id, origin.branch, destination, cwd, extra) : this.azure.clone(origin.id, origin.branch, destination, cwd, extra);
  }

  // One branch, fetched the way a workspace is cloned -- the source's own sign-in, a new directory, nothing of the
  // workspace's configuration read -- as a bare clone of that branch alone that borrows what the workspace already
  // has (`reference`), so only what is new comes over the network.
  cloneBranch(origin: Pick<RepositoryOrigin, "source" | "id" | "branch">, destination: string, cwd: string, reference: string): Promise<RunResult> {
    const extra = ["--bare", "--single-branch", "--reference-if-able", reference];
    return origin.source === "github" ? this.github.clone(origin.id, origin.branch, destination, cwd, extra) : this.azure.clone(origin.id, origin.branch, destination, cwd, extra);
  }
}

const sourceOf = (value: unknown): RepositorySource => {
  if (!isRepositorySource(value)) throw badRequest("source must be github or azure");
  return value;
};

@Controller()
export class SourcesController {
  constructor(@Inject(SourcesService) private readonly sources: SourcesService) {}

  @Get("sources")
  status(): Promise<SourcesStatus> {
    return this.sources.status();
  }

  @Get("repositories")
  list(@Query("source") source?: string, @Query("refresh") refresh?: string): Promise<RepositoryList> {
    return this.sources.list(sourceOf(source), refresh === "1" || refresh === "true");
  }

  @Get("repositories/branches")
  branches(@Query("source") source?: string, @Query("id") id?: string): Promise<BranchList> {
    if (typeof id !== "string" || id.length === 0) throw badRequest("id names the repository");
    return this.sources.branches(sourceOf(source), id);
  }
}

@Module({
  imports: [GithubModule, AzureAuthModule, ChangesModule],
  providers: [GithubSource, AzureSource, SourcesService, MirrorService],
  controllers: [SourcesController],
  exports: [SourcesService, MirrorService],
})
export class SourcesModule {}
