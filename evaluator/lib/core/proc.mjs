// PROCESSES, always as an argument list and never a shell line. A child gets the environment it is handed and nothing
// else of this one: `cleanEnv` keeps the names a program needs to find itself (PATH, HOME, a docker context) and,
// when asked, a credential's NAME, so `docker run -e NAME` fills the value from it and the value is never written on a
// command line or read by the evaluator.
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, writeSync } from "node:fs";

const BASE = ["PATH", "HOME", "LANG", "LC_ALL", "TMPDIR", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];

export const cleanEnv = (env = process.env, extra = []) => Object.fromEntries([...BASE, ...extra].filter((k) => typeof env[k] === "string").map((k) => [k, env[k]]));

// One command run to its end: { ok, code, out, err }. `input` is written to its stdin; output is kept up to `max` bytes.
export function run(argv, o = {}) {
  const r = spawnSync(argv[0], argv.slice(1), { cwd: o.cwd, env: o.env ?? cleanEnv(), input: o.input, encoding: o.binary ? "buffer" : "utf8", timeout: o.timeoutMs ?? 600000, maxBuffer: o.max ?? 64 * 1024 * 1024 });
  return { ok: r.status === 0 && !r.error, code: r.status, signal: r.signal, out: r.stdout ?? "", err: r.error ? String(r.error.message) : String(r.stderr ?? ""), error: r.error ?? null };
}

export function must(argv, o = {}) {
  const r = run(argv, o);
  if (!r.ok) throw new Error(`${argv.slice(0, 3).join(" ")} failed (${r.code ?? r.signal}): ${String(r.err).trim().split("\n").slice(-3).join(" | ").slice(0, 400)}`);
  return r;
}

// A long command whose stdout goes to a file as it arrives, kept up to `capBytes` and its last 64 KiB always; a
// deadline (ms) calls `onDeadline` once, and `every` hooks ({ ms, fn }) are called while it runs.
export function runToFile(argv, file, o = {}) {
  return new Promise((resolve) => {
    const fd = openSync(file, "w");
    const s = { bytes: 0, kept: 0, cut: false, tail: Buffer.alloc(0), timedOut: false, err: "" };
    const child = spawn(argv[0], argv.slice(1), { env: o.env ?? cleanEnv(), stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.on("data", (chunk) => kept(fd, s, chunk, o.capBytes ?? 16 * 1024 * 1024));
    child.stderr.on("data", (chunk) => (s.err = (s.err + chunk.toString("utf8")).slice(-8192)));
    const timers = hooks(child, s, o);
    child.on("close", (code, signal) => {
      timers.forEach(clearTimeout);
      if (s.cut) writeSync(fd, Buffer.concat([Buffer.from("\n"), s.tail]));
      closeSync(fd);
      resolve({ code, signal, bytes: s.bytes, cut: s.cut, timedOut: s.timedOut, err: s.err });
    });
  });
}

function kept(fd, s, chunk, cap) {
  const room = Math.max(0, Math.min(cap - s.kept, chunk.length));
  if (room > 0) writeSync(fd, chunk, 0, room);
  s.kept += room;
  s.bytes += chunk.length;
  s.cut = s.cut || room < chunk.length;
  s.tail = Buffer.concat([s.tail, chunk]).subarray(-65536);
}

function hooks(child, s, o) {
  const timers = [];
  if (o.deadlineMs > 0) timers.push(setTimeout(() => ((s.timedOut = true), o.onDeadline?.()), o.deadlineMs));
  for (const h of o.at ?? []) timers.push(setTimeout(() => h.fn(), h.ms));
  return timers;
}
