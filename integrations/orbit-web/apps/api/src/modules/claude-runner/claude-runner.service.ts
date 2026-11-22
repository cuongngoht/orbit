// THE CLAUDE RUNNER: runs the official Claude Code CLI, headless, in a session's workspace, with the model, effort and
// mode the session prefers -- as the chat's ACCOUNT's default Claude Code connection: that connection's own config home
// (CLAUDE_CONFIG_DIR), and its own key for an API-key connection; with no connected connection nothing is accepted (409
// connection_required / connection_unavailable). The Orbit plugin is loaded only when the account's owner approved it
// for chats on that connection, for the plugin's digest now; the chat's project plugins as before. One run per session
// at a time. The prompt goes in on stdin; the stream-json lines come out through the mapper as session events on the bus
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
import { ACCEPTS_MESSAGES, effortFor, modelOf, RUNTIME_LABELS, type AnySessionEvent, type ImageRef, type RunAccepted, type SessionStatus, type Settings } from "@orbit-web/contracts";
import { randomUUID } from "node:crypto";
import { createWriteStream, mkdirSync, realpathSync, writeFileSync, type WriteStream } from "node:fs";
import { dirname, join } from "node:path";
import type { AppConfig } from "../../config/config.js";
import { EventBus } from "../../core/events/event-bus.js";
import { AGENT_PROCESS_PORT, APP_CONFIG } from "../../core/tokens.js";
import { conflict, notFound } from "../../common/errors.js";
import { Db } from "../../infra/db/db.js";
import { claudeEnv, codexEnv, orbitStoreOf } from "../../infra/process/env.js";
import { LineSplitter } from "../../infra/process/lines.js";
import type { ExitInfo, ProcessHandle, ProcessPort } from "../../infra/process/process.port.js";
import { redactSecrets, tail } from "../../infra/security/redact.js";
import { ImageFiles } from "../../infra/storage/image-files.js";
import { ImageStore, RunStore, SessionStore, type SessionRecord } from "../../infra/storage/stores.js";
import type { Principal } from "../auth/principal.js";
import { ClaudeConnectorsService, type RunConnectors } from "../connections/claude-connectors.service.js";
import { ClaudeModelsService } from "../connections/claude-models.service.js";
import { RunConnections, type RunConnection } from "../connections/run-connections.js";
import { SESSION_SANDBOXES, type SessionLease, type SessionSandboxes } from "../session-sandbox/session-sandboxes.js";
import { RunGovernanceService, type RunPlan } from "../governance/run-governance.service.js";
import { ProjectService } from "../project/project.service.js";
import { AutoModeService } from "./auto-mode.js";
import { SettingsService } from "../settings/settings.module.js";
import { claudeArgs } from "./claude-args.js";
import { decideOutcome, lostConversation } from "./outcome.js";
import { StreamMapper, type InitInfo, type MappedEvent, type ResultInfo } from "./stream-mapper.js";
import { codexChatArgs, CodexStreamMapper } from "./codex-chat.js";
import { Transcript } from "./transcript.js";

const STDERR_LIMIT = 16 * 1024;
const RUN_LOG_LIMIT = 20 * 1024 * 1024;

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// What reads a run's stream into the chat's events: Claude Code's (StreamMapper) or OpenAI Codex's (CodexStreamMapper).
interface ChatMapper {
  init: InitInfo | null;
  result: ResultInfo | null;
  push(event: unknown): MappedEvent[];
  finish(): MappedEvent[];
}

interface ActiveRun {
  runId: string;
  session: SessionRecord;
  handle: ProcessHandle;
  mapper: ChatMapper;
  splitter: LineSplitter;
  stoppedBy: "user_stop" | "server_restart" | null;
  stderr: string;
  timers: NodeJS.Timeout[];
  log: WriteStream | null;
  logBytes: number;
  done: Promise<void>;
  plan: RunPlan;
  // Where its CLI runs: its own sandbox (given back when the run's end is recorded), or the agent's place.
  lease: SessionLease;
  // The run's publications, one after another: each waits for the one before it.
  queue: Promise<void>;
  // Set once the run's end is being recorded: it is recorded once, whoever notices first.
  ending: Promise<void> | null;
}

// What the CLI is given on stdin: a prompt's own text, or (Claude Code) one stream-json user message with the images;
// OpenAI Codex takes the images as files it is named (`-i`).
interface RunInput {
  streamJson: boolean;
  data: string;
  images?: string[];
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
    @Inject(RunConnections) private readonly connections: RunConnections,
    @Inject(SESSION_SANDBOXES) private readonly sandboxes: SessionSandboxes,
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

  // A Stop that came while a run was still being decided or started (the session reads as running from the moment its
  // message is accepted): honoured as soon as there is something to stop -- before the process, or the moment it exists.
  private readonly stopRequested = new Set<string>();

  isRunning(sessionId: string): boolean {
    return this.active.has(sessionId) || this.starting.has(sessionId);
  }

  // A run, or a change of the workspace under way (its working branch moving).
  isBusy(sessionId: string): boolean {
    return this.isRunning(sessionId) || this.held.has(sessionId);
  }

  // A run whose end is being recorded (its outcome may already be on the stream) is waited for, not refused: a page that
  // heard the outcome and acts at once finds the session as the outcome left it.
  private async endRecorded(sessionId: string): Promise<void> {
    await this.active.get(sessionId)?.ending;
  }

  // Runs `work` while no run may start in this session -- refused while one runs or another change is under way.
  async holding<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    await this.endRecorded(sessionId);
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
    await this.endRecorded(sessionId);
    const session = await this.sessions.get(sessionId);
    if (!session) throw notFound("Session");
    if (this.isRunning(sessionId) || session.status === "running") throw conflict("run_active", "Claude is still working on this session. Stop it or wait for it to finish.");
    if (this.held.has(sessionId)) throw conflict("workspace_busy", "The working branch is changing; send your message once it has.");
    if (session.status === "preparing") throw conflict("workspace_not_ready", "The workspace is still being prepared.");
    if (!ACCEPTS_MESSAGES.includes(session.status)) throw conflict("workspace_failed", "This session's workspace could not be prepared; start a new chat.");
    // The chat's connection (the one it named, or the account's default Claude Code one) must be connected.
    await this.connections.requireChat(session.accountId, session.connectionId);
    const runId = randomUUID();
    const input = session.runtime === "codex" ? this.codexInputOf(session, runId, text, images) : this.inputOf(text, images);
    const messageId = randomUUID();
    // From here the session counts as running: a second message waits for this one. The message and the status are kept
    // together, before the answer, so whoever reads the session after it was accepted sees it running -- until the run
    // ends, or governance refuses it (failed). A restart in between finds it running with no run: interrupted.
    this.starting.add(sessionId);
    try {
      await this.db.tx(async () => {
        if (images.length > 0) await this.images.attach(images.map((i) => i.id), sessionId, messageId);
        const event = await this.bus.publishSession(sessionId, "message.completed", { messageId, role: "user", text, parentToolUseId: null, partial: false, truncated: false, ...(images.length > 0 ? { images: [...images] } : {}) }, runId);
        await this.transcript.keep(event);
        await this.setStatus(sessionId, "running", null, runId);
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

  // OpenAI Codex: the words on stdin, each image a file beside the workspace (never in the repository's tree) it is
  // named with `-i`. Read now and whole; an image gone refuses the message.
  private codexInputOf(session: SessionRecord, runId: string, text: string, images: readonly ImageRef[]): RunInput {
    if (images.length === 0) return { streamJson: false, data: text };
    const dir = join(dirname(session.workspacePath), "codex-images");
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const paths = images.map((i, n) => {
      const path = join(dir, `${runId}-${n + 1}.${i.mediaType.split("/")[1]?.replace(/[^a-z0-9]/g, "") || "img"}`);
      writeFileSync(path, this.readImage(i.id), { mode: 0o600 });
      return path;
    });
    return { streamJson: false, data: text, images: paths };
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
      // The chat's connection, as it is now (it may have been disconnected since the message came).
      const connection = await this.connections.readyChat(session.accountId, session.connectionId);
      if (connection === null) return await this.refuse(session, runId, `This chat's ${RUNTIME_LABELS[session.runtime]} connection is not connected, so the run did not start: check it in Settings → AI Connections.`);
      let decided: { plan: RunPlan; connectors: RunConnectors };
      try {
        // Claude's connectors are Claude Code's: a chat on another CLI reaches none.
        const connectors = connection.connection.runtime === "claude" ? await this.connectors.forRun(session.accountId, connection.connection.id) : { known: [], chat: [], research: [] };
        const prepared = await this.governance.prepare(session, runId, { mode: session.mode, startedBy, connectors: connectors.chat });
        if (!prepared.ok) return await this.refuse(session, runId, prepared.message);
        decided = { plan: prepared.plan, connectors };
      } catch (err) {
        return await this.refuse(session, runId, `Governance could not decide this run, so it did not start: ${message(err)}`);
      }
      if (this.stopRequested.has(session.id)) return await this.stoppedBeforeStart(session, runId, decided.plan);
      // OpenAI Codex takes no spending cap: where one is set, its runs are refused rather than left uncapped.
      if (connection.connection.runtime === "codex" && this.config.maxBudgetUsd !== null) {
        await this.refuse(session, runId, `A spending cap is set for each run (ORBIT_WEB_MAX_BUDGET_USD), and OpenAI Codex cannot be held to it: this chat cannot run here.`);
        await this.governance.finished(decided.plan, runId, "failed", null);
        return;
      }
      try {
        await this.start((await this.sessions.get(session.id)) ?? session, input, runId, decided.plan, decided.connectors, connection);
      } catch (err) {
        // Nothing runs: no run record stays "running", and the run's binding ends.
        await this.runs.finish(runId, "failed", { exitCode: null, signal: null, costUsd: null });
        await this.refuse(session, runId, `The run could not be started: ${message(err)}`);
        await this.governance.finished(decided.plan, runId, "failed", null);
      }
    } catch (err) {
      this.logger.error(`run ${runId} could not be refused: ${message(err)}`);
    } finally {
      this.starting.delete(session.id);
      this.stopRequested.delete(session.id);
    }
  }

  // Stopped before Claude Code was started: nothing ran, and the run is interrupted -- never completed, never started later.
  // Nothing runs from here on: a Stop that comes once it reads as interrupted is refused, as for any ended run.
  private async stoppedBeforeStart(session: SessionRecord, runId: string, plan: RunPlan): Promise<void> {
    this.starting.delete(session.id);
    await this.db.tx(async () => {
      await this.bus.publishSession(session.id, "session.interrupted", { reason: "user_stop", exitCode: null, signal: null }, runId);
      await this.setStatus(session.id, "interrupted", "user_stop", runId);
    });
    await this.governance.finished(plan, runId, "interrupted", null);
  }

  private async refuse(session: SessionRecord, runId: string, message: string): Promise<void> {
    await this.db.tx(async () => {
      await this.bus.publishSession(session.id, "session.failed", { reason: "governance", subtype: null, message, exitCode: null, signal: null, permissionDenials: 0, costUsd: null, turns: null, durationMs: null }, runId);
      await this.setStatus(session.id, "failed", message.slice(0, 300), runId);
    });
  }

  stop(sessionId: string, by: "user_stop" | "server_restart" = "user_stop"): void {
    const run = this.active.get(sessionId);
    if (!run && this.starting.has(sessionId)) {
      this.stopRequested.add(sessionId);
      return;
    }
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

  private async start(session: SessionRecord, input: RunInput, runId: string, plan: RunPlan, connectors: RunConnectors, connection: RunConnection): Promise<void> {
    if (connection.connection.runtime === "codex") return this.startCodex(session, input, runId, plan, connection);
    const resume = session.turns > 0;
    // The chat's own account's preferences: whose switches hand Claude Code a sign-in.
    const prefs = await this.settings.get(session.accountId);
    // An isolated run (the governed deployment) holds no CLI's sign-in whatever a switch says.
    const credentials = !plan.isolated;
    const azure = credentials && prefs.azureForClaude;
    // GitHub's sign-in only ever reaches a chat whose repository came from GitHub.
    const github = credentials && prefs.githubForClaude && session.source === "github";
    const lease = await this.sandboxFor(session, runId, connection, { workspace: "rw", github, azure });
    try {
      if (this.stopRequested.has(session.id)) {
        await lease.release();
        return await this.stoppedBeforeStart(session, runId, plan);
      }
      await this.startClaude(session, input, runId, plan, connectors, connection, lease, { resume, prefs, azure, github });
    } catch (err) {
      await lease.release();
      throw err;
    }
  }

  // Claude Code, in the run's place (its sandbox, or the agent's).
  private async startClaude(session: SessionRecord, input: RunInput, runId: string, plan: RunPlan, connectors: RunConnectors, connection: RunConnection, lease: SessionLease, o: { resume: boolean; prefs: Settings; azure: boolean; github: boolean }): Promise<void> {
    const { resume, prefs, azure, github } = o;
    const project = await this.project.runtime(session);
    // The effort the account's catalog says this model takes (none, for a model that takes no level).
    const catalog = await this.models.catalog(session.accountId);
    // The Orbit plugin only when the account's owner approved it for chats on this connection, for its digest now.
    const orbit = await this.connections.pluginApproved(connection.connection, "chat");
    // The connectors the policy allowed this run, of those its owner checked for chats; every other one the account has
    // is denied by name. An isolated run reaches none at all (--strict-mcp-config).
    const allowed = new Set(plan.connectors.map((c) => c.name));
    const deniedConnectors = plan.isolated ? [] : connectors.known.filter((c) => !allowed.has(c.name)).map((c) => c.prefix);
    const args = claudeArgs({
      model: session.model,
      effort: effortFor(modelOf(catalog, session.model), session.effort),
      mode: session.mode,
      pluginDirs: [...(orbit ? [this.config.pluginDir] : []), ...project.pluginDirs],
      enabledPlugins: project.enabledPlugins,
      autoModeEnvironment: this.autoMode.current(plan.isolated, lease.sandboxed),
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
      protectedDirs: [this.config.data.connections, this.config.data.github, this.config.data.app, this.config.data.control, ...(azure ? [] : [this.config.data.azure])],
    });
    // The session reads as running since its message was accepted (send).
    await this.runs.start({ id: runId, sessionId: session.id, model: session.model, effort: session.effort, mode: session.mode, resumed: resume });
    const handle = lease.port.spawn(this.config.binaries.claude, args, { cwd: session.workspacePath, env: { ...claudeEnv(this.config, connection.configDir, { azure, github, orbitStore: orbitStoreOf(this.config, session.accountId) }), ...connection.secretEnv, ...this.envIn(lease, plan.env) } });
    const mapper = new StreamMapper({ requestedModel: session.model, requestedEffort: session.effort, requestedMode: session.mode, resumed: resume, cwd: session.workspacePath });
    this.attach(session, input, runId, plan, handle, mapper, lease);
  }

  // The run's own sandbox (where this Orbit Web makes them): asked for once governance allowed the run -- waited for, and
  // the chat told, when every one is in use -- and given back once the run's end is recorded.
  private sandboxFor(session: SessionRecord, runId: string, connection: RunConnection, o: { workspace: "rw" | "ro"; github: boolean; azure: boolean }): Promise<SessionLease> {
    const waiting = (running: number) => void this.bus.publishSession(session.id, "run.notice", { kind: "info", message: `Waiting for a sandbox to run in: all ${running} are in use by other runs. This run starts when one of them ends.` }, runId).catch(() => undefined);
    return this.sandboxes.acquire({ accountId: session.accountId, sessionId: session.id, connectionId: connection.connection.id, runId, kind: "chat", workspace: o.workspace, switches: { github: o.github, azure: o.azure } }, waiting);
  }

  // How the run's programs reach Orbit Web from its sandbox: the agent gateway by the name Orbit Web has there.
  private envIn(lease: SessionLease, env: Record<string, string>): Record<string, string> {
    if (lease.controlHost === null || env.ORBIT_AGENT_GATEWAY === undefined) return env;
    return { ...env, ORBIT_AGENT_GATEWAY: `http://${lease.controlHost}:${this.config.port}/api/agent` };
  }

  // A chat on OpenAI Codex: `codex exec --json` in the workspace, in the connection's own CODEX_HOME, resuming the thread
  // its first run named (codex-chat.ts). The effort is the chat's, where its model takes one.
  private async startCodex(session: SessionRecord, input: RunInput, runId: string, plan: RunPlan, connection: RunConnection): Promise<void> {
    const resume = session.turns > 0;
    const prefs = await this.settings.get(session.accountId);
    const option = modelOf(await this.models.catalogFor(session.accountId, connection.connection), session.model);
    const effort = option !== null && option.efforts.length === 0 ? null : session.effort;
    // In a sandbox of its own a Plan run's workspace is mounted read-only: the container holds what Codex's own
    // read-only sandbox would.
    const lease = await this.sandboxFor(session, runId, connection, { workspace: session.mode === "plan" ? "ro" : "rw", github: false, azure: false });
    try {
      if (this.stopRequested.has(session.id)) {
        await lease.release();
        return await this.stoppedBeforeStart(session, runId, plan);
      }
      if (lease.sandboxed) {
        // Its commands run, held by the container -- which holds this chat's places and nothing else of Orbit Web.
        const args = codexChatArgs({ model: session.model, effort, mode: session.mode, webTools: prefs.webTools && plan.webTools, execute: plan.execute, note: plan.note, threadId: resume ? session.claudeSessionId : null, images: input.images ?? [], confine: null, container: true });
        await this.spawnCodex(session, input, runId, plan, connection, lease, args, resume);
        return;
      }
      await this.startCodexHere(session, input, runId, plan, connection, lease, { resume, prefs, effort });
    } catch (err) {
      await lease.release();
      throw err;
    }
  }

  // Codex where the agent's programs run (no sandbox of its own): confined by Codex's own sandbox where that starts.
  private async startCodexHere(session: SessionRecord, input: RunInput, runId: string, plan: RunPlan, connection: RunConnection, lease: SessionLease, o: { resume: boolean; prefs: Settings; effort: string | null }): Promise<void> {
    const { resume, prefs, effort } = o;
    // Where Codex's own sandbox runs here, its commands reach nothing of Orbit Web's data -- no account's sign-ins, keys
    // or workspaces -- but this chat's own room; where it cannot, they cannot run at all, and the chat is told.
    const sandbox = await this.codexSandboxRuns();
    const confine = sandbox ? { denied: [real(this.config.data.root)], room: [...new Set([real(dirname(session.workspacePath)), "/tmp", real("/tmp")])] } : null;
    if (!sandbox) await this.bus.publishSession(session.id, "run.notice", { kind: "info", message: "OpenAI Codex's sandbox cannot start on this server: its commands cannot run here (it still answers). An operator lets them run by allowing user namespaces where Orbit Web runs." }, runId);
    // Unconfined, it runs nothing: no shell, read-only -- whatever kept the profile from being confirmed.
    const args = codexChatArgs({ model: session.model, effort, mode: session.mode, webTools: prefs.webTools && plan.webTools, execute: plan.execute && sandbox, note: plan.note, threadId: resume ? session.claudeSessionId : null, images: input.images ?? [], confine });
    await this.spawnCodex(session, input, runId, plan, connection, lease, args, resume);
  }

  private async spawnCodex(session: SessionRecord, input: RunInput, runId: string, plan: RunPlan, connection: RunConnection, lease: SessionLease, args: string[], resume: boolean): Promise<void> {
    await this.runs.start({ id: runId, sessionId: session.id, model: session.model, effort: session.effort, mode: session.mode, resumed: resume });
    const handle = lease.port.spawn(this.config.binaries.codex, args, { cwd: session.workspacePath, env: { ...codexEnv(this.config, connection.configDir), ...this.envIn(lease, plan.env) } });
    this.attach(session, input, runId, plan, handle, new CodexStreamMapper({ requestedModel: session.model, requestedEffort: session.effort, requestedMode: session.mode, resumed: resume }), lease);
  }

  // Whether Codex's own sandbox can start on this host (`codex sandbox -- true`), asked once: in a container without user
  // namespaces it cannot, and then neither can a chat's commands.
  private codexSandbox: Promise<boolean> | null = null;

  private codexSandboxRuns(): Promise<boolean> {
    if (this.codexSandbox === null) {
      const scratch = join(this.config.data.home, "codex-probe");
      mkdirSync(scratch, { recursive: true, mode: 0o700 });
      this.codexSandbox = this.process
        .run(this.config.binaries.codex, ["sandbox", "--", "true"], { cwd: scratch, env: codexEnv(this.config, scratch), timeoutMs: 15_000 })
        .then((r) => r.spawnError === null && !r.timedOut && r.code === 0)
        .catch(() => false);
    }
    return this.codexSandbox;
  }

  // A started CLI made the session's run: its stream read into the chat's events, its end recorded once, the input given.
  private attach(session: SessionRecord, input: RunInput, runId: string, plan: RunPlan, handle: ProcessHandle, mapper: ChatMapper, lease: SessionLease): void {
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
      lease,
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
    // A Stop asked while it was being started stops it now that it exists.
    if (this.stopRequested.has(session.id)) this.stop(session.id, "user_stop");
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
  private publish(run: ActiveRun, mapped: MappedEvent): void {
    // The run's start says where it ran: a sandbox of its own.
    const e: MappedEvent = run.lease.sandboxed && mapped.type === "session.started" ? { type: "session.started", data: { ...mapped.data, sandboxed: true } } : mapped;
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
    // Its sandbox is given back once its end is recorded -- however that went.
    run.ending ??= this.recordEnd(run, exit)
      .catch((err: unknown) => this.logger.error(`the end of run ${run.runId} could not be recorded: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => run.lease.release());
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
      const outcome = decideOutcome({ stoppedBy: run.stoppedBy, exit, result: run.mapper.result, stderrTail: tail(run.stderr, 6), cli: RUNTIME_LABELS[run.session.runtime] });
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
      await this.bus.publishSession(current.id, "run.notice", { kind: "info", message: `${RUNTIME_LABELS[current.runtime]} could not find the earlier conversation to resume, so the next message starts a new conversation in the same workspace.` }, run.runId);
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

// A path as the kernel resolves it (a sandbox matches real paths: /tmp is /private/tmp on macOS); itself when it is not there.
function real(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
