// THE TURNS OF A CONVERSATION (Executive, application; ADR 0062): who answers (the CEO in office -- its appointment and
// revision pinned on the turn), how an owner's message is answered (it joins the turn that waits to start, or a new turn
// answers it), how a turn asks for its run (a conversation run of the CEO, admitted like any run), how it ends, and what
// starts next. Shared by the service that takes the owner's messages and the runner that runs the answers.
import { Inject, Injectable } from "@nestjs/common";
import type { ExecutiveTurnKind, ExecutiveTurnState } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { Db } from "../../../infra/db/db.js";
import { WorkerSignals } from "../../execution/application/worker-signals.js";
import { ConversationRunRepository } from "../../execution/infrastructure/conversation-runs.repository.js";
import { conflictWith } from "../../shared/domain.js";
import { OrgReader } from "../../work/infrastructure/org.reader.js";
import { EmployeeEligibility } from "../../workforce/application/eligibility.js";
import { PENDING_TURN_STATES, TURN_FAILURES, type TurnFailure } from "../domain/conversation.js";
import { executiveRuntimeOf } from "../infrastructure/executive-runtimes.js";
import { TurnTasks } from "./turn-tasks.js";
import { ExecutiveRepository, turnView, type TurnRecord } from "../infrastructure/executive.repository.js";
import { ExecutiveStream } from "../infrastructure/executive-stream.js";

// The CEO an answer is asked of: who holds the appointment now, and what its answer runs on.
export interface CeoForTurn {
  employeeId: string;
  name: string;
  appointmentId: string;
  appointmentRevision: number;
  execution: { runtime: string; connectionId: string | null; model: string; effort: string | null };
}

export const NO_CEO = "The company has no CEO yet: hire an AI employee (or choose one), then appoint them CEO in the Office.";

@Injectable()
export class ExecutiveTurns {
  constructor(
    @Inject(Db) private readonly db: Db,
    @Inject(ExecutiveRepository) private readonly repo: ExecutiveRepository,
    @Inject(ExecutiveStream) private readonly stream: ExecutiveStream,
    @Inject(OrgReader) private readonly org: OrgReader,
    @Inject(EmployeeEligibility) private readonly eligibility: EmployeeEligibility,
    @Inject(ConversationRunRepository) private readonly runs: ConversationRunRepository,
    @Inject(WorkerSignals) private readonly signals: WorkerSignals,
    @Inject(TurnTasks) private readonly tasks: TurnTasks,
  ) {}

  // The CEO in office who can answer now -- or the 409 that says why nobody can (no CEO, a suspended appointment, a CEO
  // that cannot work, a runtime CEO Chat cannot hold to answering without tools). Never another employee.
  async ceo(orbitId: string, lock = false): Promise<CeoForTurn> {
    const i = (await this.org.slot(orbitId, { kind: "ceo" }, lock)).incumbent;
    if (i === null) throw conflictWith("no_ceo", NO_CEO);
    if (i.state === "suspended") throw conflictWith("appointment_suspended", `${i.employeeName}'s appointment as CEO is suspended: reinstate it, or appoint another CEO, before asking the CEO anything.`);
    const el = await this.eligibility.of(orbitId, i.employeeId, false);
    if (el === null || !el.eligible) throw conflictWith("ceo_unavailable", `${i.employeeName} cannot answer now: ${el?.reason ?? "the employee no longer exists."}`);
    if (executiveRuntimeOf(el.execution.runtime) === null) throw conflictWith("runtime_unsupported", `${i.employeeName} runs on ${el.execution.runtime}, which CEO Chat cannot hold to answering without tools: CEO Chat answers through Claude Code or OpenAI Codex. Work you give the CEO still goes to ${i.employeeName}.`);
    if (el.execution.model === null || el.execution.model === "") throw conflictWith("ceo_unavailable", `${i.employeeName}'s profile names no model: choose one on the profile, or set a default.`);
    return { employeeId: i.employeeId, name: i.employeeName, appointmentId: i.appointmentId, appointmentRevision: i.slotRevision, execution: { runtime: el.execution.runtime, connectionId: el.execution.connectionId, model: el.execution.model, effort: el.execution.effort } };
  }

  // An owner's message, answered: it joins the turn of this CEO that waits to start, or a new turn answers it -- queued
  // behind the conversation's running answer, else asking for its run now. A turn that waits for a CEO no longer in
  // office ends first, saying why. Inside the caller's transaction (the conversation's row held).
  async answer(orbitId: string, conversationId: string, messageId: string, ceo: CeoForTurn, kind: ExecutiveTurnKind = "answer"): Promise<TurnRecord> {
    const open = await this.repo.openTurns(orbitId, conversationId, true);
    for (const stale of open.filter((t) => PENDING_TURN_STATES.includes(t.state) && t.appointmentId !== ceo.appointmentId)) await this.end(stale, "failed", "ceo_changed");
    const pending = open.find((t) => PENDING_TURN_STATES.includes(t.state) && t.appointmentId === ceo.appointmentId && t.kind === kind);
    if (pending !== undefined) {
      const joined = (await this.repo.updateTurn(orbitId, pending.id, PENDING_TURN_STATES, { requestMessageId: messageId })) ?? pending;
      await this.stream.publish(orbitId, conversationId, "executive.turn.waiting", { turn: turnView(joined) }, joined.id);
      return joined;
    }
    const running = open.some((t) => t.state === "running");
    const turn = await this.repo.insertTurn({ id: randomUUID(), orbitId, conversationId, kind, requestMessageId: messageId, employeeId: ceo.employeeId, authorName: ceo.name, appointmentId: ceo.appointmentId, appointmentRevision: ceo.appointmentRevision, state: running ? "queued" : "waiting", runId: null, at: new Date().toISOString() });
    const asked = running ? turn : await this.requestRun(turn, ceo);
    await this.stream.publish(orbitId, conversationId, "executive.turn.waiting", { turn: turnView(asked) }, asked.id);
    return asked;
  }

  // The conversation run a turn's answer runs as: the CEO's execution as it resolves now, the appointment it answers
  // under. The worker is asked for a pass once this is committed.
  async requestRun(turn: TurnRecord, ceo: CeoForTurn): Promise<TurnRecord> {
    const run = await this.runs.request({ orbitId: turn.orbitId, employeeId: turn.employeeId, requested: { ...ceo.execution, appointmentId: ceo.appointmentId, appointmentRevision: ceo.appointmentRevision } });
    this.db.afterCommit(() => this.signals.kick());
    return (await this.repo.updateTurn(turn.orbitId, turn.id, ["queued", "waiting"], { state: "waiting", runId: run.id, waitingReason: null })) ?? turn;
  }

  // A turn ends (however it did): said on its conversation's stream. Its run, if it never started, is cancelled.
  async end(turn: TurnRecord, state: Extract<ExecutiveTurnState, "failed" | "interrupted" | "cancelled">, code: TurnFailure, detail: string | null = null): Promise<TurnRecord | null> {
    const words = detail === null ? TURN_FAILURES[code] : `${TURN_FAILURES[code]} ${detail}`.trim();
    const ended = await this.repo.updateTurn(turn.orbitId, turn.id, ["queued", "waiting", "running"], { state, code, detail: words, endedAt: new Date().toISOString() });
    if (ended === null) return null;
    if (turn.runId !== null && turn.state !== "running") await this.runs.move(turn.orbitId, turn.runId, ["requested", "waiting"], "cancelled", { detail: words, endedAt: new Date().toISOString() });
    await this.stream.publish(turn.orbitId, turn.conversationId, "executive.response.failed", { turn: turnView(ended) }, ended.id);
    // What the turn asked beyond an answer (a hiring request, a draft) ends with it, saying why.
    await this.tasks.settled(ended, null, { completed: false, detail: words });
    return ended;
  }

  // The conversation's next answer, once its running one ended: the oldest queued turn asks for its run -- if the CEO it
  // was asked of is still the one in office and can answer; otherwise it ends, saying why.
  async next(orbitId: string, conversationId: string): Promise<void> {
    await this.db.tx(async () => {
      await this.repo.conversation(orbitId, conversationId, true);
      if ((await this.repo.openTurns(orbitId, conversationId)).some((t) => t.state === "running" || t.state === "waiting")) return;
      const queued = await this.repo.nextQueued(orbitId, conversationId);
      if (queued === null) return;
      let ceo: CeoForTurn;
      try {
        ceo = await this.ceo(orbitId);
      } catch (err) {
        await this.end(queued, "failed", "ceo_unavailable", err instanceof Error ? err.message : String(err));
        return;
      }
      if (ceo.appointmentId !== queued.appointmentId) {
        await this.end(queued, "failed", "ceo_changed");
        return;
      }
      const asked = await this.requestRun(queued, ceo);
      await this.stream.publish(orbitId, conversationId, "executive.turn.waiting", { turn: turnView(asked) }, asked.id);
    });
  }
}
