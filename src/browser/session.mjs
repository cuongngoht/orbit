// The one way the engine talks to playwright-cli.
//
// A session is global to the MACHINE and keyed by NAME, not scoped to the
// working directory: opening in one directory and evaluating from another drives
// the same browser. The engine passes each run's session name explicitly, which
// is what makes `as` switch browsers rather than just switch directories. The
// cwd still matters, because the launcher writes `.playwright/cli.config.json`
// into the run directory it prints and the CLI reads it from there.
//
// Every command carries a TIMEOUT. Without one a wedged CLI outlived every step
// budget the case declared -- and because `requests`, `console` and `ev` all
// tolerate failure, the wedge came back as "ERROR: …" text that a poll then span
// on. A killed command is Blocked: the tool died, the product did not misbehave.
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { Blocked } from "../errors.mjs";
import { varName } from "../project/env.mjs";
import { invocation } from "../process/shim.mjs";
import { short } from "../hash.mjs";

// The one real browser adapter this engine has. Named here, once, so anything
// that needs to talk ABOUT it (query doctor) does not spell it again.
export const BROWSER_CLI = "playwright-cli";

// The npm package that provides it. This is the engine's OWN dependency, not a
// product's, which is why the engine may know it -- and it is read off the shim
// npm writes (`node "%dp0%/node_modules/@playwright/cli/playwright-cli.js"`),
// not guessed.
export const BROWSER_CLI_PACKAGE = "@playwright/cli";

export const DEFAULT_CLI_TIMEOUT_MS = 30000;

// The invocation is resolved ONCE, not per call: on Windows it reads a shim off
// PATH to find the real entry point (see process/shim.mjs), and doing that on every
// eval would put a file read in front of every poll.
export const sessionName = (dir) => `orbit-${short(dir, 24)}`;

export function createSession(initialDir, exec = execFileSync, timeoutMs = DEFAULT_CLI_TIMEOUT_MS, how = null, options = {}) {
  const at = { dir: initialDir, name: options.isolate ? sessionName(initialDir) : null };
  const call = how ?? invocation(BROWSER_CLI);
  const cli = (args, allowFail = false) => run(exec, call, options.guard?.(at.dir) ?? at.dir, named(at.name, args), allowFail, timeoutMs, !options.isolate);
  return { cli, dir: () => at.dir, session: () => at.name, use: (d, name) => moveTo(at, options.guard?.(d) ?? d, options.isolate ? sessionName(d || at.dir) : name) };
}

// The NAME is what actually isolates. Switching identity used to change only the
// working directory, and since a session is keyed by name rather than by cwd,
// `as admin` and then `as scoped` drove ONE browser and read ONE set of claims
// -- a permission case that reported a result it had never observed.
function moveTo(at, d, name) {
  at.dir = d || at.dir;
  at.name = name ?? at.name;
  return at.dir;
}

const named = (name, args) => (name ? [`-s=${name}`, ...args] : args);

function run(exec, call, cwd, args, allowFail, timeoutMs, fallback = true) {
  try {
    return exec(call.file, [...call.prefix, ...args], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL" });
  } catch (e) {
    if (fallback && args[0]?.startsWith("-s=") && /is not open/i.test(said(e))) {
      try {
        return exec(call.file, [...call.prefix, ...args.slice(1)], { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, timeout: timeoutMs, killSignal: "SIGKILL" });
      } catch (e2) {
        return failure(e2, args.slice(1), allowFail, timeoutMs, cwd);
      }
    }
    return failure(e, args, allowFail, timeoutMs, cwd);
  }
}

// The kill check comes BEFORE allowFail, and that order is the whole point: with
// it the other way round a hang is laundered into a product FAIL.
function failure(e, args, allowFail, timeoutMs, cwd) {
  if (killed(e)) throw new Blocked(`${BROWSER_CLI} ${args[0]} was killed after ${timeoutMs / 1000}s — the browser session is not answering; re-open it (${varName("CLI_TIMEOUT")} raises the limit)`);
  if (allowFail) return `ERROR: ${absent(cwd) ?? said(e).slice(0, 300)}`;
  throw e;
}

// STDOUT first, because that is where this CLI puts its diagnostics: with no
// session open it prints "The browser 'default' is not open, please run open
// first" to stdout and leaves stderr empty. Reading only stderr left the
// exec's own "Command failed: <300 chars of argv>" as the message, which
// classify() could not recognise -- so a browser that was simply never opened
// reported BUSY ("retry") instead of NONE, and the session gate never printed
// the one sentence that would have fixed it.
// A run directory that is not there is the commonest setup mistake of all, and
// the exec's own ENOENT names NODE rather than the directory -- so it read as
// "something is broken" rather than "the launcher has not run yet".
const absent = (cwd) => (cwd && !existsSync(cwd) ? `the run directory ${cwd} does not exist — playwright-cli open has not run there` : null);

const said = (e) => [e.stdout, e.stderr, e.message].map((s) => String(s ?? "").trim()).find(Boolean) ?? "";

const killed = (e) => e?.killed === true || e?.signal === "SIGKILL" || e?.code === "ETIMEDOUT";
