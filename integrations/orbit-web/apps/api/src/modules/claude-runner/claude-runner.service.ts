// THE CLAUDE RUNNER: runs the official Claude Code CLI, headless, with the Orbit plugin (and the chat's project
// plugins), in a session's workspace, with the model, effort and mode the session prefers. One run per session at a
// time. The prompt goes in on stdin; the stream-json lines come out through the mapper as session events on the bus
// (what keeps the transcript, refreshes Orbit or feeds a browser SUBSCRIBES -- the runner only publishes, one event after
// another, in the order the mapper made them); the outcome is decided from the exit status and the CLI's own result
// line; a stop signals the process group (SIGINT, then SIGTERM, then SIGKILL). A restart of Orbit Web leaves no run
// "running": the ones it cut short are recorded as interrupted, and nothing is started again without a person sending a
// message.
//
// GOVERNANCE (modules/governance/run-governance.service.ts) decides EVERY run before it starts, under the policy of the
// account that owns the chat: it may refuse the run (recorded, and said in the chat), and otherwise binds it (a token for
// the gateway, and in the governed deployment the proxy) and says what the policy lets the runtime do -- the web tools,
// commands, which of the connectors its owner checked for chats. Nothing starts undecided.
import { type BeforeApplicationShutdown, Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ACCEPTS_MESSAGES, effortFor, modelOf, type AnySessionEvent, type ImageRef, type RunAccepted, type SessionStatus } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { conflict, notFound } from "../../common/errors.js";
import { Db } from "../../infra/db/db.js";
import { claudeEnv } from "../../infra/process/env.js";
import { LineSplitter } from "../../infra/process/lines.js";
import type { ExitInfo, ProcessHandle, ProcessPort } from "../../infra/process/process.port.js";
import { redactSecrets, tail } from "../../infra/security/redact.js";
import { ImageFiles } from "../../infra/storage/image-files.js";
import { ImageStore, RunStore, SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import type { Principal } from "../auth/principal.js";
import { ClaudeConnectorsService, type RunConnectors } from "../claude-auth/claude-connectors.service.js";
import { ClaudeModelsService } from "../claude-auth/claude-models.service.js";
import { RunGovernanceService, type RunPlan } from "../governance/run-governance.service.js";
import { ProjectService } from "../project/project.service.js";
import { AutoModeService } from "./auto-mode.js";
import { SettingsService } from "../settings/settings.module.js";
import { claudeArgs } from "./claude-args.js";
import { decideOutcome, lostConversation } from "./outcome.js";
import { StreamMapper, type MappedEvent } from "./stream-mapper.js";
import { Transcript } from "./transcript.js";

const STDERR_LIMIT = 16 * 1024;
const RUN_LOG_LIMIT = 20 * 1024 * 1024;

interface ActiveRun {
  runId: string;
  session: SessionRecord;
  handle: ProcessHandle;
  mapper: StreamMapper;
  splitter: LineSplitter;
  stoppedBy: "user_stop" | "server_restart" | null;
  stderr: string;
  timers: NodeJS.Timeout[];
  log: WriteStream | null;
  logBytes: number;
  done: Promise<void>;
  plan: RunPlan;
  // The run's publications, one after another: each waits for the one before it.
  queue: Promise<void>;
  // Set once the run's end is being recorded: it is recorded once, whoever notices first.
  ending: Promise<void> | null;
}

// What Claude Code is given on stdin: a prompt's own text, or one stream-json user message (a message with images).
interface RunInput {
  streamJson: boolean;
  data: string;
}

@Injectable()
export class ClaudeRunnerService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger("ClaudeRunner");
  private readonly active = new Map<string, ActiveRun>();
  // Sessions whose workspace is changing (holding): no run starts in them until it is done.
  private readonly held = new Set<string>();
  // Sessions whose run is being decided by governance: it counts as running.
  private readonly starting = new Set<string>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(AGENT_PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(Db) private readonly db: Db,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(RunStore) private readonly runs: RunStore,
    @Inject(EventBus) private readonly bus: EventBus,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(ProjectService) private readonly project: ProjectService,
    @Inject(AutoModeService) private readonly autoMode: AutoModeService,
    @Inject(RunGovernanceService) private readonly governance: RunGovernanceService,
    @Inject(ClaudeModelsService) private readonly models: ClaudeModelsService,
    @Inject(ImageStore) private readonly images: ImageStore,
    @Inject(ImageFiles) private readonly imageFiles: ImageFiles,
    @Inject(ClaudeConnectorsService) private readonly connectors: ClaudeConnectorsService,
    @Inject(Transcript) private readonly transcript: Transcript,
  ) {}

  // After a restart nothing is running: a run the restart cut short is recorded as interrupted, never resumed.
  async onModuleInit(): Promise<void> {
    for (const run of await this.runs.running()) await this.runs.finish(run.id, "interrupted", { exitCode: null, signal: null, costUsd: null });
    for (const s of await this.sessions.withStatus("running")) {
      await this.db.tx(async () => {
        await this.bus.publishSession(s.id, "session.interrupted", { reason: "server_restart", exitCode: null, signal: null });
        await this.setStatus(s.id, "interrupted", "Orbit Web restarted while this run was active.", null);
      });
    }
  }

  isRunning(sessionId: string): boolean {
    return this.active.has(sessionId) || this.starting.has(sessionId);
  }

  // A run, or a change of the workspace under way (its working branch moving).
  isBusy(sessionId: string): boolean {
    return this.isRunning(sessionId) || this.held.has(sessionId);
  }

  // Runs `work` while no run may start in this session -- refused while one runs or another change is under way.
  async holding<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    if (this.isRunning(sessionId)) throw conflict("run_active", "Claude is still working on this session. Stop it or wait for it to finish.");
    if (this.held.has(sessionId)) throw conflict("workspace_busy", "The working branch is already changing.");
    this.held.add(sessionId);
    try {
      return await work();
    } finally {
      this.held.delete(sessionId);
    }
  }

  // A person's message: stored, shown, and handed to Claude Code as the next turn of this session -- its words, and the
  // images it carries (already claimed for this chat: ImagesService). `startedBy` is the owner whose browser sent it:
  // what the run's records name as its cause.
  async send(sessionId: string, text: string, images: readonly ImageRef[], startedBy: Principal): Promise<RunAccepted> {
    const session = await this.sessions.get(sessionId);
    if (!session) throw notFound("Session");
    if (this.isRunning(sessionId) || session.status === "running") throw conflict("run_active", "Claude is still working on this session. Stop it or wait for it to finish.");
    if (this.held.has(sessionId)) throw conflict("workspace_busy", "The working branch is changing; send your message once it has.");
    if (session.status === "preparing") throw conflict("workspace_not_ready", "The workspace is still being prepared.");
    if (!ACCEPTS_MESSAGES.includes(session.status)) throw conflict("workspace_failed", "This session's workspace could not be prepared; start a new chat.");
    const input = this.inputOf(text, images);
    const runId = randomUUID();
    const messageId = randomUUID();
    // From here the session counts as running: a second message waits for this one.
    this.starting.add(sessionId);
    try {
      await this.db.tx(async () => {
        if (images.length > 0) await this.images.attach(images.map((i) => i.id), sessionId, messageId);
        const event = await this.bus.publishSession(sessionId, "message.completed", { messageId, role: "user", text, parentToolUseId: null, partial: false, truncated: false, ...(images.length > 0 ? { images: [...images] } : {}) }, runId);
        await this.transcript.keep(event);
      });
    } catch (err) {
      this.starting.delete(sessionId);
      throw err;
    }
    void this.governed(session, input, runId, startedBy);
    return { sessionId, runId };
  }

  // The words as the prompt -- or, with images, one stream-json user message holding the words and each image as
  // base64, which is how the CLI takes an image headless. Read now and whole; an image gone refuses the message.
  private inputOf(text: string, images: readonly ImageRef[]): RunInput {
    if (images.length === 0) return { streamJson: false, data: text };
    const bytes = images.map((i) => this.readImage(i.id));
    const content = [
      ...(text.trim().length > 0 ? [{ type: "text", text }] : []),
      ...images.map((i, n) => ({ type: "image", source: { type: "base64", media_type: i.mediaType, data: (bytes[n] as Buffer).toString("base64") } })),
    ];
    return { streamJson: true, data: `${JSON.stringify({ type: "user", message: { role: "user", content } })}
` };
  }

  private readImage(id: string): Buffer {
    try {
      return this.imageFiles.read(id);
    } catch {
      throw conflict("image_missing", "An image of this message is no longer kept here: paste it again.");
    }
  }

  // Decided first (and recorded), started only if allowed. Anything that keeps governance from deciding refuses the run
  // -- it never starts undecided.
  private async governed(session: SessionRecord, input: RunInput, runId: string, startedBy: Principal): Promise<void> {
    try {
      const connectors = await this.connectors.forRun(session.accountId);
      const prepared = await this.governance.prepare(session, runId, { mode: session.mode, startedBy, connectors: connectors.chat });
      if (!prepared.ok) return await this.refuse(session, runId, prepared.message);
      await this.start((await this.sessions.get(session.id)) ?? session, input, runId, prepared.plan, connectors);
    } catch (err) {
      await this.refuse(session, runId, `Governance could not decide this run, so it did not start: ${err instanceof Error ? err.message : String(err)}`).catch((e: unknown) =>
        this.logger.error(`run ${runId} could not be refused: ${e instanceof Error ? e.message : String(e)}`),
      );
    } finally {
      this.starting.delete(session.id);
    }
  }

  private async refuse(session: SessionRecord, runId: string, message: string): Promise<void> {
    await this.db.tx(async () => {
      await this.bus.publishSession(session.id, "session.failed", { reason: "governance", subtype: null, message, exitCode: null, signal: null, permissionDenials: 0, costUsd: null, turns: null, durationMs: null }, runId);
      await this.setStatus(session.id, "failed", message.slice(0, 300), runId);
    });
  }

  stop(sessionId: string, by: "user_stop" | "server_restart" = "user_stop"): void {
    const run = this.active.get(sessionId);
    if (!run) throw conflict("not_running", "Nothing is running in this session.");
    if (run.stoppedBy !== null) return;
    run.stoppedBy = by;
    run.handle.kill("SIGINT");
    const grace = this.config.limits.stopGraceMs;
    run.timers.push(setTimeout(() => run.handle.kill("SIGTERM"), grace), setTimeout(() => run.handle.kill("SIGKILL"), grace * 2));
  }

  // Waits for a run to end (tests and shutdown).
  async settled(sessionId: string): Promise<void> {
    await this.active.get(sessionId)?.done;
  }

  async beforeApplicationShutdown(): Promise<void> {
    const runs = [...this.active.values()];
    for (const run of runs) this.stop(run.session.id, "server_restart");
    await Promise.race([Promise.all(runs.map((r) => r.done)), new Promise((r) => setTimeout(r, this.config.limits.stopGraceMs).unref())]);
    for (const run of runs.filter((r) => this.active.has(r.session.id))) await this.finalize(run, { code: null, signal: "SIGKILL", spawnError: null });
  }

  private async start(session: SessionRecord, input: RunInput, runId: string, plan: RunPlan, connectors: RunConnectors): Promise<void> {
    const resume = session.turns > 0;
    // The chat's own account's preferences: whose switches hand Claude Code a sign-in.
    const prefs = await this.settings.get(session.accountId);
    // An isolated run (the governed deployment) holds no CLI's sign-in whatever a switch says.
    const credentials = !plan.isolated;
    const azure = credentials && prefs.azureForClaude;
    // GitHub's sign-in only ever reaches a chat whose repository came from GitHub.
    const github = credentials && prefs.githubForClaude && session.source === "github";
    const project = await this.project.runtime(session);
    // The effort the account's catalog says this model takes (none, for a model that takes no level).
    const catalog = this.models.cached(session.accountId);
    // The connectors the policy allowed this run, of those its owner checked for chats; every other one the account has
    // is denied by name. An isolated run reaches none at all (--strict-mcp-config).
    const allowed = new Set(plan.connectors.map((c) => c.name));
    const deniedConnectors = plan.isolated ? [] : connectors.known.filter((c) => !allowed.has(c.name)).map((c) => c.prefix);
    const args = claudeArgs({
      model: session.model,
      effort: effortFor(catalog === null ? null : modelOf(catalog, session.model), session.effort),
      mode: session.mode,
      pluginDirs: [this.config.pluginDir, ...project.pluginDirs],
      enabledPlugins: project.enabledPlugins,
      autoModeEnvironment: this.autoMode.current(plan.isolated),
      sessionId: session.claudeSessionId,
      resume,
      webTools: prefs.webTools && plan.webTools,
      execute: plan.execute,
      governanceNote: plan.note,
      isolated: plan.isolated,
      streamInput: input.streamJson,
      deniedConnectors,
      azure,
      github,
      maxBudgetUsd: this.config.maxBudgetUsd,
      // The control plane's own rooms too. In the single deployment these rules are defence in depth only -- the agent
      // shares this container's user with them (README, "The limit, said plainly").
      protectedDirs: [this.config.data.claude, this.config.data.github, this.config.data.app, this.config.data.control, ...(azure ? [] : [this.config.data.azure])],
    });
    await this.runs.start({ id: runId, sessionId: session.id, model: session.model, effort: session.effort, mode: session.mode, resumed: resume });
    await this.setStatus(session.id, "running", null, runId);
    const handle = this.process.spawn(this.config.binaries.claude, args, { cwd: session.workspacePath, env: { ...claudeEnv(this.config, { azure, github }), ...plan.env } });
    const mapper = new StreamMapper({ requestedModel: session.model, requestedEffort: session.effort, requestedMode: session.mode, resumed: resume, cwd: session.workspacePath });
    let resolveDone: () => void = () => undefined;
    const run: ActiveRun = {
      runId,
      session,
      handle,
      mapper,
      splitter: new LineSplitter((line) => this.onLine(run, line)),
      stoppedBy: null,
      stderr: "",
      timers: [],
      log: this.openLog(session.id, runId),
      logBytes: 0,
      done: new Promise<void>((r) => (resolveDone = r)),
      plan,
      queue: Promise.resolve(),
      ending: null,
    };
    this.active.set(session.id, run);
    handle.onStdout((chunk) => run.splitter.push(chunk));
    handle.onStderr((chunk) => (run.stderr = (run.stderr + chunk).slice(-STDERR_LIMIT)));
    handle.onExit((exit) => {
      void this.finalize(run, exit).finally(resolveDone);
    });
    handle.write(input.data);
    handle.closeInput();
  }

  private onLine(run: ActiveRun, line: string): void {
    if (line.trim().length === 0) return;
    this.writeLog(run, line);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    for (const e of run.mapper.push(parsed)) this.publish(run, e);
  }

  // Published in its turn: after every event of this run the mapper made before it.
  private publish(run: ActiveRun, e: MappedEvent): void {
    run.queue = run.queue.then(() => this.publishNow(run, e)).catch((err: unknown) => this.logger.error(`an event of run ${run.runId} was not published: ${err instanceof Error ? err.message : String(err)}`));
  }

  // A top-level message is kept in the transcript in the transaction that journals it.
  private async publishNow(run: ActiveRun, e: MappedEvent): Promise<void> {
    if (!Transcript.keeps(e.type, e.data)) {
      await this.bus.publishSession(run.session.id, e.type, e.data as never, run.runId);
      return;
    }
    await this.db.tx(async () => {
      const event = await this.bus.publishSession(run.session.id, e.type, e.data as never, run.runId);
      await this.transcript.keep(event as AnySessionEvent);
    });
  }

  private finalize(run: ActiveRun, exit: ExitInfo): Promise<void> {
    run.ending ??= this.recordEnd(run, exit).catch((err: unknown) => this.logger.error(`the end of run ${run.runId} could not be recorded: ${err instanceof Error ? err.message : String(err)}`));
    return run.ending;
  }

  private async recordEnd(run: ActiveRun, exit: ExitInfo): Promise<void> {
    if (this.active.get(run.session.id) !== run) return;
    for (const t of run.timers) clearTimeout(t);
    run.splitter.end();
    for (const e of run.mapper.finish()) this.publish(run, e);
    // Every event of the stream is published before the outcome is.
    await run.queue;
    try {
      const outcome = decideOutcome({ stoppedBy: run.stoppedBy, exit, result: run.mapper.result, stderrTail: tail(run.stderr, 6) });
      await this.bus.publishSession(run.session.id, outcome.type, outcome.data as never, run.runId);
      await this.runs.finish(run.runId, outcome.status, { exitCode: exit.code, signal: exit.signal, costUsd: run.mapper.result?.costUsd ?? null });
      await this.recordTurn(run, outcome.type === "session.failed" ? outcome.data.message : "");
      const reason = outcome.type === "session.failed" ? outcome.data.message.slice(0, 300) : outcome.type === "session.interrupted" ? outcome.data.reason : null;
      await this.setStatus(run.session.id, outcome.status, reason, run.runId);
      try {
        await this.governance.finished(run.plan, run.runId, outcome.status, exit.code);
      } catch (err) {
        this.logger.error(`the end of governed run ${run.runId} could not be recorded: ${err instanceof Error ? err.message : String(err)}`);
      }
    } finally {
      run.log?.end();
      this.active.delete(run.session.id);
    }
  }

  // A run that reached the CLI's init line is a turn of the Claude session; the next one resumes it.
  private async recordTurn(run: ActiveRun, failure: string): Promise<void> {
    const init = run.mapper.init;
    const current = await this.sessions.get(run.session.id);
    if (!current) return;
    if (lostConversation(failure) || lostConversation(run.stderr)) {
      await this.sessions.update(current.id, { claudeSessionId: randomUUID(), turns: 0 });
      await this.bus.publishSession(current.id, "run.notice", { kind: "info", message: "Claude Code could not find the earlier conversation to resume, so the next message starts a new Claude conversation in the same workspace." }, run.runId);
      return;
    }
    if (init === null) return;
    await this.sessions.update(current.id, { turns: current.turns + 1, ...(init.sessionId ? { claudeSessionId: init.sessionId } : {}) });
  }

  // Kept and told together: the status is journaled in the transaction that records it.
  private async setStatus(sessionId: string, status: SessionStatus, reason: string | null, runId: string | null): Promise<void> {
    await this.db.tx(async () => {
      await this.sessions.update(sessionId, { status, statusReason: reason });
      await this.bus.publishSession(sessionId, "session.status", { status, reason }, runId);
    });
  }

  // A diagnostic copy of the run's stream, masked and bounded, under /data/sessions/<session>/runs/.
  private openLog(sessionId: string, runId: string): WriteStream | null {
    try {
      // Governed: in the control plane's own room -- never appended to through a directory the agent can write.
      const dir = this.config.governance.deployment === "governed" ? join(this.config.data.app, "run-logs", sessionId) : join(this.config.data.sessions, sessionId, "runs");
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      return createWriteStream(join(dir, `${runId}.jsonl`), { flags: "a", mode: 0o600 });
    } catch (err) {
      this.logger.warn(`no run log for ${sessionId}: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }

  private writeLog(run: ActiveRun, line: string): void {
    if (run.log === null || run.logBytes > RUN_LOG_LIMIT) return;
    const masked = `${redactSecrets(line)}\n`;
    run.logBytes += masked.length;
    run.log.write(masked);
  }
}
