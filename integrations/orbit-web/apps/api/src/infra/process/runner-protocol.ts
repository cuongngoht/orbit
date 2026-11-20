// THE RUNNER'S WIRE: how the control plane starts a program in the agent's container (governed deployment). One TCP
// connection per program, newline-delimited JSON frames, nothing else. The control plane speaks first and alone
// decides what runs (a file, an argument list, a directory, an environment -- never a shell line); the runner answers
// with what the program printed and how it ended. When the connection ends before the program, the runner kills the
// program's whole process group.
//
// Why TCP on the agent network and not a socket file: a socket file would sit in a directory the agent (the same Unix
// user) can write, where it could be replaced; a listening port can only be taken by killing the runner, which ends the
// agent's container.
import type { IsolationCheck } from "@orbit-web/contracts";

export const RUNNER_SIGNALS = ["SIGINT", "SIGTERM", "SIGKILL"] as const;
export type RunnerSignal = (typeof RUNNER_SIGNALS)[number];

// One frame at most this long (a prompt is at most 100 000 characters, base64 output is chunked).
export const MAX_FRAME = 4 * 1024 * 1024;

export interface SpawnFrame {
  op: "spawn";
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  // Standard output as bytes (base64 frames) rather than text.
  binary: boolean;
}

export interface AttestFrame {
  op: "attest";
  // Files the control plane wrote where the agent's container must see them, with what they hold.
  present: { name: string; path: string; nonce: string }[];
  // Files the control plane wrote where the agent's container must NOT see them.
  absent: { name: string; path: string }[];
  // Directories the agent's container must not be able to write.
  readOnly: { name: string; path: string }[];
  // An address on the internet a direct connection to must fail, and a name that must not resolve.
  egress: { host: string; port: number };
  dnsName: string;
}

export type ClientFrame = SpawnFrame | AttestFrame | { op: "in"; d: string } | { op: "eof" } | { op: "kill"; signal: RunnerSignal };

export type RunnerFrame =
  | { t: "started"; pid: number | null }
  | { t: "out"; d: string }
  | { t: "outb"; b: string }
  | { t: "err"; d: string }
  | { t: "exit"; code: number | null; signal: string | null; spawnError: string | null }
  | { t: "attested"; checks: IsolationCheck[]; hostname: string; uid: number | null }
  | { t: "error"; message: string };

const isStrings = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
const isEnv = (v: unknown): v is Record<string, string> => typeof v === "object" && v !== null && !Array.isArray(v) && Object.values(v).every((x) => typeof x === "string");
const isNamedPaths = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === "object" && x !== null && typeof (x as { name?: unknown }).name === "string" && typeof (x as { path?: unknown }).path === "string");

// A frame from the control plane, checked before anything is done with it; null for anything else.
export function clientFrame(line: string): ClientFrame | null {
  let v: unknown;
  try {
    v = JSON.parse(line);
  } catch {
    return null;
  }
  if (typeof v !== "object" || v === null) return null;
  const f = v as Record<string, unknown>;
  if (f.op === "spawn") return typeof f.file === "string" && f.file.length > 0 && isStrings(f.args) && typeof f.cwd === "string" && isEnv(f.env) ? { op: "spawn", file: f.file, args: f.args, cwd: f.cwd, env: f.env, binary: f.binary === true } : null;
  if (f.op === "in") return typeof f.d === "string" ? { op: "in", d: f.d } : null;
  if (f.op === "eof") return { op: "eof" };
  if (f.op === "kill") return (RUNNER_SIGNALS as readonly unknown[]).includes(f.signal) ? { op: "kill", signal: f.signal as RunnerSignal } : null;
  if (f.op === "attest" && isNamedPaths(f.present) && isNamedPaths(f.absent) && isNamedPaths(f.readOnly) && typeof f.dnsName === "string") {
    const egress = f.egress as { host?: unknown; port?: unknown } | undefined;
    if (typeof egress?.host !== "string" || typeof egress.port !== "number") return null;
    return { op: "attest", present: f.present as AttestFrame["present"], absent: f.absent as AttestFrame["absent"], readOnly: f.readOnly as AttestFrame["readOnly"], egress: { host: egress.host, port: egress.port }, dnsName: f.dnsName };
  }
  return null;
}

export const frame = (f: ClientFrame | RunnerFrame): string => `${JSON.stringify(f)}\n`;
