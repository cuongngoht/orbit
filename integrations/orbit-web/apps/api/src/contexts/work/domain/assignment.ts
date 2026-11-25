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
// A LEAD (ADR 0061 §8): RUNNING ──delegate──▶ WAITING_FOR_SUBORDINATES ──▶ REVIEWING (its team handed in: review, then
// integrate and hand in) or ANSWERING (its team asked: answer, or move the question one level up) ──▶ back to WAITING.
// A question a part asks BLOCKS it (waiting on its lead); the answer resumes it ONCE. A pause or a block remembers the
// state it left, and a resume returns to it (a lead paused while it waits for its team waits again). Each attempt that
// delegated, asked, answered or handed in has ended its work: its tools close at once (`acting`).
//
// Every transition says its precondition and raises its event; a command that does not fit the state is refused with
// `invalid_transition` and changes nothing. The fence moves at every claim and every new attempt: a worker's result
// carries the fence it was given, and a result under an older fence is refused (handled where results are accepted).
import { isHolding, WORKFORCE_LIMITS, type AssignmentState, type Deliverable, type ExecutionProfile, type ExecutionSources } from "@orbit-web/contracts";
import { AccountOwned, conflictWith, type OrbitId, type RaisedEvent } from "../../shared/domain.js";

// The states in which an attempt of the assignment may act through its tools: anything else (it delegated, asked, handed
// in, was paused or is being cancelled) has ended its work, whatever its CLI still says.
export const ACTING_STATES: readonly AssignmentState[] = ["ASSIGNED", "RUNNING", "REVIEWING", "ANSWERING", "RECOVERING"];

// What a part or a mission was given to, as kept on it.
export interface AssignmentTargetData {
  kind: "employee" | "department" | "ceo";
  departmentId: string | null;
  appointmentId: string | null;
  appointmentRevision: number | null;
}

export interface Brief {
  goal: string;
  deliverables: Deliverable[];
  acceptanceCriteria: string[];
  // What a reviewer asked to change, oldest first (a revision keeps the same assignment and adds to this).
  revisions: { handoffRevision: number; criteria: string; at: string }[];
  // Answers a person gave to the employee's questions.
  answers: { question: string; answer: string; at: string }[];
  // A part of a manager's assignment: the other parts (their unit keys) it waits for before it can be claimed.
  dependsOn?: string[];
  // Whether its lead shared the mission's attached repositories with this part (recipient Access grants still checked at attempt start).
  shareRepositories?: boolean;
}

// What the assignment pinned when its employee claimed it.
export interface Pinned {
  profileRevision: number;
  departmentId: string | null;
  departmentName: string | null;
  execution: ExecutionProfile;
  // Which layer gave each field of the execution (mission, employee, department, company, the runtime's default).
  sources?: ExecutionSources;
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
  // Plans it gave and questions it asked (bounded), and the state a pause or a block left (to return to it).
  planCount: number;
  questionCount: number;
  pausedFrom: AssignmentState | null;
  blockedFrom: AssignmentState | null;
  target: AssignmentTargetData | null;
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

// What a state that waits waits on, when a resume returns to it.
const WAITING_ON: Partial<Record<AssignmentState, string>> = { WAITING_FOR_SUBORDINATES: "team", AWAITING_ACCEPTANCE: "owner_review", BLOCKED: "owner" };

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
  static queued(o: Omit<AssignmentData, "state" | "reason" | "waitingOn" | "handoffRevision" | "reworkCount" | "planCount" | "questionCount" | "pausedFrom" | "blockedFrom" | "target" | "pinned" | "fence" | "claimedAt" | "finishedAt" | "updatedAt" | "version"> & { target?: AssignmentTargetData | null }): Assignment {
    const a = new Assignment({ ...o, target: o.target ?? null, state: "QUEUED", reason: null, waitingOn: null, handoffRevision: 0, reworkCount: 0, planCount: 0, questionCount: 0, pausedFrom: null, blockedFrom: null, pinned: null, fence: 0, claimedAt: null, finishedAt: null, updatedAt: o.createdAt, version: 0 });
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

  // Whether the attempt under `fence` may still act: it is the current attempt and the assignment is in a state that runs
  // one (ACTING_STATES). An attempt that delegated, asked or handed in is done, whatever its CLI still does.
  acting(fence: number): boolean {
    return this.d.fence === fence && ACTING_STATES.includes(this.d.state);
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
    if (this.d.state !== "RUNNING" && this.d.state !== "ASSIGNED" && this.d.state !== "REVIEWING") transition(this.d.state, "receive a handoff");
    if (fence !== this.d.fence) throw conflictWith("stale_fence", "This handoff comes from an attempt that was replaced; it is kept as history and not reviewed.");
    if (revision !== this.d.handoffRevision + 1) throw conflictWith("handoff_revision", `Expected handoff revision ${this.d.handoffRevision + 1}.`);
    this.d = { ...this.d, state: "AWAITING_ACCEPTANCE", handoffRevision: revision, reason: null, waitingOn: "owner_review", updatedAt: at };
    this.raise("HandoffSubmitted", { revision, digest });
  }

  // AWAITING_ACCEPTANCE → ASSIGNED: the reviewer asked for changes. The employee keeps the assignment; a new attempt runs.
  requestRevision(criteria: string, by: string, at: string): number {
    if (this.d.state !== "AWAITING_ACCEPTANCE") transition(this.d.state, "be sent back for a revision");
    if (this.d.reworkCount >= WORKFORCE_LIMITS.reworkLimit) throw conflictWith("rework_limit", `This work was sent back ${this.d.reworkCount} times already (the limit is ${WORKFORCE_LIMITS.reworkLimit}): accept it, or cancel it and give it again.`, { reworkCount: this.d.reworkCount });
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
    if (!["ASSIGNED", "RUNNING", "RECOVERING", "REVIEWING", "ANSWERING"].includes(this.d.state)) transition(this.d.state, "be blocked");
    this.d = { ...this.d, state: "BLOCKED", blockedFrom: this.d.state, reason: reason.slice(0, 500), waitingOn, updatedAt: at };
    this.raise("AssignmentBlocked", { reason: this.d.reason, waitingOn });
  }

  // → BLOCKED on a question its attempt asked (its lead's, or the owner's at the root): its attempt ends there. At most
  // WORKFORCE_LIMITS.questionLimit questions per assignment.
  asked(question: string, waitingOn: "lead" | "information", fence: number, at: string): void {
    if (!this.acting(fence)) throw conflictWith("stale_fence", "This attempt was replaced or has ended: its question was not sent.");
    if (this.d.questionCount >= WORKFORCE_LIMITS.questionLimit) throw conflictWith("question_limit", `You asked ${this.d.questionCount} questions already (the limit is ${WORKFORCE_LIMITS.questionLimit}): decide yourself, or hand in what you have saying what is missing.`, { questionCount: this.d.questionCount });
    this.d = { ...this.d, questionCount: this.d.questionCount + 1 };
    this.block(question, waitingOn, at);
  }

  // BLOCKED → the state it was blocked from (a lead's review or answering again; else ASSIGNED): a person or a lead
  // answered, or a person retried. A new attempt runs.
  unblock(at: string, answer: { question: string; answer: string } | null): number {
    if (this.d.state !== "BLOCKED") transition(this.d.state, "continue");
    const brief = answer === null ? this.d.brief : { ...this.d.brief, answers: [...this.d.brief.answers, { ...answer, at }] };
    const back: AssignmentState = this.d.blockedFrom === "REVIEWING" || this.d.blockedFrom === "ANSWERING" ? this.d.blockedFrom : "ASSIGNED";
    this.d = { ...this.d, state: back, blockedFrom: null, brief, reason: null, waitingOn: null, fence: this.d.fence + 1, updatedAt: at };
    this.raise(answer === null ? "AssignmentResumed" : "InformationProvided", { fence: this.d.fence });
    return this.d.fence;
  }

  // Any holding state but CANCELLING → PAUSED (a live run is stopped by the caller). Keeps the employee, and the state it
  // left.
  pause(reason: string, at: string): void {
    if (!this.holding || this.d.state === "CANCELLING" || this.d.state === "PAUSED") transition(this.d.state, "pause");
    this.d = { ...this.d, state: "PAUSED", pausedFrom: this.d.state, reason: reason || "Paused by a person.", waitingOn: "owner", fence: this.d.fence + 1, updatedAt: at };
    this.raise("AssignmentPaused", { reason: this.d.reason });
  }

  // PAUSED → the state it was paused in: waiting work waits again (a lead for its team, a question for its answer, a
  // result for its review) and runs nothing; work that was acting runs a new attempt. Returns the new fence, or null when
  // nothing is to run.
  resume(at: string): number | null {
    if (this.d.state !== "PAUSED") transition(this.d.state, "resume");
    const from = this.d.pausedFrom;
    const waits = from === "WAITING_FOR_SUBORDINATES" || from === "BLOCKED" || from === "AWAITING_ACCEPTANCE";
    const back: AssignmentState = waits ? (from as AssignmentState) : from === "REVIEWING" || from === "ANSWERING" ? from : "ASSIGNED";
    this.d = { ...this.d, state: back, pausedFrom: null, reason: waits ? this.d.reason : null, waitingOn: waits ? WAITING_ON[back] ?? null : null, fence: this.d.fence + 1, updatedAt: at };
    this.raise("AssignmentResumed", { fence: this.d.fence });
    return waits ? null : this.d.fence;
  }

  // RUNNING → RECOVERING: a run's end is not known (a worker or the allocator could not be read); nothing new starts
  // until it is reconciled.
  recovering(reason: string, at: string): void {
    if (this.d.state !== "RUNNING" && this.d.state !== "ASSIGNED" && this.d.state !== "REVIEWING") transition(this.d.state, "be reconciled");
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

  // RUNNING (or REVIEWING) → WAITING_FOR_SUBORDINATES: the manager gave `units` parts of its work to its team. Its attempt
  // ends here; it keeps the assignment (and its employee) while the team works.
  delegated(fence: number, units: number, at: string): void {
    if (!["RUNNING", "REVIEWING", "ASSIGNED", "ANSWERING"].includes(this.d.state)) transition(this.d.state, "give parts of its work to a team");
    if (fence !== this.d.fence) throw conflictWith("stale_fence", "A replaced attempt cannot give work to a team.");
    if (this.d.planCount >= WORKFORCE_LIMITS.replanLimit) throw conflictWith("replan_limit", `You gave ${this.d.planCount} plans for this work already (the limit is ${WORKFORCE_LIMITS.replanLimit}): finish it with the parts you have.`, { planCount: this.d.planCount });
    this.d = { ...this.d, state: "WAITING_FOR_SUBORDINATES", planCount: this.d.planCount + 1, reason: `${units} part(s) given to the team`, waitingOn: "team", updatedAt: at };
    this.raise("AssignmentDelegated", { units, fence });
  }

  // WAITING_FOR_SUBORDINATES → REVIEWING: the team handed in (or ended); a new attempt of the lead reviews and integrates.
  reviewing(at: string): number {
    if (this.d.state !== "WAITING_FOR_SUBORDINATES") transition(this.d.state, "review its team's results");
    this.d = { ...this.d, state: "REVIEWING", reason: null, waitingOn: null, fence: this.d.fence + 1, updatedAt: at };
    this.raise("AssignmentReviewing", { fence: this.d.fence });
    return this.d.fence;
  }

  // WAITING_FOR_SUBORDINATES → ANSWERING: a part of its team asked it a question; a new attempt of the lead answers it
  // (or moves it one level up).
  answering(at: string): number {
    if (this.d.state !== "WAITING_FOR_SUBORDINATES") transition(this.d.state, "answer its team");
    this.d = { ...this.d, state: "ANSWERING", reason: null, waitingOn: null, fence: this.d.fence + 1, updatedAt: at };
    this.raise("AssignmentAnswering", { fence: this.d.fence });
    return this.d.fence;
  }

  // REVIEWING or ANSWERING → WAITING_FOR_SUBORDINATES: nothing left to decide now; the lead waits for its team again.
  waitForTeam(at: string): void {
    if (this.d.state !== "REVIEWING" && this.d.state !== "ANSWERING") transition(this.d.state, "wait for its team");
    this.d = { ...this.d, state: "WAITING_FOR_SUBORDINATES", reason: "Waiting for its team", waitingOn: "team", updatedAt: at };
  }

  // A HANDOVER: a person moves this open work to another employee -- never a side effect of a replaced appointment --
  // only before or between attempts (QUEUED, ASSIGNED, BLOCKED, PAUSED, WAITING_FOR_SUBORDINATES), with a new fence so a
  // result of the old holder's attempt is refused. Work held is re-pinned to the new holder's profile; queued work is
  // pinned when it is claimed. Returns the employee who held it.
  handOver(to: { employeeId: string; pinned: Pinned | null }, at: string): string {
    if (!["QUEUED", "ASSIGNED", "BLOCKED", "PAUSED", "WAITING_FOR_SUBORDINATES"].includes(this.d.state)) transition(this.d.state, "be handed over");
    if (to.employeeId === this.d.employeeId) throw conflictWith("same_holder", "That employee holds this work already.");
    const from = this.d.employeeId;
    const pinned = this.holding ? to.pinned : null;
    this.d = { ...this.d, employeeId: to.employeeId, pinned, fence: this.holding ? this.d.fence + 1 : this.d.fence, updatedAt: at };
    this.raise("AssignmentHandedOver", { fromEmployeeId: from, employeeId: to.employeeId, fence: this.d.fence });
    if (this.holding) this.raise("ReservationReleased", { employeeId: from, outcome: "handed_over" });
    return from;
  }

  // A REPIN: work blocked or paused after its employee's profile changed (a provider changed, say) continues on the
  // profile in effect now, by a person's choice -- never by itself. The fence moves: the next attempt is a new one.
  repin(pinned: Pinned, at: string): void {
    if (this.d.state !== "BLOCKED" && this.d.state !== "PAUSED") transition(this.d.state, "be re-pinned");
    this.d = { ...this.d, pinned, fence: this.d.fence + 1, updatedAt: at };
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
