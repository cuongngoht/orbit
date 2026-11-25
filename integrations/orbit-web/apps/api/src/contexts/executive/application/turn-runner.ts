// THE CEO ANSWERS (Executive, application; ADR 0062): what runs a turn once the admission pass admitted its conversation
// run (CONVERSATION_DISPATCH). Before anything starts, everything is checked again as it is NOW: the CEO in office is
// still the one the turn was asked of (else `ceo_changed` -- never another employee's answer), the employee can work, its
// runtime has a strategy here (executive-runtimes.ts: Claude Code or OpenAI Codex) that PROVES its connection answers
// with that model holding no tool, its connection is connected and offers its model, and the company's policy lets it
// run, as the employee, on that model (governance run kind `executive`). Then the CLI runs in a sandbox of its own (its
// connection's home alone) with NO tool: one that starts with a tool or tries one is stopped. Its answer streams out as
// deltas (an answer that arrives whole is said whole); the end is decided from the process's real exit and the CLI's
// own result line, never from the text. No line below names a runtime: what differs per CLI is its strategy's. The answer
// is kept as the CEO's message -- the proposal it may carry is read by the server (domain/proposal.ts) and authorizes
// nothing -- and the turn's end is said on the conversation's stream. What the run held is given back once its process is
// gone, and the conversation's next answer starts.
import { Inject, Injectable, Logger, Optional, type BeforeApplicationShutdown } from "@nestjs/common";
import { EXECUTIVE_LIMITS } from "@orbit-web/contracts";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../../config/config.js";
import { APP_CONFIG } from "../../../core/tokens.js";
import { Db } from "../../../infra/db/db.js";
import { LineSplitter } from "../../../infra/process/lines.js";
import type { ExitInfo, ProcessHandle } from "../../../infra/process/process.port.js";
import { bounded, tail } from "../../../infra/security/redact.js";
import { decideOutcome } from "../../../modules/claude-runner/outcome.js";
import { TEXT_LIMIT, type MappedEvent } from "../../../modules/claude-runner/stream-mapper.js";
import { ConnectionProbe } from "../../../modules/connections/probe.js";
import { RunConnections, type RunConnection } from "../../../modules/connections/run-connections.js";
import { RunGovernanceService, type RunPlan } from "../../../modules/governance/run-governance.service.js";
import { SESSION_SANDBOXES, type SessionLease, type SessionSandboxes } from "../../../modules/session-sandbox/session-sandboxes.js";
import { AdmissionService } from "../../execution/application/admission.service.js";
import type { ConversationDispatch } from "../../execution/application/conversation-dispatch.port.js";
import { workerTimings, type WorkerTimings } from "../../execution/application/execution.worker.js";
import { WorkerSignals } from "../../execution/application/worker-signals.js";
import { ConversationRunRepository, type ConversationRunRecord } from "../../execution/infrastructure/conversation-runs.repository.js";
import { OrgReader } from "../../work/infrastructure/org.reader.js";
import { EmployeeEligibility } from "../../workforce/application/eligibility.js";
import { TURN_FAILURES, type TurnFailure } from "../domain/conversation.js";
import { readAnswer } from "../domain/proposal.js";
import { executivePrompt, newNonce, type PromptMessage } from "../infrastructure/executive-prompt.js";
import { executiveRuntimeOf, type ChatStreamMapper, type ExecutiveRuntime } from "../infrastructure/executive-runtimes.js";
import { ExecutiveRepository, messageView, turnView, type TurnRecord } from "../infrastructure/executive.repository.js";
import { ExecutiveStream } from "../infrastructure/executive-stream.js";
import { ExecutiveReports } from "./executive-reports.js";
import { TurnTasks, type AnswerBlocks } from "./turn-tasks.js";
import { ExecutiveTurns } from "./turns.js";

const STDERR_LIMIT = 16 * 1024;
// How long one answer may take before it is stopped where it is.
export const TURN_LIMIT_MS = 10 * 60_000;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

type StopReason = "stopped" | "server_restart" | "connection_disconnected" | "time_limit" | "lost";

interface Active {
  run: ConversationRunRecord;
  turn: TurnRecord;
  handle: ProcessHandle;
  rt: ExecutiveRuntime;
  mapper: ChatStreamMapper;
  splitter: LineSplitter;
  messageId: string;
  answer: string;
  answering: boolean;
  segments: Map<string, number>;
  stoppedBy: StopReason | null;
  refused: string | null;
  stderr: string;
  timers: NodeJS.Timeout[];
  plan: RunPlan;
  lease: SessionLease;
  finalizing: boolean;
  done: Promise<void>;
}

// What an answer runs on, once everything was checked: its runtime's strategy, the run's governance, its connection, what
// it is asked, its environment, its effort, and the model entry its strategy proved with (written where the CLI reads it).
interface Ready {
  rt: ExecutiveRuntime;
  plan: RunPlan;
  connectionId: string;
  prompt: string;
  env: Record<string, string>;
  effort: string | null;
  modelFile: string | null;
}

// The model entry a strategy proved with, written once by its content into the connection's own home -- the one place
// of Orbit Web's the CLI's sandbox holds, at the same path -- and named to the CLI (null: none).
function modelFileOf(rc: RunConnection, entry: string | null): string | null {
  if (entry === null) return null;
  const path = join(rc.configDir, `orbit-executive-model-${createHash("sha256").update(entry).digest("hex").slice(0, 16)}.json`);
  if (existsSync(path)) return path;
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, entry, { mode: 0o600 });
  renameSync(temp, path);
  return path;
}

// Why an answer could not start, said on its turn.
class NotStarted extends Error {
  constructor(
    readonly code: TurnFailure,
    readonly detail: string | null = null,
  ) {
    super(detail ?? code);
  }
}

@Injectable()
export class TurnRunner implements ConversationDispatch, BeforeApplicationShutdown {
  private readonly logger = new Logger("CeoChat");
  private readonly active = new Map<string, Active>();
  private readonly timings: WorkerTimings;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(ExecutiveRepository) private readonly repo: ExecutiveRepository,
    @Inject(ExecutiveStream) private readonly stream: ExecutiveStream,
    @Inject(ExecutiveTurns) private readonly turns: ExecutiveTurns,
    @Inject(ExecutiveReports) private readonly reports: ExecutiveReports,
    @Inject(ConversationRunRepository) private readonly runs: ConversationRunRepository,
    @Inject(AdmissionService) private readonly admission: AdmissionService,
    @Inject(OrgReader) private readonly org: OrgReader,
    @Inject(EmployeeEligibility) private readonly eligibility: EmployeeEligibility,
    @Inject(RunConnections) private readonly connections: RunConnections,
    @Inject(RunGovernanceService) private readonly governance: RunGovernanceService,
    @Inject(SESSION_SANDBOXES) private readonly sandboxes: SessionSandboxes,
    @Inject(WorkerSignals) private readonly signals: WorkerSignals,
    @Inject(TurnTasks) private readonly tasks: TurnTasks,
    @Optional() @Inject(ConnectionProbe) private readonly probe: ConnectionProbe | null = null,
  ) {
    this.timings = workerTimings(config.sourceEnv);
  }

  // ---- what the worker hands over (CONVERSATION_DISPATCH) -----------------------------------------------------------

  admitted(orbitId: string, runId: string): void {
    void this.drive(orbitId, runId).catch((err: unknown) => this.logger.warn(`The answer of run ${runId} ended in error: ${message(err)}`));
  }

  async held(orbitId: string, runId: string, outcome: { kind: "wait" | "unschedulable"; reason: string }): Promise<void> {
    const turn = await this.repo.turnOfRun(orbitId, runId);
    if (turn === null) return;
    if (outcome.kind === "unschedulable") {
      await this.db.tx(() => this.turns.end(turn, "failed", "unschedulable", outcome.reason));
      return this.turns.next(orbitId, turn.conversationId);
    }
    const waiting = await this.repo.updateTurn(orbitId, turn.id, ["waiting"], { waitingReason: outcome.reason === "" ? null : this.waitingWords(turn, outcome.reason) });
    if (waiting !== null) await this.stream.publish(orbitId, waiting.conversationId, "executive.turn.waiting", { turn: turnView(waiting) }, waiting.id);
  }

  async interrupted(orbitId: string, runId: string, _reason: string): Promise<void> {
    const turn = await this.repo.turnOfRun(orbitId, runId);
    if (turn === null || this.active.has(runId)) return;
    await this.db.tx(() => this.turns.end(turn, "interrupted", "lost"));
    await this.turns.next(orbitId, turn.conversationId);
  }

  // A person's Stop on an answer that runs here: the process is stopped (an answer elsewhere reads the request on its
  // next heartbeat).
  stopLocal(runId: string): boolean {
    const a = this.active.get(runId);
    if (a === undefined) return false;
    this.stop(a, "stopped");
    return true;
  }

  async beforeApplicationShutdown(): Promise<void> {
    for (const a of this.active.values()) this.stop(a, "server_restart");
    await Promise.race([Promise.all([...this.active.values()].map((a) => a.done)), new Promise((r) => setTimeout(r, this.config.limits.stopGraceMs * 2).unref())]);
  }

  // How many answers run here now (tests).
  get running(): number {
    return this.active.size;
  }

  // ---- one answer ---------------------------------------------------------------------------------------------------

  private waitingWords(turn: TurnRecord, reason: string): string {
    if (reason.startsWith("Its employee is running work now")) return `${turn.authorName} is working on a mission run now: the answer starts once that run ends.`;
    return reason;
  }

  private async drive(orbitId: string, runId: string): Promise<void> {
    const run = await this.runs.get(orbitId, runId);
    const turn = await this.repo.turnOfRun(orbitId, runId);
    if (run === null || turn === null || turn.state !== "waiting" || run.stopRequested !== null) {
      await this.endRun(orbitId, runId, "cancelled", "Its answer was no longer waiting, or was stopped before it started.");
      if (turn !== null && turn.state === "waiting") {
        await this.db.tx(() => this.turns.end(turn, "cancelled", "stopped"));
        await this.turns.next(orbitId, turn.conversationId);
      }
      return;
    }
    let plan: RunPlan | null = null;
    let lease: SessionLease | null = null;
    try {
      const ready = await this.ready(run, turn);
      plan = ready.plan;
      lease = await this.sandbox(run, turn, ready.connectionId);
      this.start(run, turn, ready, lease);
    } catch (err) {
      if (lease !== null) await lease.release().catch(() => undefined);
      if (plan !== null) await this.governance.finished(plan, runId, "failed", null).catch(() => undefined);
      const why = err instanceof NotStarted ? err : new NotStarted("cli_error", message(err));
      await this.endRun(orbitId, runId, "failed", why.detail ?? TURN_FAILURES[why.code]);
      await this.db.tx(() => this.turns.end(turn, "failed", why.code, why.detail));
      await this.turns.next(orbitId, turn.conversationId);
    }
  }

  // Everything checked again as it is now; what the answer runs on, and what it is given.
  private async ready(run: ConversationRunRecord, turn: TurnRecord): Promise<Ready> {
    const orbitId = run.orbitId;
    const ceo = (await this.org.slot(orbitId, { kind: "ceo" }, false)).incumbent;
    if (ceo === null || ceo.appointmentId !== turn.appointmentId || ceo.slotRevision !== turn.appointmentRevision || ceo.employeeId !== turn.employeeId) throw new NotStarted("ceo_changed");
    if (ceo.state === "suspended") throw new NotStarted("ceo_unavailable", `${ceo.employeeName}'s appointment as CEO is suspended.`);
    const el = await this.eligibility.of(orbitId, turn.employeeId, false);
    if (el === null || !el.eligible) throw new NotStarted("ceo_unavailable", el?.reason ?? "The employee no longer exists.");
    const requested = run.requested;
    const rt = executiveRuntimeOf(requested.runtime);
    if (rt === null) throw new NotStarted("runtime_unsupported", `${turn.authorName} runs on ${requested.runtime}.`);
    const refusal = rt.refusal(this.config);
    if (refusal !== null) throw new NotStarted("runtime_unsupported", refusal);
    const rc = await this.connections.readyChat(orbitId, requested.connectionId);
    if (rc === null) throw new NotStarted("ceo_unavailable", `${turn.authorName}'s AI connection is not connected: check it in Settings → AI Connections.`);
    const model = rc.connection.catalog.models.find((m) => m.id === requested.model);
    if (model === undefined) throw new NotStarted("ceo_unavailable", `${turn.authorName}'s model ${requested.model} is not offered by its connection now: choose another on the profile.`);
    const effort = model.efforts.length === 0 ? null : requested.effort !== null && model.efforts.includes(requested.effort) ? requested.effort : null;
    if (model.efforts.length > 0 && requested.effort !== null && effort === null) throw new NotStarted("ceo_unavailable", `${requested.model} takes no effort ${requested.effort}: choose another on the profile.`);
    const proof = await rt.toolless(this.probe, rc, requested.model);
    if (!proof.ok) throw new NotStarted("runtime_unsupported", `${rt.label} cannot answer with ${requested.model} holding no tool: ${proof.reason}.`);
    const prepared = await this.governance.prepareExecutive({ accountId: orbitId, employeeId: turn.employeeId, title: turn.authorName, departmentId: el.departmentId }, run.id, { startedBy: { kind: "system", id: "ceo-chat", accountId: orbitId }, startedByLabel: `owner:${orbitId}`, runtime: rt.kind, model: requested.model });
    if (!prepared.ok) throw new NotStarted("governance", prepared.message);
    const prompt = await this.promptFor(turn, el.name, el.profile.title, el.profile.duties, el.profile.instructions);
    const env = { ...rt.env(this.config, rc), ...prepared.plan.env };
    return { rt, plan: prepared.plan, connectionId: rc.connection.id, prompt: prompt.text, env, effort, modelFile: modelFileOf(rc, proof.modelEntry) };
  }

  // The persona, the records, the conversation so far and what the owner asked since the CEO last answered.
  private async promptFor(turn: TurnRecord, name: string, title: string, duties: string, instructions: string): Promise<{ text: string }> {
    const request = await this.repo.message(turn.orbitId, turn.requestMessageId);
    const through = Number(request?.position ?? 0);
    const rows = await this.repo.history(turn.orbitId, turn.conversationId, through, EXECUTIVE_LIMITS.historyMessages + 10);
    const lastCeo = rows.map((r) => String(r.role)).lastIndexOf("ceo");
    const asked = rows.slice(lastCeo + 1).filter((r) => r.role === "owner").map((r) => String(r.text));
    const history: PromptMessage[] = rows.slice(Math.max(0, lastCeo + 1 - EXECUTIVE_LIMITS.historyMessages), lastCeo + 1).map((r) => ({ role: String(r.role) as PromptMessage["role"], author: String(r.author_name), text: String(r.text) }));
    const records = await this.reports.lines(turn.orbitId);
    await this.repo.updateTurn(turn.orbitId, turn.id, ["waiting"], { records });
    const company = (records[0] ?? "Company: the company").replace(/^Company: /, "").replace(/ \(records as of .*\)$/, "");
    const task = await this.tasks.taskOf(turn);
    return { text: executivePrompt({ persona: { name, title, company, duties, instructions }, records, history, asked: asked.length > 0 ? asked : [String(request?.text ?? "")], nonce: newNonce(), task }) };
  }

  // Its own sandbox (its connection's home alone), or the agent's place.
  private async sandbox(run: ConversationRunRecord, turn: TurnRecord, connectionId: string): Promise<SessionLease> {
    const waiting = (running: number) => void this.held(run.orbitId, run.id, { kind: "wait", reason: `Waiting for a sandbox to answer in: all ${running} are in use by other runs.` }).catch(() => undefined);
    try {
      return await this.sandboxes.acquire({ accountId: run.orbitId, sessionId: turn.conversationId, connectionId, runId: run.id, kind: "executive", workspace: "none", switches: { github: false, azure: false } }, waiting);
    } catch (err) {
      throw new NotStarted("ceo_unavailable", `No sandbox could be made to answer in (${message(err)}).`);
    }
  }

  private start(run: ConversationRunRecord, turn: TurnRecord, ready: Ready, lease: SessionLease): void {
    const { rt, prompt, env, effort, plan, modelFile } = ready;
    const model = run.requested.model;
    const cwd = this.config.data.home;
    const handle = lease.port.spawn(rt.binary(this.config), rt.args({ model, effort, maxBudgetUsd: this.config.maxBudgetUsd, modelFile }), { cwd, env });
    let resolveDone: () => void = () => undefined;
    const a: Active = {
      run,
      turn,
      handle,
      rt,
      mapper: rt.mapper({ model, effort, cwd }),
      splitter: new LineSplitter((line) => this.onLine(a, line)),
      messageId: randomUUID(),
      answer: "",
      answering: false,
      segments: new Map(),
      stoppedBy: null,
      refused: null,
      stderr: "",
      timers: [],
      plan,
      lease,
      finalizing: false,
      done: new Promise<void>((r) => (resolveDone = r)),
    };
    this.active.set(run.id, a);
    handle.onStdout((chunk) => a.splitter.push(chunk));
    handle.onStderr((chunk) => (a.stderr = (a.stderr + chunk).slice(-STDERR_LIMIT)));
    handle.onExit((exit) => void this.finalize(a, exit).finally(() => resolveDone()));
    a.timers.push(setInterval(() => void this.beat(a), this.timings.heartbeatMs));
    a.timers.push(setTimeout(() => this.stop(a, "time_limit"), TURN_LIMIT_MS));
    for (const t of a.timers) t.unref();
    // The CLI is given its prompt once its start is said: nothing it answers can be said before it.
    void this.began(a)
      .catch((err: unknown) => this.logger.warn(`The start of answer ${run.id} was not recorded: ${message(err)}`))
      .finally(() => {
        handle.write(prompt);
        handle.closeInput();
      });
  }

  // The run is running, and its turn says so.
  private async began(a: Active): Promise<void> {
    const at = new Date().toISOString();
    await this.runs.move(a.run.orbitId, a.run.id, ["starting"], "running", { startedAt: at });
    const turn = await this.repo.updateTurn(a.run.orbitId, a.turn.id, ["waiting"], { state: "running", startedAt: at, waitingReason: null });
    if (turn === null) return;
    a.turn = turn;
    await this.stream.publish(turn.orbitId, turn.conversationId, "executive.response.started", { turn: turnView(turn), messageId: a.messageId, authorName: turn.authorName, model: a.run.requested.model }, turn.id);
  }

  // Its lease renewed while it runs; a Stop asked anywhere (or a connection gone) is read here.
  private async beat(a: Active): Promise<void> {
    if (a.finalizing) return;
    // The lease is the worker's of this process (admission leased the run to it): lost, the answer is not this
    // process's any more, and it stops.
    const held = await this.runs.renew(a.run.orbitId, a.run.id, this.signals.owner, this.timings.leaseMs).catch(() => true);
    if (!held) return this.stop(a, "lost");
    const now = await this.runs.get(a.run.orbitId, a.run.id).catch(() => null);
    if (now?.stopRequested !== null && now?.stopRequested !== undefined) this.stop(a, now.stopRequested === "disconnected" ? "connection_disconnected" : "stopped");
  }

  private stop(a: Active, why: StopReason): void {
    if (a.stoppedBy !== null || a.finalizing) return;
    a.stoppedBy = why;
    const grace = this.config.limits.stopGraceMs;
    a.handle.kill("SIGINT");
    a.timers.push(setTimeout(() => a.handle.kill("SIGTERM"), grace).unref());
    a.timers.push(setTimeout(() => a.handle.kill("SIGKILL"), grace * 2).unref());
  }

  private onLine(a: Active, line: string): void {
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    const violation = a.rt.violation(parsed);
    if (violation !== null) return this.refuse(a, violation);
    for (const e of a.mapper.push(parsed)) this.onMapped(a, e);
  }

  private onMapped(a: Active, e: MappedEvent): void {
    if (a.refused !== null) return;
    if (e.type === "tool.started" || e.type === "plan.proposed" || e.type === "permission.denied") return this.refuse(a, TURN_FAILURES.tool_refused);
    if (e.type === "message.started" && e.data.role === "assistant" && e.data.parentToolUseId === null) return this.segment(a, e.data.messageId);
    if (e.type === "message.delta") return this.delta(a, e.data.messageId, e.data.offset, e.data.text);
    if (e.type === "message.completed" && e.data.role === "assistant" && e.data.parentToolUseId === null) return this.completed(a, e.data.messageId, e.data.text);
  }

  private segment(a: Active, segmentId: string): void {
    if (!a.answering) a.answering = true;
    else if (a.answer.length > 0) this.append(a, "\n\n");
    a.segments.set(segmentId, a.answer.length);
  }

  private delta(a: Active, segmentId: string, offset: number, text: string): void {
    const base = a.segments.get(segmentId);
    if (base === undefined || base + offset !== a.answer.length) return;
    this.append(a, text);
  }

  private append(a: Active, text: string): void {
    if (a.answer.length + text.length > TEXT_LIMIT) return;
    const offset = a.answer.length;
    a.answer += text;
    this.stream.emit(a.turn.orbitId, a.turn.conversationId, "executive.response.delta", { messageId: a.messageId, offset, text }, a.turn.id);
  }

  // A segment's whole text: what its deltas did not say yet -- all of it, for a CLI whose answer arrives whole -- is said
  // now, as one delta.
  private completed(a: Active, segmentId: string, text: string): void {
    if (!a.segments.has(segmentId)) this.segment(a, segmentId);
    const base = a.segments.get(segmentId) ?? a.answer.length;
    const said = a.answer.slice(base);
    if (text.length > said.length && text.startsWith(said)) this.append(a, text.slice(said.length));
    a.answer = a.answer.slice(0, base) + text;
  }

  private refuse(a: Active, reason: string): void {
    if (a.refused !== null) return;
    a.refused = reason;
    this.logger.warn(`CEO answer ${a.run.id} stopped: ${reason}`);
    a.handle.kill("SIGKILL");
  }

  // How it ended: completed, interrupted (stopped, restarted, timed out, a connection gone) or failed.
  private outcomeOf(a: Active, exit: ExitInfo): { state: "completed" | "failed" | "interrupted"; code: TurnFailure | null; detail: string | null } {
    if (a.refused !== null) return { state: "failed", code: "tool_refused", detail: null };
    const o = decideOutcome({ stoppedBy: a.stoppedBy === null ? null : a.stoppedBy === "server_restart" || a.stoppedBy === "lost" ? "server_restart" : "user_stop", exit, result: a.mapper.result, stderrTail: tail(a.stderr, 6), cli: a.rt.label });
    if (o.type === "session.completed") return { state: "completed", code: null, detail: null };
    if (o.type === "session.interrupted") return { state: "interrupted", code: a.stoppedBy ?? "stopped", detail: null };
    return { state: "failed", code: "cli_error", detail: o.data.message.slice(0, 600) };
  }

  // Written once, whoever notices the end first: the answer kept (with what it proposed), the turn's end said, what the
  // run held given back, governance told, and the conversation's next answer started.
  private async finalize(a: Active, exit: ExitInfo): Promise<void> {
    if (a.finalizing) return;
    a.finalizing = true;
    for (const t of a.timers) clearTimeout(t);
    a.splitter.end();
    for (const e of a.mapper.finish()) this.onMapped(a, e);
    const outcome = this.outcomeOf(a, exit);
    const turn = a.turn;
    try {
      await this.db.tx(async () => {
        const at = new Date().toISOString();
        const said = a.answer.trim().length > 0 ? readAnswer(a.answer) : null;
        if (said === null || (said.text.length === 0 && said.staffing === null && said.profile === null)) {
          const detail = outcome.code === null ? "The CEO's AI CLI ended without an answer." : outcome.detail === null ? TURN_FAILURES[outcome.code] : `${TURN_FAILURES[outcome.code]} ${outcome.detail}`;
          const ended = await this.repo.updateTurn(turn.orbitId, turn.id, ["waiting", "running"], { state: outcome.state === "completed" ? "failed" : outcome.state, code: outcome.code ?? "cli_error", detail, endedAt: at });
          if (ended !== null) await this.stream.publish(turn.orbitId, turn.conversationId, "executive.response.failed", { turn: turnView(ended) }, turn.id);
          await this.settle(turn, null, { completed: false, detail });
          return;
        }
        const completed = outcome.state === "completed";
        // A block only another kind of turn reads (a staffing plan, a profile) is ignored here, and says so.
        const note = [...(completed && said.note !== null ? [said.note] : []), ...this.tasks.ignored(turn, said)].join(" ");
        const text = said.text.length > 0 ? said.text : "(The CEO answered with what it was asked for, below.)";
        const row = await this.repo.addMessage({ id: a.messageId, orbitId: turn.orbitId, conversationId: turn.conversationId, role: "ceo", authorName: turn.authorName, employeeId: turn.employeeId, appointmentId: turn.appointmentId, appointmentRevision: turn.appointmentRevision, text: bounded(text, EXECUTIVE_LIMITS.textLength * 4).text, partial: !completed, model: a.run.requested.model, effort: a.run.requested.effort, proposal: completed ? said.proposal : null, proposalNote: note.length > 0 ? note : null, turnId: turn.id, at });
        const ended = await this.repo.updateTurn(turn.orbitId, turn.id, ["waiting", "running"], { state: outcome.state, responseMessageId: a.messageId, code: outcome.code, detail: outcome.code === null ? null : outcome.detail === null ? TURN_FAILURES[outcome.code] : `${TURN_FAILURES[outcome.code]} ${outcome.detail}`, endedAt: at });
        if (row !== null && ended !== null) await this.stream.publish(turn.orbitId, turn.conversationId, "executive.response.completed", { turn: turnView(ended), message: messageView(row, turn.appointmentId) }, turn.id);
        await this.settle(turn, said, { completed, detail: outcome.code === null ? null : (outcome.detail ?? TURN_FAILURES[outcome.code]) });
      });
    } catch (err) {
      this.logger.error(`The end of CEO answer ${a.run.id} could not be written: ${message(err)}`);
    } finally {
      this.active.delete(a.run.id);
      await a.lease.release().catch(() => undefined);
    }
    await this.endRun(a.run.orbitId, a.run.id, outcome.state === "completed" ? "succeeded" : outcome.state, outcome.detail).catch((err: unknown) => this.logger.error(`CEO answer ${a.run.id} was not released: ${message(err)}`));
    await this.governance.finished(a.plan, a.run.id, outcome.state === "completed" ? "completed" : outcome.state, exit.code).catch((err: unknown) => this.logger.error(`The end of CEO answer ${a.run.id} was not recorded: ${message(err)}`));
    await this.turns.next(turn.orbitId, turn.conversationId).catch((err: unknown) => this.logger.warn(`The next answer of conversation ${turn.conversationId} did not start: ${message(err)}`));
  }

  // What the turn asked beyond an answer (a hiring request's plan, a draft) is settled, in a savepoint of the turn's end:
  // what could not be settled never takes the turn's end with it.
  private async settle(turn: TurnRecord, blocks: AnswerBlocks | null, ended: { completed: boolean; detail: string | null }): Promise<void> {
    await this.db.tx(() => this.tasks.settled(turn, blocks, ended)).catch((err: unknown) => this.logger.error(`What CEO answer ${turn.id} was asked for was not settled: ${message(err)}`));
  }

  // The run's end, and what it held given back (its process is gone) -- and a pass asked for now, since what waited for
  // that compute (an employee's attempt, another answer) may start (not on the worker's next tick).
  private async endRun(orbitId: string, runId: string, state: "succeeded" | "failed" | "interrupted" | "cancelled", detail: string | null): Promise<void> {
    await this.runs.move(orbitId, runId, ["requested", "waiting", "starting", "running"], state, { detail, endedAt: new Date().toISOString() });
    if (await this.admission.releaseConversation(orbitId, runId, state)) this.signals.kick();
  }
}
