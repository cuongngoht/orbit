#!/usr/bin/env node
// THE ENTRY of a task container: what runs first in the container one (arm, task, trial) gets. It makes the run's
// fresh home and store (and the files its brief names in them, such as the host's own settings), checks what the
// network lets it reach -- nothing direct, no outside name, the model's API through the egress proxy and nothing else
// through it; or, for a container with no network, nothing at all -- and only then runs the agent the brief names, with the
// prompt on its stdin. An arm that is SEATED first has the plugin's own adoption command run here, once, before the
// agent (same user, same HOME and ORBIT_STORE_DIR, no credential): what a person does once in a repository they adopt
// the plugin in. The checkout must be byte for byte what it was before the seat (a seat writes only the store); a
// seat that failed, ran too long or wrote the checkout ends the run here, and no agent runs. The agent's stdout is
// this container's stdout (the controller captures it), bounded; what this
// entry itself observed goes to /opt/evalrun/out/entry.json, which the controller reads after the container ends.
// It decides nothing about the run: the controller and the grader do. Copied into the container alone; it imports
// nothing but Node.
//
//   node /opt/evalrun/entry.mjs        brief: /opt/evalrun/brief.json
//   exit 0 the agent ran (its own code is in entry.json) · 3 the network did not hold · 4 the agent did not start
//   · 5 the seat did not hold
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import { existsSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, writeFileSync, writeSync, closeSync } from "node:fs";
import { request } from "node:http";
import { connect } from "node:net";
import { connect as tlsConnect } from "node:tls";
import { dirname, join } from "node:path";
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

// A container with no network at all (an arm whose agent runs on the host): nothing direct gets out, no outside name
// resolves, and there is no proxy to ask.
async function isolatedOf(e) {
  const [outside, name] = await Promise.all([direct("1.1.1.1", 443, 3000), resolved(e.refusedProbe)]);
  return { isolated: true, direct: outside, outsideName: name, holds: outside !== "connected" && name !== "resolved" };
}

export async function egressOf(e) {
  if (e.isolated) return isolatedOf(e);
  const [outside, name, api, other] = await Promise.all([direct("1.1.1.1", 443, 3000), resolved(e.refusedProbe), apiAnswer(e.proxy, e.allow), tunnelled(e.proxy, `${e.refusedProbe}:443`, 5000)]);
  other.socket?.destroy();
  const holds = outside !== "connected" && name !== "resolved" && api.connect === 200 && typeof api.http === "number" && other.status === 403;
  return { direct: outside, outsideName: name, api, otherHost: other.status, holds };
}

// ---- the seat ----------------------------------------------------------------------------------------------------------------

// Every entry under `dir` (its root's .git apart) as path -> what it is: a file's mode and content digest, a link's
// target, a directory. Two of these that differ in any path are two checkouts.
export function treeOf(dir, skip = ".git") {
  const out = new Map();
  const walk = (rel) => {
    for (const name of readdirSync(join(dir, rel)).sort()) {
      const p = rel ? `${rel}/${name}` : name;
      if (!rel && name === skip) continue;
      const st = lstatSync(join(dir, p));
      if (st.isSymbolicLink()) out.set(p, `link ${readlinkSync(join(dir, p))}`);
      else if (st.isDirectory()) (out.set(p, "dir"), walk(p));
      else out.set(p, `file ${(st.mode & 0o111) ? "x" : "-"} ${createHash("sha256").update(readFileSync(join(dir, p))).digest("hex")}`);
    }
  };
  walk("");
  return out;
}

// The root .git as sizes and times only: what a seat did there is said, never hashed (packs are large) and never fatal.
const gitDirOf = (dir) => (existsSync(join(dir, ".git")) ? statsOf(join(dir, ".git")) : new Map());

function statsOf(dir) {
  const out = new Map();
  const walk = (rel) => {
    for (const name of readdirSync(join(dir, rel))) {
      const p = rel ? `${rel}/${name}` : name;
      const st = lstatSync(join(dir, p));
      if (st.isDirectory()) walk(p);
      else out.set(p, `${st.size} ${st.mtimeMs}`);
    }
  };
  walk("");
  return out;
}

export const changedOf = (a, b) => [...new Set([...a.keys(), ...b.keys()])].filter((p) => a.get(p) !== b.get(p)).sort();

const storeFiles = (dir) => (dir && existsSync(dir) ? [...statsOf(dir).keys()].sort() : []);

// The seat command, as the agent would be run: in the checkout, with this container's environment but no credential.
function seatRan(b) {
  return new Promise((resolve) => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !(b.seat.dropEnv ?? []).includes(k)));
    const log = openSync(b.seat.log ?? `${RUN_DIR}/out/seat.out`, "w");
    const s = { startedAt: Date.now(), timedOut: false };
    let child;
    try { child = spawn(b.seat.argv[0], b.seat.argv.slice(1), { cwd: b.repo, env, stdio: ["ignore", log, log] }); }
    catch (e) { return (closeSync(log), resolve({ exit: null, why: String(e.message), ms: 0 })); }
    const timer = setTimeout(() => ((s.timedOut = true), child.kill("SIGKILL")), b.seat.timeoutMs ?? 300000);
    child.on("error", (e) => (clearTimeout(timer), resolve({ exit: null, why: String(e.message), ms: Date.now() - s.startedAt })));
    child.on("close", (code, signal) => (clearTimeout(timer), closeSync(log), resolve({ exit: code, signal, timedOut: s.timedOut, ms: Date.now() - s.startedAt })));
  });
}

const seatWhy = (ran, changed) => (ran.exit !== 0 ? `the seat command ${ran.why ? `did not start: ${ran.why}` : ran.timedOut ? "ran past its time and was stopped" : `ended ${ran.signal ? `on ${ran.signal}` : `with exit ${ran.exit}`}`}` : changed.length ? `the seat wrote the checkout (${changed.slice(0, 5).join(", ")}${changed.length > 5 ? ", …" : ""}): a seat writes only the store` : null);

// The seat, once, before the agent: what it ran, how it ended, what it left in the store, and whether the checkout is
// exactly as it was.
export async function seatOf(b) {
  const [before, gitBefore, storeBefore] = [treeOf(b.repo), gitDirOf(b.repo), new Set(storeFiles(b.seat.store))];
  const ran = await seatRan(b);
  const changed = changedOf(before, treeOf(b.repo));
  const why = seatWhy(ran, changed);
  return { argv: b.seat.argv, exit: ran.exit, signal: ran.signal ?? null, timedOut: ran.timedOut === true, ms: ran.ms, unchanged: changed.length === 0, changed: changed.slice(0, 20), gitDirChanged: changedOf(gitBefore, gitDirOf(b.repo)).length, storeFiles: storeFiles(b.seat.store).filter((p) => !storeBefore.has(p)).slice(0, 200), holds: why === null, why };
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
  for (const f of b.writeFiles ?? []) (mkdirSync(dirname(f.path), { recursive: true }), writeFileSync(f.path, f.text));
  const egress = b.egress ? await egressOf(b.egress) : { none: true, holds: true };
  written("egress.json", egress);
  if (!egress.holds) return (written("entry.json", { phase: "egress", egress }), process.exit(3));
  const seat = b.seat ? await seatOf(b) : null;
  if (seat && !seat.holds) return (written("entry.json", { phase: "seat", seat }), process.exit(5));
  written("entry.json", { phase: "agent-started", startedAt: new Date().toISOString(), seat });
  const agent = await agentRan(b);
  written("entry.json", { phase: agent.spawned ? "ended" : "not-started", agent, seat });
  process.exit(agent.spawned ? 0 : 4);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
