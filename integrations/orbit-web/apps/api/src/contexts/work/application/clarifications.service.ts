// QUESTIONS GO UP THE TREE, AND STOP BELOW THE CEO (Work; ADR 0061 §8). An attempt that cannot go on without an answer
// asks ONE question and its work ends there (BLOCKED, its run stopped by design):
//
//   - a PART asks its LEAD: the lead is woken (ANSWERING; or it answers in the review it is already in), and answers it --
//     the asker resumes ONCE, with the answer in its brief;
//   - the ROOT asks the person who gave the work (Needs me) -- unless its role decides alone (a manager: roles.ts);
//   - a manager and the CEO DECIDE: they never move a question up. A lead who leads by a grant may move one up only to a
//     lead below the CEO -- never to the CEO, never to the person who gave the work;
//   - a lead woken for a question it then leaves unanswered is woken again, at most WORKFORCE_LIMITS.answerWakes times;
//     then -- or when it is overdue (the sweep) -- the question moves up by itself to a lead below the CEO, or, where the
//     next hop would be the CEO or the person, it is ANSWERED FOR ITS ASKER: decide with your best judgment and say what
//     you assumed (DECIDE_YOURSELF). Nothing asked below the CEO reaches Needs me;
//   - an asker cancelled or failed withdraws its question.
//
// An answer is a compare-and-set on the open question: a lead's and a person's at once, or the same twice, resume the
// asker exactly once.
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { WORKFORCE_LIMITS, type ClarificationKind } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { Db } from "../../../infra/db/db.js";
import { RunRequests } from "../../execution/application/run-requests.js";
import { systemActor, type Actor } from "../../shared/application/commands.js";
import { conflictWith, missing, type RaisedEvent } from "../../shared/domain.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { Assignment } from "../domain/assignment.js";
import { DECIDE_YOURSELF, rulesOf, toolRefusal } from "../domain/roles.js";
import { ClarificationRepository, type ClarificationRecord } from "../infrastructure/clarifications.repository.js";
import { DecisionRepository } from "../infrastructure/decisions.js";
import { AssignmentRepository } from "../infrastructure/repositories.js";
import { TeamService } from "./team.service.js";

const SWEEP_MS = 30_000;

const event = (c: { id: string; missionId: string }, type: RaisedEvent["type"], payload: RaisedEvent["payload"], version = 1): RaisedEvent => ({ type, aggregateType: "clarification", aggregateId: c.id, aggregateVersion: version, missionId: c.missionId, payload });

@Injectable()
export class ClarificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger("Clarifications");
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ClarificationRepository) private readonly questions: ClarificationRepository,
    @Inject(AssignmentRepository) private readonly assignments: AssignmentRepository,
    @Inject(DecisionRepository) private readonly decisions: DecisionRepository,
    @Inject(RunRequests) private readonly runs: RunRequests,
    @Inject(TeamService) private readonly team: TeamService,
    @Inject(Outbox) private readonly outbox: Outbox,
  ) {}

  onModuleInit(): void {
    this.timer = setInterval(() => void this.sweep().catch((err: unknown) => this.logger.warn(`The question sweep failed: ${err instanceof Error ? err.message : String(err)}`)), SWEEP_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer !== null) clearInterval(this.timer);
  }

  // ---- asking (inside the asker's run transaction: the caller holds it locked and saves it) ---------------------------

  async ask(actor: Actor, a: Assignment, fence: number, question: string): Promise<RaisedEvent[]> {
    const orbitId = a.orbitId;
    const at = new Date().toISOString();
    const toLead = a.data.parentId !== null;
    a.asked(question, toLead ? "lead" : "information", fence, at);
    const c = { id: randomUUID(), orbitId, missionId: a.data.missionId, askerAssignmentId: a.id, askerFence: fence, question, addressee: (toLead ? "lead" : "owner") as "lead" | "owner", addresseeAssignmentId: a.data.parentId, kind: "information" as const, dueAt: a.data.deadline, askedAt: at };
    await this.questions.insert(c, toLead ? "asked of its lead" : "asked of the person who gave the work");
    if (!toLead) await this.decisions.open({ orbitId, kind: "information", missionId: a.data.missionId, assignmentId: a.id, title: "The employee asks", reason: question, waiting: actor.command.actor, deadline: a.data.deadline, pin: { assignmentVersion: a.nextVersion, handoffDigest: null, deliveryId: null }, dedupKey: `information:${a.id}` });
    // Its work ends here, by design: its compute goes back now, not when its CLI happens to stop.
    await this.runs.stop(orbitId, a.id, "waiting_for_answer");
    return [event(c, "ClarificationRequested", { askerAssignmentId: a.id, addressee: c.addressee, ...(toLead ? { addresseeAssignmentId: a.data.parentId as string } : {}) })];
  }

  // ---- a lead answers, or moves a question up (inside the lead's run transaction) ------------------------------------

  async answerByLead(actor: Actor, lead: Assignment, fence: number, id: string, answer: string): Promise<{ events: RaisedEvent[]; text: string }> {
    const c = await this.mine(lead, fence, id);
    const at = new Date().toISOString();
    if (!(await this.questions.answer(lead.orbitId, c.id, answer, actor.command.actor, at))) throw conflictWith("already_answered", "That question was answered already.");
    const events = [event(c, "ClarificationAnswered", { askerAssignmentId: c.askerAssignmentId, by: "lead" }, 2), ...(await this.resumeAsker(c, answer, "answered by its lead"))];
    const settled = await this.settle(lead, at, "answered");
    return { events: [...events, ...settled.events], text: `Answered: the colleague who asked continues with your answer.${settled.done ? " Nothing else waits for you now: stop here." : ""}` };
  }

  // A lead moves a question one level up: only one who leads by a grant, and only to a lead below the CEO (roles.ts).
  async escalate(_actor: Actor, lead: Assignment, fence: number, id: string, kind: ClarificationKind, note: string): Promise<{ events: RaisedEvent[]; text: string }> {
    const c = await this.mine(lead, fence, id);
    const rules = rulesOf((await this.team.standing(lead.orbitId, lead)).role, lead.data.parentId === null);
    if (!rules.escalates) throw conflictWith("decide_yourself", toolRefusal(rules, "escalate_question", false) ?? "You decide: answer the question yourself.");
    if ((await this.nextHop(lead)) !== "lead") throw conflictWith("decide_yourself", "A question does not go above your department to the CEO or to the person who gave the work: answer it yourself, with your best judgment, and say what you assumed.");
    const at = new Date().toISOString();
    const events = await this.moveUp(lead, c, kind, note.trim() || `moved up by its lead (${kind.replace(/_/g, " ")})`, at);
    const settled = await this.settle(lead, at, "escalated");
    return { events: [...events, ...settled.events], text: `Moved the question up to your lead: the colleague who asked waits for that answer.${settled.done ? " Nothing else waits for you now: stop here." : ""}` };
  }

  // ---- a person answers (Needs me: a root's question, or one moved up to them) ---------------------------------------

  async answerByOwner(actor: Actor, asker: Assignment, answer: string): Promise<RaisedEvent[]> {
    const c = await this.questions.openOf(asker.orbitId, asker.id, true);
    if (c === null) throw conflictWith("invalid_transition", "This assignment is not waiting for an answer.");
    if (c.addressee === "lead") throw conflictWith("asked_of_lead", "This question was asked of its lead, who answers it (or moves it up to you).", { clarificationId: c.id });
    const at = new Date().toISOString();
    if (!(await this.questions.answer(asker.orbitId, c.id, answer, actor.command.actor, at))) throw conflictWith("already_answered", "That question was answered already.");
    const fence = asker.unblock(at, { question: c.question, answer });
    await this.decisions.close(asker.orbitId, `information:${asker.id}`, "resolved", "answered", actor.command.actor);
    return [event(c, "ClarificationAnswered", { askerAssignmentId: asker.id, by: "owner" }, 2), await this.requestRun(asker, fence, "answered by the person who gave the work")];
  }

  // The question an assignment asked that is still open (null: none).
  openQuestionOf(orbitId: string, assignmentId: string): Promise<ClarificationRecord | null> {
    return this.questions.openOf(orbitId, assignmentId);
  }

  // ---- what an attempt's end leaves (inside the lead's transaction) ---------------------------------------------------

  // A lead's answering attempt ended without settling its team's questions: each is counted, and one its lead was woken
  // for WORKFORCE_LIMITS.answerWakes times moves up by itself; then the lead waits, or is woken again.
  async answeringEnded(lead: Assignment, at: string): Promise<RaisedEvent[]> {
    const events: RaisedEvent[] = [];
    for (const q of await this.questions.openTo(lead.orbitId, lead.id)) {
      if ((await this.questions.woken(lead.orbitId, q.id)) >= WORKFORCE_LIMITS.answerWakes) events.push(...(await this.upOrDecide(lead, q, "unanswered", `its lead was woken ${WORKFORCE_LIMITS.answerWakes} times and did not answer it`, at)));
    }
    lead.waitForTeam(at);
    return [...events, ...(await this.team.next(lead, at))];
  }

  // The asker ended (cancelled, failed): its open question is withdrawn, and a person's item for it closes.
  async withdrawFor(orbitId: string, assignmentId: string): Promise<RaisedEvent[]> {
    const c = await this.questions.withdraw(orbitId, assignmentId);
    if (c === null) return [];
    if (c.addressee === "owner") await this.decisions.close(orbitId, `information:${assignmentId}`, "resolved", "withdrawn", "system:clarifications");
    return [event(c, "ClarificationWithdrawn", { askerAssignmentId: assignmentId }, 3)];
  }

  // ---- the sweep: an overdue question moves up; a wake that was lost is made again ----------------------------------

  async sweep(now = new Date().toISOString()): Promise<void> {
    for (const c of await this.questions.overdue(now)) {
      if (c.addressee !== "lead" || c.addresseeAssignmentId === null) continue;
      await this.db.tx(async () => {
        const lead = await this.assignments.get(c.orbitId, c.addresseeAssignmentId as string, true);
        if (lead === null) return;
        const events = await this.upOrDecide(lead, c, "deadline", "it was due and not answered", now);
        await this.outbox.append(systemActor(c.orbitId, "clarifications", `clarification:${c.id}`).command, events);
      });
    }
    for (const w of await this.questions.waitingLeads()) await this.team.wake(w.orbitId, w.leadId, `sweep:${w.leadId}`, null);
  }

  // ---- inside --------------------------------------------------------------------------------------------------------

  // An open question of this lead's team, asked of it, and the lead's attempt still acting.
  private async mine(lead: Assignment, fence: number, id: string): Promise<ClarificationRecord> {
    if (!lead.acting(fence)) throw conflictWith("stale_fence", "This attempt was replaced or has ended: its tools are closed.");
    const c = await this.questions.get(lead.orbitId, id, true);
    if (c === null || c.addressee !== "lead" || c.addresseeAssignmentId !== lead.id) throw missing(`The question ${id} of your team`);
    if (c.state !== "open") throw conflictWith("already_answered", "That question was answered already.");
    return c;
  }

  // Where a question would go one level up from this lead: the person who gave the work (it is the root), the CEO (its
  // lead holds the CEO's appointment in force), or a lead below the CEO.
  private async nextHop(lead: Assignment): Promise<"owner" | "ceo" | "lead"> {
    if (lead.data.parentId === null) return "owner";
    const ceo = await this.db.one(
      `SELECT 1 AS ceo FROM workforce.assignments p
       JOIN workforce.appointments ap ON ap.account_id = p.account_id AND ap.employee_id = p.employee_id AND ap.role = 'ceo' AND ap.state = 'active'
       WHERE p.account_id = $1 AND p.id = $2`,
      [lead.orbitId, lead.data.parentId],
    );
    return ceo !== null ? "ceo" : "lead";
  }

  // A question its lead left unanswered: up to a lead below the CEO, or -- where the next hop would be the CEO or the
  // person who gave the work -- answered for its asker, once, by Orbit: decide, and say what you assumed.
  private async upOrDecide(lead: Assignment, c: ClarificationRecord, kind: ClarificationKind, why: string, at: string): Promise<RaisedEvent[]> {
    if ((await this.nextHop(lead)) === "lead") return this.moveUp(lead, c, kind, why, at);
    if (!(await this.questions.answer(c.orbitId, c.id, DECIDE_YOURSELF, "system:clarifications", at))) return [];
    return [event(c, "ClarificationAnswered", { askerAssignmentId: c.askerAssignmentId, by: "system" }, 2), ...(await this.resumeAsker(c, DECIDE_YOURSELF, "its manager did not answer in time"))];
  }

  // One level up: to the lead's own lead (woken by its event), or -- from the root -- to the person (Needs me).
  private async moveUp(lead: Assignment, c: ClarificationRecord, kind: ClarificationKind, why: string, at: string): Promise<RaisedEvent[]> {
    const toOwner = lead.data.parentId === null;
    if (!(await this.questions.moveTo(lead.orbitId, c.id, { addressee: toOwner ? "owner" : "lead", assignmentId: lead.data.parentId, kind }, why, at))) return [];
    if (toOwner) {
      const asker = await this.assignments.get(lead.orbitId, c.askerAssignmentId);
      await this.decisions.open({ orbitId: lead.orbitId, kind: "information", missionId: c.missionId, assignmentId: c.askerAssignmentId, title: "A question from the team", reason: `${c.question}\n\n(${kind.replace(/_/g, " ")}: ${why})`.slice(0, 2000), waiting: `assignment:${lead.id}`, deadline: asker?.data.deadline ?? null, pin: { assignmentVersion: asker?.data.version ?? 0, handoffDigest: null, deliveryId: null }, dedupKey: `information:${c.askerAssignmentId}` });
    }
    return [event(c, "ClarificationEscalated", { askerAssignmentId: c.askerAssignmentId, addressee: toOwner ? "owner" : "lead", kind, ...(toOwner ? {} : { addresseeAssignmentId: lead.data.parentId as string }) }, 2)];
  }

  // The asker resumes with the answer, once (its own lock; it waits on this question).
  private async resumeAsker(c: ClarificationRecord, answer: string, wake: string): Promise<RaisedEvent[]> {
    const asker = await this.assignments.get(c.orbitId, c.askerAssignmentId, true);
    if (asker === null || asker.state !== "BLOCKED") return [];
    const fence = asker.unblock(new Date().toISOString(), { question: c.question, answer });
    const run = await this.requestRun(asker, fence, wake);
    await this.assignments.save(asker);
    return [...asker.pullEvents(), run];
  }

  // A lead that answered (or moved up) what its team asked: in an answering attempt with nothing else asked of it, its
  // work ends by design and it waits -- or is woken at once for what came meanwhile.
  private async settle(lead: Assignment, at: string, why: "answered" | "escalated"): Promise<{ events: RaisedEvent[]; done: boolean }> {
    if (lead.state !== "ANSWERING" || (await this.questions.openTo(lead.orbitId, lead.id)).length > 0) return { events: [], done: false };
    lead.waitForTeam(at);
    await this.runs.stop(lead.orbitId, lead.id, why);
    return { events: await this.team.next(lead, at), done: true };
  }

  private requestRun(a: Assignment, fence: number, wake: string): Promise<RaisedEvent> {
    const execution = a.data.pinned?.execution;
    if (execution === undefined) throw conflictWith("invalid_transition", "This assignment was never claimed.");
    return this.runs.request({ orbitId: a.orbitId, assignmentId: a.id, missionId: a.data.missionId, employeeId: a.data.employeeId, fence, priority: a.data.priority, execution, wake });
  }
}
