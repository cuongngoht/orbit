// TEAMS (Work context): a LEAD -- an employee whose appointment (CEO, a department's manager) or delegation grants let
// it give work (domain/authority.ts; never a title or a profile switch) -- gives PARTS of its assignment, as a plan it
// hands in through its `delegate` tool:
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
//     accepted, integrates and hands in its own result to the person who gave the work;
//   - a part may HIRE instead of naming someone (domain/assistants.ts): the CEO or a manager in force engages a temporary
//     assistant for this mission, within its quota. The hires and the plan are decided together, as the lead: a plan
//     with any problem -- a hire refused included -- gives nothing and engages nobody, and its decisions stay on record.
import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { isWorkforceId, WORKFORCE_LIMITS, type AssignmentState, type DataShareView, type Deliverable, type HireAssistantRequest, type TeamRoomChange } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { Db } from "../../../infra/db/db.js";
import { RunRequests } from "../../execution/application/run-requests.js";
import { OfficeGovernance, systemActor, type Actor } from "../../shared/application/commands.js";
import { conflictWith, DomainError, invalid, missing, refused, type RaisedEvent } from "../../shared/domain.js";
import { EventDispatcher } from "../../shared/infrastructure/consumers.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { ResourcesService } from "../../execution/application/resources.service.js";
import type { TeamRoom } from "../../execution/application/run-outcomes.port.js";
import { HiringService, type Engagement } from "../../workforce/application/hiring.service.js";
import { Assignment, type AssignmentTargetData } from "../domain/assignment.js";
import { placeHire, type Quota } from "../domain/assistants.js";
import { delegationScope, resolveTarget, scopeIsEmpty, type AuthorityFacts, type DelegationScope } from "../domain/authority.js";
import { roleFrom, type WorkRole } from "../domain/roles.js";
import { allEnded, DONE, leadNext, planProblems } from "../domain/team.js";
import { ClarificationRepository } from "../infrastructure/clarifications.repository.js";
import { OrgReader } from "../infrastructure/org.reader.js";
import { sharedSourcesOf, type ShareMode } from "../domain/data-authorization.js";
import { AccessHooks } from "../../../modules/governance/access-hooks.js";
import { AttemptDataService } from "./attempt-data.service.js";
import { DecisionRepository } from "../infrastructure/decisions.js";
import { AssignmentRepository, HandoffRepository, MissionRepository } from "../infrastructure/repositories.js";

// A part as the lead's plan names it: to an employee or a department (by id or exact name) -- or to an assistant it hires
// for it -- what it must do, what it waits for, and what the lead shares with it (nothing unless it says): source labels
// it reads ("all": every one it reads), and the accepted hand-in of a part this one waits for -- its summary, or in full.
export interface UnitPlan {
  key: string;
  employee?: string;
  department?: string;
  hire?: HireAssistantRequest;
  title: string;
  goal: string;
  deliverables: Deliverable[];
  acceptanceCriteria: string[];
  dependsOn: string[];
  shareSources?: string[];
  shareRepositories?: boolean;
  receives?: { from: string; as: ShareMode }[];
}

// A part once its authority resolved who takes it -- and, for a part that hires, the department its assistant joins and
// who manages it there (the part goes to the assistant itself, or -- the CEO's -- to that department's manager).
type ResolvedPart = UnitPlan & { employeeId: string; target: AssignmentTargetData; joins?: { departmentId: string; managerId: string } };

// What a plan came to: given (its events, and the assistants it engaged), or refused whole with every problem.
export type PlanOutcome = { given: true; events: RaisedEvent[]; engaged: string[] } | { given: false; problems: string[] };

// Who takes a manager's hired part until its assistant is engaged: the assistant.
const toAssistant = (key: string): string => `assistant:${key}`;

export interface UnitView {
  key: string;
  assignmentId: string;
  employeeId: string;
  employeeName: string;
  state: AssignmentState;
  dependsOn: string[];
  handoff: { revision: number; digest: string; summary: string; submittedAt: string; artifacts: { name: string; sha256: string }[] } | null;
}

// Never: a part waiting for others is claimable only once they are accepted.
const NOT_YET = "9999-12-31T00:00:00.000Z";
// A team room's data domain: one department's, or the company's (the employees of no department).
const roomKeyOf = (departmentId: string | null): string => (departmentId === null ? "company" : `department:${departmentId}`);
const TEAM_ROOM_MIB = 1024;

// The plan's rules and what a lead does next are pure (domain/team.ts); kept importable from here.
export { orderOf, planProblems, readyToReview } from "../domain/team.js";

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
    @Inject(AccessHooks) private readonly access: AccessHooks,
    @Inject(OrgReader) private readonly org: OrgReader,
    @Inject(ClarificationRepository) private readonly clarifications: ClarificationRepository,
    @Inject(HiringService) private readonly hiring: HiringService,
  ) {}

  onModuleInit(): void {
    // When a part hands in or ends, its lead may have everything it waited for; when a part asks (or a question comes up
    // a level), its lead is woken to answer. A wake is a compare-and-set on the lead's waiting state: a duplicate event,
    // or a lead already awake, changes nothing.
    this.dispatcher.register({
      id: "work.team",
      types: ["HandoffSubmitted", "AssignmentCancelled", "AssignmentFailed", "ClarificationRequested", "ClarificationEscalated"],
      handle: async (e) => {
        const lead = e.aggregateType === "clarification" ? (typeof e.payload.addresseeAssignmentId === "string" ? e.payload.addresseeAssignmentId : null) : await this.leadOf(e.accountId, e.aggregateId);
        if (lead !== null) await this.wake(e.accountId, lead, e.correlationId, e.id);
      },
    });
  }

  // ---- what an attempt is told -------------------------------------------------------------------------------------

  // Whom this assignment's employee may give work to now: its appointment in force and its grants, never itself nor a
  // lead above it in this mission (domain/authority.ts). Empty: it does the work itself.
  async scope(orbitId: string, a: Assignment): Promise<DelegationScope> {
    return (await this.standing(orbitId, a)).scope;
  }

  // Its standing in this work, from one read of the company's authority ON ITS MISSION (an assistant of another mission
  // is not there): whom it may give work to, its role (the CEO, a manager with or without a team, or an employee:
  // domain/roles.ts), and -- an appointee in force -- its quota of temporary assistants.
  async standing(orbitId: string, a: Assignment): Promise<{ scope: DelegationScope; role: WorkRole; facts: AuthorityFacts; assistants: Quota | null }> {
    const chain = await this.org.chainOf(orbitId, a.id);
    const facts = await this.org.authority(orbitId, a.data.employeeId, chain, a.data.missionId);
    const assistants = facts.appointment === null ? null : await this.hiring.assistantQuota(orbitId, a.data.employeeId);
    return { scope: delegationScope(facts), role: roleFrom(facts), facts, assistants };
  }

  // The questions its team asked this lead, still open.
  openQuestions(orbitId: string, leadAssignmentId: string) {
    return this.clarifications.openTo(orbitId, leadAssignmentId);
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

  // Inside the lead's run transaction (its assignment locked by the caller): the plan held to its authority and its own
  // rules, its hires decided as the lead -- a plan with any problem gives nothing and engages nobody, and says every
  // problem (the caller refuses it once its decisions are committed: they stay on record) -- else the assistants engaged,
  // the parts made and queued, what it shares with each, and the room.
  async delegate(actor: Actor, manager: Assignment, fence: number, units: UnitPlan[]): Promise<PlanOutcome> {
    const orbitId = manager.orbitId;
    const { scope, facts } = await this.standing(orbitId, manager);
    if (scopeIsEmpty(scope) && !units.some((u) => u.hire !== undefined)) throw refused("no_authority", "You hold no appointment or grant that lets you give work to others: do it yourself.");
    if ((await this.depth(orbitId, manager)) >= WORKFORCE_LIMITS.delegationDepth) throw refused("delegation_too_deep", `Work is already given down ${WORKFORCE_LIMITS.delegationDepth} levels: do this part yourself.`);
    const problems: string[] = [];
    const parts: ResolvedPart[] = [];
    for (const u of units) {
      const r = u.hire !== undefined ? this.hiredPart(facts, scope, manager, u) : resolveTarget(scope, { employee: u.employee, department: u.department });
      if ("problem" in r) problems.push(`"${u.key}": ${r.problem}`);
      else parts.push({ ...u, ...r });
    }
    const taken = new Set((await this.units(orbitId, manager.id)).map((u) => u.key));
    problems.push(...planProblems(parts, manager.data.employeeId, taken));
    const shared = await this.sharesOf(orbitId, manager, parts, problems);
    const engagements = await this.decideHires(actor, manager, parts, problems);
    if (problems.length > 0) return { given: false, problems };
    const at = new Date().toISOString();
    manager.delegated(fence, parts.length, at);
    const engaged: string[] = [];
    for (const u of parts) {
      const g = engagements.get(u.key);
      if (g === undefined) continue;
      await this.hiring.engageAssistant(actor, g);
      engaged.push(g.name);
      if (u.employeeId === toAssistant(u.key)) u.employeeId = g.id;
    }
    for (const u of parts) await this.governance.authorize(actor, "work.delegate", u.employeeId, { employee: u.employeeId, manager: manager.data.employeeId });
    await this.openRoom(orbitId, manager.data.missionId, await this.departmentOf(orbitId, manager.data.employeeId), at);
    const events: RaisedEvent[] = [];
    const made = new Map<string, string>();
    for (const u of parts) {
      const part = Assignment.queued({
        id: randomUUID(),
        orbitId,
        missionId: manager.data.missionId,
        parentId: manager.id,
        unitKey: u.key,
        employeeId: u.employeeId,
        brief: { goal: `${u.title}\n\n${u.goal}`, deliverables: u.deliverables, acceptanceCriteria: u.acceptanceCriteria, revisions: [], answers: [], dependsOn: u.dependsOn, ...(u.shareRepositories === true ? { shareRepositories: true } : {}) },
        execution: null,
        priority: manager.data.priority,
        eligibleAt: u.dependsOn.length === 0 ? at : NOT_YET,
        deadline: manager.data.deadline,
        createdBy: actor.command.actor,
        createdAt: at,
        target: u.target,
      });
      await this.assignments.save(part);
      events.push(...part.pullEvents());
      made.set(u.key, part.id);
    }
    await this.share(actor, manager, parts, shared, made, at);
    const m = await this.missions.get(orbitId, manager.data.missionId, true);
    if (m !== null) {
      await this.db.query("UPDATE workforce.missions SET plan_revision = plan_revision + 1, updated_at = $3, version = version + 1 WHERE account_id = $1 AND id = $2", [orbitId, m.id, at]);
      events.push({ type: "MissionPlanRevised", aggregateType: "mission", aggregateId: m.id, aggregateVersion: m.data.version + 1, missionId: m.id, payload: { parts: parts.length, by: manager.data.employeeId } });
    }
    // Its attempt ended here, by design: asked to stop, it ends as having handed its work to its team.
    await this.runs.stop(orbitId, manager.id, "delegated");
    return { given: true, events, engaged };
  }

  // Who takes a part that hires (domain/assistants.ts): a manager's assistant itself, once engaged; the CEO's part goes to
  // the department its assistant joins, through that department's manager.
  private hiredPart(facts: AuthorityFacts, scope: DelegationScope, manager: Assignment, u: UnitPlan): Pick<ResolvedPart, "employeeId" | "target" | "joins"> | { problem: string } {
    const p = placeHire(facts, scope, { employee: u.employee, department: u.department });
    if ("problem" in p) return p;
    if (p.goesTo === "manager") return { employeeId: p.employeeId, target: p.target, joins: { departmentId: p.departmentId, managerId: p.employeeId } };
    return { employeeId: toAssistant(u.key), target: { kind: "employee", departmentId: null, appointmentId: null, appointmentRevision: null }, joins: { departmentId: p.departmentId, managerId: manager.data.employeeId } };
  }

  // Each assistant the plan hires, decided as the lead (Workforce: its quota through governance, the department, the
  // mission's time, the execution and resources a hire is held to) -- every refusal a problem of the plan, each one
  // counting those decided before it against the lead's quota and the account's storage.
  private async decideHires(actor: Actor, manager: Assignment, parts: readonly ResolvedPart[], problems: string[]): Promise<Map<string, Engagement>> {
    const out = new Map<string, Engagement>();
    if (!parts.some((u) => u.hire !== undefined)) return out;
    const deadline = (await this.missions.get(manager.orbitId, manager.data.missionId))?.data.deadline ?? null;
    const before = { assistants: 0, deskMiB: 0, cacheMiB: 0 };
    for (const u of parts) {
      if (u.hire === undefined || u.joins === undefined) continue;
      try {
        const g = await this.hiring.decideAssistant(actor, { leadId: manager.data.employeeId, missionId: manager.data.missionId, deadline, departmentId: u.joins.departmentId, managerId: u.joins.managerId, hire: u.hire, before: { ...before } });
        out.set(u.key, g);
        before.assistants += 1;
        before.deskMiB += g.resources.deskStorageMiB;
        before.cacheMiB += g.resources.cacheStorageMiB;
      } catch (err) {
        if (!(err instanceof DomainError)) throw err;
        problems.push(`"${u.key}": ${err.message}`);
      }
    }
    return out;
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

  // When a mission ends (completed, cancelled or failed): freeze its open team rooms and release unused quota back into
  // the account's storage budget (rooms that wrote nothing drop their commitment to 0; rooms with bytes keep only used_mib).
  async freezeRooms(orbitId: string, missionId: string, at: string): Promise<void> {
    const rooms = await this.db.query(
      "UPDATE workforce.team_rooms SET state = 'frozen', frozen_at = $3, version = version + 1 WHERE account_id = $1 AND mission_id = $2 AND state = 'open' RETURNING id",
      [orbitId, missionId, at],
    );
    if (rooms.length === 0) return;
    const refs = rooms.map((r) => String(r.id));
    await this.db.query("DELETE FROM workforce.storage_usage WHERE account_id = $1 AND category = 'team' AND owner_ref = ANY($2::text[]) AND COALESCE(used_mib, 0) = 0", [orbitId, refs]);
    await this.db.query("UPDATE workforce.storage_usage SET committed_mib = COALESCE(used_mib, 0) WHERE account_id = $1 AND category = 'team' AND owner_ref = ANY($2::text[])", [orbitId, refs]);
  }

  private async departmentOf(orbitId: string, employeeId: string): Promise<string | null> {
    const r = await this.db.one("SELECT department_id FROM workforce.employees WHERE account_id = $1 AND id = $2", [orbitId, employeeId]);
    return r === null || r.department_id === null ? null : String(r.department_id);
  }

  // ---- what a lead shares with its parts ---------------------------------------------------------------------------------

  // The source revisions each part is given, held to what the lead reads itself (a label it does not read refuses the
  // plan whole, with the others' problems: added to `problems`).
  private async sharesOf(orbitId: string, manager: Assignment, units: readonly ResolvedPart[], problems: string[]): Promise<Map<string, string[]>> {
    const askedSources = units.filter((u) => (u.shareSources ?? []).length > 0);
    const askedRepos = units.filter((u) => u.shareRepositories === true);
    const out = new Map<string, string[]>();
    if (askedSources.length === 0 && askedRepos.length === 0) return out;
    const data = await this.data.of(orbitId, manager.id);
    const held = data?.sources ?? [];
    for (const u of askedSources) {
      const r = sharedSourcesOf(u.shareSources ?? [], held);
      problems.push(...r.problems.map((p) => `"${u.key}": ${p}`));
      out.set(u.key, r.revisionIds);
    }
    if (askedRepos.length > 0 && data?.repositories !== true) {
      for (const u of askedRepos) problems.push(`"${u.key}": you cannot share repositories because your assignment does not hold mission repository access.`);
    }
    return out;
  }

  // Each share recorded with what, to whom and from where (and audited): a source revision, or a predecessor's hand-in.
  private async share(actor: Actor, manager: Assignment, units: readonly ResolvedPart[], sources: ReadonlyMap<string, string[]>, made: ReadonlyMap<string, string>, at: string): Promise<void> {
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

  // The shares of a mission, as the owner reads them.
  async missionShares(orbitId: string, missionId: string): Promise<DataShareView[]> {
    if ((await this.db.one("SELECT 1 AS one FROM workforce.missions WHERE account_id = $1 AND id = $2", [orbitId, missionId])) === null) throw missing("Mission");
    const rows = await this.db.query(
      `SELECT s.id, s.kind, s.source_revision_id, s.mode, s.shared_by, s.created_at, s.revoked_by, s.revoked_at, s.recipient_assignment_id, s.lead_assignment_id,
              r.unit_key AS recipient_key, re.name AS recipient_name, o.unit_key AS origin_key
       FROM workforce.data_shares s
       JOIN workforce.assignments r ON r.account_id = s.account_id AND r.id = s.recipient_assignment_id
       JOIN workforce.employees re ON re.account_id = r.account_id AND re.id = r.employee_id
       LEFT JOIN workforce.assignments o ON o.account_id = s.account_id AND o.id = s.origin_assignment_id
       WHERE s.account_id = $1 AND s.mission_id = $2 ORDER BY s.created_at, s.id`,
      [orbitId, missionId],
    );
    return rows.map((r) => ({
      id: String(r.id),
      kind: r.kind === "source" ? "source" : "handoff",
      sourceRevisionId: r.source_revision_id === null ? null : String(r.source_revision_id),
      fromUnit: r.origin_key === null ? null : String(r.origin_key),
      mode: r.mode === "full" ? "full" : "summary",
      recipientAssignmentId: String(r.recipient_assignment_id),
      recipientUnit: String(r.recipient_key),
      recipientName: String(r.recipient_name),
      leadAssignmentId: String(r.lead_assignment_id),
      sharedBy: String(r.shared_by),
      sharedAt: new Date(String(r.created_at)).toISOString(),
      revokedBy: r.revoked_by === null ? null : String(r.revoked_by),
      revokedAt: r.revoked_at === null ? null : new Date(String(r.revoked_at)).toISOString(),
    }));
  }

  // A person takes back what a lead shared: the share is revoked (recorded, audited) and, after commit, every live attempt
  // that holds it is stopped by the access watch. Revoking a revoked share changes nothing.
  async revokeShare(actor: Actor, shareId: string): Promise<{ id: string; revokedAt: string }> {
    const orbitId = actor.command.orbitId;
    if (!isWorkforceId(shareId)) throw missing("The share");
    const out = await this.governance.command(actor, "data-share.revoke", shareId, async () => {
      const r = await this.db.one("SELECT recipient_assignment_id, revoked_at FROM workforce.data_shares WHERE account_id = $1 AND id = $2 FOR UPDATE", [orbitId, shareId]);
      if (r === null) throw missing("The share");
      if (r.revoked_at !== null) return { id: shareId, revokedAt: new Date(String(r.revoked_at)).toISOString(), moved: false };
      const recipient = await this.assignments.get(orbitId, String(r.recipient_assignment_id));
      if (recipient === null) throw missing("The share");
      await this.governance.authorize(actor, "work.assign", recipient.data.employeeId, { employee: recipient.data.employeeId });
      const at = new Date().toISOString();
      await this.db.query("UPDATE workforce.data_shares SET revoked_by = $3, revoked_at = $4 WHERE account_id = $1 AND id = $2", [orbitId, shareId, actor.command.actor, at]);
      await this.governance.recorded(actor, "data-share.revoke", "data-share", shareId, 1, "revoked");
      return { id: shareId, revokedAt: at, moved: true };
    });
    if (out.moved) this.access.changed(orbitId, { cause: "a share revoked" });
    return { id: out.id, revokedAt: out.revokedAt };
  }

  // ---- the manager wakes, and reviews ----------------------------------------------------------------------------------

  // The lead of a part (null: it is a mission's root).
  private async leadOf(orbitId: string, assignmentId: string): Promise<string | null> {
    const r = await this.db.one("SELECT parent_id FROM workforce.assignments WHERE account_id = $1 AND id = $2", [orbitId, assignmentId]);
    return r === null || r.parent_id === null ? null : String(r.parent_id);
  }

  // A lead waiting for its team is woken when it has something to do (domain/team.ts leadNext): its parts' results to
  // review (or every part ended: integrate), else its team's questions to answer. A compare-and-set on WAITING under the
  // lead's lock: a lead already awake, or a duplicate event, changes nothing.
  async wake(orbitId: string, leadId: string, correlationId: string, causationId: string | null): Promise<boolean> {
    return this.db.tx(async () => {
      const lead = await this.assignments.get(orbitId, leadId, true);
      if (lead === null || lead.state !== "WAITING_FOR_SUBORDINATES") return false;
      const events = await this.next(lead, new Date().toISOString());
      if (events.length === 0) return false;
      const actor = systemActor(orbitId, "team", correlationId, causationId);
      await this.assignments.save(lead);
      await this.outbox.append(actor.command, [...lead.pullEvents(), ...events]);
      await this.outbox.touched(orbitId, ["roster", "missions"], lead.data.missionId);
      return true;
    });
  }

  // What a lead in WAITING does next, applied to it (the caller saves it): an attempt to review or to answer, or nothing.
  async next(lead: Assignment, at: string): Promise<RaisedEvent[]> {
    const units = await this.units(lead.orbitId, lead.id);
    const open = (await this.clarifications.openTo(lead.orbitId, lead.id)).length;
    const what = leadNext(units, open);
    if (what === "wait") return [];
    const fence = what === "review" ? lead.reviewing(at) : lead.answering(at);
    return [await this.requestRun(lead, fence, what === "review" ? (allEnded(units) ? "its team finished: integrate and hand in" : "its team handed in: review") : "its team asked: answer")];
  }

  // The manager's decision on one part it reviews: accept it (it completes, its employee is free, the parts waiting for it
  // may start), or ask for a revision (the part keeps its employee; a new attempt).
  async review(actor: Actor, manager: Assignment, unitKey: string, decision: "accept" | "revise", criteria: string, digest: string | null = null): Promise<{ events: RaisedEvent[]; text: string }> {
    const orbitId = manager.orbitId;
    if (manager.state !== "REVIEWING" && manager.state !== "ANSWERING") throw conflictWith("invalid_transition", "Reviewing your team's parts happens when they have handed in.");
    const row = await this.db.one("SELECT id FROM workforce.assignments WHERE account_id = $1 AND parent_id = $2 AND unit_key = $3", [orbitId, manager.id, unitKey]);
    if (row === null) {
      const awaiting = (await this.units(orbitId, manager.id)).filter((u) => u.state === "AWAITING_ACCEPTANCE").map((u) => u.key);
      if (awaiting.length > 0) throw new DomainError("not_found", "not_found", `There is no part "${unitKey}". Parts awaiting your review: ${awaiting.join(", ")}.`);
      throw missing(`The part "${unitKey}"`);
    }
    const part = (await this.assignments.get(orbitId, String(row.id), true)) as Assignment;
    if (part.state !== "AWAITING_ACCEPTANCE") throw conflictWith("invalid_transition", `The part "${unitKey}" is ${part.state.toLowerCase().replace(/_/g, " ")}: there is nothing of it to review now.`);
    const h = await this.handoffs.latest(orbitId, part.id);
    if (h === null || h.status !== "submitted") throw conflictWith("invalid_transition", `The part "${unitKey}" has no result waiting.`);
    // The revision the lead looked at: a newer one (or none like it) refuses the decision.
    if (digest !== null && digest !== h.digest) throw conflictWith("stale_handoff", `The part "${unitKey}" handed in revision ${h.revision} (digest ${h.digest.slice(0, 12)}): review that one.`, { current: h.digest });
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
      events.push(await this.requestRun(part, fence, "its lead asked for a revision"));
      text = `Asked "${unitKey}" for a revision: its employee works on it again.`;
    }
    await this.assignments.save(part);
    events.push(...part.pullEvents());
    if (decision === "accept") events.push(...(await this.release(orbitId, manager.id, at)));
    const after = await this.units(orbitId, manager.id);
    const remaining = after.filter((u) => u.state === "AWAITING_ACCEPTANCE").map((u) => u.key);
    if (remaining.length > 0) text += ` Still awaiting your review (${remaining.length}): ${remaining.join(", ")}. Call review_unit for each before finishing.`;
    else if (allEnded(after)) text += " Every part has ended: integrate their results into /output and call submit_handoff now.";
    else text += " No other parts await your review now (others are still in progress): end this attempt now and you will be woken when they hand in.";
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

  // A review attempt that ended cleanly without handing in. A part's result that arrived after this attempt's prompt was
  // snapshotted (never shown to it, or superseded by a newer revision): the manager reviews again. Parts still being
  // worked on: back to waiting. A result it was actually shown and left undecided, or nothing left to wait for and no
  // hand-in: blocked, with why.
  async reviewEnded(
    manager: Assignment,
    at: string,
    attempt: { startedAt: string | null; reviewedUnits?: readonly { key: string; digest: string }[] },
  ): Promise<{ kind: "blocked"; why: string } | { kind: "waiting" } | { kind: "again" }> {
    const units = await this.units(manager.orbitId, manager.id);
    const awaiting = units.filter((u) => u.state === "AWAITING_ACCEPTANCE");
    const shown = attempt.reviewedUnits === undefined ? null : new Map(attempt.reviewedUnits.map((u) => [u.key, u.digest]));
    const seen = (u: UnitView): boolean => {
      if (u.handoff === null) return false;
      if (shown !== null) return shown.get(u.key) === u.handoff.digest;
      return attempt.startedAt !== null && Date.parse(u.handoff.submittedAt) <= Date.parse(attempt.startedAt);
    };
    const undecided = awaiting.filter(seen).map((u) => u.key);
    if (undecided.length > 0) return { kind: "blocked", why: `The lead ended its review without deciding on ${undecided.join(", ")}.` };
    // Every part ended and nothing handed in: blocked while it is still the review that ended (a waiting lead has no
    // attempt to block).
    if (awaiting.length === 0 && units.every((u) => DONE.includes(u.state))) return { kind: "blocked", why: "The lead ended without handing in the integrated result." };
    manager.waitForTeam(at);
    return awaiting.length > 0 ? { kind: "again" } : { kind: "waiting" };
  }

  // The lead woken again at once (a result arrived while it reviewed).
  async wakeAgain(manager: Assignment, at: string): Promise<RaisedEvent> {
    return this.requestRun(manager, manager.reviewing(at), "a result arrived while it reviewed");
  }

  private requestRun(a: Assignment, fence: number, wake: string): Promise<RaisedEvent> {
    const execution = a.data.pinned?.execution;
    if (execution === undefined) throw conflictWith("invalid_transition", "This assignment was never claimed.");
    return this.runs.request({ orbitId: a.orbitId, assignmentId: a.id, missionId: a.data.missionId, employeeId: a.data.employeeId, fence, priority: a.data.priority, execution, wake });
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
