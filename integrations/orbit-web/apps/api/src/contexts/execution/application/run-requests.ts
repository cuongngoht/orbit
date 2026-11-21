// What the Work context asks of Execution, in ITS transaction (synchronous port): write the durable intent of a new
// attempt of an assignment (with the claim, a revision, an answer, a resume), and ask a live run to stop. The worker does
// the rest after commit: admission, the sandbox, the CLI. Nothing here starts a process, and no transaction is held
// open while anything runs.
import { Inject, Injectable } from "@nestjs/common";
import type { ExecutionProfile } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { RaisedEvent } from "../../shared/domain.js";
import { RunRepository, type RunRecord } from "../infrastructure/runs.repository.js";

@Injectable()
export class RunRequests {
  constructor(@Inject(RunRepository) private readonly runs: RunRepository) {}

  // A new attempt of the assignment under `fence`. Returns the event that says so (the caller writes it to the outbox).
  // An attempt still live (one that handed in and is ending, say) is asked to stop: admission starts the new one only
  // once no attempt of its employee is live.
  async request(o: { orbitId: string; assignmentId: string; missionId: string; employeeId: string; fence: number; priority: number; execution: ExecutionProfile }): Promise<RaisedEvent> {
    await this.stop(o.orbitId, o.assignmentId, "replaced");
    const attemptNo = (await this.runs.attempts(o.orbitId, o.assignmentId)) + 1;
    const id = randomUUID();
    await this.runs.insert({ id, orbitId: o.orbitId, assignmentId: o.assignmentId, employeeId: o.employeeId, attemptNo, fence: o.fence, requested: { ...o.execution }, priority: o.priority, at: new Date().toISOString() });
    return { type: "RunRequested", aggregateType: "run", aggregateId: id, aggregateVersion: 1, missionId: o.missionId, payload: { assignmentId: o.assignmentId, attemptNo, fence: o.fence } };
  }

  // Asks the live run of the assignment to stop (the worker stops it, verifies it stopped, then reports its end). A run
  // not admitted yet is cancelled at once. Returns whether a run is still live (stopping).
  async stop(orbitId: string, assignmentId: string, reason: string): Promise<boolean> {
    const run = await this.runs.live(orbitId, assignmentId, true);
    if (run === null) return false;
    if (["requested", "waiting_for_resources", "unschedulable"].includes(run.state)) {
      await this.runs.transition(orbitId, run.id, [run.state], "cancelled", { endedAt: new Date().toISOString(), detail: reason, waitingReason: null });
      return false;
    }
    await this.runs.set(orbitId, run.id, { stopRequested: reason.slice(0, 200) || "stop" });
    return true;
  }

  async live(orbitId: string, assignmentId: string): Promise<RunRecord | null> {
    return this.runs.live(orbitId, assignmentId);
  }
}
