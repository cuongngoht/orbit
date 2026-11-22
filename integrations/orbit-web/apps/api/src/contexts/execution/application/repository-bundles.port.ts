// AN ATTEMPT'S REPOSITORIES, as inputs: a snapshot of each repository its mission brings in (and its employee may still
// use), cloned by Orbit Web with the source's own sign-in and handed over as a git bundle -- read by the sandbox
// provider once, then released. Bound by the composition; with none bound, an attempt brings no repository.
// A repository an attempt brings in, as it was granted to its mission.
export interface AttemptRepository {
  source: "github" | "azure";
  id: string;
  fullName: string;
  owner: string;
  project: string | null;
  name: string;
  // null: the repository's default branch.
  branch: string | null;
}

export const REPOSITORY_BUNDLES = Symbol("REPOSITORY_BUNDLES");
export const REPO_BUNDLE_PREFIX = "repo-bundle:";

export interface RepositoryInputs {
  inputs: { name: string; storePath: string }[];
  // What the employee is told: each bundle and how to open it, and each repository that could not be brought in, why.
  lines: string[];
}

export interface RepositoryBundles {
  prepare(orbitId: string, employeeId: string, runId: string, repositories: readonly AttemptRepository[]): Promise<RepositoryInputs>;
  read(storePath: string): Promise<Buffer>;
  release(runId: string): Promise<void>;
}
