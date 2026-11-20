// THE RESEARCH RUNNER: one question at a time per research session, answered by the official Claude CLI in a profile of
// its own (research-args.ts: no tool, restricted, nothing persisted) from passages the server retrieved itself.
//
//   1. The evidence is FROZEN: the revisions the session's selected sources are indexed at now -- a selection changed
//      while it runs applies to the next question -- and the passages retrieved from them alone, each labelled S1..Sn,
//      recorded with the run before it starts.
//   2. The question, the conversation so far and the passages go in on stdin (prompt.ts); the answer streams out as
//      deltas, mapped by the coding runner's own stream mapper.
//   3. A process that reports a tool, an MCP server or a tool call is stopped: a research run has none.
//   4. The outcome is decided from the process's real exit and the CLI's own result line, never from the text; a
//      stopped run is `interrupted`, never `completed`. The answer is kept with every citation label checked against the
//      run's passages (citations.ts): what passes is a citation with the server's own record of where it comes from.
//   5. A restart of Orbit Web leaves no run "running": one it cut short is recorded as interrupted and never run again.
//
// In the governed deployment the run is bound like any run there (run-governance.service.ts): its only way out is the
// egress proxy, and the Constitution decides each connection.
import { type BeforeApplicationShutdown, Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { effortFor, modelOf, type EventDataMap, type ResearchSessionStatus, type RunAccepted } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import type { AppConfig } from "../../../config/config.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../../core/tokens.js";
import { conflict } from "../../../common/errors.js";
import { claudeEnv } from "../../../infra/process/env.js";
import { LineSplitter } from "../../../infra/process/lines.js";
import type { ExitInfo, ProcessHandle, ProcessPort } from "../../../infra/process/process.port.js";
import { bounded, redactSecrets, tail } from "../../../infra/security/redact.js";
import { ClaudeModelsService } from "../../claude-auth/claude-models.service.js";
import { decideOutcome } from "../../claude-runner/outcome.js";
import { StreamMapper, TEXT_LIMIT, type MappedEvent } from "../../claude-runner/stream-mapper.js";
import { RunGovernanceService, type RunPlan } from "../../governance/run-governance.service.js";
import { RETRIEVER, type RetrievedPassage, type Retriever } from "../retrieval/retriever.js";
import { EvidenceStore, type CitationRecord } from "../store/evidence.js";
import { ResearchRunStore, ResearchSessionStore, type FrozenRevision, type ResearchSessionRecord } from "../store/sessions.js";
import { SourceStore } from "../store/sources.js";
import { ResearchStream } from "../stream.js";
import { ResearchViews } from "../views.js";
import { verifyLabels } from "./citations.js";
import { newNonce, researchPrompt, type PromptTurn } from "./prompt.js";
import { researchArgs } from "./research-args.js";

const STDERR_LIMIT = 16 * 1024;
export const QUOTE_LIMIT = 4_000;

interface ActiveRun {
  runId: string;
  session: ResearchSessionRecord;
  handle: ProcessHandle;
  mapper: StreamMapper;
  splitter: LineSplitter;
  stoppedBy: "user_stop" | "server_restart" | null;
  // Why the run was stopped as one a research run must never be (a tool).
  refused: string | null;
  stderr: string;
  timers: NodeJS.Timeout[];
  answerId: string;
  answer: string;
  answering: boolean;
  segments: Map<string, number>;
  usage: { input: number | null; output: number | null };
  plan: RunPlan;
  done: Promise<void>;
}

type Outcome = { status: Exclude<ResearchSessionStatus, "ready" | "running">; event: "research.run.completed" | "research.run.failed" | "research.run.interrupted"; data: EventDataMap["research.run.completed"] | EventDataMap["research.run.failed"] | EventDataMap["research.run.interrupted"]; error: string | null };

const UNGOVERNED: RunPlan = { scope: "LEGACY_ORBIT", binding: null, env: {}, webTools: false, execute: false, note: null, governed: false, isolation: "not_applicable" };

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const numberOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// What a research run must never have: a tool, an MCP server.
export function forbiddenInit(line: Json): string | null {
  const tools = Array.isArray(line.tools) ? line.tools.filter((t) => typeof t === "string") : [];
  const servers = Array.isArray(line.mcp_servers) ? line.mcp_servers : [];
  if (tools.length > 0) return `The Claude CLI started with tools (${tools.slice(0, 5).join(", ")}) -- a research run has none, so it was stopped.`;
  if (servers.length > 0) return "The Claude CLI started with an MCP server -- a research run has none, so it was stopped.";
  return null;
}

@Injectable()
export class ResearchRunnerService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger("ResearchRunner");
  private readonly active = new Map<string, ActiveRun>();
  private readonly starting = new Set<string>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(ResearchSessionStore) private readonly sessions: ResearchSessionStore,
    @Inject(ResearchRunStore) private readonly runs: ResearchRunStore,
    @Inject(SourceStore) private readonly sources: SourceStore,
    @Inject(EvidenceStore) private readonly evidence: EvidenceStore,
    @Inject(ResearchStream) private readonly stream: ResearchStream,
    @Inject(ResearchViews) private readonly views: ResearchViews,
    @Inject(RETRIEVER) private readonly retriever: Retriever,
    @Inject(ClaudeModelsService) private readonly models: ClaudeModelsService,
    @Inject(RunGovernanceService) private readonly governance: RunGovernanceService,
  ) {}

  // After a restart nothing is running: a run the restart cut short is interrupted, never run again.
  onModuleInit(): void {
    for (const run of this.runs.running()) this.runs.finish(run.id, "interrupted", { answerId: null, exitCode: null, signal: null, costUsd: null, inputTokens: null, outputTokens: null, error: "Orbit Web restarted while this run was answering." });
    for (const s of this.sessions.withStatus("running")) {
      this.stream.publish(s.id, "research.run.interrupted", { reason: "server_restart" });
      this.setStatus(s.id, "interrupted", "Orbit Web restarted while this run was answering.", null);
    }
  }

  isRunning(sessionId: string): boolean {
    return this.active.has(sessionId) || this.starting.has(sessionId);
  }

  anyRunning(): number {
    return this.active.size + this.starting.size;
  }

  // The sources and revisions a question would be answered from now: the selected sources that have an indexed revision.
  freeze(session: ResearchSessionRecord): FrozenRevision[] {
    return this.sessions.selection(session.id).flatMap((id) => {
      const s = this.sources.get(id);
      return s !== null && s.workspaceId === session.workspaceId && s.currentRevisionId !== null ? [{ sourceId: s.id, revisionId: s.currentRevisionId, title: s.title }] : [];
    });
  }

  ask(session: ResearchSessionRecord, question: string): RunAccepted {
    if (this.isRunning(session.id) || session.status === "running") throw conflict("run_active", "This research session is still answering. Stop it or wait for it to finish.");
    const frozen = this.freeze(session);
    if (frozen.length === 0) throw conflict("no_ready_sources", "None of this session's selected sources is ready to search: add a source, or select one that is ready.");
    const runId = randomUUID();
    const questionId = randomUUID();
    const history: PromptTurn[] = this.sessions.messages(session.id).map((m) => ({ role: m.role, text: m.text }));
    this.sessions.addMessage({ id: questionId, sessionId: session.id, runId, role: "user", text: question, partial: false });
    this.stream.publish(session.id, "research.message.completed", { messageId: questionId, role: "user", text: question, partial: false, truncated: false }, runId);
    const passages = this.retriever.retrieve({ revisionIds: frozen.map((f) => f.revisionId), question, budgetChars: this.config.research.contextChars });
    this.runs.start(
      { id: runId, sessionId: session.id, workspaceId: session.workspaceId, model: session.model, effort: session.effort, questionId },
      frozen,
      passages.map((p) => ({ label: p.label, chunkId: p.chunk.id, sourceId: p.chunk.sourceId, revisionId: p.chunk.revisionId, rank: p.rank, score: p.score, match: p.match })),
    );
    if (session.draftQuestion !== null) this.sessions.update(session.id, { draftQuestion: null });
    this.setStatus(session.id, "running", null, runId);
    const effort = this.effortOf(session);
    this.stream.publish(session.id, "research.run.started", { model: session.model, effort, sources: frozen, passages: passages.length, matched: passages.filter((p) => p.match === "fts").length }, runId);
    const prompt = researchPrompt({ question, history, passages: passages.map((p) => this.promptPassage(p, frozen)), nonce: newNonce() });
    if (this.config.governance.deployment !== "governed") this.start(session, prompt, runId, UNGOVERNED, effort);
    else {
      this.starting.add(session.id);
      void this.governed(session, prompt, runId, effort);
    }
    return { sessionId: session.id, runId };
  }

  stop(sessionId: string, by: "user_stop" | "server_restart" = "user_stop"): void {
    const run = this.active.get(sessionId);
    if (!run) throw conflict("not_running", "Nothing is running in this research session.");
    if (run.stoppedBy !== null) return;
    run.stoppedBy = by;
    run.handle.kill("SIGINT");
    const grace = this.config.limits.stopGraceMs;
    run.timers.push(setTimeout(() => run.handle.kill("SIGTERM"), grace), setTimeout(() => run.handle.kill("SIGKILL"), grace * 2));
  }

  async settled(sessionId: string): Promise<void> {
    await this.active.get(sessionId)?.done;
  }

  async beforeApplicationShutdown(): Promise<void> {
    const runs = [...this.active.values()];
    for (const run of runs) this.stop(run.session.id, "server_restart");
    await Promise.race([Promise.all(runs.map((r) => r.done)), new Promise((r) => setTimeout(r, this.config.limits.stopGraceMs).unref())]);
    for (const run of runs.filter((r) => this.active.has(r.session.id))) this.finalize(run, { code: null, signal: "SIGKILL", spawnError: null });
  }

  // The effort the account's catalog says this model takes (none, for a model that takes no level).
  private effortOf(session: ResearchSessionRecord): string | null {
    const catalog = this.models.cached();
    return effortFor(catalog === null ? null : modelOf(catalog, session.model), session.effort);
  }

  private promptPassage(p: RetrievedPassage, frozen: readonly FrozenRevision[]) {
    return {
      label: p.label,
      title: frozen.find((f) => f.revisionId === p.chunk.revisionId)?.title ?? "Untitled",
      revisionNumber: this.sources.revision(p.chunk.revisionId)?.number ?? null,
      page: p.chunk.page,
      section: p.chunk.section,
      match: p.match,
      text: p.chunk.text,
    };
  }

  private async governed(session: ResearchSessionRecord, prompt: string, runId: string, effort: string | null): Promise<void> {
    try {
      this.start(session, prompt, runId, await this.governance.prepareResearch(session.id, runId), effort);
    } catch (err) {
      const message = `Governance could not decide this run, so it did not start: ${err instanceof Error ? err.message : String(err)}`;
      this.runs.finish(runId, "failed", { answerId: null, exitCode: null, signal: null, costUsd: null, inputTokens: null, outputTokens: null, error: message });
      this.stream.publish(session.id, "research.run.failed", { reason: "governance", message, costUsd: null, turns: null, durationMs: null }, runId);
      this.setStatus(session.id, "failed", message.slice(0, 300), runId);
    } finally {
      this.starting.delete(session.id);
    }
  }

  private start(session: ResearchSessionRecord, prompt: string, runId: string, plan: RunPlan, effort: string | null): void {
    const args = researchArgs({ model: session.model, effort, maxBudgetUsd: this.config.maxBudgetUsd });
    // The agent's HOME: a directory that exists wherever Claude Code runs. With no tool, nothing in it is read.
    const cwd = this.config.data.home;
    const handle = this.process.spawn(this.config.binaries.claude, args, { cwd, env: { ...claudeEnv(this.config), ENABLE_CLAUDEAI_MCP_SERVERS: "false", ...plan.env } });
    let resolveDone: () => void = () => undefined;
    const run: ActiveRun = {
      runId,
      session,
      handle,
      mapper: new StreamMapper({ requestedModel: session.model, requestedEffort: session.effort, requestedMode: "plan", resumed: false, cwd }),
      splitter: new LineSplitter((line) => this.onLine(run, line)),
      stoppedBy: null,
      refused: null,
      stderr: "",
      timers: [],
      answerId: randomUUID(),
      answer: "",
      answering: false,
      segments: new Map(),
      usage: { input: null, output: null },
      plan,
      done: new Promise<void>((r) => (resolveDone = r)),
    };
    this.active.set(session.id, run);
    handle.onStdout((chunk) => run.splitter.push(chunk));
    handle.onStderr((chunk) => (run.stderr = (run.stderr + chunk).slice(-STDERR_LIMIT)));
    handle.onExit((exit) => {
      this.finalize(run, exit);
      resolveDone();
    });
    handle.write(prompt);
    handle.closeInput();
  }

  private onLine(run: ActiveRun, line: string): void {
    if (line.trim().length === 0) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    if (!isRecord(parsed)) return;
    if (parsed.type === "system" && parsed.subtype === "init") {
      const forbidden = forbiddenInit(parsed);
      if (forbidden !== null) return this.refuse(run, forbidden);
    }
    if (parsed.type === "result" && isRecord(parsed.usage)) {
      const u = parsed.usage;
      run.usage = { input: [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].map(numberOr).reduce<number | null>((sum, n) => (n === null ? sum : (sum ?? 0) + n), null), output: numberOr(u.output_tokens) };
    }
    for (const e of run.mapper.push(parsed)) this.onMapped(run, e);
  }

  // The coding runner's events, read as research's: one answer, made of the text segments Claude Code writes.
  private onMapped(run: ActiveRun, e: MappedEvent): void {
    if (run.refused !== null) return;
    if (e.type === "tool.started" || e.type === "plan.proposed" || e.type === "permission.denied") return this.refuse(run, "The Claude CLI tried to use a tool -- a research run has none, so it was stopped.");
    if (e.type === "message.started" && e.data.role === "assistant" && e.data.parentToolUseId === null) return this.segment(run, e.data.messageId);
    if (e.type === "message.delta") return this.delta(run, e.data.messageId, e.data.offset, e.data.text);
    if (e.type === "message.completed" && e.data.role === "assistant" && e.data.parentToolUseId === null) return this.completed(run, e.data.messageId, e.data.text);
    if (e.type === "run.notice") this.stream.publish(run.session.id, "research.run.notice", { kind: e.data.kind === "rate_limit" ? "rate_limit" : "info", message: e.data.message }, run.runId);
  }

  private segment(run: ActiveRun, segmentId: string): void {
    if (!run.answering) {
      run.answering = true;
      this.stream.publish(run.session.id, "research.message.started", { messageId: run.answerId, role: "assistant" }, run.runId);
    } else if (run.answer.length > 0) this.appendAnswer(run, "\n\n");
    run.segments.set(segmentId, run.answer.length);
  }

  private delta(run: ActiveRun, segmentId: string, offset: number, text: string): void {
    const base = run.segments.get(segmentId);
    if (base === undefined || base + offset !== run.answer.length) return;
    this.appendAnswer(run, text);
  }

  private appendAnswer(run: ActiveRun, text: string): void {
    if (run.answer.length + text.length > TEXT_LIMIT) return;
    const offset = run.answer.length;
    run.answer += text;
    this.stream.publish(run.session.id, "research.message.delta", { messageId: run.answerId, offset, text }, run.runId);
  }

  // A segment's whole text, as the CLI completed it: it replaces what its deltas said.
  private completed(run: ActiveRun, segmentId: string, text: string): void {
    if (!run.segments.has(segmentId)) this.segment(run, segmentId);
    run.answer = run.answer.slice(0, run.segments.get(segmentId)) + text;
  }

  private refuse(run: ActiveRun, reason: string): void {
    if (run.refused !== null) return;
    run.refused = reason;
    this.logger.warn(`research run ${run.runId} stopped: ${reason}`);
    run.handle.kill("SIGKILL");
  }

  private outcomeOf(run: ActiveRun, exit: ExitInfo): Outcome {
    const tokens = { inputTokens: run.usage.input, outputTokens: run.usage.output };
    if (run.refused !== null) return { status: "failed", event: "research.run.failed", data: { reason: "tool_use_refused", message: run.refused, costUsd: null, turns: null, durationMs: null }, error: run.refused };
    const o = decideOutcome({ stoppedBy: run.stoppedBy, exit, result: run.mapper.result, stderrTail: tail(run.stderr, 6) });
    if (o.type === "session.completed") return { status: "completed", event: "research.run.completed", data: { costUsd: o.data.costUsd, turns: o.data.turns, durationMs: o.data.durationMs, ...tokens }, error: null };
    if (o.type === "session.interrupted") return { status: "interrupted", event: "research.run.interrupted", data: { reason: o.data.reason }, error: null };
    const reason = o.data.reason === "governance" ? "governance" : o.data.reason;
    return { status: "failed", event: "research.run.failed", data: { reason, message: o.data.message, costUsd: o.data.costUsd, turns: o.data.turns, durationMs: o.data.durationMs }, error: o.data.message.slice(0, 2_000) };
  }

  private finalize(run: ActiveRun, exit: ExitInfo): void {
    if (this.active.get(run.session.id) !== run) return;
    for (const t of run.timers) clearTimeout(t);
    run.splitter.end();
    for (const e of run.mapper.finish()) this.onMapped(run, e);
    const outcome = this.outcomeOf(run, exit);
    const answered = run.answer.trim().length > 0 ? this.keepAnswer(run, outcome.status !== "completed") : null;
    this.runs.finish(run.runId, outcome.status, { answerId: answered, exitCode: exit.code, signal: exit.signal, costUsd: (outcome.data as { costUsd?: number | null }).costUsd ?? null, inputTokens: run.usage.input, outputTokens: run.usage.output, error: outcome.error });
    this.stream.publish(run.session.id, outcome.event, outcome.data as never, run.runId);
    const reason = outcome.event === "research.run.failed" ? (outcome.data as { message: string }).message.slice(0, 300) : outcome.event === "research.run.interrupted" ? (outcome.data as { reason: string }).reason : null;
    this.setStatus(run.session.id, outcome.status, reason, run.runId);
    this.active.delete(run.session.id);
    try {
      this.governance.finished(run.plan, run.runId, outcome.status, exit.code);
    } catch (err) {
      this.logger.error(`the end of research run ${run.runId} could not be recorded: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // The answer, kept with only the citations its run's passages verify.
  private keepAnswer(run: ActiveRun, partial: boolean): string {
    const passages = this.runs.passages(run.runId);
    const verified = verifyLabels(run.answer, new Set(passages.map((p) => p.label)));
    const text = bounded(verified.text, TEXT_LIMIT);
    this.sessions.addMessage({ id: run.answerId, sessionId: run.session.id, runId: run.runId, role: "assistant", text: text.text, partial });
    if (!run.answering) this.stream.publish(run.session.id, "research.message.started", { messageId: run.answerId, role: "assistant" }, run.runId);
    this.stream.publish(run.session.id, "research.message.completed", { messageId: run.answerId, role: "assistant", text: text.text, partial, truncated: text.truncated }, run.runId);
    const frozen = this.runs.frozen(run.runId);
    const citations: Omit<CitationRecord, "createdAt">[] = verified.used.flatMap((label) => {
      const passage = passages.find((p) => p.label === label);
      const chunk = passage === undefined ? null : this.sources.chunk(passage.chunkId);
      if (passage === undefined || chunk === null) return [];
      return [
        {
          id: randomUUID(),
          workspaceId: run.session.workspaceId,
          sessionId: run.session.id,
          runId: run.runId,
          messageId: run.answerId,
          label,
          sourceId: passage.sourceId,
          revisionId: passage.revisionId,
          revisionNumber: this.sources.revision(passage.revisionId)?.number ?? null,
          chunkOrdinal: chunk.ordinal,
          page: chunk.page,
          section: chunk.section,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          sourceTitle: frozen.find((f) => f.revisionId === passage.revisionId)?.title ?? "Untitled",
          // A citation's copy of its passage is masked by token shape, as everything else Orbit Web shows is.
          quote: redactSecrets(chunk.text).slice(0, QUOTE_LIMIT),
          match: passage.match,
          rank: passage.rank,
          score: passage.score,
        },
      ];
    });
    this.evidence.addCitations(citations);
    this.stream.publish(run.session.id, "research.citation.recorded", { messageId: run.answerId, citationIds: citations.map((c) => c.id), labels: citations.map((c) => c.label), rejected: verified.rejected }, run.runId);
    return run.answerId;
  }

  private setStatus(sessionId: string, status: ResearchSessionStatus, reason: string | null, runId: string | null): void {
    this.sessions.update(sessionId, { status, statusReason: reason });
    this.stream.publish(sessionId, "research.status", { status, reason }, runId);
    this.views.notifySession(sessionId);
  }
}
