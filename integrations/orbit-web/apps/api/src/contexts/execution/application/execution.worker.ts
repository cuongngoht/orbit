// THE EXECUTION WORKER (Execution context, ADR 0067): what turns a run's durable intent into an attempt, and an attempt
// back into a fact Work decides on. One per Orbit Web process.
//
//   ADMIT     a pass of the admission service (one at a time across the deployment) moves pending attempts to `starting`
//             with their resources reserved and a LEASE in this worker's name -- or records why they wait.
//   DISPATCH  with no transaction open: the assignment and the employee are checked again (still this attempt's, still
//             able to run), the run is decided and bound under the account's policy, the execution asked is resolved
//             against the connection's own catalog, the workspace is prepared, both planes are started (idempotent by the
//             dispatch key; the handle written at once), the attempt is attested, and only then is the run `running` and
//             the CLI started in the model plane. Its init line is checked: anything it was not given stops it (fail
//             closed).
//   WATCH     the CLI's stream is folded into facts (never a prompt's or a file's contents); a heartbeat renews the lease,
//             samples usage and reads stop requests (pause, cancel); the time limit stops it.
//   SETTLE    usage read, both planes stopped and REMOVED (verified), the reservation released -- only then -- the run's
//             end written under its fence and lease, the run's governance binding ended, and Work told what happened.
//   RECOVER   a run whose lease ran out (its worker died) is taken over: what the provider still has of it is stopped and
//             removed, and Work is told the attempt was interrupted -- never a second spawn to guess. When the provider
//             cannot say, the run is `unknown`, the assignment RECOVERING, and a person decides.
import { Inject, Injectable, Logger, Optional, type OnApplicationBootstrap, type OnModuleDestroy } from "@nestjs/common";
import { RUNTIME_LABELS, type ExecutionProfile, type ResourceEvidence, type ResourceProfile, type RunState, type SandboxAttestation } from "@orbit-web/contracts";
import { randomBytes, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import type { AppConfig } from "../../../config/config.js";
import { APP_CONFIG } from "../../../core/tokens.js";
import { Db } from "../../../infra/db/db.js";
import { baseEnv } from "../../../infra/process/env.js";
import { LineSplitter } from "../../../infra/process/lines.js";
import type { ExitInfo, ProcessHandle } from "../../../infra/process/process.port.js";
import { redactSecrets } from "../../../infra/security/redact.js";
import { RunGovernanceService, type EmployeeNetwork, type RunPlan } from "../../../modules/governance/run-governance.service.js";
import { systemActor, type Actor } from "../../shared/application/commands.js";
import { DomainError } from "../../shared/domain.js";
import { Outbox } from "../../shared/infrastructure/outbox.js";
import { ConnectionsReader, usable, type ConnectionFacts } from "../../workforce/infrastructure/connections.reader.js";
import { emptyFacts, employeeArgs, employeeEnv, foldLine, initViolation, promptOf, systemPromptOf, type StreamFacts } from "../infrastructure/claude-employee.adapter.js";
import { RunRepository, type RunRecord } from "../infrastructure/runs.repository.js";
import { AdmissionService } from "./admission.service.js";
import { CONNECTION_SECRETS, type ConnectionSecrets } from "./connection-secrets.port.js";
import { RUN_OUTCOMES, type AttemptContext, type RunEnd, type RunOutcomes } from "./run-outcomes.port.js";
import { SANDBOX_PROVIDER, type AttemptHandle, type AttemptSpec, type SandboxIds, type SandboxProvider } from "./sandbox.port.js";
import { WorkspacePublisher } from "./workspace-publisher.js";

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// Why Orbit stops an attempt it is running.
type StopWhy = "pause" | "cancel" | "accepted" | "replaced" | "timeout" | "lost_lease" | "shutdown";

export interface WorkerTimings {
  tickMs: number;
  leaseMs: number;
  heartbeatMs: number;
  sweepMs: number;
  graceMs: number;
  agingMinutes: number;
  guardMinutes: number;
}

const DEFAULT_TIMINGS: WorkerTimings = { tickMs: 1000, leaseMs: 60_000, heartbeatMs: 15_000, sweepMs: 30_000, graceMs: 10_000, agingMinutes: 30, guardMinutes: 60 };

const intEnv = (env: AppConfig["sourceEnv"], name: string, fallback: number): number => {
  const raw = env[name];
  const n = raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
};

export function workerTimings(env: AppConfig["sourceEnv"]): WorkerTimings {
  return {
    tickMs: intEnv(env, "ORBIT_WEB_WORKER_TICK_MS", DEFAULT_TIMINGS.tickMs),
    leaseMs: intEnv(env, "ORBIT_WEB_RUN_LEASE_MS", DEFAULT_TIMINGS.leaseMs),
    heartbeatMs: intEnv(env, "ORBIT_WEB_RUN_HEARTBEAT_MS", DEFAULT_TIMINGS.heartbeatMs),
    sweepMs: intEnv(env, "ORBIT_WEB_RECOVERY_SWEEP_MS", DEFAULT_TIMINGS.sweepMs),
    graceMs: intEnv(env, "ORBIT_WEB_STOP_GRACE_MS", DEFAULT_TIMINGS.graceMs),
    agingMinutes: intEnv(env, "ORBIT_WEB_AGING_MINUTES", DEFAULT_TIMINGS.agingMinutes),
    guardMinutes: intEnv(env, "ORBIT_WEB_STARVATION_GUARD_MINUTES", DEFAULT_TIMINGS.guardMinutes),
  };
}

// One attempt this worker drives.
interface Active {
  orbitId: string;
  runId: string;
  handle: AttemptHandle | null;
  child: ProcessHandle | null;
  // The first reason Orbit asked it to stop (null: it was not asked).
  stopFor: StopWhy | null;
  stopTimer: NodeJS.Timeout | null;
  done: Promise<void>;
}

// What a stop request written by Work (`stop_requested`) asks for.
const stopOf = (requested: string): "pause" | "cancel" | "accepted" | "replaced" => {
  if (requested.startsWith("pause")) return "pause";
  if (requested === "accepted" || requested === "replaced") return requested;
  return "cancel";
};

// What Work is told about an attempt that never started because it was asked to stop first.
const notWanted = (requested: string | null): RunEnd["stoppedFor"] => {
  const why = requested === null ? "cancel" : stopOf(requested);
  return why === "pause" ? "pause" : "cancel";
};

const NETWORK_TEXT = (n: EmployeeNetwork): string =>
  n.mode === "RESTRICTED"
    ? `only these hosts are reachable from your sandbox: ${n.allow.length > 0 ? n.allow.join(", ") : "none"}; every other connection is refused. Private and internal addresses are always refused.`
    : "your sandbox reaches public websites, registries and APIs over HTTP and HTTPS through Orbit's proxy, which records every connection; private and internal addresses are always refused.";

@Injectable()
export class ExecutionWorker implements OnApplicationBootstrap, OnModuleDestroy {
  readonly owner = `${hostname()}:${process.pid}:${randomBytes(4).toString("hex")}`;
  private readonly logger = new Logger("ExecutionWorker");
  private readonly active = new Map<string, Active>();
  private readonly timings: WorkerTimings;
  private timer: NodeJS.Timeout | null = null;
  private heartbeat: NodeJS.Timeout | null = null;
  private ticking = false;
  private again = false;
  private closing = false;
  private lastSweep = 0;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(Db) private readonly db: Db,
    @Inject(RunRepository) private readonly runs: RunRepository,
    @Inject(AdmissionService) private readonly admission: AdmissionService,
    @Inject(RunGovernanceService) private readonly governance: RunGovernanceService,
    @Inject(ConnectionsReader) private readonly connections: ConnectionsReader,
    @Inject(RUN_OUTCOMES) private readonly outcomes: RunOutcomes,
    @Inject(Outbox) private readonly outbox: Outbox,
    @Inject(WorkspacePublisher) private readonly desk: WorkspacePublisher,
    @Optional() @Inject(SANDBOX_PROVIDER) private readonly provider: SandboxProvider | null = null,
    @Optional() @Inject(CONNECTION_SECRETS) private readonly secrets: ConnectionSecrets | null = null,
  ) {
    this.timings = workerTimings(config.sourceEnv);
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.provider === null) {
      this.logger.warn("No sandbox provider is configured: employees' work waits until one is.");
      return;
    }
    // Runs an earlier process on this host was driving are this host's to recover now, not after their lease ran out.
    await this.db.run("UPDATE workforce.runs SET lease_until = now() WHERE state IN ('starting', 'running', 'unknown') AND lease_owner LIKE $1 AND lease_owner <> $2", [`${hostname()}:%`, this.owner]);
    // Anything appended to the outbox (a run requested, resources released, a budget or a profile changed) asks for a pass.
    this.outbox.onAppended(() => this.kick());
    this.timer = setInterval(() => this.kick(), this.timings.tickMs);
    this.timer.unref();
    this.heartbeat = setInterval(() => void this.beat(), this.timings.heartbeatMs);
    this.heartbeat.unref();
    this.kick();
  }

  // Stop taking work; what runs is stopped (verified), released and reported as interrupted.
  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.timer !== null) clearInterval(this.timer);
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    for (const a of this.active.values()) this.stop(a, "shutdown");
    const all = Promise.all([...this.active.values()].map((a) => a.done));
    await Promise.race([all, new Promise((r) => setTimeout(r, this.timings.graceMs * 2).unref())]);
  }

  // How many attempts this worker drives now (health, tests).
  get running(): number {
    return this.active.size;
  }

  // Ask for a pass soon (coalesced: one at a time, again once more if asked meanwhile).
  kick(): void {
    if (this.closing || this.provider === null) return;
    if (this.ticking) {
      this.again = true;
      return;
    }
    this.ticking = true;
    void this.tick().finally(() => {
      this.ticking = false;
      if (this.again && !this.closing) {
        this.again = false;
        this.kick();
      }
    });
  }

  private async tick(): Promise<void> {
    try {
      await this.stopRequested();
      if ((await this.runs.pending(1)).length > 0) {
        const admitted = await this.admission.pass(this.owner, { agingMinutes: this.timings.agingMinutes, guardMinutes: this.timings.guardMinutes }, this.timings.leaseMs);
        for (const a of admitted) this.launch(a.orbitId, a.runId);
      }
      if (Date.now() - this.lastSweep >= this.timings.sweepMs) {
        this.lastSweep = Date.now();
        await this.recover();
      }
    } catch (err) {
      this.logger.warn(`The worker's pass failed: ${redactSecrets(err instanceof Error ? err.message : String(err))}`);
    }
  }

  // ---- one attempt --------------------------------------------------------------------------------------------------

  private launch(orbitId: string, runId: string): void {
    if (this.active.has(runId)) return;
    const entry: Active = { orbitId, runId, handle: null, child: null, stopFor: null, stopTimer: null, done: Promise.resolve() };
    this.active.set(runId, entry);
    entry.done = this.attempt(entry)
      .catch((err: unknown) => this.logger.warn(`Attempt ${runId} ended in error: ${redactSecrets(err instanceof Error ? err.message : String(err))}`))
      .finally(() => {
        if (entry.stopTimer !== null) clearTimeout(entry.stopTimer);
        this.active.delete(runId);
      });
  }

  private async attempt(entry: Active): Promise<void> {
    const run = await this.runs.get(entry.orbitId, entry.runId);
    if (run === null || run.state !== "starting" || run.leaseOwner !== this.owner || this.provider === null) return;
    const provider = this.provider;
    const actor = systemActor(run.orbitId, "execution-worker", `run:${run.id}`);
    const ctx = await this.outcomes.current(run.orbitId, run.assignmentId, run.fence);
    if (ctx === null || !ctx.current || run.stopRequested !== null) return this.unstarted(run, actor, null, { state: "cancelled", detail: "The assignment no longer waits for this attempt (paused, cancelled or replaced).", stoppedFor: notWanted(run.stopRequested) });
    if (!ctx.employee.eligible || ctx.employee.sandboxId === null || ctx.employee.profile === null) return this.unstarted(run, actor, null, { state: "failed", detail: ctx.employee.reason ?? "The employee cannot run work now.", stoppedFor: "refused" });
    const prep = await this.governance.prepareAssignment({ accountId: run.orbitId, employeeId: run.employeeId, title: ctx.employee.name, assignmentId: run.assignmentId }, run.id, { startedBy: actor.principal, webSearch: run.requested.webSearch === true });
    if (!prep.ok) return this.unstarted(run, actor, null, { state: "failed", detail: prep.message, stoppedFor: "refused" });
    const resolved = await this.resolve(run.orbitId, run.requested, prep.plan);
    if (typeof resolved === "string") return this.unstarted(run, actor, prep.plan, { state: "failed", detail: resolved, stoppedFor: "refused" });
    const requested = run.resources?.requested ?? null;
    if (requested === null) return this.unstarted(run, actor, prep.plan, { state: "failed", detail: "The attempt was admitted without its resources: it was not started.", stoppedFor: "refused" });
    const apiKey = resolved.connection.method === "api_key" ? (this.secrets?.read(resolved.connection.credentialRef) ?? null) : null;
    if (resolved.connection.method === "api_key" && apiKey === null) return this.unstarted(run, actor, prep.plan, { state: "failed", detail: `The API key of the connection "${resolved.connection.label}" is missing: enter it again in Settings → AI Connections.`, stoppedFor: "refused" });
    const ids: SandboxIds = { orbitId: run.orbitId, employeeId: run.employeeId, sandboxId: ctx.employee.sandboxId };
    const { modelPlane, ...profile } = requested;
    const spec: AttemptSpec = {
      ...ids,
      runId: run.id,
      dispatchKey: run.dispatchKey,
      fence: run.fence,
      assignmentId: run.assignmentId,
      resources: profile as ResourceProfile,
      modelPlane: { cpuMillis: modelPlane.cpuMillis, memoryMiB: modelPlane.memoryMiB, connectionHome: resolved.connection.home, env: {} },
      egress: { proxyHost: this.config.governance.agentControlHost, proxyPort: this.config.governance.proxyPort ?? 0, runToken: prep.token },
      bridge: { url: this.toolUrl(), runToken: prep.token },
      inputs: [],
      teamRoom: null,
    };

    // The workspace, then both planes (written down at once: a crash after this point is recovered by its dispatch key).
    // The desk first holds everything the employee had accepted (its next work starts from that, toolbox included).
    try {
      await this.desk.publishPending(run.orbitId, run.employeeId);
    } catch (err) {
      return this.unstarted(run, actor, prep.plan, { state: "failed", detail: `The employee's desk could not be brought up to date with its accepted work: ${this.messageOf(err)}`, stoppedFor: null });
    }
    let handle: AttemptHandle;
    try {
      await provider.prepareWorkspace(ids, run.assignmentId, profile.scratchStorageMiB);
      handle = await provider.startAttempt(spec);
    } catch (err) {
      return this.failedStart(run, actor, prep.plan, `The sandbox could not be started: ${this.messageOf(err)}`);
    }
    entry.handle = handle;
    await this.runs.set(run.orbitId, run.id, { handle });

    // What isolates it, read from outside its shell. The account's policy may oblige isolation; it may forbid commands.
    let attestation: SandboxAttestation;
    let evidence: ResourceEvidence;
    try {
      const e = await provider.attest(handle, spec);
      attestation = e.attestation;
      evidence = { requested, applied: e.applied, observed: e.observed };
    } catch (err) {
      return this.settle(entry, run, actor, prep.plan, null, { state: "failed", detail: `The sandbox could not be attested: ${this.messageOf(err)}`, stoppedFor: null });
    }
    if (prep.isolationRequired && attestation.state !== "attested") return this.settle(entry, run, actor, prep.plan, null, { state: "failed", detail: `The account's policy requires the agent to run isolated, and this attempt's sandbox was not attested: ${attestation.detail}`, stoppedFor: "refused" });
    if (attestation.shell && !prep.plan.execute) attestation = { ...attestation, shell: false, detail: "The account's policy does not allow running commands in the workspace (workspace.execute): file tools only." };
    if (entry.stopFor !== null) return this.settle(entry, run, actor, prep.plan, null, this.stoppedEnd(entry.stopFor, profile));

    const startedAt = new Date().toISOString();
    if (!(await this.runs.transition(run.orbitId, run.id, ["starting"], "running", { startedAt, resolved: resolved.profile, sandbox: attestation, resources: evidence }, run.fence, this.owner))) {
      return this.settle(entry, run, actor, prep.plan, null, { state: "cancelled", detail: "The attempt was taken over before it ran.", stoppedFor: "recover" });
    }
    try {
      await this.outcomes.started(actor, run.assignmentId, run.fence);
    } catch (err) {
      if (!this.isStale(err)) throw err;
      return this.settle(entry, run, actor, prep.plan, null, { state: "cancelled", detail: "The assignment moved on before the attempt ran.", stoppedFor: "cancel" });
    }

    // The CLI, in the model plane.
    const p = ctx.employee.profile;
    const systemPrompt = systemPromptOf({ name: ctx.employee.name, title: p.title, duties: p.duties, instructions: p.instructions, handoffStandard: p.handoffStandard, reportingRule: p.reportingRule, shell: attestation.shell, shellReason: attestation.shell ? null : attestation.detail, network: NETWORK_TEXT(prep.network) });
    const args = employeeArgs({ model: resolved.profile.model, effort: resolved.profile.effort, webSearch: resolved.profile.webSearch, bridge: { command: handle.bridgeCommand.command, args: handle.bridgeCommand.args, env: { ORBIT_TOOL_URL: spec.bridge.url, ORBIT_RUN_TOKEN: prep.token } }, systemPrompt, sessionId: randomUUID() });
    const env = employeeEnv(this.modelPlaneBase(handle), handle.modelPlaneHome, apiKey);
    const watched = await this.watch(entry, handle, args, env, promptOf({ goal: ctx.brief.goal, deliverables: ctx.brief.deliverables, criteria: ctx.brief.acceptanceCriteria, revisions: ctx.brief.revisions, answers: ctx.brief.answers, inputs: spec.inputs }), resolved.profile.webSearch, profile.timeoutMinutes);
    await this.settle(entry, run, actor, prep.plan, watched, this.endOf(entry, watched, profile));
  }

  // The execution asked, held to what the connection's own CLI says now (catalog, efforts, search) and to the policy.
  private async resolve(orbitId: string, requested: RunRecord["requested"], plan: RunPlan): Promise<{ profile: ExecutionProfile; connection: ConnectionFacts } | string> {
    const runtime = requested.runtime ?? "claude";
    if (runtime !== "claude") return `${RUNTIME_LABELS[runtime] ?? runtime} employees cannot run in this version of Orbit Web yet.`;
    const connection = requested.connectionId ? await this.connections.get(orbitId, requested.connectionId) : await this.connections.defaultFor(orbitId, runtime);
    if (connection === null) return "The employee's AI connection was removed: choose another in its profile.";
    if (!usable(connection)) return `The AI connection "${connection.label}" cannot run work now${connection.reason ? `: ${connection.reason}` : ""}. Reconnect it in Settings → AI Connections, then retry.`;
    const option = connection.catalog.models.find((m) => m.id === requested.model) ?? null;
    if (option === null) return `The model ${String(requested.model)} is not in the catalog of "${connection.label}" any more: choose another in the employee's profile.`;
    const effort = requested.effort ?? null;
    if (effort !== null && option.efforts.length > 0 && !option.efforts.includes(effort as never)) return `${option.label} does not take the effort level ${effort} any more.`;
    const webSearch = requested.webSearch === true && connection.capabilities.webSearch === "yes" && plan.webTools;
    return { connection, profile: { runtime, connectionId: connection.id, model: option.id, effort: option.efforts.length === 0 ? null : effort, webSearch, orbitPlugin: false } };
  }

  // Runs the CLI to its end: its stream folded into facts, its init line checked, its time limit kept.
  private async watch(entry: Active, handle: AttemptHandle, args: string[], env: Record<string, string>, prompt: string, webSearch: boolean, timeoutMinutes: number): Promise<{ exit: ExitInfo; facts: StreamFacts; violation: string | null; stderr: string }> {
    const port = (this.provider as SandboxProvider).modelPlane(handle);
    const child = port.spawn(handle.provider === "process" ? this.config.binaries.claude : "claude", args, { cwd: handle.modelPlaneCwd, env });
    entry.child = child;
    let facts = emptyFacts();
    let violation: string | null = null;
    let stderr = "";
    const refuse = (why: string): void => {
      if (violation !== null) return;
      violation = why;
      child.kill("SIGKILL");
    };
    const splitter = new LineSplitter((line) => {
      let message: unknown;
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (!isRecord(message)) return;
      if (facts.init === null && message.type === "system" && message.subtype === "init") {
        const v = initViolation(message, webSearch);
        if (v !== null) refuse(v);
      }
      facts = foldLine(facts, message, webSearch);
      if (facts.foreignTool !== null) refuse(`The model plane called a tool Orbit Web did not give it (${facts.foreignTool}): the run was stopped.`);
    });
    child.onStdout((chunk) => splitter.push(chunk));
    child.onStderr((chunk) => {
      stderr = (stderr + chunk).slice(-8192);
    });
    const limit = setTimeout(() => this.stop(entry, "timeout"), Math.max(1, timeoutMinutes) * 60_000);
    limit.unref();
    if (entry.stopFor !== null) this.stop(entry, entry.stopFor);
    child.write(prompt);
    child.closeInput();
    const exit = await child.exited;
    clearTimeout(limit);
    splitter.end();
    return { exit, facts, violation, stderr };
  }

  // Orbit asks an attempt to stop: the CLI first (TERM, then KILL after the grace); the planes are removed when it settles.
  private stop(entry: Active, why: StopWhy): void {
    if (entry.stopFor === null) entry.stopFor = why;
    const child = entry.child;
    if (child === null) return;
    child.kill("SIGTERM");
    if (entry.stopTimer === null) {
      entry.stopTimer = setTimeout(() => child.kill("SIGKILL"), this.timings.graceMs);
      entry.stopTimer.unref();
    }
  }

  private stoppedEnd(why: StopWhy, profile: Omit<ResourceProfile, never>): RunEnd {
    if (why === "pause") return { state: "cancelled", detail: "Stopped: the assignment was paused.", stoppedFor: "pause" };
    if (why === "cancel") return { state: "cancelled", detail: "Stopped: the assignment was cancelled.", stoppedFor: "cancel" };
    if (why === "accepted") return { state: "succeeded", detail: "Ended after its hand-in was accepted.", stoppedFor: "cancel" };
    if (why === "replaced") return { state: "cancelled", detail: "Stopped: a newer attempt of the assignment replaced it.", stoppedFor: "cancel" };
    if (why === "timeout") return { state: "failed", detail: `It ran past its limit of ${profile.timeoutMinutes} minutes and was stopped.`, stoppedFor: "timeout" };
    if (why === "shutdown") return { state: "interrupted", detail: "Orbit Web was shut down while this attempt ran: it was stopped. Retry it when Orbit Web is back.", stoppedFor: null };
    return { state: "interrupted", detail: "This worker lost the attempt's lease: another worker reconciles it.", stoppedFor: "recover" };
  }

  // How an attempt that ran ended, from what Orbit observed (never from what the agent said about itself).
  private endOf(entry: Active, w: { exit: ExitInfo; facts: StreamFacts; violation: string | null; stderr: string }, profile: ResourceProfile): RunEnd {
    if (w.violation !== null) return { state: "failed", detail: `${w.violation} (isolation not established)`, stoppedFor: "refused" };
    if (entry.stopFor !== null) return this.stoppedEnd(entry.stopFor, profile);
    if (w.exit.spawnError !== null) return { state: "failed", detail: `The AI CLI could not be started in the model plane (${w.exit.spawnError}).`, stoppedFor: null };
    const r = w.facts.result;
    if (w.exit.code === 0 && r !== null && !r.isError) return { state: "succeeded", detail: null, stoppedFor: null };
    const why = r?.isError ? `the AI CLI reported an error (${r.subtype ?? "error"})${r.text ? `: ${r.text.slice(0, 300)}` : ""}` : w.exit.signal !== null ? `the AI CLI was stopped by ${w.exit.signal}` : `the AI CLI exited with code ${String(w.exit.code)}`;
    const tail = redactSecrets(w.stderr.trim().split("\n").slice(-2).join(" ")).slice(0, 300);
    return { state: "failed", detail: `${why}${tail ? ` (${tail})` : ""}.`, stoppedFor: null };
  }

  // ---- settling ---------------------------------------------------------------------------------------------------------

  // Nothing was started (the dispatch check refused it, or it was no longer wanted): the run ends, its reservation goes
  // back at once, and Work is told.
  private async unstarted(run: RunRecord, actor: Actor, plan: RunPlan | null, end: RunEnd): Promise<void> {
    const moved = await this.runs.transition(run.orbitId, run.id, ["starting"], end.state, { endedAt: new Date().toISOString(), detail: end.detail }, run.fence, this.owner);
    if (!moved) return;
    await this.admission.release(run.orbitId, run.id, `not started: ${end.state}`);
    if (plan !== null) await this.governance.finished(plan, run.id, end.state, null);
    await this.report(actor, run, end);
    await this.runs.releaseLease(run.orbitId, run.id, this.owner);
  }

  // The planes may exist (a start that failed half-way): found by the dispatch key, stopped and removed, then settled.
  private async failedStart(run: RunRecord, actor: Actor, plan: RunPlan, detail: string): Promise<void> {
    const provider = this.provider as SandboxProvider;
    const found = await provider.find(run.dispatchKey).catch(() => undefined);
    if (found === undefined) {
      await this.runs.transition(run.orbitId, run.id, ["starting"], "unknown", { detail: `${detail} What it started could not be read back.` }, run.fence, this.owner);
      await this.outcomes.recovering(actor, run.assignmentId, run.fence, `${detail} Whether anything of it still runs could not be read back: Orbit Web checks again before anything new starts.`).catch((e: unknown) => this.ignoreStale(e));
      await this.governance.finished(plan, run.id, "unknown", null);
      await this.runs.releaseLease(run.orbitId, run.id, this.owner);
      return;
    }
    const entry: Active = { orbitId: run.orbitId, runId: run.id, handle: found?.handle ?? null, child: null, stopFor: null, stopTimer: null, done: Promise.resolve() };
    await this.settle(entry, run, actor, plan, null, { state: "failed", detail, stoppedFor: null });
  }

  private async settle(entry: Active, run: RunRecord, actor: Actor, plan: RunPlan, watched: { exit: ExitInfo; facts: StreamFacts } | null, end: RunEnd): Promise<void> {
    const provider = this.provider as SandboxProvider;
    const handle = entry.handle;
    let usage: RunRecord["usage"] = null;
    let gone = { gone: true, detail: "nothing was started" };
    let oom = { modelPlane: false, toolPlane: false };
    if (handle !== null) {
      oom = (await provider.find(run.dispatchKey).catch(() => null))?.oomKilled ?? oom;
      usage = await provider.usage(handle).catch(() => null);
      await provider.stop(handle, this.timings.graceMs).catch(() => undefined);
      gone = await provider.remove(handle).catch((err: unknown) => ({ gone: false, detail: this.messageOf(err) }));
    }
    const final = this.withOom(end, oom);
    const lost = end.stoppedFor === "recover";
    if (gone.gone) await this.admission.release(run.orbitId, run.id, `attempt ${final.state}`);
    if (lost) return;
    const f = watched?.facts ?? null;
    const detail = gone.gone ? final.detail : `${final.detail ?? ""} Its sandbox was not verified removed (${gone.detail}): its resources stay reserved until it is.`.trim();
    await this.runs.transition(
      run.orbitId,
      run.id,
      ["starting", "running"],
      final.state,
      {
        endedAt: new Date().toISOString(),
        detail,
        usage,
        observed: f === null ? null : { cli: f.init === null ? null : { model: f.init.model, version: f.init.version, tools: f.init.tools, plugins: f.init.plugins }, toolCalls: f.toolCalls, webSearches: f.webSearches, exit: watched === null ? null : { code: watched.exit.code, signal: watched.exit.signal } },
        modelUsage: f?.result === null || f === null ? null : { costUsd: f.result.costUsd, turns: f.result.turns, durationMs: f.result.durationMs },
      },
      run.fence,
      this.owner,
    );
    await this.governance.finished(plan, run.id, final.state, watched?.exit.code ?? null);
    await this.report(actor, run, final);
    await this.runs.releaseLease(run.orbitId, run.id, this.owner);
  }

  // A container the kernel killed for memory: said as such, and the model plane's never charged to the employee.
  private withOom(end: RunEnd, oom: { modelPlane: boolean; toolPlane: boolean }): RunEnd {
    if (end.stoppedFor === "pause" || end.stoppedFor === "cancel") return end;
    if (oom.toolPlane) return { state: "failed", detail: "Out of memory: the sandbox reached the employee's memory limit and the kernel stopped it. Raise the limit (Sandbox & resources) or retry.", stoppedFor: null };
    if (oom.modelPlane) return { state: "failed", detail: "model_plane_out_of_memory: the AI CLI ran out of memory (not charged to the employee's limits). The operator can raise ORBIT_WEB_MODEL_PLANE_CLAUDE_MEMORY.", stoppedFor: null };
    return end;
  }

  private async report(actor: Actor, run: RunRecord, end: RunEnd): Promise<void> {
    await this.outcomes.ended(actor, run.assignmentId, run.fence, end).catch((e: unknown) => this.ignoreStale(e));
  }

  // ---- heartbeat, stop requests, recovery ----------------------------------------------------------------------------

  private async beat(): Promise<void> {
    for (const entry of [...this.active.values()]) {
      try {
        if (!(await this.runs.renew(entry.orbitId, entry.runId, this.owner, this.timings.leaseMs))) {
          this.stop(entry, "lost_lease");
          continue;
        }
        if (entry.handle !== null && this.provider !== null) {
          const usage = await this.provider.usage(entry.handle).catch(() => null);
          if (usage !== null) await this.runs.set(entry.orbitId, entry.runId, { usage });
        }
      } catch (err) {
        this.logger.warn(`Heartbeat of ${entry.runId} failed: ${this.messageOf(err)}`);
      }
    }
  }

  private async stopRequested(): Promise<void> {
    if (this.active.size === 0) return;
    for (const r of await this.runs.withStopRequested()) {
      const entry = this.active.get(r.id);
      if (entry !== undefined && r.stopRequested !== null) this.stop(entry, stopOf(r.stopRequested));
    }
  }

  private async recover(): Promise<void> {
    for (const run of await this.runs.orphaned()) {
      if (this.active.has(run.id) || !(await this.runs.lease(run.orbitId, run.id, this.owner, this.timings.leaseMs))) continue;
      await this.reconcile(run).catch((err: unknown) => this.logger.warn(`Recovery of ${run.id} failed: ${this.messageOf(err)}`));
    }
    for (const run of await this.runs.unreleased()) {
      if (this.active.has(run.id) || !(await this.runs.lease(run.orbitId, run.id, this.owner, this.timings.leaseMs))) continue;
      await this.removeLeftover(run).catch((err: unknown) => this.logger.warn(`Clean-up of ${run.id} failed: ${this.messageOf(err)}`));
    }
  }

  // A run whose worker is gone: whatever the provider still has of it is stopped and removed -- verified -- before its
  // resources go back and Work hears it was interrupted. If that cannot be established, a person decides.
  private async reconcile(run: RunRecord): Promise<void> {
    const provider = this.provider as SandboxProvider;
    const actor = systemActor(run.orbitId, "execution-worker", `recover:${run.id}`);
    const found = await provider.find(run.dispatchKey).catch(() => undefined);
    let gone = found === null;
    if (found !== undefined && found !== null) {
      await provider.stop(found.handle, this.timings.graceMs).catch(() => undefined);
      gone = (await provider.remove(found.handle).catch(() => ({ gone: false }))).gone;
    }
    if (!gone) {
      if (run.state !== "unknown") {
        await this.runs.transition(run.orbitId, run.id, ["starting", "running"], "unknown", { detail: "Its worker stopped, and whether its sandbox still runs could not be established." }, run.fence, this.owner);
        await this.outcomes.recovering(actor, run.assignmentId, run.fence, "The worker running this attempt stopped, and whether its sandbox still runs could not be established. Orbit Web keeps checking; retry once it says the attempt is gone.").catch((e: unknown) => this.ignoreStale(e));
      }
      await this.runs.releaseLease(run.orbitId, run.id, this.owner);
      return;
    }
    const wasUnknown = run.state === "unknown";
    const detail = "Orbit Web stopped while this attempt ran; what it had started was stopped and removed. Retry it to run it again.";
    await this.runs.transition(run.orbitId, run.id, ["starting", "running", "unknown"], "interrupted", { endedAt: new Date().toISOString(), detail }, run.fence, this.owner);
    await this.admission.release(run.orbitId, run.id, "attempt interrupted");
    await this.governance.abandoned(run.orbitId, run.id, "interrupted");
    await this.outcomes.ended(actor, run.assignmentId, run.fence, { state: "interrupted", detail, stoppedFor: wasUnknown ? "recover" : null }).catch((e: unknown) => this.ignoreStale(e));
    await this.runs.releaseLease(run.orbitId, run.id, this.owner);
  }

  // An ended run whose sandbox was not verified removed: removed now, and its resources released once it is.
  private async removeLeftover(run: RunRecord): Promise<void> {
    const provider = this.provider as SandboxProvider;
    const found = await provider.find(run.dispatchKey);
    const gone = found === null ? true : (await provider.stop(found.handle, this.timings.graceMs).then(() => provider.remove(found.handle))).gone;
    if (gone) await this.admission.release(run.orbitId, run.id, "sandbox removed after its run ended");
    await this.runs.releaseLease(run.orbitId, run.id, this.owner);
  }

  // ---- small things ---------------------------------------------------------------------------------------------------

  private toolUrl(): string {
    return this.config.sourceEnv.ORBIT_WEB_TOOL_URL ?? `http://${this.config.governance.agentControlHost}:${this.config.port}/api/runtime/tools`;
  }

  // The model plane's own environment: a container's image provides its PATH; the development provider runs the CLI
  // here, with the server's allow-listed variables and an empty HOME.
  private modelPlaneBase(handle: AttemptHandle): Record<string, string> {
    if (handle.provider === "process") return { ...baseEnv(this.config, handle.modelPlaneCwd, false), HOME: handle.modelPlaneCwd };
    return { HOME: handle.modelPlaneCwd, LANG: "C.UTF-8", NO_COLOR: "1" };
  }

  private isStale(err: unknown): boolean {
    return err instanceof DomainError && (err.code === "stale_fence" || err.code === "invalid_transition");
  }

  private ignoreStale(err: unknown): void {
    if (!this.isStale(err)) this.logger.warn(`A run's end could not be reported: ${this.messageOf(err)}`);
  }

  private messageOf(err: unknown): string {
    return redactSecrets(err instanceof Error ? err.message : String(err)).slice(0, 500);
  }
}

export type { AttemptContext, RunState };
