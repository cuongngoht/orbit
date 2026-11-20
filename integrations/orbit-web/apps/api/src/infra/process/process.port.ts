// THE PROCESS PORT: the one way Orbit Web starts a program. A program is a file and an ARGUMENT LIST, never a shell
// line: no endpoint takes a command, and a value a person typed is one argument, whatever characters it holds. Every
// child gets an explicit working directory and an explicit environment (built by ./env.ts from an allow-list), runs
// in a process group of its own, and is stopped as a group.
//
// TWO PLACEMENTS. PROCESS_PORT starts a program in the CONTROL PLANE (gh, az, a credentialed clone or push, a version
// probe): where the sign-ins and governance's records are. AGENT_PROCESS_PORT starts one where the AGENT runs: Claude
// Code itself, and every program that touches a workspace, the agent's own Claude configuration or Orbit's store --
// whatever the agent can write, read or plant a link in. In the single deployment both are this container; in the
// governed deployment the agent port reaches the agent container's runner (runner-port.ts), and the control plane
// never runs a program over what the agent can write.
export const PROCESS_PORT = Symbol("PROCESS_PORT");
export const AGENT_PROCESS_PORT = Symbol("AGENT_PROCESS_PORT");

export interface RunOptions {
  cwd: string;
  env: Record<string, string>;
  // Written to stdin, which is then closed. Without it, stdin is closed at once.
  input?: string;
  timeoutMs: number;
  // Per stream; output beyond it is dropped and `truncated` says so.
  maxOutputBytes?: number;
}

export interface ExitInfo {
  code: number | null;
  signal: string | null;
  // The program could not be started at all (e.g. ENOENT): its error code.
  spawnError: string | null;
}

export interface RunResult extends ExitInfo {
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface SpawnOptions {
  cwd: string;
  env: Record<string, string>;
}

export interface ProcessHandle {
  readonly pid: number | null;
  onStdout(listener: (chunk: string) => void): void;
  onStderr(listener: (chunk: string) => void): void;
  onExit(listener: (exit: ExitInfo) => void): void;
  write(text: string): void;
  closeInput(): void;
  // Signals the child's whole process group.
  kill(signal: NodeJS.Signals): void;
  readonly exited: Promise<ExitInfo>;
}

// A run whose standard output is bytes (a git bundle), kept whole up to the limit.
export interface BinaryResult extends ExitInfo {
  stdout: Buffer;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface ProcessPort {
  run(file: string, args: readonly string[], options: RunOptions): Promise<RunResult>;
  spawn(file: string, args: readonly string[], options: SpawnOptions): ProcessHandle;
  runBinary(file: string, args: readonly string[], options: RunOptions): Promise<BinaryResult>;
}

export const succeeded = (r: RunResult): boolean => r.code === 0 && r.spawnError === null && !r.timedOut;

// A one-line account of how a call ended, for an error message (the caller redacts it).
export function endedHow(r: RunResult): string {
  if (r.spawnError !== null) return `could not start (${r.spawnError})`;
  if (r.timedOut) return "timed out";
  if (r.signal !== null) return `stopped by ${r.signal}`;
  return `exited with code ${r.code}`;
}
