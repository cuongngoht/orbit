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
// GOVERNANCE holds every research run, in every deployment (run-governance.service.ts): before it starts, the account's
// policy decides it and each connector the account's owner checked for research -- a run the policy refuses never starts,
// and the connectors it may use are those the policy allowed, every other one denied by name. It is bound to the account,
// the research workspace and the session, recorded as it starts and as it ends. In the governed deployment its only way
// out is the egress proxy, and each of its connections is decided as this run.
//
// A run works outside the request that asked for it: it acts for the account its session belongs to, never for whoever
// signs in later.
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
import { ClaudeConnectorsService } from "../../connections/claude-connectors.service.js";
import { ClaudeModelsService } from "../../connections/claude-models.service.js";
import { RunConnections, type RunConnection } from "../../connections/run-connections.js";
import { decideOutcome } from "../../claude-runner/outcome.js";
import { StreamMapper, TEXT_LIMIT, type MappedEvent } from "../../claude-runner/stream-mapper.js";
import type { Principal } from "../../auth/principal.js";
import { RunGovernanceService, type RunPlan } from "../../governance/run-governance.service.js";
import { RETRIEVER, type RetrievedPassage, type Retriever } from "../retrieval/retriever.js";
import { EvidenceStore, type CitationRecord } from "../store/evidence.js";
import { ResearchRunStore, ResearchSessionStore, type FrozenRevision, type ResearchSessionRecord } from "../store/sessions.js";
import { SourceStore, type RevisionRecord } from "../store/sources.js";
import { ResearchStream } from "../stream.js";
import { ResearchViews } from "../views.js";
import { verifyLabels } from "./citations.js";
import { newNonce, researchPrompt, type PromptTurn } from "./prompt.js";
import { researchArgs, type ResearchConnector } from "./research-args.js";

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
  // The connectors this run may use (checked for research AND allowed by the account's policy), and those it said it used.
  connectors: ResearchConnector[];
  used: Set<string>;
  // Set as its end is being written: it is written once, whoever notices the end first.
  finalizing: boolean;
  done: Promise<void>;
}

type Outcome = { status: Exclude<ResearchSessionStatus, "ready" | "running">; event: "research.run.completed" | "research.run.failed" | "research.run.interrupted"; data: EventDataMap["research.run.completed"] | EventDataMap["research.run.failed"] | EventDataMap["research.run.interrupted"]; error: string | null };

// The names of the connectors the account's policy allowed this run.
const allowedNamesOf = (plan: RunPlan): Set<string> => new Set(plan.connectors.map((c) => c.name));

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const numberOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

// What a research run must never have: a built-in tool -- and, unless connectors were checked for research, any MCP
// server or connector tool at all.
export function forbiddenInit(line: Json, withConnectors = false): string | null {
  const tools = Array.isArray(line.tools) ? line.tools.filter((t): t is string => typeof t === "string") : [];
  const servers = Array.isArray(line.mcp_servers) ? line.mcp_servers : [];
  const builtIn = tools.filter((t) => !t.startsWith("mcp__"));
  if (builtIn.length > 0) return `The Claude CLI started with tools (${builtIn.slice(0, 5).join(", ")}) -- a research run has none of its own, so it was stopped.`;
  if (withConnectors) return null;
  if (tools.length > 0) return `The Claude CLI started with tools (${tools.slice(0, 5).join(", ")}) -- a research run with no connector checked has none, so it was stopped.`;
  if (servers.length > 0) return "The Claude CLI started with an MCP server -- a research run with no connector checked has none, so it was stopped.";
  return null;
}

// The connector a tool belongs to, among those a run may use (null: none of them).
export const connectorOfTool = (connectors: readonly ResearchConnector[], tool: string): ResearchConnector | null => connectors.find((c) => tool.startsWith(`${c.prefix}__`)) ?? null;

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
    @Inject(ClaudeConnectorsService) private readonly connectorChoices: ClaudeConnectorsService,
    @Inject(RunConnections) private readonly connections: RunConnections,
  ) {}

  // After a restart nothing is running: a run the restart cut short is interrupted, never run again.
  async onModuleInit(): Promise<void> {
    for (const run of await this.runs.running()) await this.runs.finish(run.id, "interrupted", { answerId: null, exitCode: null, signal: null, costUsd: null, inputTokens: null, outputTokens: null, error: "Orbit Web restarted while this run was answering." });
    for (const s of await this.sessions.withStatus("running")) {
      await this.stream.publish(s.id, "research.run.interrupted", { reason: "server_restart" });
      await this.setStatus(s.id, "interrupted", "Orbit Web restarted while this run was answering.", null);
    }
  }

  isRunning(sessionId: string): boolean {
    return this.active.has(sessionId) || this.starting.has(sessionId);
  }

  anyRunning(): number {
    return this.active.size + this.starting.size;
  }

  // The sources and revisions a question would be answered from now: the selected sources of the session's own workspace
  // that have an indexed revision.
  async freeze(session: ResearchSessionRecord): Promise<FrozenRevision[]> {
    const frozen: FrozenRevision[] = [];
    for (const id of await this.sessions.selection(session.id)) {
      const s = await this.sources.get(id);
      if (s !== null && s.workspaceId === session.workspaceId && s.accountId === session.accountId && s.currentRevisionId !== null) frozen.push({ sourceId: s.id, revisionId: s.currentRevisionId, title: s.title });
    }
    return frozen;
  }

  // A question, asked by `startedBy` (the owner of the browser session that asked): kept, its evidence frozen and
  // retrieved, then the run is decided by the account's policy and started -- in the background, so the answer streams.
  async ask(session: ResearchSessionRecord, question: string, startedBy: Principal): Promise<RunAccepted> {
    if (this.isRunning(session.id) || session.status === "running") throw conflict("run_active", "This research session is still answering. Stop it or wait for it to finish.");
    // Asked of the account's own Claude Code connection, or not at all (409 connection_required / _unavailable).
    await this.connections.require(session.accountId);
    // Held from here: a second question at the same moment finds this one under way.
    this.starting.add(session.id);
    try {
      // The selected sources are references: a question may be asked with none ready (it is answered without them).
      const frozen = await this.freeze(session);
      const runId = randomUUID();
      const questionId = randomUUID();
      const history: PromptTurn[] = (await this.sessions.messages(session.id)).map((m) => ({ role: m.role, text: m.text }));
      await this.sessions.addMessage({ id: questionId, sessionId: session.id, runId, role: "user", text: question, partial: false });
      await this.stream.publish(session.id, "research.message.completed", { messageId: questionId, role: "user", text: question, partial: false, truncated: false }, runId);
      const passages = await this.retriever.retrieve({ accountId: session.accountId, workspaceId: session.workspaceId, revisionIds: frozen.map((f) => f.revisionId), question, budgetChars: this.config.research.contextChars });
      await this.runs.start(
        { id: runId, sessionId: session.id, model: session.model, effort: session.effort, questionId },
        frozen,
        passages.map((p) => ({ label: p.label, chunkId: p.chunk.id, sourceId: p.chunk.sourceId, revisionId: p.chunk.revisionId, rank: p.rank, score: p.score, match: p.match })),
      );
      if (session.draftQuestion !== null) await this.sessions.update(session.id, { draftQuestion: null });
      await this.setStatus(session.id, "running", null, runId);
      const effort = await this.effortOf(session);
      await this.stream.publish(session.id, "research.run.started", { model: session.model, effort, sources: frozen, passages: passages.length, matched: passages.filter((p) => p.match === "fts").length }, runId);
      const revisions = await this.sources.revisionsByIds([...new Set(passages.map((p) => p.chunk.revisionId))]);
      const prompt = researchPrompt({ question, history, passages: passages.map((p) => this.promptPassage(p, frozen, revisions)), nonce: newNonce() });
      void this.governed(session, prompt, runId, effort, startedBy);
      return { sessionId: session.id, runId };
    } catch (err) {
      this.starting.delete(session.id);
      throw err;
    }
  }

  // A Stop that came while the run was still being prepared or decided (the session reads as running from the moment
  // its question is accepted): honoured before anything starts.
  private readonly stopRequested = new Set<string>();

  stop(sessionId: string, by: "user_stop" | "server_restart" = "user_stop"): void {
    const run = this.active.get(sessionId);
    if (!run && this.starting.has(sessionId)) {
      this.stopRequested.add(sessionId);
      return;
    }
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
    await Promise.all(runs.filter((r) => this.active.has(r.session.id)).map((r) => this.finalize(r, { code: null, signal: "SIGKILL", spawnError: null })));
  }

  // The effort the account's catalog says this model takes (none, for a model that takes no level).
  private async effortOf(session: ResearchSessionRecord): Promise<string | null> {
    const catalog = await this.models.catalog(session.accountId);
    return effortFor(modelOf(catalog, session.model), session.effort);
  }

  private promptPassage(p: RetrievedPassage, frozen: readonly FrozenRevision[], revisions: ReadonlyMap<string, RevisionRecord>) {
    return {
      label: p.label,
      title: frozen.find((f) => f.revisionId === p.chunk.revisionId)?.title ?? "Untitled",
      revisionNumber: revisions.get(p.chunk.revisionId)?.number ?? null,
      page: p.chunk.page,
      section: p.chunk.section,
      match: p.match,
      text: p.chunk.text,
    };
  }

  // The account's policy decides the run, and each connector its owner checked for research; a run it refuses -- or one
  // governance could not decide -- never starts.
  private async governed(session: ResearchSessionRecord, prompt: string, runId: string, effort: string | null, startedBy: Principal): Promise<void> {
    try {
      // The account's Claude Code connection, as it is now (it may have been disconnected since the question came).
      const connection = await this.connections.ready(session.accountId);
      if (connection === null) return await this.notStarted(session, runId, "This account's Claude Code connection is not connected, so the question was not asked: check it in Settings → AI Connections.");
      const choices = await this.connectorChoices.forRun(session.accountId, connection.connection.id);
      const prepared = await this.governance.prepareResearch({ accountId: session.accountId, researchWorkspaceId: session.workspaceId, researchSessionId: session.id }, runId, { startedBy, connectors: choices.research });
      if (!prepared.ok) return await this.notStarted(session, runId, prepared.message);
      if (this.stopRequested.has(session.id)) return await this.stoppedBeforeStart(session, runId, prepared.plan);
      const allowed = allowedNamesOf(prepared.plan);
      const connectors = choices.research.filter((c) => allowed.has(c.name));
      const denied = choices.known.filter((c) => !allowed.has(c.name)).map((c) => c.prefix);
      this.start(session, prompt, runId, prepared.plan, effort, connectors, denied, connection);
    } catch (err) {
      await this.notStarted(session, runId, `Governance could not decide this run, so it did not start: ${message(err)}`).catch((e: unknown) => this.logger.error(`research run ${runId} could not be refused cleanly: ${message(e)}`));
    } finally {
      this.starting.delete(session.id);
      this.stopRequested.delete(session.id);
    }
  }

  // Stopped before Claude was started: nothing ran, and the run is interrupted -- never completed, never started later.
  private async stoppedBeforeStart(session: ResearchSessionRecord, runId: string, plan: RunPlan): Promise<void> {
    await this.runs.finish(runId, "interrupted", { answerId: null, exitCode: null, signal: null, costUsd: null, inputTokens: null, outputTokens: null, error: null });
    await this.stream.publish(session.id, "research.run.interrupted", { reason: "user_stop" }, runId);
    await this.setStatus(session.id, "interrupted", "user_stop", runId);
    await this.governance.finished(plan, runId, "interrupted", null);
  }

  private async notStarted(session: ResearchSessionRecord, runId: string, why: string): Promise<void> {
    await this.runs.finish(runId, "failed", { answerId: null, exitCode: null, signal: null, costUsd: null, inputTokens: null, outputTokens: null, error: why });
    await this.stream.publish(session.id, "research.run.failed", { reason: "governance", message: why, costUsd: null, turns: null, durationMs: null }, runId);
    await this.setStatus(session.id, "failed", why.slice(0, 300), runId);
  }

  private start(session: ResearchSessionRecord, prompt: string, runId: string, plan: RunPlan, effort: string | null, connectors: ResearchConnector[], deniedConnectors: string[], connection: RunConnection): void {
    const args = researchArgs({ model: session.model, effort, maxBudgetUsd: this.config.maxBudgetUsd, connectors, deniedConnectors });
    // The agent's HOME: a directory that exists wherever Claude Code runs. With no tool, nothing in it is read.
    const cwd = this.config.data.home;
    const handle = this.process.spawn(this.config.binaries.claude, args, { cwd, env: { ...claudeEnv(this.config, connection.configDir), ...connection.secretEnv, ...(connectors.length === 0 ? { ENABLE_CLAUDEAI_MCP_SERVERS: "false" } : {}), ...plan.env } });
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
      connectors,
      used: new Set<string>(),
      finalizing: false,
      done: new Promise<void>((r) => (resolveDone = r)),
    };
    this.active.set(session.id, run);
    handle.onStdout((chunk) => run.splitter.push(chunk));
    handle.onStderr((chunk) => (run.stderr = (run.stderr + chunk).slice(-STDERR_LIMIT)));
    handle.onExit((exit) => void this.finalize(run, exit).finally(() => resolveDone()));
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
      const forbidden = forbiddenInit(parsed, run.connectors.length > 0);
      if (forbidden !== null) return this.refuse(run, forbidden);
    }
    if (parsed.type === "result" && isRecord(parsed.usage)) {
      const u = parsed.usage;
      run.usage = { input: [u.input_tokens, u.cache_creation_input_tokens, u.cache_read_input_tokens].map(numberOr).reduce<number | null>((sum, n) => (n === null ? sum : (sum ?? 0) + n), null), output: numberOr(u.output_tokens) };
    }
    for (const e of run.mapper.push(parsed)) this.onMapped(run, e);
  }

  // The coding runner's events, read as research's: one answer, made of the text segments Claude Code writes. What is
  // said of them is published in order (the stream's own turn per session), nobody waiting for it here.
  private onMapped(run: ActiveRun, e: MappedEvent): void {
    if (run.refused !== null) return;
    if (e.type === "tool.started") return this.toolStarted(run, e.data.name);
    if (e.type === "plan.proposed") return this.refuse(run, "The Claude CLI tried to use a tool -- a research run has none of its own, so it was stopped.");
    // With connectors, a call the CLI refused was already stopped as it started (toolStarted); without, any denial is one.
    if (e.type === "permission.denied" && run.connectors.length === 0) return this.refuse(run, "The Claude CLI tried to use a tool -- a research run has none, so it was stopped.");
    if (e.type === "message.started" && e.data.role === "assistant" && e.data.parentToolUseId === null) return this.segment(run, e.data.messageId);
    if (e.type === "message.delta") return this.delta(run, e.data.messageId, e.data.offset, e.data.text);
    if (e.type === "message.completed" && e.data.role === "assistant" && e.data.parentToolUseId === null) return this.completed(run, e.data.messageId, e.data.text);
    if (e.type === "run.notice") this.stream.emit(run.session.id, "research.run.notice", { kind: e.data.kind === "rate_limit" ? "rate_limit" : "info", message: e.data.message }, run.runId);
  }

  // A connector checked for research and allowed by the policy: said once, and it goes on. Anything else -- a built-in
  // tool, a connector not checked or not allowed -- stops the run.
  private toolStarted(run: ActiveRun, tool: string): void {
    const connector = connectorOfTool(run.connectors, tool);
    if (connector === null) return this.refuse(run, `The Claude CLI tried to use a tool research may not use (${tool.slice(0, 120)}; Settings → Claude connectors), so the run was stopped.`);
    if (run.used.has(connector.prefix)) return;
    run.used.add(connector.prefix);
    this.stream.emit(run.session.id, "research.run.notice", { kind: "info", message: `Using ${connector.label}…` }, run.runId);
  }

  private segment(run: ActiveRun, segmentId: string): void {
    if (!run.answering) {
      run.answering = true;
      this.stream.emit(run.session.id, "research.message.started", { messageId: run.answerId, role: "assistant" }, run.runId);
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
    this.stream.emit(run.session.id, "research.message.delta", { messageId: run.answerId, offset, text }, run.runId);
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

  // The run ended (however it did): its answer kept with the citations its passages verify, its outcome recorded and
  // said, its end told to governance. Written once; a failure here is logged, never left unhandled.
  private async finalize(run: ActiveRun, exit: ExitInfo): Promise<void> {
    if (this.active.get(run.session.id) !== run || run.finalizing) return;
    run.finalizing = true;
    for (const t of run.timers) clearTimeout(t);
    run.splitter.end();
    for (const e of run.mapper.finish()) this.onMapped(run, e);
    const outcome = this.outcomeOf(run, exit);
    try {
      const answered = run.answer.trim().length > 0 ? await this.keepAnswer(run, outcome.status !== "completed") : null;
      await this.runs.finish(run.runId, outcome.status, { answerId: answered, exitCode: exit.code, signal: exit.signal, costUsd: (outcome.data as { costUsd?: number | null }).costUsd ?? null, inputTokens: run.usage.input, outputTokens: run.usage.output, error: outcome.error });
      await this.stream.publish(run.session.id, outcome.event, outcome.data as never, run.runId);
      const reason = outcome.event === "research.run.failed" ? (outcome.data as { message: string }).message.slice(0, 300) : outcome.event === "research.run.interrupted" ? (outcome.data as { reason: string }).reason : null;
      await this.setStatus(run.session.id, outcome.status, reason, run.runId);
    } catch (err) {
      this.logger.error(`the end of research run ${run.runId} could not be written: ${message(err)}`);
    } finally {
      this.active.delete(run.session.id);
    }
    try {
      await this.governance.finished(run.plan, run.runId, outcome.status, exit.code);
    } catch (err) {
      this.logger.error(`the end of research run ${run.runId} could not be recorded: ${message(err)}`);
    }
  }

  // The answer, kept with only the citations its run's passages verify.
  private async keepAnswer(run: ActiveRun, partial: boolean): Promise<string> {
    const passages = await this.runs.passages(run.runId);
    const verified = verifyLabels(run.answer, new Set(passages.map((p) => p.label)));
    const text = bounded(verified.text, TEXT_LIMIT);
    await this.sessions.addMessage({ id: run.answerId, sessionId: run.session.id, runId: run.runId, role: "assistant", text: text.text, partial });
    if (!run.answering) await this.stream.publish(run.session.id, "research.message.started", { messageId: run.answerId, role: "assistant" }, run.runId);
    await this.stream.publish(run.session.id, "research.message.completed", { messageId: run.answerId, role: "assistant", text: text.text, partial, truncated: text.truncated }, run.runId);
    const frozen = await this.runs.frozen(run.runId);
    const cited = verified.used.flatMap((label) => {
      const passage = passages.find((p) => p.label === label);
      return passage === undefined ? [] : [{ label, passage }];
    });
    const revisions = await this.sources.revisionsByIds([...new Set(cited.map((c) => c.passage.revisionId))]);
    const citations: Omit<CitationRecord, "createdAt">[] = [];
    for (const { label, passage } of cited) {
      const chunk = await this.sources.chunk(passage.chunkId);
      if (chunk === null) continue;
      citations.push({
        id: randomUUID(),
        workspaceId: run.session.workspaceId,
        sessionId: run.session.id,
        runId: run.runId,
        messageId: run.answerId,
        label,
        sourceId: passage.sourceId,
        revisionId: passage.revisionId,
        revisionNumber: revisions.get(passage.revisionId)?.number ?? null,
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
      });
    }
    await this.evidence.addCitations(citations);
    await this.stream.publish(run.session.id, "research.citation.recorded", { messageId: run.answerId, citationIds: citations.map((c) => c.id), labels: citations.map((c) => c.label), rejected: verified.rejected }, run.runId);
    return run.answerId;
  }

  private async setStatus(sessionId: string, status: ResearchSessionStatus, reason: string | null, runId: string | null): Promise<void> {
    await this.sessions.update(sessionId, { status, statusReason: reason });
    await this.stream.publish(sessionId, "research.status", { status, reason }, runId);
    await this.views.notifySession(sessionId);
  }
}
