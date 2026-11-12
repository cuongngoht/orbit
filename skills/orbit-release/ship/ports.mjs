// THE RELEASE GATE'S PORTS, bound to this machine: the gates run as `node <args>` in the checkout, and git asked as an
// argument list with no fsmonitor (archive, status and rev-parse run no hook). Only ship.mjs imports this file;
// everything that decides is handed these ports, and a test hands it fakes or a repository of its own.
//
//   gatesAt(env) -> (cwd) -> (args, extra) -> { out, code, timedOut, read(file) }      gateEnvOf(env) -> env
//   gitAt(cwd, env) -> (args, { binary }) -> { ok, code, out, err }
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_OUT = 256 * 1024 * 1024;

// A gate's deadline only stops a hang. A Windows runner on Node 20 took about twenty minutes over the suite, and a
// deadline at twenty killed it before it printed its count -- a hang it was not.
const GATE_MS = 45 * 60000;

// ---- the gates, in the checkout ----------------------------------------------------------------------------------------

// The names a coding host's credential or endpoint travels under -- the host's own, and the names a release session
// keeps them as. The definition of done needs none of them, and a credential handed to a test suite is one a test could
// print into a log, so the gates' environment never carries one.
export const WITHHELD = Object.freeze(["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "ORBIT_CODE_OAUTH_TOKEN", "ORBIT_EVAL_ANTHROPIC_API_KEY"]);

export const gateEnvOf = (env) => Object.fromEntries(Object.entries(env).filter(([k]) => !WITHHELD.includes(k)));

const gateAnswer = (r, cwd) => ({ out: (r.stdout ?? "") + (r.stderr ?? ""), code: r.status, timedOut: r.error?.code === "ETIMEDOUT" ? GATE_MS / 60000 : null, read: (file) => (existsSync(join(cwd, file)) ? readFileSync(join(cwd, file), "utf8") : null) });

export const gatesAt = (env) => (cwd) => (args, extra = {}) => gateAnswer(spawnSync(process.execPath, args, { cwd, encoding: "utf8", env: { ...gateEnvOf(env), ...extra }, timeout: GATE_MS, maxBuffer: MAX_OUT }), cwd);

// ---- git ---------------------------------------------------------------------------------------------------------------

const gitAnswer = (r) => ({ ok: r.status === 0, code: r.status, out: r.stdout ?? "", err: String(r.stderr ?? r.error?.message ?? "") });

export const gitAt = (cwd, env) => (args, o = {}) => gitAnswer(spawnSync("git", ["-c", "core.fsmonitor=false", "-C", cwd, ...args], { env, encoding: o.binary ? "buffer" : "utf8", maxBuffer: MAX_OUT, timeout: 600000 }));
