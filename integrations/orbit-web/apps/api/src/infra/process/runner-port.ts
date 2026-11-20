// THE AGENT PLACEMENT in the governed deployment: a process port whose programs run in the agent's container, through
// its runner (runner/server.ts, wire in runner-protocol.ts). To its callers it is the process port they know -- a
// handle that streams, takes input, is killed as a group, and ends with an exit -- and `run` is held to the same
// limits as on this side (node-process.ts runText). A runner that cannot be reached is a program that could not
// start (ERUNNERUNREACHABLE), and one that goes away mid-run ends it (ERUNNERLOST): never a hang.
import type { IsolationCheck } from "@orbit-web/contracts";
import { connect, type Socket } from "node:net";
import { LineSplitter } from "./lines.js";
import { runBytes, runText, type BinaryHandle } from "./node-process.js";
import type { BinaryResult, ExitInfo, ProcessPort, RunOptions, RunResult, SpawnOptions } from "./process.port.js";
import { frame, MAX_FRAME, type AttestFrame, type ClientFrame, type RunnerFrame, type RunnerSignal } from "./runner-protocol.js";

const CONNECT_TIMEOUT_MS = 5_000;

function runnerFrame(line: string): RunnerFrame | null {
  try {
    const f = JSON.parse(line) as RunnerFrame;
    return typeof f === "object" && f !== null && typeof (f as { t?: unknown }).t === "string" ? f : null;
  } catch {
    return null;
  }
}

class RunnerHandle implements BinaryHandle {
  pid: number | null = null;
  readonly exited: Promise<ExitInfo>;
  private readonly socket: Socket;
  private readonly stdout: ((chunk: string) => void)[] = [];
  private readonly stdoutBytes: ((chunk: Buffer) => void)[] = [];
  private readonly stderr: ((chunk: string) => void)[] = [];
  private readonly exits: ((exit: ExitInfo) => void)[] = [];
  private settle: (exit: ExitInfo) => void = () => undefined;
  private settled = false;

  constructor(host: string, port: number, spawnFrame: ClientFrame) {
    this.exited = new Promise((resolve) => {
      this.settle = (exit) => {
        if (this.settled) return;
        this.settled = true;
        for (const l of this.exits) l(exit);
        resolve(exit);
      };
    });
    this.socket = connect({ host, port });
    this.socket.setEncoding("utf8");
    const timer = setTimeout(() => this.socket.destroy(new Error("ETIMEDOUT")), CONNECT_TIMEOUT_MS);
    timer.unref();
    let connected = false;
    this.socket.on("connect", () => {
      connected = true;
      clearTimeout(timer);
    });
    // Frames written before the connection opens are queued by the socket itself.
    this.socket.write(frame(spawnFrame));
    const splitter = new LineSplitter((line) => this.heard(runnerFrame(line)), MAX_FRAME);
    this.socket.on("data", (chunk: string) => splitter.push(chunk));
    this.socket.on("error", () => undefined);
    this.socket.on("close", () => this.settle({ code: null, signal: null, spawnError: connected ? "ERUNNERLOST" : "ERUNNERUNREACHABLE" }));
  }

  private heard(f: RunnerFrame | null): void {
    if (f === null) return;
    if (f.t === "started") this.pid = f.pid;
    if (f.t === "out") for (const l of this.stdout) l(f.d);
    if (f.t === "outb") {
      const bytes = Buffer.from(f.b, "base64");
      for (const l of this.stdoutBytes) l(bytes);
    }
    if (f.t === "err") for (const l of this.stderr) l(f.d);
    if (f.t === "exit") this.settle({ code: f.code, signal: f.signal, spawnError: f.spawnError });
  }

  onStdout(listener: (chunk: string) => void): void {
    this.stdout.push(listener);
  }

  onStdoutBytes(listener: (chunk: Buffer) => void): void {
    this.stdoutBytes.push(listener);
  }

  onStderr(listener: (chunk: string) => void): void {
    this.stderr.push(listener);
  }

  onExit(listener: (exit: ExitInfo) => void): void {
    this.exits.push(listener);
  }

  write(text: string): void {
    if (!this.socket.destroyed) this.socket.write(frame({ op: "in", d: text }));
  }

  closeInput(): void {
    if (!this.socket.destroyed) this.socket.write(frame({ op: "eof" }));
  }

  kill(signal: NodeJS.Signals): void {
    const s: RunnerSignal = signal === "SIGINT" || signal === "SIGTERM" ? signal : "SIGKILL";
    if (!this.socket.destroyed) this.socket.write(frame({ op: "kill", signal: s }));
  }
}

export interface Attestation {
  checks: IsolationCheck[];
  hostname: string;
  uid: number | null;
}

export class RunnerProcessPort implements ProcessPort {
  constructor(
    readonly host: string,
    readonly port: number,
  ) {}

  spawn(file: string, args: readonly string[], options: SpawnOptions): RunnerHandle {
    return new RunnerHandle(this.host, this.port, { op: "spawn", file, args: [...args], cwd: options.cwd, env: options.env, binary: false });
  }

  run(file: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
    return runText(this.spawn(file, args, { cwd: options.cwd, env: options.env }), options);
  }

  runBinary(file: string, args: readonly string[], options: RunOptions): Promise<BinaryResult> {
    return runBytes(new RunnerHandle(this.host, this.port, { op: "spawn", file, args: [...args], cwd: options.cwd, env: options.env, binary: true }), options);
  }

  // The isolation check, asked of the runner (runner/server.ts attest).
  attest(request: Omit<AttestFrame, "op">, timeoutMs = 15_000): Promise<Attestation> {
    return new Promise((resolve, reject) => {
      const socket = connect({ host: this.host, port: this.port });
      socket.setEncoding("utf8");
      const timer = setTimeout(() => socket.destroy(new Error("the runner did not answer the isolation check in time")), timeoutMs);
      let answered = false;
      const splitter = new LineSplitter((line) => {
        const f = runnerFrame(line);
        if (f?.t !== "attested") return;
        answered = true;
        clearTimeout(timer);
        resolve({ checks: f.checks, hostname: f.hostname, uid: f.uid });
        socket.end();
      }, MAX_FRAME);
      socket.on("data", (chunk: string) => splitter.push(chunk));
      socket.on("error", (err) => {
        clearTimeout(timer);
        if (!answered) reject(err);
      });
      socket.on("close", () => {
        clearTimeout(timer);
        if (!answered) reject(new Error("the runner closed the connection without answering"));
      });
      socket.write(frame({ op: "attest", ...request }));
    });
  }
}
