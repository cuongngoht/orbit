// The real process port, over node:child_process. `shell: false` always; `detached: true` puts each child in a
// process group of its own, so a stop reaches the grandchildren a CLI starts (a test runner, a subagent's shell).
import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import type { BinaryResult, ExitInfo, ProcessHandle, ProcessPort, RunOptions, RunResult, SpawnOptions } from "./process.port.js";

export const DEFAULT_MAX_OUTPUT = 4 * 1024 * 1024;

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

  constructor(
    private readonly child: ChildProcess,
    binary = false,
  ) {
    if (!binary) child.stdout?.setEncoding("utf8");
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

  // The raw bytes, for a handle spawned for binary output.
  onStdoutBytes(listener: (chunk: Buffer) => void): void {
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
export class Collector {
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

export class ByteCollector {
  private readonly parts: Buffer[] = [];
  private bytes = 0;
  truncated = false;

  constructor(private readonly limit: number) {}

  add(chunk: Buffer): void {
    if (this.truncated) return;
    if (this.bytes + chunk.length <= this.limit) {
      this.parts.push(chunk);
      this.bytes += chunk.length;
      return;
    }
    this.parts.push(chunk.subarray(0, this.limit - this.bytes));
    this.bytes = this.limit;
    this.truncated = true;
  }

  buffer(): Buffer {
    return Buffer.concat(this.parts);
  }
}

// What `run` is over any handle: the input written and closed, both streams collected to a limit, a timeout that
// stops the whole group. Shared by every port, so a program run through the agent's runner is held to exactly the
// same limits -- decided on THIS side. `takeStdout` attaches whatever collects standard output.
async function runOver(handle: ProcessHandle, options: RunOptions, takeStdout: () => void): Promise<ExitInfo & { stderr: string; timedOut: boolean; errTruncated: boolean }> {
  const err = new Collector(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT);
  takeStdout();
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
  return { ...exit, stderr: err.text(), timedOut, errTruncated: err.truncated };
}

export async function runText(handle: ProcessHandle, options: RunOptions): Promise<RunResult> {
  const out = new Collector(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT);
  const r = await runOver(handle, options, () => handle.onStdout((c) => out.add(c)));
  return { code: r.code, signal: r.signal, spawnError: r.spawnError, stdout: out.text(), stderr: r.stderr, timedOut: r.timedOut, truncated: out.truncated || r.errTruncated };
}

export interface BinaryHandle extends ProcessHandle {
  onStdoutBytes(listener: (chunk: Buffer) => void): void;
}

export async function runBytes(handle: BinaryHandle, options: RunOptions): Promise<BinaryResult> {
  const out = new ByteCollector(options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT);
  const r = await runOver(handle, options, () => handle.onStdoutBytes((c) => out.add(c)));
  return { code: r.code, signal: r.signal, spawnError: r.spawnError, stdout: out.buffer(), stderr: r.stderr, timedOut: r.timedOut, truncated: out.truncated || r.errTruncated };
}

export class NodeProcessPort implements ProcessPort {
  spawn(file: string, args: readonly string[], options: SpawnOptions): ProcessHandle {
    return this.start(file, args, options, false);
  }

  run(file: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
    return runText(this.spawn(file, args, { cwd: options.cwd, env: options.env }), options);
  }

  runBinary(file: string, args: readonly string[], options: RunOptions): Promise<BinaryResult> {
    return runBytes(this.start(file, args, { cwd: options.cwd, env: options.env }, true), options);
  }

  private start(file: string, args: readonly string[], options: SpawnOptions, binary: boolean): NodeProcessHandle {
    const child = nodeSpawn(file, [...args], {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      detached: true,
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return new NodeProcessHandle(child, binary);
  }
}
