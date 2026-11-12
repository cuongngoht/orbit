#!/usr/bin/env node
// THE ENTRY of a task container: what runs first in the container one (arm, task, trial) gets. It makes the run's
// fresh home and store, checks what the network lets it reach -- nothing direct, no outside name, the model's API
// through the egress proxy and nothing else through it -- and only then runs the agent the brief names, with the
// prompt on its stdin. The agent's stdout is this container's stdout (the controller captures it), bounded; what this
// entry itself observed goes to /opt/evalrun/out/entry.json, which the controller reads after the container ends.
// It decides nothing about the run: the controller and the grader do. Copied into the container alone; it imports
// nothing but Node.
//
//   node /opt/evalrun/entry.mjs        brief: /opt/evalrun/brief.json
//   exit 0 the agent ran (its own code is in entry.json) · 3 the network did not hold · 4 the agent did not start
import { spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { mkdirSync, openSync, readFileSync, writeFileSync, writeSync, closeSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { pathToFileURL } from "node:url";

export const RUN_DIR = "/opt/evalrun";

const written = (name, value) => writeFileSync(`${RUN_DIR}/out/${name}`, `${JSON.stringify(value, null, 2)}\n`);

// ---- the network ------------------------------------------------------------------------------------------------------------

const direct = (host, port, ms) => new Promise((resolve) => {
  const s = connect(port, host, () => (s.destroy(), resolve("connected")));
  s.setTimeout(ms, () => (s.destroy(), resolve("timeout")));
  s.on("error", (e) => resolve(e.code ?? "error"));
});

const resolved = (name) => lookup(name).then(() => "resolved", (e) => e.code ?? "failed");

// A CONNECT through the proxy: its status, and the socket when it is 200.
const tunnelled = (proxy, target, ms) => new Promise((resolve) => {
  const r = request({ host: proxy.host, port: proxy.port, method: "CONNECT", path: target, timeout: ms });
  r.on("connect", (res, socket) => resolve({ status: res.statusCode, socket }));
  r.on("timeout", () => (r.destroy(), resolve({ status: "timeout" })));
  r.on("error", (e) => resolve({ status: e.code ?? "error" })).end();
});

// The first HTTP status line an HTTPS host answers on a tunnel: proof that the API itself answers through the proxy,
// not only that a TCP connection opened.
const httpsStatus = (socket, host, ms) => new Promise((resolve) => {
  const t = tlsConnect({ socket, servername: host }, () => t.write(`GET / HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`));
  let text = "";
  const done = (v) => (t.destroy(), resolve(v));
  t.setTimeout(ms, () => done("timeout"));
  t.on("data", (d) => ((text += d.toString("latin1")), /^HTTP\/1\.[01] (\d{3})/.test(text) ? done(Number(/^HTTP\/1\.[01] (\d{3})/.exec(text)[1])) : null));
  t.on("error", (e) => done(e.code ?? "tls-error"));
  t.on("end", () => done(text ? "unreadable" : "closed"));
});

async function apiAnswer(proxy, host) {
  const c = await tunnelled(proxy, `${host}:443`, 8000);
  if (c.status !== 200) return { connect: c.status, http: null };
  return { connect: 200, http: await httpsStatus(c.socket, host, 10000) };
}

export async function egressOf(e) {
  const [outside, name, api, other] = await Promise.all([direct("1.1.1.1", 443, 3000), resolved(e.refusedProbe), apiAnswer(e.proxy, e.allow), tunnelled(e.proxy, `${e.refusedProbe}:443`, 5000)]);
  other.socket?.destroy();
  const holds = outside !== "connected" && name !== "resolved" && api.connect === 200 && typeof api.http === "number" && other.status === 403;
  return { direct: outside, outsideName: name, api, otherHost: other.status, holds };
}

// ---- the agent ---------------------------------------------------------------------------------------------------------------

function agentRan(b) {
  return new Promise((resolve) => {
    const err = openSync(`${RUN_DIR}/out/agent.err`, "w");
    const s = { bytes: 0, cut: false, errBytes: 0 };
    const startedAt = new Date().toISOString();
    let child;
    try { child = spawn(b.agent.argv[0], b.agent.argv.slice(1), { cwd: b.repo, env: process.env, stdio: ["pipe", "pipe", "pipe"] }); }
    catch (e) { return resolve({ spawned: false, why: String(e.message) }); }
    child.on("error", (e) => resolve({ spawned: false, why: String(e.message) }));
    child.stdout.on("data", (d) => out(s, d, b.outCap));
    child.stderr.on("data", (d) => ((s.errBytes += d.length), s.errBytes <= 1048576 ? writeSync(err, d) : null));
    child.stdin.on("error", () => null);
    child.stdin.end(b.agent.stdin ?? "");
    child.on("close", (code, signal) => (closeSync(err), resolve({ spawned: true, exit: code, signal, startedAt, endedAt: new Date().toISOString(), bytes: s.bytes, cut: s.cut })));
  });
}

function out(s, chunk, cap) {
  const room = Math.max(0, Math.min(cap - s.bytes, chunk.length));
  if (room > 0) process.stdout.write(chunk.subarray(0, room));
  s.bytes += chunk.length;
  s.cut = s.cut || room < chunk.length;
}

async function main() {
  const b = JSON.parse(readFileSync(`${RUN_DIR}/brief.json`, "utf8"));
  mkdirSync(`${RUN_DIR}/out`, { recursive: true });
  for (const d of b.makeDirs ?? []) mkdirSync(d, { recursive: true });
  const egress = b.egress ? await egressOf(b.egress) : { none: true, holds: true };
  written("egress.json", egress);
  if (!egress.holds) return (written("entry.json", { phase: "egress", egress }), process.exit(3));
  written("entry.json", { phase: "agent-started", startedAt: new Date().toISOString() });
  const agent = await agentRan(b);
  written("entry.json", { phase: agent.spawned ? "ended" : "not-started", agent });
  process.exit(agent.spawned ? 0 : 4);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
