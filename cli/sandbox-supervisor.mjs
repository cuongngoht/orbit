#!/usr/bin/env node
// SANDBOX SUPERVISOR: the one long-lived process an isolated sandbox runs on this machine (ADR 0036).
//
//   node sandbox-supervisor.mjs --task=<tsk-…> [--once]
//                     follow ONE task's isolated sandbox until it is released: a heartbeat a viewer can read, the
//                     pause / resume / cancel the roots that own a cancel write (`runtime sandbox-signal`), the
//                     lifetime a person set, a worker past its deadline -- and, on a cancel or a spent lifetime, the
//                     teardown in its order. It LAUNCHES nothing and knows no transport; it stops only what ownership
//                     proves. `--once` takes one tick and exits (what a test, or a person looking, uses).
//
// Launched detached by `runtime sandbox-start` behind a receipt of kind `supervisor`; exactly one per sandbox, held by
// an owner file in the sandbox's supervision room (a second one finds it and exits 0). It ends by itself when the
// sandbox is released or quarantined, and after its own hard lifetime.
//
// Exit 0 = ended · 2 = REFUSED (no such sandbox) · 3 = BLOCKED (its store cannot be read).
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, writeSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { bindSandbox } from "../skills/orbit-runtime/bind.mjs";
import { Refused } from "../src/errors.mjs";
import { short } from "../src/hash.mjs";
import { flag } from "../src/learn/args.mjs";
import { command } from "../src/project/command.mjs";
import { deps as depsOf } from "../src/runtime/lifecycle/deps.mjs";
import { released } from "../src/runtime/sandbox/release.mjs";
import { effectivePolicy } from "../src/runtime/sandbox/policy.mjs";
import { ISOLATION_PROVIDERS, isolationOf } from "../src/runtime/isolation/index.mjs";
import { stoppedNode } from "../src/runtime/sandbox/network.mjs";
import { TICK_MS, decided, factsNow, heartbeatLine, heartbeatsFile, supervisionRoom } from "../src/runtime/sandbox/supervise.mjs";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ARGS = process.argv.slice(2);

// How long one supervisor lives at most, whatever the sandbox says: a supervisor that outlived everything is a process
// nobody asked for.
export const HARD_LIFETIME_MS = 26 * 60 * 60 * 1000;

const ownerFile = (ctx) => join(supervisionRoom(ctx.rooms.liveSandbox), "supervisor.owner");

function alive(pid) {
  try { return process.kill(pid, 0), true; }
  catch (e) { return e?.code === "EPERM"; }
}

// The one supervisor of a sandbox: whoever creates the owner file holds it; a stale one (its pid gone) is taken over.
function held(file) {
  mkdirSync(dirname(file), { recursive: true });
  const other = Number(String(safeRead(file)).trim());
  if (other && other !== process.pid && alive(other)) return false;
  return written(file);
}

function written(file) {
  rmSync(file, { force: true });
  const fd = openSync(file, "wx", 0o600);
  return (writeSync(fd, String(process.pid)), closeSync(fd), true);
}

function safeRead(file) {
  try { return readFileSync(file, "utf8"); }
  catch { return ""; }
}

// One tick: the table's actions, done in order. -> true when the supervisor should end.
export async function tick(ctx, deps, state) {
  const policy = effectivePolicy(ctx.readSettings().settings).policy;
  const actions = decided(factsNow(ctx, policy));
  for (const a of actions) await acted(ctx, deps, state, a);
  return actions.some((a) => a.kind === "end");
}

const ACTS = {
  beat: (ctx, deps, state, a) => ctx.io.append(heartbeatsFile(supervisionRoom(ctx.rooms.liveSandbox)), heartbeatLine({ seq: ++state.seq, gen: state.gen, at: ctx.now(), state: a.state, running: ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).filter((s) => s.container && s.state === "RUNNING").length, workers: factsNow(ctx, effectivePolicy(ctx.readSettings().settings).policy).workers.length })),
  "stop-worker": (ctx, deps, state, a) => ((s) => (s ? stoppedNode(ctx, isolationOf(s.container.provider, ctx.isolation ?? ISOLATION_PROVIDERS), s, deps) : null))(ctx.sessions.read(a.session)),
  teardown: (ctx, deps) => released(ctx, deps),
  end: () => null,
};

const acted = async (ctx, deps, state, a) => ACTS[a.kind]?.(ctx, deps, state, a);

async function looped(ctx, deps, state) {
  for (;;) {
    if ((await tick(ctx, deps, state)) || Date.now() - state.since > HARD_LIFETIME_MS || state.once) return;
    await new Promise((r) => setTimeout(r, TICK_MS));
  }
}

async function main() {
  const task = flag(ARGS, "task");
  if (!task) throw new Refused("a supervisor follows one task's sandbox: --task=<tsk-…>");
  const ctx = bindSandbox({ pluginRoot: PLUGIN_ROOT, env: commandEnvironment(process.env, process.argv), cwd: process.cwd(), task });
  if (held(ownerFile(ctx))) await supervisedUntilEnd(ctx);
}

async function supervisedUntilEnd(ctx) {
  await looped(ctx, depsOf(ctx), { seq: 0, gen: short(`${process.pid}:${Date.now()}`, 8), since: Date.now(), once: ARGS.includes("--once") });
  rmSync(ownerFile(ctx), { force: true });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) command(main);
