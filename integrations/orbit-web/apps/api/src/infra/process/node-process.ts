// The real process port, over node:child_process. `shell: false` always; `detached: true` puts each child in a
// process group of its own, so a stop reaches the grandchildren a CLI starts (a test runner, a subagent's shell).
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import type { ExitInfo, ProcessHandle, ProcessPort, RunOptions, RunResult, SpawnOptions } from "./process.port.js";

const DEFAULT_MAX_OUTPUT = 4 * 1024 * 1024;

function signalGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

class NodeProcessHandle implements ProcessHandle {
  readonly exited: Promise<ExitInfo>;
  private readonly exitListeners: ((exit: ExitInfo) => void)[] = [];

  constructor(private readonly child: ChildProcess) {
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdin?.on("error", () => undefined);
    this.exited = new Promise((resolveExit) => {
      let settled = false;
      const settle = (exit: ExitInfo) => {
        if (settled) return;
        settled = true;
        for (const listener of this.exitListeners) listener(exit);
        resolveExit(exit);
      };
      child.on("error", (err: NodeJS.ErrnoException) => settle({ code: null, signal: null, spawnError: err.code ?? "ESPAWN" }));
      child.on("close", (code, signal) => settle({ code, signal, spawnError: null }));
      // A grandchild that inherited the pipes can hold them open after the child itself has exited: the exit is
      // still the child's, so it is settled a moment later without waiting for the pipes.
      child.on("exit", (code, signal) => setTimeout(() => settle({ code, signal, spawnError: null }), 3_000).unref());
    });
  }

  get pid(): number | null {
    return this.child.pid ?? null;
  }

  onStdout(listener: (chunk: string) => void): void {
    this.child.stdout?.on("data", listener);
  }

  onStderr(listener: (chunk: string) => void): void {
    this.child.stderr?.on("data", listener);
  }

  onExit(listener: (exit: ExitInfo) => void): void {
    this.exitListeners.push(listener);
  }

  write(text: string): void {
    if (this.child.stdin && !this.child.stdin.destroyed && this.child.stdin.writable) this.child.stdin.write(text);
  }

  closeInput(): void {
    if (this.child.stdin && !this.child.stdin.destroyed) this.child.stdin.end();
  }

  kill(signal: NodeJS.Signals): void {
    signalGroup(this.child, signal);
  }
}

// Collects one stream up to a byte limit.
class Collector {
  private readonly parts: string[] = [];
  private bytes = 0;
  truncated = false;

  constructor(private readonly limit: number) {}

  add(chunk: string): void {
    if (this.truncated) return;
    const size = Buffer.byteLength(chunk);
    if (this.bytes + size <= this.limit) {
      this.parts.push(chunk);
      this.bytes += size;
      return;
    }
    this.parts.push(Buffer.from(chunk).subarray(0, this.limit - this.bytes).toString("utf8"));
    this.bytes = this.limit;
    this.truncated = true;
  }

  text(): string {
    return this.parts.join("");
  }
}

export class NodeProcessPort implements ProcessPort {
  spawn(file: string, args: readonly string[], options: SpawnOptions): ProcessHandle {
    const child = nodeSpawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new NodeProcessHandle(child);
  }

  async run(file: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
    const handle = this.spawn(file, args, { cwd: options.cwd, env: options.env });
    const limit = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT;
    const out = new Collector(limit);
    const err = new Collector(limit);
    handle.onStdout((c) => out.add(c));
    handle.onStderr((c) => err.add(c));
    if (options.input !== undefined) handle.write(options.input);
    handle.closeInput();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      handle.kill("SIGTERM");
      setTimeout(() => handle.kill("SIGKILL"), 2_000).unref();
    }, options.timeoutMs);
    timer.unref();
    const exit = await handle.exited;
    clearTimeout(timer);
    return { ...exit, stdout: out.text(), stderr: err.text(), timedOut, truncated: out.truncated || err.truncated };
  }
}
