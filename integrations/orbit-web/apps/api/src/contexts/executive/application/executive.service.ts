// CEO CHAT (Executive, application; ADR 0062): what the owner does through it, every command scoped by the account the
// session belongs to and recorded like the office's.
//
//   STATE         GET /api/executive: no company (CEO Chat does not exist: nothing is created by opening it), no CEO, a
//                 CEO who answers (now, or once its run ends), or one who cannot (said why) -- from the authoritative
//                 records: the office, the CEO's appointment in force, the employee's eligibility, what it holds.
//   MESSAGES      an owner's message is kept, then answered by a TURN of the CEO in office (turns.ts) -- refused before
//                 anything is kept when the CEO cannot answer. A message is sent under an Idempotency-Key: sent twice, it
//                 is one message.
//   REPORTS       a quick action asks Orbit's records (executive-reports.ts): a system message, never the CEO's words.
//   MISSIONS      a proposal (or the owner's own words) given to the CEO IS the existing mission creation -- target the
//                 CEO, the responsible the owner saw (expectedAssignee), work.assign, its idempotency, its queue -- and
//                 the mission is linked to the conversation and the message it came from.
import { Inject, Injectable } from "@nestjs/common";
import {
  checkExecutiveMission,
  checkExecutiveReport,
  checkExecutiveText,
  EXECUTIVE_LIMITS,
  isIdempotencyKey,
  isWorkforceId,
  type ExecutiveCapability,
  type ExecutiveConversationDetail,
  type ExecutiveConversationList,
  type ExecutiveMessage,
  type ExecutiveMessagePage,
  type ExecutiveReportKind,
  type ExecutiveState,
  type ExecutiveTurn,
  type Employment,
  type ExecutiveMissionFields,
  type ExpectedAssignee,
  type MissionAccepted,
} from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { randomUUID } from "node:crypto";
import { accountAudience, EventBus } from "../../../core/events/event-bus.js";
import { Db } from "../../../infra/db/db.js";
import type { Owner } from "../../../modules/auth/principal.js";
import { RunRepository } from "../../execution/infrastructure/runs.repository.js";
import { ConversationRunRepository } from "../../execution/infrastructure/conversation-runs.repository.js";
import { OfficeGovernance, type Actor } from "../../shared/application/commands.js";
import { accepted } from "../../../common/errors.js";
import { conflictWith, DomainError, invalid, missing } from "../../shared/domain.js";
import { Idempotency, type IdempotencyScope, type StoredAnswer } from "../../shared/infrastructure/idempotency.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { MissionsService } from "../../work/application/missions.service.js";
import { OrgReader } from "../../work/infrastructure/org.reader.js";
import { AssignmentRepository, MissionRepository } from "../../work/infrastructure/repositories.js";
import { EmployeeEligibility } from "../../workforce/application/eligibility.js";
import { ConnectionsReader } from "../../workforce/infrastructure/connections.reader.js";
import { OfficeRepository } from "../../workforce/infrastructure/repositories.js";
import { titleOf } from "../domain/conversation.js";
import { ExecutiveRepository, messageView, summaryOf, turnView, type ConversationRecord } from "../infrastructure/executive.repository.js";
import { ExecutiveStream } from "../infrastructure/executive-stream.js";
import { ExecutiveReports } from "./executive-reports.js";
import { TurnRunner } from "./turn-runner.js";
import { ExecutiveTurns, NO_CEO, type CeoForTurn } from "./turns.js";

export const NO_COMPANY = "This account has no company yet: create one in the Office first. CEO Chat belongs to a company.";

const OK: ExecutiveCapability = { ok: true, code: null, reason: null };
const refusal = (code: string, reason: string): ExecutiveCapability => ({ ok: false, code, reason });

@Injectable()
export class ExecutiveService {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ExecutiveRepository) private readonly repo: ExecutiveRepository,
    @Inject(ExecutiveStream) private readonly stream: ExecutiveStream,
    @Inject(ExecutiveTurns) private readonly turns: ExecutiveTurns,
    @Inject(ExecutiveReports) private readonly reports: ExecutiveReports,
    @Inject(TurnRunner) private readonly runner: TurnRunner,
    @Inject(OfficeRepository) private readonly offices: OfficeRepository,
    @Inject(OrgReader) private readonly org: OrgReader,
    @Inject(EmployeeEligibility) private readonly eligibility: EmployeeEligibility,
    @Inject(AssignmentRepository) private readonly assignments: AssignmentRepository,
    @Inject(MissionRepository) private readonly missionRecords: MissionRepository,
    @Inject(RunRepository) private readonly attempts: RunRepository,
    @Inject(ConversationRunRepository) private readonly conversationRuns: ConversationRunRepository,
    @Inject(ConnectionsReader) private readonly connections: ConnectionsReader,
    @Inject(MissionsService) private readonly missions: MissionsService,
    @Inject(Idempotency) private readonly idempotency: Idempotency,
    @Inject(OfficeGovernance) private readonly governance: OfficeGovernance,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(EventBus) private readonly bus: EventBus,
  ) {}

  // ---- what CEO Chat is now -------------------------------------------------------------------------------------------

  async state(orbitId: string): Promise<ExecutiveState> {
    const office = await this.offices.get(orbitId);
    if (office === null) return { company: null, state: "no_company", ceo: null, converse: refusal("office_not_set_up", NO_COMPANY), assign: refusal("office_not_set_up", NO_COMPANY) };
    const company = { id: office.id, name: office.name };
    const preview = await this.missions.preview(orbitId, { kind: "ceo" });
    const assign = preview.responsible !== null ? OK : refusal(preview.code ?? "no_ceo", preview.reason ?? NO_CEO);
    const i = (await this.org.slot(orbitId, { kind: "ceo" }, false)).incumbent;
    if (i === null) return { company, state: "no_ceo", ceo: null, converse: refusal("no_ceo", NO_CEO), assign };
    const converse = await this.turns.ceo(orbitId).then(
      () => OK,
      (err: unknown) => {
        if (err instanceof DomainError) return refusal(err.code, err.message);
        throw err;
      },
    );
    const el = await this.eligibility.of(orbitId, i.employeeId, false);
    const facts = await this.db.one("SELECT e.employment, a.appointed_at FROM workforce.employees e JOIN workforce.appointments a ON a.account_id = e.account_id AND a.id = $3 WHERE e.account_id = $1 AND e.id = $2", [orbitId, i.employeeId, i.appointmentId]);
    const connectionId = el?.execution.connectionId ?? null;
    const connection = connectionId === null ? null : await this.connections.get(orbitId, connectionId);
    const holding = await this.holdingOf(orbitId, i.employeeId);
    return {
      company,
      state: !converse.ok ? "unavailable" : holding?.running === true || (await this.conversationRuns.liveOfEmployee(orbitId, i.employeeId)) !== null ? "busy" : "available",
      ceo: {
        employeeId: i.employeeId,
        name: i.employeeName,
        title: el?.profile.title ?? "",
        employment: String(facts?.employment ?? "active") as Employment,
        appointment: { id: i.appointmentId, revision: i.slotRevision, state: i.state, since: new Date(String(facts?.appointed_at ?? new Date().toISOString())).toISOString() },
        execution: { runtime: el?.execution.runtime ?? "claude", connectionId, connectionName: connection?.label ?? null, model: el?.execution.model ?? null, effort: el?.execution.effort ?? null, sources: el?.sources ?? { connection: "employee", model: "employee", effort: "employee" } },
        holding,
      },
      converse,
      assign,
    };
  }

  // What the CEO holds now: the mission, and whether an attempt of it runs (an answer then waits for it).
  private async holdingOf(orbitId: string, employeeId: string): Promise<{ missionId: string; title: string; running: boolean } | null> {
    const held = await this.assignments.heldBy(orbitId, employeeId);
    if (held === null) return null;
    const mission = await this.missionRecords.get(orbitId, held.data.missionId);
    return { missionId: held.data.missionId, title: mission?.data.title ?? "", running: (await this.attempts.liveOfEmployee(orbitId, employeeId)) !== null };
  }

  // ---- conversations ------------------------------------------------------------------------------------------------

  async conversations(orbitId: string, cursor: string | null): Promise<ExecutiveConversationList> {
    await this.requireOffice(orbitId);
    const page = await this.repo.conversations(orbitId, cursor !== null && /^[0-9TZ:.+-]{10,40}~[0-9a-f-]{36}$/.test(cursor) ? cursor : null);
    return { conversations: page.items.map(summaryOf), nextCursor: page.next };
  }

  // A conversation's last page, its open turns, its missions and its stream's head -- read in one snapshot, so following
  // the stream after `lastSeq` misses nothing and repeats nothing.
  async detail(orbitId: string, conversationId: string): Promise<ExecutiveConversationDetail> {
    await this.requireOffice(orbitId);
    return this.db.snapshot(async () => {
      const c = await this.conversationOf(orbitId, conversationId);
      const current = await this.currentAppointment(orbitId);
      const page = await this.repo.page(orbitId, c.id, null, EXECUTIVE_LIMITS.pageSize);
      return {
        conversation: summaryOf(c),
        messages: page.rows.map((r) => messageView(r, current)),
        hasOlder: page.hasOlder,
        turns: (await this.repo.recentTurns(orbitId, c.id)).map(turnView),
        links: await this.repo.links(orbitId, c.id),
        lastSeq: c.lastSeq,
      };
    });
  }

  async older(orbitId: string, conversationId: string, before: unknown): Promise<ExecutiveMessagePage> {
    await this.requireOffice(orbitId);
    const c = await this.conversationOf(orbitId, conversationId);
    const at = typeof before === "string" && /^\d{1,12}$/.test(before) ? Number(before) : null;
    if (at === null) throw invalid("bad_cursor", "before must be a message's position.");
    const page = await this.repo.page(orbitId, c.id, at, EXECUTIVE_LIMITS.pageSize);
    const current = await this.currentAppointment(orbitId);
    return { messages: page.rows.map((r) => messageView(r, current)), hasOlder: page.hasOlder };
  }

  // A new conversation: its first message (answered by the CEO), a report of Orbit's records (there may be no CEO to
  // answer), or work given to the CEO in the owner's own words (the same mission creation as a proposal's).
  async start(actor: Actor, owner: Owner, body: unknown, key: unknown): Promise<StoredAnswer> {
    const has = (field: string): boolean => typeof body === "object" && body !== null && field in body;
    const report = has("report") ? accepted(checkExecutiveReport({ kind: (body as { report: unknown }).report })) : null;
    const work = report === null && has("mission") ? accepted(checkExecutiveMission({ ...(body as object), proposalMessageId: null })) : null;
    const text = report === null && work === null ? accepted(checkExecutiveText(body)) : null;
    const scope = this.scopeOf(actor, "executive.conversation", key);
    return this.governance.command(actor, "executive.conversation", "new", async () => {
      const prior = await this.idempotency.begin(scope, body);
      if (prior !== null) return prior;
      const office = await this.requireOffice(actor.command.orbitId);
      const ceo = text !== null ? await this.turns.ceo(actor.command.orbitId, true) : null;
      const at = new Date().toISOString();
      const title = text !== null ? titleOf(text.text) : work !== null ? titleOf(work.mission.title) : await this.reportTitle((report as { kind: ExecutiveReportKind }).kind);
      const c = await this.repo.insertConversation({ id: randomUUID(), orbitId: office.orbitId, officeId: office.id, title, userId: owner.userId, at });
      let answer: StoredAnswer;
      if (text !== null && ceo !== null) answer = { status: 201, body: { conversationId: c.id, ...(await this.ask(c, owner, text.text, ceo, at)) } };
      else if (work !== null) {
        const given = await this.giveIn(actor, owner, c, null, work.mission, work.expectedAssignee, key as string);
        if (given.status !== 201 && given.status !== 202) return given;
        answer = { status: 201, body: { conversationId: c.id, mission: given.body } };
      } else answer = { status: 201, body: { conversationId: c.id, message: await this.addReport(c, (report as { kind: ExecutiveReportKind }).kind), turn: null } };
      await this.idempotency.complete(scope, body, answer);
      await this.governance.recorded(actor, "executive.conversation", "conversation", c.id, 1, text !== null ? "started" : work !== null ? "started with work for the CEO" : "started with a report");
      this.db.afterCommit(() => this.bus.publishApp("executive.conversation.created", { conversationId: c.id }, accountAudience(office.orbitId)));
      return answer;
    });
  }

  // ---- messages ------------------------------------------------------------------------------------------------------

  async send(actor: Actor, owner: Owner, conversationId: string, body: unknown, key: unknown): Promise<StoredAnswer> {
    const req = accepted(checkExecutiveText(body));
    const scope = this.scopeOf(actor, `executive.message:${conversationId}`, key);
    return this.governance.command(actor, "executive.message", conversationId, async () => {
      const prior = await this.idempotency.begin(scope, req);
      if (prior !== null) return prior;
      await this.requireOffice(actor.command.orbitId);
      const c = await this.conversationOf(actor.command.orbitId, conversationId, true);
      const ceo = await this.turns.ceo(actor.command.orbitId, true);
      const answer: StoredAnswer = { status: 202, body: { conversationId: c.id, ...(await this.ask(c, owner, req.text, ceo, new Date().toISOString())) } };
      await this.idempotency.complete(scope, req, answer);
      return answer;
    });
  }

  // The owner's message kept and said, then answered by a turn of the CEO.
  private async ask(c: ConversationRecord, owner: Owner, text: string, ceo: CeoForTurn, at: string): Promise<{ message: ExecutiveMessage; turn: ExecutiveTurn }> {
    const row = await this.repo.addMessage({ id: randomUUID(), orbitId: c.orbitId, conversationId: c.id, role: "owner", authorName: owner.fullName || owner.username, userId: owner.userId, text, at });
    const message = messageView(row as NonNullable<typeof row>, ceo.appointmentId);
    await this.stream.publish(c.orbitId, c.id, "executive.message.created", { message }, null);
    const turn = await this.turns.answer(c.orbitId, c.id, message.id, ceo);
    return { message, turn: turnView(turn) };
  }

  // A turn stopped: one that waits ends at once; one that runs is stopped where it is (its answer kept, cut off).
  async stop(actor: Actor, conversationId: string, turnId: string): Promise<{ turn: ExecutiveTurn }> {
    const orbitId = actor.command.orbitId;
    const out = await this.governance.command(actor, "executive.stop", turnId, async () => {
      const c = await this.conversationOf(orbitId, conversationId, true);
      const t = isWorkforceId(turnId) ? await this.repo.turn(orbitId, turnId, true) : null;
      if (t === null || t.conversationId !== c.id) throw missing("The answer");
      if (t.state === "queued" || t.state === "waiting") {
        const ended = await this.turns.end(t, "cancelled", "stopped");
        return { turn: ended ?? t, next: true };
      }
      if (t.state !== "running" || t.runId === null) throw conflictWith("turn_ended", "That answer has ended already.");
      await this.conversationRuns.requestStop(orbitId, t.runId, "stopped");
      return { turn: t, next: false };
    });
    if (out.turn.runId !== null) this.runner.stopLocal(out.turn.runId);
    if (out.next) await this.turns.next(orbitId, conversationId);
    return { turn: turnView(out.turn) };
  }

  // Ask again: an answer that ended without one is asked of the CEO in office now -- explicitly, never on its own.
  async retry(actor: Actor, conversationId: string, turnId: string): Promise<{ turn: ExecutiveTurn }> {
    const orbitId = actor.command.orbitId;
    return this.governance.command(actor, "executive.retry", turnId, async () => {
      const c = await this.conversationOf(orbitId, conversationId, true);
      const t = isWorkforceId(turnId) ? await this.repo.turn(orbitId, turnId) : null;
      if (t === null || t.conversationId !== c.id) throw missing("The answer");
      if (!["failed", "interrupted", "cancelled"].includes(t.state)) throw conflictWith("turn_not_ended", "That answer has not ended: wait for it, or stop it first.");
      if ((await this.repo.openTurns(orbitId, c.id)).length > 0) throw conflictWith("turn_open", "An answer is already on its way in this conversation.");
      const ceo = await this.turns.ceo(orbitId, true);
      return { turn: turnView(await this.turns.answer(orbitId, c.id, t.requestMessageId, ceo)) };
    });
  }

  // ---- Orbit's records ------------------------------------------------------------------------------------------------

  async report(actor: Actor, conversationId: string, body: unknown): Promise<{ message: ExecutiveMessage }> {
    const req = accepted(checkExecutiveReport(body));
    return this.governance.command(actor, "executive.report", conversationId, async () => {
      await this.requireOffice(actor.command.orbitId);
      const c = await this.conversationOf(actor.command.orbitId, conversationId, true);
      return { message: await this.addReport(c, req.kind) };
    });
  }

  private async addReport(c: ConversationRecord, kind: ExecutiveReportKind): Promise<ExecutiveMessage> {
    const report = await this.reports.report(c.orbitId, kind);
    const row = await this.repo.addMessage({ id: randomUUID(), orbitId: c.orbitId, conversationId: c.id, role: "system", authorName: "Orbit", text: report.title, report, at: new Date().toISOString() });
    const message = messageView(row as NonNullable<typeof row>, null);
    await this.stream.publish(c.orbitId, c.id, "executive.message.created", { message }, null);
    return message;
  }

  private async reportTitle(kind: ExecutiveReportKind): Promise<string> {
    const titles: Record<ExecutiveReportKind, string> = { status: "Company status", missions: "Active missions", departments: "Departments", resources: "Resource usage", decisions: "Waiting for you" };
    return titles[kind];
  }

  // ---- missions ------------------------------------------------------------------------------------------------------

  // Give the CEO a mission from this conversation: the existing mission creation (the CEO as target, held to the
  // responsible the owner saw, queued when the CEO is busy), linked to the conversation and to the message it came from.
  async giveMission(actor: Actor, owner: Owner, conversationId: string, body: unknown, key: unknown): Promise<StoredAnswer> {
    const req = accepted(checkExecutiveMission(body));
    if (!isIdempotencyKey(key)) throw invalid("idempotency_key_required", "Send an Idempotency-Key header (8-128 letters, digits, dots, dashes, colons or underscores) with every new mission.");
    const orbitId = actor.command.orbitId;
    return this.governance.command(actor, "executive.mission", conversationId, async () => {
      await this.requireOffice(orbitId);
      const c = await this.conversationOf(orbitId, conversationId, true);
      return this.giveIn(actor, owner, c, req.proposalMessageId, req.mission, req.expectedAssignee, key);
    });
  }

  // Inside the command's transaction: the proposal checked (or the owner's own words kept), the mission made, linked.
  private async giveIn(actor: Actor, owner: Owner, c: ConversationRecord, proposalMessageId: string | null, fields: ExecutiveMissionFields, expectedAssignee: ExpectedAssignee, key: string): Promise<StoredAnswer> {
    const orbitId = c.orbitId;
    const proposal = proposalMessageId === null ? null : await this.repo.message(orbitId, proposalMessageId, true);
    if (proposalMessageId !== null && (proposal === null || String(proposal.conversation_id) !== c.id || proposal.proposal === null)) throw missing("The proposal");
    if (proposal !== null && proposal.proposal_state === "dismissed") throw conflictWith("proposal_dismissed", "That proposal was set aside: ask the CEO again, or give the work in your own words.");
    const answer = await this.missions.create(actor, { ...fields, target: { kind: "ceo" }, expectedAssignee, whenBusy: "enqueue" }, key);
    if (answer.status !== 201 && answer.status !== 202) return answer;
    const missionId = (answer.body as MissionAccepted).missionId;
    const at = new Date().toISOString();
    const messageId = proposal !== null ? String(proposal.id) : await this.ownWords(c, owner, fields.title, fields.goal, at);
    if (!(await this.repo.link({ orbitId, missionId, conversationId: c.id, messageId, by: actor.command.actor, at }))) return answer;
    const given = proposal !== null ? await this.repo.setProposal(orbitId, messageId, "given", missionId) : null;
    await this.outbox.append(actor.command, [{ type: "ExecutiveMissionLinked", aggregateType: "conversation", aggregateId: c.id, aggregateVersion: 1, missionId, payload: { conversationId: c.id, messageId } }]);
    await this.stream.publish(orbitId, c.id, "executive.mission.linked", { link: { missionId, messageId, title: fields.title, linkedAt: at }, message: given === null ? null : messageView(given, await this.currentAppointment(orbitId)) }, null);
    return answer;
  }

  // The owner's own words, kept as the message the mission came from.
  private async ownWords(c: ConversationRecord, owner: Owner, title: string, goal: string, at: string): Promise<string> {
    const row = await this.repo.addMessage({ id: randomUUID(), orbitId: c.orbitId, conversationId: c.id, role: "owner", authorName: owner.fullName || owner.username, userId: owner.userId, text: `Work for the CEO: ${title}\n\n${goal}`, at });
    const message = messageView(row as NonNullable<typeof row>, null);
    await this.stream.publish(c.orbitId, c.id, "executive.message.created", { message }, null);
    return message.id;
  }

  async dismiss(actor: Actor, conversationId: string, messageId: string): Promise<{ message: ExecutiveMessage }> {
    const orbitId = actor.command.orbitId;
    return this.governance.command(actor, "executive.dismiss", messageId, async () => {
      const c = await this.conversationOf(orbitId, conversationId, true);
      const m = isWorkforceId(messageId) ? await this.repo.message(orbitId, messageId, true) : null;
      if (m === null || String(m.conversation_id) !== c.id || m.proposal === null) throw missing("The proposal");
      if (m.proposal_state !== "open") throw conflictWith("proposal_not_open", m.proposal_state === "given" ? "That proposal was given already." : "That proposal was set aside already.");
      const changed = await this.repo.setProposal(orbitId, messageId, "dismissed", null);
      const message = messageView(changed as NonNullable<typeof changed>, await this.currentAppointment(orbitId));
      await this.stream.publish(orbitId, c.id, "executive.message.changed", { message }, null);
      return { message };
    });
  }

  // ---- the conversation's stream -------------------------------------------------------------------------------------

  async events(owner: Owner, conversationId: string, req: Request, res: Response): Promise<void> {
    await this.requireOffice(owner.accountId);
    const c = await this.conversationOf(owner.accountId, conversationId);
    await this.stream.serve(c.id, { accountId: owner.accountId, email: owner.email, sessionId: owner.sessionId }, req, res);
  }

  // ---- inside ----------------------------------------------------------------------------------------------------------

  private async requireOffice(orbitId: string): Promise<{ id: string; orbitId: string; name: string }> {
    const office = await this.offices.get(orbitId);
    if (office === null) throw conflictWith("office_not_set_up", NO_COMPANY);
    return { id: office.id, orbitId, name: office.name };
  }

  private async conversationOf(orbitId: string, id: string, lock = false): Promise<ConversationRecord> {
    const c = isWorkforceId(id) ? await this.repo.conversation(orbitId, id, lock) : null;
    if (c === null) throw missing("The conversation");
    return c;
  }

  private async currentAppointment(orbitId: string): Promise<string | null> {
    return (await this.org.slot(orbitId, { kind: "ceo" }, false)).incumbent?.appointmentId ?? null;
  }

  private scopeOf(actor: Actor, operation: string, key: unknown): IdempotencyScope {
    if (!isIdempotencyKey(key)) throw invalid("idempotency_key_required", "Send an Idempotency-Key header (8-128 letters, digits, dots, dashes, colons or underscores) with every message.");
    return { orbitId: actor.command.orbitId, actor: actor.command.actor, operation, key };
  }
}
