// THE ASSIGNMENT: the responsibility ONE employee holds for a mission (or a unit of it). Work Management is the only
// author of its states. While it is in a HOLDING state it holds its employee (the reservation, a fact of the database:
// workforce.reservations, checked at commit); QUEUED waits for a slot; COMPLETED, CANCELLED and FAILED_FINAL have let go.
//
//   QUEUED ──claim──▶ ASSIGNED ──runStarted──▶ RUNNING ──handoff──▶ AWAITING_ACCEPTANCE ──accept──▶ COMPLETED
//                         ▲                     │  │                      │
//                         └──────revision───────┼──┼──────────────────────┘ (request revision keeps the employee)
//                         ├─answer── BLOCKED ◀──┘  └─▶ RECOVERING (a run's end is not known) ─▶ ASSIGNED
//                         └─resume── PAUSED  (any holding state but CANCELLING can pause)
//   any non-terminal ──cancel──▶ CANCELLING (a run is live: stop it first) ──▶ CANCELLED, or straight to CANCELLED
//
// Every transition says its precondition and raises its event; a command that does not fit the state is refused with
// `invalid_transition` and changes nothing. The fence moves at every claim and every new attempt: a worker's result
// carries the fence it was given, and a result under an older fence is refused (handled where results are accepted).
import { isHolding, type AssignmentState, type Deliverable, type ExecutionProfile } from "@orbit-web/contracts";
import { AccountOwned, conflictWith, type OrbitId, type RaisedEvent } from "../../shared/domain.js";

export interface Brief {
  goal: string;
  deliverables: Deliverable[];
  acceptanceCriteria: string[];
  // What a reviewer asked to change, oldest first (a revision keeps the same assignment and adds to this).
  revisions: { handoffRevision: number; criteria: string; at: string }[];
  // Answers a person gave to the employee's questions.
  answers: { question: string; answer: string; at: string }[];
}

// What the assignment pinned when its employee claimed it.
export interface Pinned {
  profileRevision: number;
  departmentId: string | null;
  departmentName: string | null;
  execution: ExecutionProfile;
}

export interface AssignmentData {
  id: string;
  orbitId: OrbitId;
  missionId: string;
  parentId: string | null;
  unitKey: string | null;
  employeeId: string;
  state: AssignmentState;
  reason: string | null;
  waitingOn: string | null;
  brief: Brief;
  execution: { model?: string; effort?: string | null } | null;
  handoffRevision: number;
  reworkCount: number;
  pinned: Pinned | null;
  priority: number;
  eligibleAt: string;
  deadline: string | null;
  fence: number;
  claimedAt: string | null;
  finishedAt: string | null;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  // The version the row was read at (0: not stored yet).
  version: number;
}

const transition = (from: AssignmentState, command: string): never => {
  throw conflictWith("invalid_transition", `This assignment is ${from}: it cannot ${command} now.`, { state: from, command });
};

export class Assignment extends AccountOwned {
  private readonly raised: RaisedEvent[] = [];
  // The state the row was read in: what the repository compares to decide the reservation's fate.
  readonly loadedState: AssignmentState | null;

  private constructor(private d: AssignmentData) {
    super(d.orbitId);
    this.loadedState = d.version === 0 ? null : d.state;
  }

  static restore(d: AssignmentData): Assignment {
    return new Assignment({ ...d });
  }

  // A new assignment, waiting in the employee's queue. It is claimed at once by the caller when a slot is free.
  static queued(o: Omit<AssignmentData, "state" | "reason" | "waitingOn" | "handoffRevision" | "reworkCount" | "pinned" | "fence" | "claimedAt" | "finishedAt" | "updatedAt" | "version">): Assignment {
    const a = new Assignment({ ...o, state: "QUEUED", reason: null, waitingOn: null, handoffRevision: 0, reworkCount: 0, pinned: null, fence: 0, claimedAt: null, finishedAt: null, updatedAt: o.createdAt, version: 0 });
    a.raise("AssignmentQueued", { employeeId: o.employeeId, priority: o.priority });
    return a;
  }

  get data(): Readonly<AssignmentData> {
    return this.d;
  }

  get id(): string {
    return this.d.id;
  }

  get state(): AssignmentState {
    return this.d.state;
  }

  get holding(): boolean {
    return isHolding(this.d.state);
  }

  // The version this save will give the row.
  get nextVersion(): number {
    return this.d.version + 1;
  }

  pullEvents(): RaisedEvent[] {
    return this.raised.splice(0, this.raised.length);
  }

  // QUEUED → ASSIGNED: the employee takes it (the caller holds the employee's row and writes the reservation in the same
  // transaction). Pins the profile revision, the department then, and the execution asked.
  claim(pinned: Pinned, at: string): void {
    if (this.d.state !== "QUEUED") transition(this.d.state, "be claimed");
    this.d = { ...this.d, state: "ASSIGNED", pinned, claimedAt: at, fence: this.d.fence + 1, reason: null, waitingOn: null, updatedAt: at };
    this.raise("AssignmentClaimed", { employeeId: this.d.employeeId, fence: this.d.fence, profileRevision: pinned.profileRevision, departmentId: pinned.departmentId, departmentName: pinned.departmentName });
  }

  // ASSIGNED → RUNNING: the run the worker started under the current fence.
  runStarted(fence: number, at: string): void {
    if (this.d.state !== "ASSIGNED" && this.d.state !== "RECOVERING") transition(this.d.state, "start running");
    if (fence !== this.d.fence) throw conflictWith("stale_fence", "A run of an earlier attempt cannot start this assignment.");
    this.d = { ...this.d, state: "RUNNING", reason: null, waitingOn: null, updatedAt: at };
    this.raise("RunStarted", { fence });
  }

  // A new attempt (after a revision, an answer, a resume, a retry): the fence moves, so an older run's result is refused.
  nextAttempt(at: string): number {
    if (!this.holding || this.d.state === "CANCELLING") transition(this.d.state, "start another attempt");
    this.d = { ...this.d, fence: this.d.fence + 1, updatedAt: at };
    return this.d.fence;
  }

  // RUNNING (or ASSIGNED) → AWAITING_ACCEPTANCE: a handoff of the current attempt was submitted.
  handoffSubmitted(revision: number, digest: string, fence: number, at: string): void {
    if (this.d.state !== "RUNNING" && this.d.state !== "ASSIGNED") transition(this.d.state, "receive a handoff");
    if (fence !== this.d.fence) throw conflictWith("stale_fence", "This handoff comes from an attempt that was replaced; it is kept as history and not reviewed.");
    if (revision !== this.d.handoffRevision + 1) throw conflictWith("handoff_revision", `Expected handoff revision ${this.d.handoffRevision + 1}.`);
    this.d = { ...this.d, state: "AWAITING_ACCEPTANCE", handoffRevision: revision, reason: null, waitingOn: "owner_review", updatedAt: at };
    this.raise("HandoffSubmitted", { revision, digest });
  }

  // AWAITING_ACCEPTANCE → ASSIGNED: the reviewer asked for changes. The employee keeps the assignment; a new attempt runs.
  requestRevision(criteria: string, by: string, at: string): number {
    if (this.d.state !== "AWAITING_ACCEPTANCE") transition(this.d.state, "be sent back for a revision");
    const brief: Brief = { ...this.d.brief, revisions: [...this.d.brief.revisions, { handoffRevision: this.d.handoffRevision, criteria, at }] };
    this.d = { ...this.d, state: "ASSIGNED", brief, reworkCount: this.d.reworkCount + 1, fence: this.d.fence + 1, reason: null, waitingOn: null, updatedAt: at };
    this.raise("RevisionRequested", { handoffRevision: this.d.handoffRevision, reworkCount: this.d.reworkCount, by });
    return this.d.fence;
  }

  // AWAITING_ACCEPTANCE → COMPLETED: the reviewed handoff is accepted; the reservation is released in this transaction.
  accept(handoffRevision: number, by: string, at: string): void {
    if (this.d.state !== "AWAITING_ACCEPTANCE") transition(this.d.state, "be accepted");
    if (handoffRevision !== this.d.handoffRevision) throw conflictWith("stale_handoff", "A newer handoff was submitted: review it before accepting.");
    this.d = { ...this.d, state: "COMPLETED", finishedAt: at, waitingOn: null, reason: null, updatedAt: at };
    this.raise("AssignmentAccepted", { handoffRevision, by });
    this.raise("ReservationReleased", { employeeId: this.d.employeeId, outcome: "completed" });
  }

  // → BLOCKED: the employee needs something (an answer, a person's action) or the run ended without a result.
  block(reason: string, waitingOn: string, at: string): void {
    if (!["ASSIGNED", "RUNNING", "RECOVERING"].includes(this.d.state)) transition(this.d.state, "be blocked");
    this.d = { ...this.d, state: "BLOCKED", reason: reason.slice(0, 500), waitingOn, updatedAt: at };
    this.raise("AssignmentBlocked", { reason: this.d.reason, waitingOn });
  }

  // BLOCKED → ASSIGNED: a person answered, or retried; a new attempt runs.
  unblock(at: string, answer: { question: string; answer: string } | null): number {
    if (this.d.state !== "BLOCKED") transition(this.d.state, "continue");
    const brief = answer === null ? this.d.brief : { ...this.d.brief, answers: [...this.d.brief.answers, { ...answer, at }] };
    this.d = { ...this.d, state: "ASSIGNED", brief, reason: null, waitingOn: null, fence: this.d.fence + 1, updatedAt: at };
    this.raise(answer === null ? "AssignmentResumed" : "InformationProvided", { fence: this.d.fence });
    return this.d.fence;
  }

  // Any holding state but CANCELLING → PAUSED (a live run is stopped by the caller). Keeps the employee.
  pause(reason: string, at: string): void {
    if (!this.holding || this.d.state === "CANCELLING" || this.d.state === "PAUSED") transition(this.d.state, "pause");
    this.d = { ...this.d, state: "PAUSED", reason: reason || "Paused by a person.", waitingOn: "owner", fence: this.d.fence + 1, updatedAt: at };
    this.raise("AssignmentPaused", { reason: this.d.reason });
  }

  // PAUSED → ASSIGNED: a new attempt runs.
  resume(at: string): number {
    if (this.d.state !== "PAUSED") transition(this.d.state, "resume");
    this.d = { ...this.d, state: "ASSIGNED", reason: null, waitingOn: null, fence: this.d.fence + 1, updatedAt: at };
    this.raise("AssignmentResumed", { fence: this.d.fence });
    return this.d.fence;
  }

  // RUNNING → RECOVERING: a run's end is not known (a worker or the allocator could not be read); nothing new starts
  // until it is reconciled.
  recovering(reason: string, at: string): void {
    if (this.d.state !== "RUNNING" && this.d.state !== "ASSIGNED") transition(this.d.state, "be reconciled");
    this.d = { ...this.d, state: "RECOVERING", reason: reason.slice(0, 500), waitingOn: "reconciliation", updatedAt: at };
    this.raise("AssignmentBlocked", { reason: this.d.reason, waitingOn: "reconciliation" });
  }

  // RECOVERING → ASSIGNED: the old run is proven stopped; a new attempt runs under a new fence.
  recovered(at: string): number {
    if (this.d.state !== "RECOVERING") transition(this.d.state, "leave reconciliation");
    this.d = { ...this.d, state: "ASSIGNED", reason: null, waitingOn: null, fence: this.d.fence + 1, updatedAt: at };
    this.raise("AssignmentResumed", { fence: this.d.fence });
    return this.d.fence;
  }

  // Cancel: QUEUED or not running → CANCELLED at once; a live run → CANCELLING (the caller stops it, then `cancelled`).
  cancel(runLive: boolean, reason: string, at: string): void {
    if (["COMPLETED", "CANCELLED", "FAILED_FINAL", "CANCELLING"].includes(this.d.state)) transition(this.d.state, "be cancelled");
    if (runLive) {
      this.d = { ...this.d, state: "CANCELLING", reason: reason || "Cancelled by a person.", waitingOn: "run_stop", fence: this.d.fence + 1, updatedAt: at };
      this.raise("AssignmentCancelling", { reason: this.d.reason });
      return;
    }
    this.finish("CANCELLED", reason || "Cancelled by a person.", at);
  }

  // CANCELLING → CANCELLED: the run was stopped (verified by the worker).
  cancelled(at: string): void {
    if (this.d.state !== "CANCELLING") transition(this.d.state, "finish cancelling");
    this.finish("CANCELLED", this.d.reason ?? "Cancelled.", at);
  }

  // → FAILED_FINAL: a valid decision to end it (never a transient runtime error by itself).
  fail(reason: string, at: string): void {
    if (["COMPLETED", "CANCELLED", "FAILED_FINAL"].includes(this.d.state)) transition(this.d.state, "fail");
    this.finish("FAILED_FINAL", reason, at);
  }

  private finish(state: "CANCELLED" | "FAILED_FINAL", reason: string, at: string): void {
    const held = this.holding;
    this.d = { ...this.d, state, reason: reason.slice(0, 500), waitingOn: null, finishedAt: at, updatedAt: at };
    this.raise(state === "CANCELLED" ? "AssignmentCancelled" : "AssignmentFailed", { reason: this.d.reason });
    if (held) this.raise("ReservationReleased", { employeeId: this.d.employeeId, outcome: state === "CANCELLED" ? "cancelled" : "failed" });
  }

  private raise(type: RaisedEvent["type"], payload: RaisedEvent["payload"]): void {
    this.raised.push({ type, aggregateType: "assignment", aggregateId: this.d.id, aggregateVersion: this.d.version + 1, missionId: this.d.missionId, payload });
  }
}
