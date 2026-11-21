// What a run looks like to a reader (Execution's read side): what was asked, what the backend resolved and what the
// runtime itself reported -- three records, never merged -- with the sandbox's attestation, the resources requested,
// applied and observed, and what the containers' cgroups showed. Nothing a run's model read or wrote is here.
import { Inject, Injectable } from "@nestjs/common";
import type { RunView } from "@orbit-web/contracts";
import { RunRepository, type RunRecord } from "../infrastructure/runs.repository.js";

type Observed = { cli?: { model?: string | null; version?: string | null; plugins?: string[] } | null } | null;

export function runView(r: RunRecord): RunView {
  const observed = r.observed as Observed;
  const { brief: _brief, ...requested } = r.requested;
  return {
    id: r.id,
    attemptNo: r.attemptNo,
    state: r.state,
    requested,
    resolved: r.resolved,
    observed: {
      model: observed?.cli?.model ?? null,
      // The CLI's own stream does not say which effort it ran at.
      effort: "unknown",
      plugins: observed?.cli ? (observed.cli.plugins ?? []) : "unknown",
      runtimeVersion: observed?.cli?.version ?? null,
      nativeSession: null,
    },
    modelUsage: r.modelUsage ?? { costUsd: null, turns: null, durationMs: null },
    sandbox: r.sandbox,
    resources: r.resources,
    usage: r.usage ?? { modelPlane: null, toolPlane: null },
    waitingReason: r.waitingReason,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    detail: r.detail,
  };
}

@Injectable()
export class RunViews {
  constructor(@Inject(RunRepository) private readonly runs: RunRepository) {}

  // The last attempt of each assignment, and how many there were.
  async ofAssignments(orbitId: string, assignmentIds: readonly string[]): Promise<Map<string, { last: RunView; attempts: number }>> {
    const out = new Map<string, { last: RunView; attempts: number }>();
    for (const r of await this.runs.ofAssignments(orbitId, assignmentIds)) {
      const prior = out.get(r.assignmentId);
      out.set(r.assignmentId, { last: runView(r), attempts: (prior?.attempts ?? 0) + 1 });
    }
    return out;
  }

  async liveOfEmployee(orbitId: string, employeeId: string): Promise<RunView | null> {
    const r = await this.runs.liveOfEmployee(orbitId, employeeId);
    return r === null ? null : runView(r);
  }

  // Every attempt of one assignment, newest first.
  async attemptsOf(orbitId: string, assignmentId: string): Promise<RunView[]> {
    return (await this.runs.ofAssignments(orbitId, [assignmentId])).map(runView).reverse();
  }
}
