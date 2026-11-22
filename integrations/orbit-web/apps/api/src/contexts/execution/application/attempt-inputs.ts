// WHERE AN ATTEMPT'S INPUT BYTES COME FROM, for the sandbox provider: a repository's bundle (repository-bundles.port.ts),
// or a research revision or a hand-in's artifact (ResearchInputs) -- of that account only.
import { Inject, Injectable, Optional } from "@nestjs/common";
import { REPO_BUNDLE_PREFIX, REPOSITORY_BUNDLES, type RepositoryBundles } from "./repository-bundles.port.js";
import { ResearchInputs } from "./research-inputs.js";

@Injectable()
export class AttemptInputs {
  constructor(
    @Inject(ResearchInputs) private readonly research: ResearchInputs,
    @Optional() @Inject(REPOSITORY_BUNDLES) private readonly bundles: RepositoryBundles | null = null,
  ) {}

  read(storePath: string): Promise<Buffer> {
    if (!storePath.startsWith(REPO_BUNDLE_PREFIX)) return this.research.read(storePath);
    if (this.bundles === null) return Promise.reject(new Error("this installation brings no repository into an attempt"));
    return this.bundles.read(storePath);
  }
}
