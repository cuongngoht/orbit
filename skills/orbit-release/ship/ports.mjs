// THE SHIP'S PORTS, bound to this machine: the benchmark as a child process (watched while it runs, stopped on a
// person's word), git as an argument list with no hook and no fsmonitor, the gates run in a cycle's own checkout, and
// the release workspace. Only ship.mjs imports this file; everything that decides is handed these ports, and a test
// hands it fakes.
//
//   benchPort(root, env) -> (args, o) -> Promise<{ code, json, err, stopped }>
//   gitPort(noHooks, env) -> (cwd, args) -> { ok, code, out, err }      gatesAt(env) -> (cwd) -> gate runner
//   workspacesOf(root, storeRoot, env) -> the workspace owner (src/orchestration/workspace.mjs)
import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";
import { createLocalClones } from "../../../src/frontend/local-clones.mjs";
import { createWorkspaces } from "../../../src/orchestration/workspace.mjs";
import { createProcess } from "../../../src/process/index.mjs";
import { guardedIo } from "../../../src/store/guard.mjs";
import { realIo } from "../../../src/store/io.mjs";

const MAX_OUT = 64 * 1024 * 1024;

// A gate's deadline only stops a hang: a Windows runner takes eight to ten minutes over the suite.
const GATE_MS = 20 * 60000;

const parsed = (text) => {
  try { return JSON.parse(text); }
  catch { return null; }
};

const tail = (text) => String(text ?? "").trim().split("\n").filter(Boolean).slice(-3).join(" | ").slice(0, 600) || null;

// ---- the benchmark, as a child ------------------------------------------------------------------------------------------

function collected(child) {
  const got = { out: [], bytes: 0, err: "" };
  child.stdout.on("data", (d) => (got.bytes < MAX_OUT ? (got.out.push(d), (got.bytes += d.length)) : null));
  child.stderr.on("data", (d) => (got.err = `${got.err}${d}`.slice(-16384)));
  return got;
}

function stopping(child, s) {
  s.stopped = true;
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 10000).unref();
}

// Every so often, the ship's own word on whether to go on: "stop" ends the child, as a person's pause or cancel does.
const watching = (child, o, s) => (o.watch ? setInterval(() => (!s.stopped && o.watch() === "stop" ? stopping(child, s) : null), o.everyMs ?? 15000) : null);

const answered = (got, code, s) => ({ code, json: parsed(Buffer.concat(got.out).toString("utf8")), err: tail(got.err), stopped: s.stopped });

function spawned(root, env, args, o, resolve) {
  const child = spawn(process.execPath, [join(root, "benchmark", "run.mjs"), ...args, "--json"], { cwd: root, env, stdio: ["ignore", "pipe", "pipe"] });
  const s = { stopped: false };
  const got = collected(child);
  const timer = watching(child, o, s);
  child.on("close", (code) => (clearInterval(timer), resolve(answered(got, code, s))));
}

export const benchPort = (root, env) => (args, o = {}) => new Promise((resolve) => spawned(root, env, args, o, resolve));

// ---- git ---------------------------------------------------------------------------------------------------------------

export const gitPort = (noHooks, env) => (cwd, args) => ((r) => ({ ok: r.status === 0, code: r.status, out: r.stdout ?? "", err: r.stderr ?? String(r.error?.message ?? "") }))(spawnSync("git", ["-c", `core.hooksPath=${noHooks}`, "-c", "core.fsmonitor=false", "-C", cwd, ...args], { env, encoding: "utf8", maxBuffer: MAX_OUT, timeout: 600000 }));

// ---- the gates, in a checkout of their own -----------------------------------------------------------------------------

// Every gate is `node <args>` run in the cycle's checkout, which hands it nothing about where the ship was started.
export const gatesAt = (env) => (cwd) => (args, extra = {}) => ((r) => ({ out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status, read: (file) => (existsSync(join(cwd, file)) ? readFileSync(join(cwd, file), "utf8") : null) }))(spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: { ...env, ...extra }, timeout: GATE_MS, maxBuffer: MAX_OUT }));

// ---- the release workspace ---------------------------------------------------------------------------------------------

export const workspacesOf = (root, storeRoot, env) => createWorkspaces({ root: storeRoot, io: guardedIo(storeRoot, realIo()), trees: createLocalClones(root, createProcess(), { noHooks: join(storeRoot, "workspaces", ".no-hooks"), inherit: env }), host: hostname(), now: () => new Date().toISOString() });
