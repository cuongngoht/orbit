#!/usr/bin/env node
// THE RUNNER'S ENTRY: one round inside the runner container. It reads the round's brief (mounted read-only), checks
// what the network lets it reach, and runs the coding host: Claude Code, given the round's prompt on stdin and the
// plugin it was handed. A REPAIR round first makes sure its ONE engineering task exists -- started through Orbit's own
// `autonomous-engineering.mjs start` on the first round, named by the brief on every later one, never a second. A QA
// round starts nothing: its investigation is already open beside the controller, and the plugin's autonomous-qa is the
// relay's client. Everything it writes goes to /work/out; what the host printed is kept as it came, bounded. It decides
// nothing: the controller reads back what the round left, and a verifier that shares nothing with this container judges.
//
// A SCRIPTED host -- a control's, never a model's -- runs in this same container with no network at all: there is no
// egress to check, and in place of Claude Code it runs /bench/scripted.mjs, which drives the same engineering task
// through Orbit's own loop with the edits its control defines.
//
// A GOAL round (an engineering case) starts no task either: the goal is handed to Orbit's own goal entry, which starts
// the workflow and the engineering task it needs. Orbit is the plugin at /work/orbit; /work/repo is the target.
//
//   node /bench/entry.mjs     brief: /run/brief/brief.json      out: /work/out/{egress,start,runner}.json, host.jsonl
import { spawn, spawnSync } from "node:child_process";
import { closeSync, openSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { request } from "node:http";
import { connect } from "node:net";
import { pathToFileURL } from "node:url";

export const PATHS = { brief: "/run/brief/brief.json", out: "/work/out", repo: "/work/repo", store: "/work/store", target: "/work/target" };

export const TOOLS = "Read,Edit,Write,Glob,Grep,Bash,Skill,Agent,TodoWrite";

// A QA round's host edits nothing: it reads, decides, and may write a decision to a file of its own before sending it.
export const QA_TOOLS = "Read,Write,Glob,Grep,Bash,Skill,TodoWrite";

// What the host is told never to run, beside what the case already forbids: a second engineering task, and removing the
// one it has. A deny rule outranks an allow rule a skill brings; it is a guard, and the controller still counts the
// tasks the round left (a second one refuses the round).
export const DENIED = ["WebFetch", "WebSearch", ...["start", "cleanup", "remove-workspace"].flatMap((cmd) => [`Bash(node ${"/work/repo"}/cli/autonomous-engineering.mjs ${cmd}:*)`, `Bash(node cli/autonomous-engineering.mjs ${cmd}:*)`])];

// What a goal round's host is told never to run: removing what its tasks left. Its tasks are its goal's to start.
export const GOAL_DENIED = ["WebFetch", "WebSearch", ...["cleanup", "remove-workspace"].map((cmd) => `Bash(node /work/orbit/cli/autonomous-engineering.mjs ${cmd}:*)`)];

const isGoal = (b) => b.kind === "engineering";

const pluginOf = (b) => b.plugin ?? PATHS.repo;

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

// A control's scripted host, named by its brief: it needs and has no network.
export const isScripted = (b) => String(b.host ?? "").startsWith("scripted:");

// A session host: the operator's own session drives this round from outside the container (docker exec), so nothing in
// it reasons and it needs no network either.
export const isSession = (b) => String(b.host ?? "").startsWith("session:");

const NO_NETWORK = { holds: true, none: true, says: "a scripted or session host runs with no network: nothing reasons in the container, so there is nothing to reach and no egress to check" };

const egressFor = (b, env) => (isScripted(b) || isSession(b) ? NO_NETWORK : egressOf(env, b.allowedHost));

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

// A round that starts no task of its own: a QA round (its investigation is open beside the controller), a goal round
// (its goal starts what it needs), or a later round (its task already exists).
const noStart = (b) => (isQa(b) ? { task: null, started: false, investigation: b.investigation } : isGoal(b) ? { task: null, started: false, goal: true } : b.task ? { task: b.task, started: false } : null);

function taskOf(b, env) {
  if (noStart(b)) return noStart(b);
  const r = orbit("autonomous-engineering.mjs", startArgs(b), env);
  const j = jsonOf(r.stdout);
  return j?.task ? { task: j.task, started: true } : { task: null, started: false, exit: r.status, why: String(r.stderr || r.stdout).trim().split("\n").at(-1)?.slice(0, 300) ?? null };
}

// ---- the host ----------------------------------------------------------------------------------------------------------

// A QA round's host also reads the application's public material, and no engineering task is started for it.
const isQa = (b) => b.kind === "qa";

export const hostArgs = (b) => ["-p", "--output-format", "stream-json", "--verbose", "--plugin-dir", pluginOf(b), "--permission-mode", "dontAsk", "--allowedTools", isQa(b) ? QA_TOOLS : TOOLS, "--disallowedTools", (isGoal(b) ? GOAL_DENIED : DENIED).join(","), "--setting-sources", "user", "--strict-mcp-config", "--no-session-persistence", "--add-dir", PATHS.store, ...(isQa(b) ? ["--add-dir", PATHS.target] : []), ...(b.model ? ["--model", b.model] : []), ...(b.usd > 0 ? ["--max-budget-usd", String(b.usd)] : [])];

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

// What runs as the host: Claude Code with its flags -- or, for a control, the scripted host on the round's task.
const HOST_PROGRAMS = [[isScripted, "/bench/scripted.mjs"], [isSession, "/bench/session.mjs"]];

export const hostCommand = (b, task) => ((p) => (p ? [process.execPath, [p[1], task ?? "-"]] : ["claude", hostArgs(b)]))(HOST_PROGRAMS.find(([is]) => is(b)));

const hosted = (b, env, sinks, task) => new Promise((resolve) => {
  const child = spawn(...hostCommand(b, task), { cwd: PATHS.repo, env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.on("data", sinks.out.write);
  child.stderr.on("data", sinks.err.write);
  child.on("error", (e) => resolve({ exit: null, signal: null, error: e.code ?? String(e.message) })).on("close", (exit, signal) => resolve({ exit, signal }));
  child.stdin.on("error", () => null).end(b.prompt);
});

async function round(b, env, task) {
  const sinks = { out: cappedSink(`${PATHS.out}/host.jsonl`, b.outputBytes), err: cappedSink(`${PATHS.out}/host.err`, 1024 * 1024) };
  const ran = await hosted(b, env, sinks, task);
  [sinks.out, sinks.err].forEach((x) => x.close());
  writeFileSync(`${PATHS.out}/host-tail.jsonl`, sinks.out.s.tail);
  return { ...ran, hostBytes: sinks.out.s.bytes, truncated: sinks.out.s.cut };
}

// Why a round runs no host: its network did not hold, or its one engineering task does not exist.
const notRun = (egress, t) => (!egress.holds ? { exit: null, setup: "EGRESS", why: "the runner's network does not hold to what a round needs: nothing direct, no outside name, only the model's API through the proxy" } : { exit: null, setup: "TASK", why: t.why ?? "the engineering task could not be started" });

async function main() {
  const b = JSON.parse(readFileSync(PATHS.brief, "utf8"));
  const egress = await egressFor(b, process.env);
  const t = egress.holds ? taskOf(b, process.env) : { task: b.task ?? null, started: false };
  written("start.json", { ...t, egress, round: b.round, at: new Date().toISOString() });
  written("runner.json", { round: b.round, task: t.task, egress, startedAt: new Date().toISOString(), ...(egress.holds && (t.task || isQa(b) || isGoal(b)) ? await round(b, process.env, t.task) : notRun(egress, t)), endedAt: new Date().toISOString() });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main().catch((e) => (process.stderr.write(`entry failed: ${e?.message ?? e}\n`), (process.exitCode = 3)));
