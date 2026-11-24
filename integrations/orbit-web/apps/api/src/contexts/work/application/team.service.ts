// TEAMS (Work context): a manager -- an employee whose profile may delegate -- gives PARTS of its assignment to its
// colleagues, as a plan it hands in through its `delegate` tool:
//
//   - the plan is a graph: each part has a stable key, an employee, a brief, and the parts it waits for. It is refused
//     whole when a key repeats, an employee is not a working colleague of this account (or is the manager), a part waits
//     for one that is not in the plan, the waits make a cycle, or the delegation is deeper than the account allows;
//   - each part is an ASSIGNMENT of the same mission under the manager's (its `unitKey` the part's key), queued for its
//     employee and claimed through the same queue as any work; a part that waits for others is not claimable until they
//     are accepted;
//   - the mission gets TEAM ROOMS, one per data domain: a workbench at /team the attempts of one department share (the
//     employees of no department share the company's), never another department's (never the evidence either: a part's
//     result is still a pinned handoff), its history kept as which attempt changed which file;
//   - a part READS only what its lead shares with it on purpose (data_shares): sources the lead reads itself, and the
//     accepted hand-in of a part it waits for, as its summary or in full (domain/data-authorization.ts);
//   - the manager waits (WAITING_FOR_SUBORDINATES); when every part handed in or ended, a new attempt of the manager
//     REVIEWS them (`review_unit`: accept, or ask for a revision -- the part keeps its employee) and, once all are
//     accepted, integrates and hands in its own result to the person who gave the work.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { WORKFORCE_LIMITS, type AssignmentState, type Deliverable, type TeamRoomChange } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { Db } from "../../../infra/db/db.js";
import { RunRequests } from "../../execution/application/run-requests.js";
import { OfficeGovernance, systemActor, type Actor } from "../../shared/application/commands.js";
import { conflictWith, invalid, missing, refused, type RaisedEvent } from "../../shared/domain.js";
import { EventDispatcher } from "../../shared/infrastructure/consumers.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { ResourcesService } from "../../execution/application/resources.service.js";
import type { TeamRoom } from "../../execution/application/run-outcomes.port.js";
import { Assignment } from "../domain/assignment.js";
import { sharedSourcesOf, type ShareMode } from "../domain/data-authorization.js";
import { AttemptDataService } from "./attempt-data.service.js";
import { DecisionRepository } from "../infrastructure/decisions.js";
import { AssignmentRepository, HandoffRepository, MissionRepository } from "../infrastructure/repositories.js";

export interface UnitPlan {
  key: string;
  employeeId: string;
  title: string;
  goal: string;
  deliverables: Deliverable[];
  acceptanceCriteria: string[];
  dependsOn: string[];
  // What the lead shares with the part (nothing unless it says): source labels it reads ("all": every one it reads), and
  // the accepted hand-in of a part this one waits for -- its summary, or in full.
  shareSources?: string[];
  receives?: { from: string; as: ShareMode }[];
}

export interface UnitView {
  key: string;
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  state: AssignmentState;
  dependsOn: string[];
  handoff: { revision: number; digest: string; summary: string; submittedAt: string; artifacts: { name: string; sha256: string }[] } | null;
}

const KEY = /^[a-z0-9][a-z0-9-]{0,39}$/;
// Never: a part waiting for others is claimable only once they are accepted.
const NOT_YET = "9999-12-31T00:00:00.000Z";
// A team room's data domain: one department's, or the company's (the employees of no department).
const roomKeyOf = (departmentId: string | null): string => (departmentId === null ? "company" : `department:${departmentId}`);
const TEAM_ROOM_MIB = 1024;
// A part blocked on a question is not settled: its person answers, and it goes on.
const SETTLED: readonly AssignmentState[] = ["AWAITING_ACCEPTANCE", "COMPLETED", "CANCELLED", "FAILED_FINAL"];
const DONE: readonly AssignmentState[] = ["COMPLETED", "CANCELLED", "FAILED_FINAL"];

// Whether a manager waiting for its team has something to do now: a part's result waits for its decision, or every part
// ended -- and no part is still being worked on. A part that waits for others it has not accepted yet is not "being
// worked on": its manager's decisions are what it waits for.
export function readyToReview(units: readonly Pick<UnitView, "key" | "state" | "dependsOn">[]): boolean {
  if (units.length === 0) return false;
  const done = new Set(units.filter((u) => u.state === "COMPLETED").map((u) => u.key));
  const working = units.some((u) => (u.state === "QUEUED" ? u.dependsOn.every((d) => done.has(d)) : !SETTLED.includes(u.state) && u.state !== "BLOCKED"));
  if (working) return false;
  return units.some((u) => u.state === "AWAITING_ACCEPTANCE") || units.every((u) => DONE.includes(u.state));
}

// The waits of a plan, ordered (Kahn); null when they make a cycle.
export function orderOf(units: readonly Pick<UnitPlan, "key" | "dependsOn">[]): string[] | null {
  const waits = new Map(units.map((u) => [u.key, new Set(u.dependsOn)]));
  const out: string[] = [];
  const ready = units.filter((u) => u.dependsOn.length === 0).map((u) => u.key);
  while (ready.length > 0) {
    const k = ready.shift() as string;
    out.push(k);
    for (const [other, deps] of waits) {
      if (deps.delete(k) && deps.size === 0 && !out.includes(other) && !ready.includes(other)) ready.push(other);
    }
  }
  return out.length === units.length ? out : null;
}

// What is wrong with a plan, as the manager is told (empty: it can be given).
export function planProblems(units: readonly UnitPlan[], managerId: string, colleagues: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  if (units.length === 0) problems.push("A plan gives at least one part.");
  if (units.length > 8) problems.push("A plan gives at most 8 parts at a time.");
  const keys = new Set<string>();
  for (const u of units) {
    if (!KEY.test(u.key)) problems.push(`"${u.key}" is not a part's key (lower-case letters, digits and dashes).`);
    if (keys.has(u.key)) problems.push(`The key "${u.key}" is given twice.`);
    keys.add(u.key);
    if (u.employeeId === managerId) problems.push(`"${u.key}" is given to yourself: give it to a colleague, or do it yourself.`);
    else if (!colleagues.has(u.employeeId)) problems.push(`"${u.key}" names someone who is not a working colleague of this office.`);
    if (u.goal.trim().length === 0) problems.push(`"${u.key}" has no goal.`);
  }
  for (const u of units) for (const d of u.dependsOn) if (!keys.has(d)) problems.push(`"${u.key}" waits for "${d}", which is not in the plan.`);
  for (const u of units) for (const r of u.receives ?? []) if (!u.dependsOn.includes(r.from)) problems.push(`"${u.key}" receives the hand-in of "${r.from}", which it does not wait for: a part receives only what it waits for.`);
  if (problems.length === 0 && orderOf(units) === null) problems.push("The parts wait for each other in a circle: nothing could start.");
  return problems;
}

@Injectable()
export class TeamService implements OnModuleInit {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(AssignmentRepository) private readonly assignments: AssignmentRepository,
    @Inject(HandoffRepository) private readonly handoffs: HandoffRepository,
    @Inject(MissionRepository) private readonly missions: MissionRepository,
    @Inject(DecisionRepository) private readonly decisions: DecisionRepository,
    @Inject(RunRequests) private readonly runs: RunRequests,
    @Inject(ResourcesService) private readonly resources: ResourcesService,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(EventDispatcher) private readonly dispatcher: EventDispatcher,
    @Inject(AttemptDataService) private readonly data: AttemptDataService,
  ) {}

  onModuleInit(): void {
    // When a part hands in or ends, its manager may have everything it waited for.
    this.dispatcher.register({ id: "work.team", types: ["HandoffSubmitted", "AssignmentCancelled", "AssignmentFailed"], handle: async (e) => this.maybeWake(e.accountId, e.aggregateId, e.correlationId, e.id) });
  }

  // ---- what an attempt is told -------------------------------------------------------------------------------------

  async colleagues(orbitId: string, employeeId: string): Promise<{ id: string; name: string; title: string }[]> {
    const rows = await this.db.query(
      `SELECT e.id, e.name, p.profile->>'title' AS title FROM workforce.employees e
       JOIN workforce.employee_profiles p ON p.account_id = e.account_id AND p.employee_id = e.id AND p.revision = e.profile_revision
       WHERE e.account_id = $1 AND e.id <> $2 AND e.employment IN ('probation', 'active') ORDER BY e.name, e.id LIMIT 50`,
      [orbitId, employeeId],
    );
    return rows.map((r) => ({ id: String(r.id), name: String(r.name), title: String(r.title ?? "") }));
  }

  async units(orbitId: string, managerAssignmentId: string): Promise<UnitView[]> {
    const rows = await this.db.query(
      `SELECT a.id, a.unit_key, a.employee_id, a.state, a.brief, e.name FROM workforce.assignments a
       JOIN workforce.employees e ON e.account_id = a.account_id AND e.id = a.employee_id
       WHERE a.account_id = $1 AND a.parent_id = $2 ORDER BY a.created_at, a.id`,
      [orbitId, managerAssignmentId],
    );
    const out: UnitView[] = [];
    for (const r of rows) {
      // What a lead is shown of a part (and reads in /input): its latest hand-in submitted or accepted -- never one it
      // asked to revise, nor one a newer revision superseded.
      const h = await this.handoffs.latestIn(orbitId, String(r.id), ["submitted", "accepted"]);
      const files = h === null ? [] : await this.db.query("SELECT name, sha256 FROM workforce.artifacts WHERE account_id = $1 AND handoff_id = $2 ORDER BY name", [orbitId, h.id]);
      out.push({
        key: String(r.unit_key),
        assignmentId: String(r.id),
        employeeId: String(r.employee_id),
        employeeName: String(r.name),
        state: String(r.state) as AssignmentState,
        dependsOn: ((r.brief as { dependsOn?: string[] }).dependsOn ?? []) as string[],
        handoff: h === null ? null : { revision: h.revision, digest: h.digest, summary: h.summary, submittedAt: h.submittedAt, artifacts: files.map((f) => ({ name: String(f.name), sha256: String(f.sha256) })) },
      });
    }
    return out;
  }

  // The room of one data domain of a mission: its department's (the department named), else the company's.
  async room(orbitId: string, missionId: string, departmentId: string | null): Promise<TeamRoom | null> {
    const r = await this.db.one("SELECT id, quota_mib FROM workforce.team_rooms WHERE account_id = $1 AND mission_id = $2 AND room_key = $3 AND state = 'open'", [orbitId, missionId, roomKeyOf(departmentId)]);
    return r === null ? null : { id: String(r.id), quotaMiB: Number(r.quota_mib), domain: departmentId === null ? "company" : "department" };
  }

  // At dispatch: the room of the attempt's data domain, opened when the mission has a team (any room) and this domain has
  // none yet. A mission with no team has no room.
  async roomFor(orbitId: string, missionId: string, departmentId: string | null): Promise<TeamRoom | null> {
    const had = await this.room(orbitId, missionId, departmentId);
    if (had !== null) return had;
    const team = await this.db.one("SELECT 1 AS one FROM workforce.team_rooms WHERE account_id = $1 AND mission_id = $2 LIMIT 1", [orbitId, missionId]);
    if (team === null) return null;
    await this.db.tx(() => this.openRoom(orbitId, missionId, departmentId, new Date().toISOString()));
    return this.room(orbitId, missionId, departmentId);
  }

  // ---- the manager's plan ------------------------------------------------------------------------------------------

  // Inside the manager's run transaction (its assignment locked by the caller): the parts made, queued, and the room.
  async delegate(actor: Actor, manager: Assignment, fence: number, units: UnitPlan[], canDelegate: boolean): Promise<RaisedEvent[]> {
    const orbitId = manager.orbitId;
    if (!canDelegate) throw refused("cannot_delegate", "Your profile does not let you give work to others: do it yourself.");
    if ((await this.depth(orbitId, manager)) >= WORKFORCE_LIMITS.delegationDepth) throw refused("delegation_too_deep", `Work is already given down ${WORKFORCE_LIMITS.delegationDepth} levels: do this part yourself.`);
    const colleagues = new Set((await this.colleagues(orbitId, manager.data.employeeId)).map((c) => c.id));
    const existing = new Set((await this.units(orbitId, manager.id)).map((u) => u.key));
    const problems = planProblems(units, manager.data.employeeId, colleagues);
    for (const u of units) if (existing.has(u.key)) problems.push(`A part "${u.key}" was already given.`);
    if (problems.length > 0) throw invalid("plan_refused", `The plan was not given: ${problems.join(" ")}`, { problems });
    const shared = await this.sharesOf(orbitId, manager, units);
    for (const u of units) await this.governance.authorize(actor, "work.delegate", u.employeeId, { employee: u.employeeId, manager: manager.data.employeeId });
    const at = new Date().toISOString();
    await this.openRoom(orbitId, manager.data.missionId, await this.departmentOf(orbitId, manager.data.employeeId), at);
    const events: RaisedEvent[] = [];
    const made = new Map<string, string>();
    for (const u of units) {
      const part = Assignment.queued({
        id: randomUUID(),
        orbitId,
        missionId: manager.data.missionId,
        parentId: manager.id,
        unitKey: u.key,
        employeeId: u.employeeId,
        brief: { goal: `${u.title}\n\n${u.goal}`, deliverables: u.deliverables, acceptanceCriteria: u.acceptanceCriteria, revisions: [], answers: [], dependsOn: u.dependsOn },
        execution: null,
        priority: manager.data.priority,
        eligibleAt: u.dependsOn.length === 0 ? at : NOT_YET,
        deadline: manager.data.deadline,
        createdBy: actor.command.actor,
        createdAt: at,
      });
      await this.assignments.save(part);
      events.push(...part.pullEvents());
      made.set(u.key, part.id);
    }
    await this.share(actor, manager, units, shared, made, at);
    const m = await this.missions.get(orbitId, manager.data.missionId, true);
    if (m !== null) {
      await this.db.query("UPDATE workforce.missions SET plan_revision = plan_revision + 1, updated_at = $3, version = version + 1 WHERE account_id = $1 AND id = $2", [orbitId, m.id, at]);
      events.push({ type: "MissionPlanRevised", aggregateType: "mission", aggregateId: m.id, aggregateVersion: m.data.version + 1, missionId: m.id, payload: { parts: units.length, by: manager.data.employeeId } });
    }
    manager.delegated(fence, units.length, at);
    return events;
  }

  private async depth(orbitId: string, a: Assignment): Promise<number> {
    const r = await this.db.one(
      `WITH RECURSIVE up(id, parent_id, n) AS (SELECT id, parent_id, 0 FROM workforce.assignments WHERE account_id = $1 AND id = $2
         UNION ALL SELECT p.id, p.parent_id, up.n + 1 FROM workforce.assignments p JOIN up ON p.id = up.parent_id WHERE p.account_id = $1 AND up.n < 10)
       SELECT max(n) AS n FROM up`,
      [orbitId, a.id],
    );
    return Number(r?.n ?? 0);
  }

  // A mission given to an employee who may delegate gets its room at once (its data domain's): its first attempt can
  // prepare what its team will need before it gives the parts.
  async ensureRoom(orbitId: string, missionId: string, employeeId: string): Promise<void> {
    await this.openRoom(orbitId, missionId, await this.departmentOf(orbitId, employeeId), new Date().toISOString());
  }

  // One room per mission and data domain; its storage is committed by the room (owner_ref = the room's id).
  private async openRoom(orbitId: string, missionId: string, departmentId: string | null, at: string): Promise<void> {
    const made = await this.db.one(
      "INSERT INTO workforce.team_rooms (id, account_id, mission_id, room_key, department_id, quota_mib, state, created_at) VALUES ($1, $2, $3, $4, $5, $6, 'open', $7) ON CONFLICT (account_id, mission_id, room_key) DO NOTHING RETURNING id",
      [randomUUID(), orbitId, missionId, roomKeyOf(departmentId), departmentId, TEAM_ROOM_MIB, at],
    );
    if (made !== null) await this.resources.commit(orbitId, "team", String(made.id), TEAM_ROOM_MIB);
  }

  private async departmentOf(orbitId: string, employeeId: string): Promise<string | null> {
    const r = await this.db.one("SELECT department_id FROM workforce.employees WHERE account_id = $1 AND id = $2", [orbitId, employeeId]);
    return r === null || r.department_id === null ? null : String(r.department_id);
  }

  // ---- what a lead shares with its parts ---------------------------------------------------------------------------------

  // The source revisions each part is given, held to what the lead reads itself (a label it does not read refuses the
  // plan whole, with the others' problems).
  private async sharesOf(orbitId: string, manager: Assignment, units: readonly UnitPlan[]): Promise<Map<string, string[]>> {
    const asked = units.filter((u) => (u.shareSources ?? []).length > 0);
    const out = new Map<string, string[]>();
    if (asked.length === 0) return out;
    const held = (await this.data.of(orbitId, manager.id))?.sources ?? [];
    const problems: string[] = [];
    for (const u of asked) {
      const r = sharedSourcesOf(u.shareSources ?? [], held);
      problems.push(...r.problems.map((p) => `"${u.key}": ${p}`));
      out.set(u.key, r.revisionIds);
    }
    if (problems.length > 0) throw invalid("plan_refused", `The plan was not given: ${problems.join(" ")}`, { problems });
    return out;
  }

  // Each share recorded with what, to whom and from where (and audited): a source revision, or a predecessor's hand-in.
  private async share(actor: Actor, manager: Assignment, units: readonly UnitPlan[], sources: ReadonlyMap<string, string[]>, made: ReadonlyMap<string, string>, at: string): Promise<void> {
    const orbitId = manager.orbitId;
    const write = async (recipient: string, kind: "source" | "handoff", ref: string, mode: ShareMode) => {
      const id = randomUUID();
      await this.db.query(
        "INSERT INTO workforce.data_shares (id, account_id, mission_id, recipient_assignment_id, lead_assignment_id, kind, source_revision_id, origin_assignment_id, mode, shared_by, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)",
        [id, orbitId, manager.data.missionId, recipient, manager.id, kind, kind === "source" ? ref : null, kind === "handoff" ? ref : null, mode, actor.command.actor, at],
      );
      await this.governance.shared(actor, { missionId: manager.data.missionId, recipient, kind, ref, mode, origin: kind === "source" ? "mission" : ref });
    };
    for (const u of units) {
      const recipient = made.get(u.key) as string;
      for (const revisionId of sources.get(u.key) ?? []) await write(recipient, "source", revisionId, "full");
      for (const r of u.receives ?? []) await write(recipient, "handoff", made.get(r.from) as string, r.as);
    }
  }

  // ---- the manager wakes, and reviews ----------------------------------------------------------------------------------

  // A part handed in or ended: when every part of its manager is settled, the manager reviews (a new attempt).
  private async maybeWake(orbitId: string, childId: string, correlationId: string, causationId: string): Promise<void> {
    const child = await this.db.one("SELECT parent_id FROM workforce.assignments WHERE account_id = $1 AND id = $2", [orbitId, childId]);
    if (child === null || child.parent_id === null) return;
    const manager = await this.assignments.get(orbitId, String(child.parent_id), true);
    if (manager === null || manager.state !== "WAITING_FOR_SUBORDINATES") return;
    const units = await this.units(orbitId, manager.id);
    if (!readyToReview(units)) return;
    const fence = manager.reviewing(new Date().toISOString());
    const actor = systemActor(orbitId, "team", correlationId, causationId);
    const run = await this.requestRun(manager, fence);
    await this.assignments.save(manager);
    await this.outbox.append(actor.command, [...manager.pullEvents(), run]);
    await this.outbox.touched(orbitId, ["roster", "missions"], manager.data.missionId);
  }

  // The manager's decision on one part it reviews: accept it (it completes, its employee is free, the parts waiting for it
  // may start), or ask for a revision (the part keeps its employee; a new attempt).
  async review(actor: Actor, manager: Assignment, unitKey: string, decision: "accept" | "revise", criteria: string): Promise<{ events: RaisedEvent[]; text: string }> {
    const orbitId = manager.orbitId;
    if (manager.state !== "REVIEWING") throw conflictWith("invalid_transition", "Reviewing your team's parts happens when they have all handed in.");
    const row = await this.db.one("SELECT id FROM workforce.assignments WHERE account_id = $1 AND parent_id = $2 AND unit_key = $3", [orbitId, manager.id, unitKey]);
    if (row === null) throw missing(`The part "${unitKey}"`);
    const part = (await this.assignments.get(orbitId, String(row.id), true)) as Assignment;
    if (part.state !== "AWAITING_ACCEPTANCE") throw conflictWith("invalid_transition", `The part "${unitKey}" is ${part.state.toLowerCase().replace(/_/g, " ")}: there is nothing of it to review now.`);
    const h = await this.handoffs.latest(orbitId, part.id);
    if (h === null || h.status !== "submitted") throw conflictWith("invalid_transition", `The part "${unitKey}" has no result waiting.`);
    const at = new Date().toISOString();
    const events: RaisedEvent[] = [];
    let text: string;
    if (decision === "accept") {
      await this.runs.stop(orbitId, part.id, "accepted");
      part.accept(h.revision, actor.command.actor, at);
      await this.handoffs.review(orbitId, part.id, h.revision, "accepted", { by: actor.command.actor, at, note: criteria });
      await this.decisions.closeAllFor(orbitId, part.id, "accepted by its manager");
      text = `Accepted "${unitKey}".`;
    } else {
      if (criteria.trim().length === 0) throw invalid("criteria_required", "Say what has to change.");
      const fence = part.requestRevision(criteria, actor.command.actor, at);
      await this.handoffs.review(orbitId, part.id, h.revision, "revision_requested", { by: actor.command.actor, at, note: criteria });
      events.push(await this.requestRun(part, fence));
      text = `Asked "${unitKey}" for a revision: its employee works on it again.`;
    }
    await this.assignments.save(part);
    events.push(...part.pullEvents());
    if (decision === "accept") events.push(...(await this.release(orbitId, manager.id, at)));
    return { events, text };
  }

  // Parts whose every wait is accepted become claimable now.
  private async release(orbitId: string, managerId: string, at: string): Promise<RaisedEvent[]> {
    const units = await this.units(orbitId, managerId);
    const done = new Set(units.filter((u) => u.state === "COMPLETED").map((u) => u.key));
    const events: RaisedEvent[] = [];
    for (const u of units.filter((x) => x.state === "QUEUED" && x.dependsOn.length > 0 && x.dependsOn.every((d) => done.has(d)))) {
      await this.db.query("UPDATE workforce.assignments SET eligible_at = $3, updated_at = $3, version = version + 1 WHERE account_id = $1 AND id = $2 AND state = 'QUEUED'", [orbitId, u.assignmentId, at]);
      events.push({ type: "AssignmentQueued", aggregateType: "assignment", aggregateId: u.assignmentId, aggregateVersion: 1, payload: { employeeId: u.employeeId, priority: 0, released: true } });
    }
    return events;
  }

  // A review attempt that ended without handing in. A part's result that arrived while it ran (it was never shown it):
  // the manager reviews again. Parts still being worked on: back to waiting. A result it was shown and left undecided, or
  // nothing left to wait for and no hand-in: blocked, with why.
  async reviewEnded(manager: Assignment, at: string, attemptStartedAt: string | null): Promise<{ kind: "blocked"; why: string } | { kind: "waiting" } | { kind: "again" }> {
    const units = await this.units(manager.orbitId, manager.id);
    const awaiting = units.filter((u) => u.state === "AWAITING_ACCEPTANCE");
    const seen = (u: UnitView) => attemptStartedAt === null || (u.handoff !== null && Date.parse(u.handoff.submittedAt) <= Date.parse(attemptStartedAt));
    const undecided = awaiting.filter(seen).map((u) => u.key);
    if (undecided.length > 0) return { kind: "blocked", why: `The manager ended its review without deciding on ${undecided.join(", ")}.` };
    manager.waitForTeam(at);
    if (awaiting.length > 0) return { kind: "again" };
    if (units.some((u) => !DONE.includes(u.state))) return { kind: "waiting" };
    return { kind: "blocked", why: "The manager ended without handing in the integrated result." };
  }

  // The manager woken again at once (a result arrived while it reviewed).
  async wakeAgain(manager: Assignment, at: string): Promise<RaisedEvent> {
    return this.requestRun(manager, manager.reviewing(at));
  }

  private requestRun(a: Assignment, fence: number): Promise<RaisedEvent> {
    const execution = a.data.pinned?.execution;
    if (execution === undefined) throw conflictWith("invalid_transition", "This assignment was never claimed.");
    return this.runs.request({ orbitId: a.orbitId, assignmentId: a.id, missionId: a.data.missionId, employeeId: a.data.employeeId, fence, priority: a.data.priority, execution });
  }

  // ---- the team room's history ------------------------------------------------------------------------------------------

  // The room as an attempt left it: every file whose content differs from the room's last known state is a change by it.
  async roomChanged(orbitId: string, roomId: string, by: { runId: string; assignmentId: string; employeeId: string }, files: { path: string; sha256: string; size: number }[]): Promise<number> {
    const known = new Map((await this.db.query(
      `SELECT DISTINCT ON (path) path, sha256 FROM workforce.team_room_changes WHERE account_id = $1 AND room_id = $2 ORDER BY path, seq DESC`,
      [orbitId, roomId],
    )).map((r) => [String(r.path), r.sha256 === null ? null : String(r.sha256)]));
    const now = new Map(files.map((f) => [f.path, f]));
    let n = 0;
    const at = new Date().toISOString();
    for (const f of files) {
      if (known.get(f.path) === f.sha256) continue;
      await this.db.query("INSERT INTO workforce.team_room_changes (account_id, room_id, path, sha256, size, run_id, assignment_id, employee_id, changed_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)", [orbitId, roomId, f.path, f.sha256, f.size, by.runId, by.assignmentId, by.employeeId, at]);
      n += 1;
    }
    for (const [path, sha] of known) {
      if (sha === null || now.has(path)) continue;
      await this.db.query("INSERT INTO workforce.team_room_changes (account_id, room_id, path, sha256, size, run_id, assignment_id, employee_id, changed_at) VALUES ($1, $2, $3, NULL, NULL, $4, $5, $6, $7)", [orbitId, roomId, path, by.runId, by.assignmentId, by.employeeId, at]);
      n += 1;
    }
    return n;
  }

  async roomHistory(orbitId: string, missionId: string): Promise<TeamRoomChange[]> {
    // A mission of another account -- or none -- is not found, like every record of another account.
    if ((await this.db.one("SELECT 1 AS found FROM workforce.missions WHERE account_id = $1 AND id = $2", [orbitId, missionId])) === null) throw missing("The mission");
    const rows = await this.db.query(
      `SELECT c.path, c.sha256, c.size, c.employee_id, e.name, c.assignment_id, c.changed_at FROM workforce.team_room_changes c
       JOIN workforce.team_rooms r ON r.account_id = c.account_id AND r.id = c.room_id
       LEFT JOIN workforce.employees e ON e.account_id = c.account_id AND e.id = c.employee_id
       WHERE c.account_id = $1 AND r.mission_id = $2 ORDER BY c.seq LIMIT 1000`,
      [orbitId, missionId],
    );
    return rows.map((r) => ({ path: String(r.path), sha256: r.sha256 === null ? null : String(r.sha256), size: r.size === null ? null : Number(r.size), employeeId: r.employee_id === null ? null : String(r.employee_id), employeeName: r.name === null ? null : String(r.name), assignmentId: r.assignment_id === null ? null : String(r.assignment_id), at: String(r.changed_at) }));
  }
}
