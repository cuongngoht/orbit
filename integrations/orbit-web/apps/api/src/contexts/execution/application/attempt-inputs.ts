// WHERE AN ATTEMPT'S INPUT BYTES COME FROM, for the sandbox provider -- and only what the attempt may read (ADR 0061 §9).
//
// The provider is handed, for every file of /input, a path that names the ATTEMPT (`attempt:<orbit>/<run>/<name>`), never
// a store's: the bytes are served only when that name is in the run's manifest (written before it started), the run is
// live, and what the manifest names is STILL what the attempt may read now -- the same grant that staged it, worked out
// again. Anything else is refused and recorded as a boundary violation of the account it named. What is read behind it:
// a repository's bundle (repository-bundles.port.ts), a research revision, a hand-in's artifact or a hand-in's summary
// (ResearchInputs) -- of that account only.
import { Inject, Injectable, Optional } from "@nestjs/common";
import { contextOf } from "../../../modules/auth/principal.js";
import { AuditService } from "../../../modules/governance/audit.service.js";
import { AttemptManifest } from "../infrastructure/attempt-manifest.js";
import { RunRepository } from "../infrastructure/runs.repository.js";
import { REPO_BUNDLE_PREFIX, REPOSITORY_BUNDLES, type RepositoryBundles } from "./repository-bundles.port.js";
import { ResearchInputs } from "./research-inputs.js";
import { RUN_OUTCOMES, type AttemptData, type RunOutcomes } from "./run-outcomes.port.js";

// One file of an attempt's /input, why it is there, and what gave it.
export interface StagedInput {
  name: string;
  // What is read behind it (a store's path: research-text:, research-object:, artifact:, handoff-summary:, repo-bundle:).
  storePath: string;
  origin: "mission" | "share" | "supervision" | "repository";
  // The share that gave it (null: the mission's own, supervision, a repository).
  ref: string | null;
  // What the employee is told of it.
  why: string;
}

const ATTEMPT_INPUT = /^attempt:([0-9a-f-]{36})\/([0-9a-f-]{36})\/([A-Za-z0-9._-]{1,160})$/;
const ACCOUNT_IN = /^[a-z-]+:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\//;
const LIVE = ["starting", "running"];

export const attemptInputPath = (orbitId: string, runId: string, name: string): string => `attempt:${orbitId}/${runId}/${name}`;

export class InputRefused extends Error {}

@Injectable()
export class AttemptInputs {
  constructor(
    @Inject(ResearchInputs) private readonly research: ResearchInputs,
    @Inject(AttemptManifest) private readonly manifest: AttemptManifest,
    @Inject(RunRepository) private readonly runs: RunRepository,
    @Inject(RUN_OUTCOMES) private readonly outcomes: RunOutcomes,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(REPOSITORY_BUNDLES) private readonly bundles: RepositoryBundles | null = null,
  ) {}

  // What one attempt may read now, as the files of its /input (its repositories' bundles aside: `repositories` says
  // whether they still come with it).
  stagedOf(orbitId: string, data: Pick<AttemptData, "sources" | "handoffs">): StagedInput[] {
    return this.research.stagedOf(orbitId, data);
  }

  async read(storePath: string): Promise<Buffer> {
    const m = ATTEMPT_INPUT.exec(storePath);
    if (m === null) return this.refuse(ACCOUNT_IN.exec(storePath)?.[1] ?? null, null, storePath, "not an attempt's input");
    const [, orbitId, runId, name] = m as unknown as [string, string, string, string];
    const row = await this.manifest.get(orbitId, runId, name);
    const run = await this.runs.get(orbitId, runId);
    if (row === null || run === null || !LIVE.includes(run.state)) return this.refuse(orbitId, runId, storePath, "not in a live attempt's manifest");
    if ((await this.withdrawn(orbitId, run.assignmentId, [row])) !== null) return this.refuse(orbitId, runId, storePath, "no longer the attempt's to read");
    return this.behind(row.storePath);
  }

  // The first input of a manifest the attempt may no longer read (null: every one still may be).
  async withdrawn(orbitId: string, assignmentId: string, rows: readonly StagedInput[]): Promise<string | null> {
    const data = await this.outcomes.data(orbitId, assignmentId);
    if (data === null) return rows[0]?.name ?? null;
    const now = new Set(this.stagedOf(orbitId, data).map((i) => `${i.name}\n${i.storePath}`));
    for (const r of rows) {
      if (r.origin === "repository" ? !data.repositories : !now.has(`${r.name}\n${r.storePath}`)) return r.name;
    }
    return null;
  }

  private behind(storePath: string): Promise<Buffer> {
    if (!storePath.startsWith(REPO_BUNDLE_PREFIX)) return this.research.read(storePath);
    if (this.bundles === null) return Promise.reject(new Error("this installation brings no repository into an attempt"));
    return this.bundles.read(storePath);
  }

  private async refuse(orbitId: string | null, runId: string | null, storePath: string, why: string): Promise<never> {
    if (orbitId !== null) {
      const ctx = contextOf({ kind: "system", id: "attempt-inputs", accountId: orbitId }, runId === null ? "attempt-inputs" : `run:${runId}`);
      await this.audit.record(ctx, { type: "boundary.violation", outcome: "refused", reasonCodes: ["INPUT_NOT_AUTHORIZED"], ...(runId !== null ? { runId } : {}), data: { kind: "input_not_authorized", route: "sandbox.input", target: storePath.slice(0, 200) } }).catch(() => undefined);
    }
    throw new InputRefused(`The input is refused: ${why}.`);
  }
}
