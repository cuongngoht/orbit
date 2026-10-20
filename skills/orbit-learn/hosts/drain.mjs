// The background drain of a protocol-2 session's engineering checkpoints (1.8.9): `cli/finalize.mjs --hook`, started
// detached and forgotten, bound to the session that queued them.
//
// A protocol-2 host (Codex, Antigravity) gives its Stop and SessionEnd hooks two or three seconds, which observing a
// change can outlast, and keeps a session's queue in that session's own room -- so the queue is drained by a process
// of its own, started from the hook that queued it, and again by the session's own Orbit commands (`help`, a workflow's
// finish) for a host that let the first one go. Silent and fail-open; the queue's lease keeps two drains apart
// (src/lifecycle/finalize.mjs), and what one could not finish waits for the next.
import { spawn } from "node:child_process";
import { join } from "node:path";

// Whether this process speaks for a protocol-2 session: its environment, or the flags it was started with.
export const protocolTwo = (env, argv = []) => env.ORBIT_HOST_PROTOCOL === "2" || argv.includes("--protocol=2");

// The host flags a command was started with, handed on so the drain binds to the same session.
export const hostFlags = (argv = []) => argv.filter((a) => a.startsWith("--host=") || a.startsWith("--protocol="));

export function drainLater(pluginRoot, env, opts = {}) {
  const child = spawn(process.execPath, [join(pluginRoot, "cli", "finalize.mjs"), "--hook", ...(opts.flags ?? [])], { cwd: opts.cwd ?? process.cwd(), env, detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => null);
  child.unref();
}
