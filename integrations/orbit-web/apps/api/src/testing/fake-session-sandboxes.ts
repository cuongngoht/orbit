// A RUN'S SANDBOX, FAKED for the tests: every run's ask is recorded and answered with a port of its own that hands each
// program to the process port given (a FakeProcessPort, whose scripts play the CLI) and records it in `spawned` -- so a
// test tells a program started in the run's sandbox from one started anywhere else. `max` holds runs back the
// way the real one does (a run beyond waits for one to end); `refuse` makes the next asks fail, as an allocator that
// cannot make a sandbox does.
import type { BinaryResult, ProcessHandle, ProcessPort, RunOptions, RunResult, SpawnOptions } from "../infra/process/process.port.js";
import type { SessionLease, SessionRunSpec, SessionSandboxes } from "../modules/session-sandbox/session-sandboxes.js";

export class FakeSessionSandboxes implements SessionSandboxes {
  readonly kind = "container" as const;
  readonly acquired: SessionRunSpec[] = [];
  readonly released: string[] = [];
  // Every program started through a run's sandbox: the run's id and the program.
  readonly spawned: { runId: string; file: string; args: readonly string[] }[] = [];
  refuse: string | null = null;
  private running = 0;
  private readonly queue: (() => void)[] = [];

  constructor(
    private readonly port: ProcessPort,
    private readonly max = Number.POSITIVE_INFINITY,
  ) {}

  async acquire(spec: SessionRunSpec, waiting: (running: number) => void): Promise<SessionLease> {
    if (this.refuse !== null) throw new Error(this.refuse);
    if (this.running >= this.max) {
      waiting(this.running);
      await new Promise<void>((resolve) => this.queue.push(resolve));
    }
    this.running += 1;
    this.acquired.push(spec);
    let given = false;
    return {
      port: this.portOf(spec.runId),
      sandboxed: true,
      controlHost: "orbit-web",
      release: () => {
        if (given) return Promise.resolve();
        given = true;
        this.released.push(spec.runId);
        this.running -= 1;
        this.queue.shift()?.();
        return Promise.resolve();
      },
    };
  }

  private portOf(runId: string): ProcessPort {
    const via = this.port;
    const seen = (file: string, args: readonly string[]) => this.spawned.push({ runId, file, args });
    return {
      run: (file: string, args: readonly string[], o: RunOptions): Promise<RunResult> => {
        seen(file, args);
        return via.run(file, args, o);
      },
      spawn: (file: string, args: readonly string[], o: SpawnOptions): ProcessHandle => {
        seen(file, args);
        return via.spawn(file, args, o);
      },
      runBinary: (file: string, args: readonly string[], o: RunOptions): Promise<BinaryResult> => {
        seen(file, args);
        return via.runBinary(file, args, o);
      },
    };
  }
}
