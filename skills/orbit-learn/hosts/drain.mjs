// The background drain of a protocol-2 session's engineering checkpoints (1.8.9): `cli/finalize.mjs --hook`, started
// detached and forgotten, bound to the session that queued them.
//
// A protocol-2 host (Codex, Antigravity) gives its Stop and SessionEnd hooks two or three seconds, which observing a
// change can outlast, and keeps a session's queue in that session's own room -- so the queue is drained by a process
// of its own, started from the hook that queued it, and again by the session's own Orbit commands (`help`, a workflow's
// finish) for a host that let the first one go. Silent and fail-open; the queue's lease keeps two drains apart
// (src/lifecycle/finalize.mjs), and what one could not finish waits for the next.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
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

// SELF-IMPROVEMENT's detection (0.3.0, ADR 0045), started the same way: `cli/improve.mjs analyse --hook`, detached and
// forgotten, from a hook or a workflow's end -- never inside the hook's own seconds. It is debounced in its own room,
// it carries a campaign only as far as reads and owner writes go, and it never evaluates: a provider is asked only
// from a session (`improve step`, `improve evaluate`). It starts in the system's temporary directory and is TOLD its
// checkout (`--checkout`): a process that outlives the hook never stands in the checkout, because a directory a
// process stands in cannot be removed on Windows while it runs.
//
// It is started only for a project that keeps something a campaign could be about, as the rooms their OWNERS keep in
// its store: a playbook the skill factory keeps, a mission Satellite keeps, a campaign already started. Most projects
// keep none, and a process that would only stamp "analysed" is a process for nothing.
// test/improvement-cli.test.mjs holds each name to its owner's own constant.
export const IMPROVABLE = [["generated-skills"], ["satellite", "missions"], ["improvement", "campaigns"]];

export const improvable = (storeRoot) => Boolean(storeRoot) && IMPROVABLE.some((parts) => existsSync(join(storeRoot, ...parts)));

export function improveLater(pluginRoot, env, opts = {}) {
  if (!improvable(opts.storeRoot)) return;
  const args = [join(pluginRoot, "cli", "improve.mjs"), "analyse", "--hook", `--checkout=${opts.cwd ?? process.cwd()}`, ...(opts.flags ?? [])];
  const child = spawn(process.execPath, args, { cwd: tmpdir(), env, detached: true, stdio: "ignore", windowsHide: true });
  child.on("error", () => null);
  child.unref();
}
