#!/usr/bin/env node
// THE RUNNER'S ENTRY: one repair round inside the runner container. It reads the round's brief (mounted read-only),
// checks what the network lets it reach, makes sure the round's ONE engineering task exists -- started through Orbit's
// own `autonomous-engineering.mjs start` on the first round, named by the brief on every later one, never a second --
// and then runs the coding host on it: Claude Code, given the round's prompt on stdin and the subject loaded as its
// plugin. Everything it writes goes to /work/out; what the host printed is kept as it came, bounded. It decides
// nothing about the change: the controller reads the task and the workspace back afterwards, and a verifier that
// shares nothing with this container judges them.
//
//   node /bench/entry.mjs     brief: /run/brief/brief.json      out: /work/out/{egress,start,runner}.json, host.jsonl
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { request } from "node:http";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

export const PATHS = { brief: "/run/brief/brief.json", out: "/work/out", repo: "/work/repo", store: "/work/store" };

export const TOOLS = "Read,Edit,Write,Glob,Grep,Bash,Skill,Agent,TodoWrite";

// What the host is told never to run, beside what the case already forbids: a second engineering task, and removing the
// one it has. A deny rule outranks an allow rule a skill brings; it is a guard, and the controller still counts the
// tasks the round left (a second one refuses the round).
export const DENIED = ["WebFetch", "WebSearch", ...["start", "cleanup", "remove-workspace"].flatMap((cmd) => [`Bash(node ${"/work/repo"}/cli/autonomous-engineering.mjs ${cmd}:*)`, `Bash(node cli/autonomous-engineering.mjs ${cmd}:*)`])];

const written = (name, value) => writeFileSync(`${PATHS.out}/${name}`, `${JSON.stringify(value, null, 2)}\n`);

// ---- what the network lets this container reach ------------------------------------------------------------------------

const direct = (host, port, ms) => new Promise((resolve) => {
  const s = connect(port, host, () => (s.destroy(), resolve("connected")));
  s.setTimeout(ms, () => (s.destroy(), resolve("timeout")));
  s.on("error", (e) => resolve(e.code ?? "error"));
});

const viaProxy = (proxy, target, ms) => new Promise((resolve) => {
  const r = request({ host: proxy.host, port: proxy.port, method: "CONNECT", path: target, timeout: ms });
  r.on("connect", (res, socket) => (socket.destroy(), resolve(res.statusCode)));
  r.on("timeout", () => (r.destroy(), resolve("timeout")));
  r.on("error", (e) => resolve(e.code ?? "error")).end();
});

const proxyOf = (env) => ((u) => (u ? { host: u.hostname, port: Number(u.port) || 3128 } : null))(env.HTTPS_PROXY ? new URL(env.HTTPS_PROXY) : null);

const resolved = (name) => lookup(name).then(() => "resolved", (e) => e.code ?? "failed");

// Positive evidence every way: nothing direct gets out, no outside name resolves (no channel through DNS either), the
// model's API answers through the proxy, and a host nobody allowed does not. A round whose network does not hold to
// this never runs the host.
export async function egressOf(env, allowedHost) {
  const proxy = proxyOf(env);
  const [outside, name, allowed, refused] = await Promise.all([direct("1.1.1.1", 443, 3000), resolved("example.com"), proxy ? viaProxy(proxy, `${allowedHost}:443`, 5000) : "no proxy", proxy ? viaProxy(proxy, "example.com:443", 5000) : "no proxy"]);
  return { direct: outside, name, allowedHost, allowed, refused, holds: outside !== "connected" && name !== "resolved" && allowed === 200 && refused === 403 };
}

// ---- the round's one engineering task ----------------------------------------------------------------------------------

const orbit = (cli, args, env) => spawnSync(process.execPath, [`${PATHS.repo}/cli/${cli}`, ...args], { cwd: PATHS.repo, env, encoding: "utf8", timeout: 300000, maxBuffer: 16 * 1024 * 1024 });

const jsonOf = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

export const startArgs = (b) => ["start", b.objective, `--attempts=${b.attempts}`, `--actions=${b.actions}`, `--minutes=${b.minutes}`, "--json"];

function taskOf(b, env) {
  if (b.task) return { task: b.task, started: false };
  const r = orbit("autonomous-engineering.mjs", startArgs(b), env);
  const j = jsonOf(r.stdout);
  return j?.task ? { task: j.task, started: true } : { task: null, started: false, exit: r.status, why: String(r.stderr || r.stdout).trim().split("\n").at(-1)?.slice(0, 300) ?? null };
}

// ---- the host ----------------------------------------------------------------------------------------------------------

export const hostArgs = (b) => ["-p", "--output-format", "stream-json", "--verbose", "--plugin-dir", PATHS.repo, "--permission-mode", "dontAsk", "--allowedTools", TOOLS, "--disallowedTools", DENIED.join(","), "--setting-sources", "user", "--strict-mcp-config", "--no-session-persistence", "--add-dir", PATHS.store, ...(b.model ? ["--model", b.model] : []), ...(b.usd > 0 ? ["--max-budget-usd", String(b.usd)] : [])];

// What the host printed, kept as it came up to `cap` bytes, and the last 64 KiB always -- where its result line is.
export function cappedSink(file, cap) {
  const fd = openSync(file, "w");
  const s = { bytes: 0, kept: 0, tail: Buffer.alloc(0), cut: false };
  return { s, write: (chunk) => keptChunk(fd, s, chunk, cap), close: () => closeSync(fd) };
}

function keptChunk(fd, s, chunk, cap) {
  const room = Math.max(0, Math.min(cap - s.kept, chunk.length));
  if (room > 0) writeSync(fd, chunk, 0, room);
  Object.assign(s, { kept: s.kept + room, bytes: s.bytes + chunk.length, cut: s.cut || room < chunk.length });
  s.tail = Buffer.concat([s.tail, chunk]).subarray(-65536);
}

const hosted = (b, env, sinks) => new Promise((resolve) => {
  const child = spawn("claude", hostArgs(b), { cwd: PATHS.repo, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.on("data", sinks.out.write);
  child.stderr.on("data", sinks.err.write);
  child.on("error", (e) => resolve({ exit: null, signal: null, error: e.code ?? String(e.message) })).on("close", (exit, signal) => resolve({ exit, signal }));
  child.stdin.on("error", () => null).end(b.prompt);
});

async function round(b, env) {
  const sinks = { out: cappedSink(`${PATHS.out}/host.jsonl`, b.outputBytes), err: cappedSink(`${PATHS.out}/host.err`, 1024 * 1024) };
  const ran = await hosted(b, env, sinks);
  [sinks.out, sinks.err].forEach((x) => x.close());
  writeFileSync(`${PATHS.out}/host-tail.jsonl`, sinks.out.s.tail);
  return { ...ran, hostBytes: sinks.out.s.bytes, truncated: sinks.out.s.cut };
}

// Why a round runs no host: its network did not hold, or its one engineering task does not exist.
const notRun = (egress, t) => (!egress.holds ? { exit: null, setup: "EGRESS", why: "the runner's network does not hold to what a round needs: nothing direct, no outside name, only the model's API through the proxy" } : { exit: null, setup: "TASK", why: t.why ?? "the engineering task could not be started" });

async function main() {
  const b = JSON.parse(readFileSync(PATHS.brief, "utf8"));
  const egress = await egressOf(process.env, b.allowedHost);
  const t = egress.holds ? taskOf(b, process.env) : { task: b.task ?? null, started: false };
  written("start.json", { ...t, egress, round: b.round, at: new Date().toISOString() });
  written("runner.json", { round: b.round, task: t.task, egress, startedAt: new Date().toISOString(), ...(egress.holds && t.task ? await round(b, process.env) : notRun(egress, t)), endedAt: new Date().toISOString() });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((e) => (process.stderr.write(`entry failed: ${e?.message ?? e}\n`), (process.exitCode = 3)));
