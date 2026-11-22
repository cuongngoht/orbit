// A CHAT'S OR A RESEARCH SESSION'S RUN IN A SANDBOX OF ITS OWN. Where the allocator is (the single deployment's
// default: ORBIT_WEB_SANDBOX=container), every run's CLI starts in a container made for that run alone -- the Orbit Web
// image's runner, holding that chat's workspace and project room, that connection's home and that account's Orbit store,
// and nothing else of Orbit Web's data -- and the container is removed when the run ends, however it ends. Nothing here
// names an image, a mount or a path: the allocator works those out from the ids it is given (sandbox/ids.ts
// `sessionMounts`). At most `max` run at once; a run beyond waits, and is told so.
//
// Without an allocator (development) and in the governed deployment (its own agent container), a run starts where the
// agent's programs always have: this lease is the agent's process port, `sandboxed` false. A configuration that names an
// allocator nobody can use refuses runs instead -- a sandbox the operator asked for is never silently dropped.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { Logger, type OnApplicationBootstrap } from "@nestjs/common";
import type { AppConfig } from "../../config/config.js";
import { loadSandboxConfig } from "../../config/sandbox-config.js";
import { AllocatorClient } from "../../contexts/execution/infrastructure/sandbox/allocator-client.js";
import { readSecret, type AllocatorApi } from "../../contexts/execution/infrastructure/sandbox/allocator-protocol.js";
import { runnerToken } from "../../contexts/execution/infrastructure/sandbox/ids.js";
import type { ProcessPort } from "../../infra/process/process.port.js";
import { RunnerProcessPort } from "../../infra/process/runner-port.js";

export const SESSION_SANDBOXES = Symbol("SESSION_SANDBOXES");

// Whose run, and which of its places and sign-ins its sandbox holds.
export interface SessionRunSpec {
  accountId: string;
  sessionId: string;
  connectionId: string;
  runId: string;
  kind: "chat" | "research";
  // A chat's workspace, read-write or (a Plan run its sandbox holds to reading) read-only; research has none.
  workspace: "rw" | "ro" | "none";
  // The installation's GitHub or Azure sign-in, where the account turned that switch on.
  switches: { github: boolean; azure: boolean };
}

export interface SessionLease {
  // Where the run's programs start.
  port: ProcessPort;
  // The run has a sandbox of its own.
  sandboxed: boolean;
  // The name Orbit Web has where the run's programs are (the agent gateway's host), or null: Orbit Web's own address.
  controlHost: string | null;
  // Given back once the run has ended (twice is once).
  release(): Promise<void>;
}

export interface SessionSandboxes {
  readonly kind: "container" | "none" | "unavailable";
  // `waiting` is told, once, how many runs hold every sandbox when this one has to wait for one.
  acquire(spec: SessionRunSpec, waiting: (running: number) => void): Promise<SessionLease>;
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// No sandbox here: the run's programs start where the agent's always have.
export class NoSessionSandboxes implements SessionSandboxes {
  readonly kind = "none" as const;

  constructor(private readonly agent: ProcessPort) {}

  acquire(): Promise<SessionLease> {
    return Promise.resolve({ port: this.agent, sandboxed: false, controlHost: null, release: () => Promise.resolve() });
  }
}

// The operator asked for sandboxes and none can be made: every run is refused, saying why.
export class UnavailableSessionSandboxes implements SessionSandboxes {
  readonly kind = "unavailable" as const;

  constructor(private readonly why: string) {}

  acquire(): Promise<SessionLease> {
    return Promise.reject(new Error(`each run here has a sandbox of its own, and none can be made: ${this.why}`));
  }
}

export interface ContainerSessionOptions {
  secret: string;
  max: number;
  // Orbit Web's name on a run's network (the allocator connects it there under this alias).
  controlHost: string;
  // Orbit Web's own data root: the places a sandbox mounts are made here first (a mount needs its directory).
  dataRoot: string;
}

export class ContainerSessionSandboxes implements SessionSandboxes, OnApplicationBootstrap {
  readonly kind = "container" as const;
  private readonly logger = new Logger("RunSandboxes");
  private running = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly allocator: AllocatorApi,
    private readonly o: ContainerSessionOptions,
  ) {}

  // A run Orbit Web was cut off from (a restart) is over: its sandbox goes too.
  async onApplicationBootstrap(): Promise<void> {
    try {
      const swept = await this.allocator.sweepSessions();
      if (swept.removed > 0) this.logger.log(`removed ${swept.removed} run sandbox(es) left from before this start`);
    } catch (err) {
      this.logger.warn(`the run sandboxes left from before could not be swept: ${message(err)}`);
    }
  }

  async acquire(spec: SessionRunSpec, waiting: (running: number) => void): Promise<SessionLease> {
    await this.slot(waiting);
    const dispatchKey = `session:${spec.runId}`;
    try {
      this.places(spec);
      const made = await this.allocator.startSession({ ...spec, dispatchKey });
      return this.lease(dispatchKey, new RunnerProcessPort(made.name, made.port, runnerToken(this.o.secret, dispatchKey)));
    } catch (err) {
      // Whatever was made of it goes, and its place is free again.
      await this.allocator.removeSession(dispatchKey).catch(() => undefined);
      this.free();
      throw err;
    }
  }

  private lease(dispatchKey: string, port: ProcessPort): SessionLease {
    let given = false;
    return {
      port,
      sandboxed: true,
      controlHost: this.o.controlHost,
      release: async () => {
        if (given) return;
        given = true;
        try {
          const r = await this.allocator.removeSession(dispatchKey);
          if (!r.gone) this.logger.warn(`a run's sandbox is not gone (${dispatchKey}): ${r.detail}`);
        } catch (err) {
          this.logger.warn(`a run's sandbox could not be removed (${dispatchKey}): ${message(err)}`);
        } finally {
          this.free();
        }
      },
    };
  }

  // A chat's project room and its account's Orbit store exist before they are mounted (its workspace and the
  // connection's home already do).
  private places(spec: SessionRunSpec): void {
    if (spec.kind !== "chat") return;
    for (const dir of [join(this.o.dataRoot, "sessions", spec.sessionId), join(this.o.dataRoot, "orbit", "accounts", spec.accountId)]) mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  private slot(waiting: (running: number) => void): Promise<void> {
    if (this.running < this.o.max) {
      this.running += 1;
      return Promise.resolve();
    }
    waiting(this.running);
    return new Promise<void>((resolve) =>
      this.queue.push(() => {
        this.running += 1;
        resolve();
      }),
    );
  }

  private free(): void {
    this.running -= 1;
    this.queue.shift()?.();
  }
}

// Which one this Orbit Web runs: sandboxes where the allocator is (and the deployment is not the governed one, whose
// agent container is its runs' place); none where there is no allocator.
export function sessionSandboxesFor(config: AppConfig, agent: ProcessPort): SessionSandboxes {
  if (config.governance.deployment === "governed") return new NoSessionSandboxes(agent);
  try {
    const sandbox = loadSandboxConfig(config.sourceEnv);
    if (sandbox.provider !== "container" || sandbox.allocator === null) return new NoSessionSandboxes(agent);
    const secret = readSecret(sandbox.allocator.secretFile);
    return new ContainerSessionSandboxes(new AllocatorClient(sandbox.allocator.url, secret), { secret, max: sandbox.session.max, controlHost: sandbox.control.alias, dataRoot: config.data.root });
  } catch (err) {
    return new UnavailableSessionSandboxes(message(err));
  }
}
