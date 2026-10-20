// NATIVE: run a component directly on this machine, with the tools it already
// has.
//
// The provider every checkout can use without a container, and the one the
// resolver prefers when it can: nothing about an isolated environment is required
// to develop a project on the machine that has its tools. It installs NOTHING --
// a missing tool is a requirement a person is told about, with what to do, and
// never something Orbit fetches -- and it starts only what a file declared, with
// the argument list the declaration was tokenized into.
//
// A launched component is a child of nobody: it leads its own process group,
// writes to two log files, and outlives the command that started it. What Orbit
// keeps is the session receipt (src/runtime/sessions.mjs); stopping it later is
// decided from that receipt and from proof the pid is still the process that was
// launched (src/runtime/ownership.mjs), and ends the whole group.
import { join } from "node:path";
import { childEnv } from "../../process/env.mjs";
import { contained } from "../../project/boundary.mjs";
import { bindingOf, folded, onHost } from "../resolve/compat.mjs";
import { isAddress } from "../connectivity/targets.mjs";

export const GRACE_MS = 3000;
export const POLL_MS = 100;

export const native = {
  apiVersion: "orbit.runtime-provider/v1",
  id: "native",
  doc: "runs a component directly on this machine, with the tools it already has",
  compatibility: (component, world) => compatibility(component, world),
  doctor: (world) => ({ provider: "native", checks: world.view.components.map((c) => ({ component: c.key, ...compatibility(c, world) })) }),
  prepare: (world, deps, opts = {}) => (opts.apply ? { ok: true, because: "native has nothing to prepare", receipt: null } : preparation(world)),
  validate: (world) => ({ ok: true, because: "there is nothing to build: native runs what the machine already has", receipt: null }),
  ready: () => ({ ok: true, because: "native runs on the machine itself" }),
  start: (component, command, world, deps) => started(command, deps),
  status: (session, deps) => ({ alive: deps.process.alive(session.pid), startedAt: deps.process.startedAtOf(session.pid) }),
  stop: (session, deps) => halted(session, deps),
  reach: (target, world, deps) => reachedHere(target, deps),
};

// From THIS machine's own network: the name first, then one connection, each within the attempt's
// deadline. A lookup that never answered is UNKNOWN, one that said no is FAILED, and only then is a
// connection tried.
async function reachedHere(target, deps) {
  if (!deps.reach) return { resolution: "UNKNOWN", transport: "NOT_ATTEMPTED", because: "nothing on this machine was bound to ask the network" };
  const named = await deps.reach.resolve(target.host, { timeoutMs: deps.timeoutMs });
  if (!named.ok) return { resolution: named.timedOut ? "UNKNOWN" : "FAILED", transport: "NOT_ATTEMPTED", because: named.error };
  const port = await deps.reach.tcp(target.host, target.port, { timeoutMs: deps.timeoutMs });
  return { resolution: "RESOLVED", transport: port.ok ? "REACHABLE" : "UNREACHABLE", because: port.ok ? `${target.host}:${target.port} accepts a connection from this machine` : `${isAddress(target.host) ? "" : `${target.host} resolves here, but `}${port.error}` };
}

function compatibility(component, world) {
  const { bound, notes } = bindingOf(component, world.view.shared);
  const results = bound.map((r) => ({ requirement: r.requirement, ...onHost(r, world) }));
  return { ...folded(results), requirements: results, notes: notes.map((n) => `${n.requirement} may also be needed (${n.stage === "run" ? n.source : "to develop and test it"}), which is not held against starting it`) };
}

// Making native ready is the person's: what is missing, and what to do about it.
function preparation(world) {
  const needs = world.view.components.flatMap((c) => compatibility(c, world).blocking ?? []);
  return { provider: "native", host: [...new Set(needs)].map((say) => ({ say })), environment: [], repository: "no changes" };
}

function started(command, deps) {
  const cwd = contained(deps.root, join(deps.root, command.cwd));
  const [file, ...args] = command.argv;
  return deps.process.launch(file, args, { cwd, env: childEnv(deps.env ?? {}, deps.envNames ?? []), out: deps.logs.out, err: deps.logs.err });
}

// TERM to the group, a grace period, then KILL -- and each time the answer is
// asked of the OS, not assumed. The waits are AWAITED: a process takes time to
// answer a signal, and a loop that looked again without waiting would see it still
// there and call a clean stop a refusal.
async function halted(session, deps) {
  const term = deps.process.signal(session.pid, "SIGTERM", { tree: true });
  if (!term.ok) return { ok: false, how: "none", why: term.error };
  if (await gone(session, deps)) return { ok: true, how: "SIGTERM" };
  deps.process.signal(session.pid, "SIGKILL", { tree: true });
  return { ok: await gone(session, deps), how: "SIGKILL" };
}

async function gone(session, deps) {
  for (let waited = 0; waited < (deps.graceMs ?? GRACE_MS); waited += POLL_MS) {
    if (!deps.process.alive(session.pid)) return true;
    await deps.sleep(POLL_MS);
  }
  return !deps.process.alive(session.pid);
}
