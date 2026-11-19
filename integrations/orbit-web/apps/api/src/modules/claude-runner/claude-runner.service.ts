// THE CLAUDE RUNNER: runs the official Claude Code CLI, headless, with the Orbit plugin, in a session's workspace.
// One run per session at a time. The prompt goes in on stdin; the stream-json lines come out through the mapper as
// application events; the outcome is decided from the exit status and the CLI's own result line; a stop signals the
// process group (SIGINT, then SIGTERM, then SIGKILL). A restart of Orbit Web leaves no run "running": the ones it cut
// short are recorded as interrupted, and nothing is started again without a person sending a message.
import { type BeforeApplicationShutdown, Inject, Injectable, Logger, type OnModuleInit } from "@nestjs/common";
import { ACCEPTS_MESSAGES, type AnyAppEvent, type RunAccepted, type SessionStatus } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { EventHub } from "../../core/event-hub.js";
import { APP_CONFIG, PROCESS_PORT } from "../../core/tokens.js";
import { conflict, notFound } from "../../common/errors.js";
import { claudeEnv } from "../../infra/process/env.js";
import { LineSplitter } from "../../infra/process/lines.js";
import type { ExitInfo, ProcessHandle, ProcessPort } from "../../infra/process/process.port.js";
import { redactSecrets, tail } from "../../infra/security/redact.js";
import { MessageStore, RunStore, SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import { OrbitService } from "../orbit/orbit.service.js";
import { SettingsService } from "../settings/settings.module.js";
import { claudeArgs } from "./claude-args.js";
import { decideOutcome, lostConversation } from "./outcome.js";
import { StreamMapper, type MappedEvent } from "./stream-mapper.js";

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
}

@Injectable()
export class ClaudeRunnerService implements OnModuleInit, BeforeApplicationShutdown {
  private readonly logger = new Logger("ClaudeRunner");
  private readonly active = new Map<string, ActiveRun>();

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
    @Inject(SessionStore) private readonly sessions: SessionStore,
    @Inject(MessageStore) private readonly messages: MessageStore,
    @Inject(RunStore) private readonly runs: RunStore,
    @Inject(EventHub) private readonly hub: EventHub,
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(OrbitService) private readonly orbit: OrbitService,
  ) {}

  // After a restart nothing is running: a run the restart cut short is recorded as interrupted, never resumed.
  onModuleInit(): void {
    for (const run of this.runs.running()) this.runs.finish(run.id, "interrupted", { exitCode: null, signal: null, costUsd: null });
    for (const s of this.sessions.withStatus("running")) {
      this.hub.emit(s.id, "session.interrupted", { reason: "server_restart", exitCode: null, signal: null }, null);
      this.setStatus(s.id, "interrupted", "Orbit Web restarted while this run was active.", null);
    }
  }

  isRunning(sessionId: string): boolean {
    return this.active.has(sessionId);
  }

  // A person's message: stored, shown, and handed to Claude Code as the next turn of this session.
  send(sessionId: string, text: string): RunAccepted {
    const session = this.sessions.get(sessionId);
    if (!session) throw notFound("Session");
    if (this.active.has(sessionId) || session.status === "running") throw conflict("run_active", "Claude is still working on this session. Stop it or wait for it to finish.");
    if (session.status === "preparing") throw conflict("workspace_not_ready", "The workspace is still being prepared.");
    if (!ACCEPTS_MESSAGES.includes(session.status)) throw conflict("workspace_failed", "This session's workspace could not be prepared; start a new chat.");
    const runId = randomUUID();
    const messageId = randomUUID();
    const createdAt = new Date().toISOString();
    this.messages.add({ id: messageId, sessionId, role: "user", text, runId, createdAt });
    this.hub.emit(sessionId, "message.completed", { messageId, role: "user", text, parentToolUseId: null, partial: false, truncated: false }, runId);
    this.start(session, text, runId);
    return { sessionId, runId };
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
    for (const run of runs.filter((r) => this.active.has(r.session.id))) this.finalize(run, { code: null, signal: "SIGKILL", spawnError: null });
  }

  private start(session: SessionRecord, prompt: string, runId: string): void {
    const resume = session.turns > 0;
    const prefs = this.settings.get();
    const azure = prefs.azureForClaude;
    const args = claudeArgs({
      model: session.model,
      pluginDir: this.config.pluginDir,
      sessionId: session.claudeSessionId,
      resume,
      webTools: prefs.webTools,
      azure,
      maxBudgetUsd: this.config.maxBudgetUsd,
      protectedDirs: [this.config.data.claude, this.config.data.github, this.config.data.app, ...(azure ? [] : [this.config.data.azure])],
    });
    this.runs.start({ id: runId, sessionId: session.id, model: session.model, resumed: resume });
    this.setStatus(session.id, "running", null, runId);
    const handle = this.process.spawn(this.config.binaries.claude, args, { cwd: session.workspacePath, env: claudeEnv(this.config, { azure }) });
    const mapper = new StreamMapper({ requestedModel: session.model, resumed: resume, cwd: session.workspacePath });
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
    this.writeLog(run, line);
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      return;
    }
    for (const e of run.mapper.push(parsed)) this.publish(run, e);
  }

  private publish(run: ActiveRun, e: MappedEvent): AnyAppEvent {
    const event = this.hub.emit(run.session.id, e.type, e.data, run.runId);
    if (event.type === "message.completed" && event.data.role === "assistant" && event.data.parentToolUseId === null) {
      this.messages.add({ id: event.data.messageId, sessionId: run.session.id, role: "assistant", text: event.data.text, runId: run.runId, createdAt: event.at });
    }
    if (event.type === "tool.completed" || event.type === "tool.failed") this.orbit.schedule(run.session.id);
    return event;
  }

  private finalize(run: ActiveRun, exit: ExitInfo): void {
    if (this.active.get(run.session.id) !== run) return;
    for (const t of run.timers) clearTimeout(t);
    run.splitter.end();
    for (const e of run.mapper.finish()) this.publish(run, e);
    const outcome = decideOutcome({ stoppedBy: run.stoppedBy, exit, result: run.mapper.result, stderrTail: tail(run.stderr, 6) });
    this.hub.emit(run.session.id, outcome.type, outcome.data, run.runId);
    this.runs.finish(run.runId, outcome.status, { exitCode: exit.code, signal: exit.signal, costUsd: run.mapper.result?.costUsd ?? null });
    this.recordTurn(run, outcome.type === "session.failed" ? outcome.data.message : "");
    const reason = outcome.type === "session.failed" ? outcome.data.message.slice(0, 300) : outcome.type === "session.interrupted" ? outcome.data.reason : null;
    this.setStatus(run.session.id, outcome.status, reason, run.runId);
    this.hub.dropLive(run.session.id);
    run.log?.end();
    this.active.delete(run.session.id);
    this.orbit.schedule(run.session.id, true);
  }

  // A run that reached the CLI's init line is a turn of the Claude session; the next one resumes it.
  private recordTurn(run: ActiveRun, failure: string): void {
    const init = run.mapper.init;
    const current = this.sessions.get(run.session.id);
    if (!current) return;
    if (lostConversation(failure) || lostConversation(run.stderr)) {
      this.sessions.update(current.id, { claudeSessionId: randomUUID(), turns: 0 });
      this.hub.emit(current.id, "run.notice", { kind: "info", message: "Claude Code could not find the earlier conversation to resume, so the next message starts a new Claude conversation in the same workspace." }, run.runId);
      return;
    }
    if (init === null) return;
    this.sessions.update(current.id, { turns: current.turns + 1, ...(init.sessionId ? { claudeSessionId: init.sessionId } : {}) });
  }

  private setStatus(sessionId: string, status: SessionStatus, reason: string | null, runId: string | null): void {
    this.sessions.update(sessionId, { status, statusReason: reason });
    this.hub.emit(sessionId, "session.status", { status, reason }, runId);
  }

  // A diagnostic copy of the run's stream, masked and bounded, under /data/sessions/<session>/runs/.
  private openLog(sessionId: string, runId: string): WriteStream | null {
    try {
      const dir = join(this.config.data.sessions, sessionId, "runs");
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
