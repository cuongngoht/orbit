// THE AGENT CONTAINER'S RUNNER (governed deployment): starts, in this container and as its user, exactly the program
// the control plane asked for -- a file and an argument list, in a directory, with an environment, never a shell line
// -- streams what it prints back, and kills its whole process group when it is told to or when the connection ends.
// It holds no credential and decides nothing: whatever reaches it can only run things as the agent, in the agent's
// container, which the agent can do anyway.
//
// It also answers the control plane's isolation check (`attest`): which of the files the control plane just wrote it
// can see, whether it can write where it must not, whether it can reach the control plane's database, and whether it
// can reach the internet or resolve a public name directly. Its answers are this container's word -- a check of the deployment's wiring, not proof against a runner the
// agent has taken over.
import { spawn, type ChildProcess } from "node:child_process";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { lookup } from "node:dns/promises";
import { lstatSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { connect, createServer, type Server, type Socket } from "node:net";
import { join } from "node:path";
import type { IsolationCheck } from "@orbit-web/contracts";
import { LineSplitter } from "../infra/process/lines.js";
import { clientFrame, frame, MAX_FRAME, type AttestFrame, type RunnerFrame, type SpawnFrame } from "../infra/process/runner-protocol.js";

const send = (socket: Socket, f: RunnerFrame): void => {
  if (!socket.destroyed) socket.write(frame(f));
};

function killGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined || child.exitCode !== null || child.signalCode !== null) return;
  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function startProgram(socket: Socket, f: SpawnFrame): ChildProcess {
  const child = spawn(f.file, f.args, { cwd: f.cwd, env: f.env, shell: false, detached: true, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin?.on("error", () => undefined);
  if (!f.binary) child.stdout?.setEncoding("utf8");
  child.stderr?.setEncoding("utf8");
  send(socket, { t: "started", pid: child.pid ?? null });
  child.stdout?.on("data", (c: string | Buffer) => send(socket, f.binary ? { t: "outb", b: (c as Buffer).toString("base64") } : { t: "out", d: c as string }));
  child.stderr?.on("data", (c: string) => send(socket, { t: "err", d: c }));
  let ended = false;
  const end = (code: number | null, signal: string | null, spawnError: string | null) => {
    if (ended) return;
    ended = true;
    send(socket, { t: "exit", code, signal, spawnError });
    socket.end();
  };
  child.on("error", (err: NodeJS.ErrnoException) => end(null, null, err.code ?? "ESPAWN"));
  child.on("close", (code, signal) => end(code, signal, null));
  child.on("exit", (code, signal) => setTimeout(() => end(code, signal, null), 3_000).unref());
  return child;
}

const errorCode = (err: unknown): string => (err as NodeJS.ErrnoException)?.code ?? "error";

function presentCheck(p: AttestFrame["present"][number]): IsolationCheck {
  try {
    const held = readFileSync(p.path, "utf8").trim();
    return held === p.nonce ? { name: p.name, ok: true, detail: "visible here, as expected" } : { name: p.name, ok: false, detail: "visible, but not what the control plane wrote" };
  } catch (err) {
    return { name: p.name, ok: false, detail: `not visible here (${errorCode(err)}): this is not the agent's shared room` };
  }
}

function absentCheck(a: AttestFrame["absent"][number]): IsolationCheck {
  try {
    lstatSync(a.path);
    return { name: a.name, ok: false, detail: "VISIBLE from the agent's container" };
  } catch (err) {
    return errorCode(err) === "ENOENT" ? { name: a.name, ok: true, detail: "not in the agent's container" } : { name: a.name, ok: false, detail: `could not be told (${errorCode(err)})` };
  }
}

function readOnlyCheck(r: AttestFrame["readOnly"][number]): IsolationCheck {
  const probe = join(r.path, `.orbit-write-probe-${randomBytes(6).toString("hex")}`);
  try {
    writeFileSync(probe, "x", { flag: "wx" });
    rmSync(probe, { force: true });
    return { name: r.name, ok: false, detail: "WRITABLE from the agent's container" };
  } catch (err) {
    return { name: r.name, ok: true, detail: `not writable here (${errorCode(err)})` };
  }
}

// A connection that must fail from here: open is the finding, refused or timed out is the check holding.
function closedCheck(name: string, host: string, port: number, what: string): Promise<IsolationCheck> {
  return new Promise((resolve) => {
    const s = connect({ host, port, timeout: 3_000 });
    const done = (c: IsolationCheck) => {
      s.destroy();
      resolve(c);
    };
    s.on("connect", () => done({ name, ok: false, detail: `a connection to ${what} at ${host}:${port} SUCCEEDED from the agent's container` }));
    s.on("timeout", () => done({ name, ok: true, detail: `${what} cannot be reached from here (${host}:${port} timed out)` }));
    s.on("error", (err) => done({ name, ok: true, detail: `${what} cannot be reached from here (${errorCode(err)})` }));
  });
}

async function dnsCheck(name: string): Promise<IsolationCheck> {
  try {
    const found = await lookup(name);
    return { name: "public_dns", ok: false, detail: `${name} RESOLVED to ${found.address} from the agent's network: names are a channel out` };
  } catch (err) {
    return { name: "public_dns", ok: true, detail: `public names do not resolve here (${errorCode(err)})` };
  }
}

async function attest(socket: Socket, f: AttestFrame): Promise<void> {
  const closed = await Promise.all(f.closed.map((c) => closedCheck(c.name, c.host, c.port, "the control plane's server")));
  const checks = [...f.present.map(presentCheck), ...f.absent.map(absentCheck), ...f.readOnly.map(readOnlyCheck), ...closed, await closedCheck("direct_egress", f.egress.host, f.egress.port, "the internet"), await dnsCheck(f.dnsName)];
  send(socket, { t: "attested", checks, hostname: hostname(), uid: process.getuid?.() ?? null });
  socket.end();
}

export interface RunnerOptions {
  // A runner started with a token (an employee attempt's model plane) refuses every connection whose first frame does
  // not name it, and closes one that names nothing within AUTH_DEADLINE_MS.
  token?: string | null;
  // Variables every program it starts is given beneath the ones the frame names (the model plane's PATH, and an API key
  // the allocator placed in the container's environment).
  baseEnv?: Record<string, string>;
}

const AUTH_DEADLINE_MS = 10_000;
const digest = (s: string): Buffer => createHash("sha256").update(s, "utf8").digest();
const sameToken = (given: string, expected: string): boolean => timingSafeEqual(digest(given), digest(expected));

function serve(socket: Socket, options: RunnerOptions): void {
  let child: ChildProcess | null = null;
  let begun = false;
  const token = options.token ?? null;
  let authenticated = token === null;
  const deadline = token === null ? null : setTimeout(() => socket.destroy(), AUTH_DEADLINE_MS);
  deadline?.unref();
  socket.setEncoding("utf8");
  const splitter = new LineSplitter((line) => {
    if (socket.destroyed) return;
    const f = clientFrame(line);
    if (f === null) return send(socket, { t: "error", message: "not a frame the runner reads" });
    if (!authenticated) {
      if (f.op === "auth" && token !== null && sameToken(f.token, token)) {
        authenticated = true;
        if (deadline !== null) clearTimeout(deadline);
        return;
      }
      send(socket, { t: "error", message: "this runner answers only its own attempt: name its token first" });
      socket.destroy();
      return;
    }
    if (f.op === "auth") return;
    if (f.op === "spawn" && !begun) {
      begun = true;
      child = startProgram(socket, { ...f, env: { ...(options.baseEnv ?? {}), ...f.env } });
      return;
    }
    if (f.op === "attest" && !begun) {
      begun = true;
      void attest(socket, f);
      return;
    }
    if (child === null) return;
    if (f.op === "in" && child.stdin && !child.stdin.destroyed) child.stdin.write(f.d);
    if (f.op === "eof" && child.stdin && !child.stdin.destroyed) child.stdin.end();
    if (f.op === "kill") killGroup(child, f.signal);
  }, MAX_FRAME);
  socket.on("data", (chunk: string) => splitter.push(chunk));
  socket.on("error", () => undefined);
  // The control plane hung up: nothing it started may outlive it.
  socket.on("close", () => {
    if (child !== null) killGroup(child, "SIGKILL");
  });
}

export function startRunner(port: number, host = "0.0.0.0", options: RunnerOptions = {}): Promise<Server> {
  const server = createServer((socket) => serve(socket, options));
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve(server));
  });
}
