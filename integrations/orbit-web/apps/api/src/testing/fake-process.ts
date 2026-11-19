// A process port for tests: each program call is answered by the first script whose matcher accepts it; a call no
// script accepts goes to the real port when one is given (so git really runs on a real temporary repository), and
// otherwise fails as a program that is not installed. Every call is recorded with its argument list and environment.
import { EventEmitter } from "node:events";
import type { ExitInfo, ProcessHandle, ProcessPort, RunOptions, RunResult, SpawnOptions } from "../infra/process/process.port.js";

export interface Call {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  input: string | undefined;
}

export type Matcher = (file: string, args: string[]) => boolean;

export type RunAnswer = Partial<RunResult> | ((call: Call) => Partial<RunResult> | Promise<Partial<RunResult>>);

export type SpawnScript = (child: FakeChild, call: Call) => void;

interface Script {
  match: Matcher;
  run?: RunAnswer;
  spawn?: SpawnScript;
}

// A child process the test drives: what it prints, when it exits, and what it was sent.
export class FakeChild implements ProcessHandle {
  readonly pid = 4242;
  readonly written: string[] = [];
  readonly signals: string[] = [];
  inputClosed = false;
  readonly exited: Promise<ExitInfo>;
  private readonly events = new EventEmitter();
  private ended = false;
  private resolveExit: (e: ExitInfo) => void = () => undefined;

  constructor() {
    this.exited = new Promise((r) => (this.resolveExit = r));
  }

  onStdout(listener: (chunk: string) => void): void {
    this.events.on("stdout", listener);
  }

  onStderr(listener: (chunk: string) => void): void {
    this.events.on("stderr", listener);
  }

  onExit(listener: (exit: ExitInfo) => void): void {
    this.events.on("exit", listener);
  }

  write(text: string): void {
    this.written.push(text);
    this.events.emit("input", text);
  }

  closeInput(): void {
    this.inputClosed = true;
    this.events.emit("input-closed");
  }

  kill(signal: NodeJS.Signals): void {
    this.signals.push(signal);
    this.events.emit("signal", signal);
  }

  // Test side.
  stdout(text: string): void {
    this.events.emit("stdout", text);
  }

  stderr(text: string): void {
    this.events.emit("stderr", text);
  }

  line(json: unknown): void {
    this.stdout(`${JSON.stringify(json)}\n`);
  }

  exit(code: number | null, signal: string | null = null): void {
    if (this.ended) return;
    this.ended = true;
    const info = { code, signal, spawnError: null };
    this.events.emit("exit", info);
    this.resolveExit(info);
  }

  // A script registers its listeners after the code under test may already have written and closed stdin: what
  // already happened is replayed to a listener that arrives late.
  onInput(listener: (text: string) => void): void {
    for (const text of this.written) listener(text);
    this.events.on("input", listener);
  }

  onInputClosed(listener: () => void): void {
    if (this.inputClosed) setImmediate(listener);
    else this.events.on("input-closed", listener);
  }

  onSignal(listener: (signal: string) => void): void {
    this.events.on("signal", listener);
  }
}

const result = (r: Partial<RunResult>): RunResult => ({ code: 0, signal: null, spawnError: null, stdout: "", stderr: "", timedOut: false, truncated: false, ...r });

export class FakeProcessPort implements ProcessPort {
  readonly calls: Call[] = [];
  readonly children: { call: Call; child: FakeChild }[] = [];
  private scripts: Script[] = [];

  constructor(private readonly real: ProcessPort | null = null) {}

  // Later scripts take precedence over earlier ones, so a test can override a default.
  on(match: Matcher, answer: { run?: RunAnswer; spawn?: SpawnScript }): this {
    this.scripts.unshift({ match, ...answer });
    return this;
  }

  reset(): void {
    this.scripts = [];
  }

  callsOf(match: Matcher): Call[] {
    return this.calls.filter((c) => match(c.file, c.args));
  }

  async run(file: string, args: readonly string[], options: RunOptions): Promise<RunResult> {
    const call: Call = { file, args: [...args], cwd: options.cwd, env: options.env, input: options.input };
    this.calls.push(call);
    const script = this.scripts.find((s) => s.run !== undefined && s.match(file, call.args));
    if (script?.run !== undefined) return result(typeof script.run === "function" ? await script.run(call) : script.run);
    if (this.real !== null) return this.real.run(file, args, options);
    return result({ code: null, spawnError: "ENOENT" });
  }

  spawn(file: string, args: readonly string[], options: SpawnOptions): ProcessHandle {
    const call: Call = { file, args: [...args], cwd: options.cwd, env: options.env, input: undefined };
    this.calls.push(call);
    const script = this.scripts.find((s) => s.spawn !== undefined && s.match(file, call.args));
    if (script?.spawn === undefined && this.real !== null) return this.real.spawn(file, args, options);
    const child = new FakeChild();
    this.children.push({ call, child });
    if (script?.spawn !== undefined) {
      const drive = script.spawn;
      setImmediate(() => drive(child, call));
    } else setImmediate(() => child.exit(127));
    return child;
  }
}

export const program = (name: string, ...prefix: string[]): Matcher => (file, args) => (file === name || file.endsWith(`/${name}`)) && prefix.every((p, i) => args[i] === p);
