// Running a program in a container the allocator made: `execIn` asks the runtime to start it there (an argument list,
// a user, an environment), streams what it prints into bounded collectors and reads back how it ended; `runOnce` makes a
// container for one program (created, started, the program run, removed -- and removed by the runtime itself if the
// allocator dies before it can).
import { randomBytes } from "node:crypto";
import { ByteCollector } from "../infra/process/node-process.js";
import type { DockerEngine } from "./docker/engine.js";

export interface ExecOutcome {
  code: number | null;
  stdout: Buffer;
  stderr: Buffer;
  timedOut: boolean;
  truncated: boolean;
}

export interface ExecOptions {
  user?: string;
  env?: string[];
  workingDir?: string;
  stdin?: Buffer | null;
  timeoutMs: number;
  maxOutputBytes: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function execIn(engine: DockerEngine, containerId: string, cmd: string[], o: ExecOptions): Promise<ExecOutcome> {
  const stdin = o.stdin ?? null;
  const execId = await engine.execCreate(containerId, { Cmd: cmd, ...(o.env ? { Env: o.env } : {}), ...(o.user ? { User: o.user } : {}), ...(o.workingDir ? { WorkingDir: o.workingDir } : {}), AttachStdin: stdin !== null });
  const out = new ByteCollector(o.maxOutputBytes);
  const err = new ByteCollector(o.maxOutputBytes);
  const r = await engine.execStart(execId, { stdin, timeoutMs: o.timeoutMs, onStdout: (b) => out.add(b), onStderr: (b) => err.add(b) });
  let info = await engine.execInspect(execId);
  for (let i = 0; info.Running && !r.timedOut && i < 60; i += 1) {
    await sleep(50);
    info = await engine.execInspect(execId);
  }
  return { code: info.Running ? null : info.ExitCode, stdout: out.buffer(), stderr: err.buffer(), timedOut: r.timedOut || info.Running, truncated: out.truncated || err.truncated || r.truncatedStream };
}

export const text = (b: Buffer): string => b.toString("utf8").trim();

// A one-line account of a program that did not succeed, for an error (bounded).
export function failure(what: string, r: ExecOutcome): string {
  const said = text(r.stderr) || text(r.stdout);
  const how = r.timedOut ? "timed out" : `exited with ${r.code}`;
  return `${what} ${how}${said ? `: ${said.slice(0, 600)}` : ""}`;
}

export interface OnceBody {
  HostConfig: Record<string, unknown>;
  [k: string]: unknown;
}

export async function runOnce(engine: DockerEngine, prefix: string, body: OnceBody, cmd: string[], o: ExecOptions): Promise<ExecOutcome> {
  const name = `${prefix}-task-${randomBytes(6).toString("hex")}`;
  const created = await engine.containerCreate(name, { ...body, HostConfig: { ...body.HostConfig, AutoRemove: true } });
  if (created === null) throw new Error(`a container named ${name} already exists`);
  try {
    await engine.containerStart(created.id);
    return await execIn(engine, created.id, cmd, o);
  } finally {
    await engine.containerRemove(created.id, true).catch(() => undefined);
  }
}
