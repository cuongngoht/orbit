// How to start, WITHOUT A SHELL, a command that a Windows PATH names through a shim.
//
// On Windows what sits on PATH for an npm-installed CLI is `<bin>.cmd`, and Node refuses
// it: ENOENT for the bare name, EINVAL for the `.cmd` itself. Every way of handing the
// shim to cmd.exe was tried and measured against `playwright-cli --raw eval <arg>`, and
// all of them break on an argument containing double quotes -- which is the most common
// thing this engine passes, because selectors look like `[data-testid="x"]`:
//
//   shell: true, args unquoted           breaks
//   cmd.exe /c                           breaks
//   cmd /d /s /c + windowsVerbatim       works for 1+1, still breaks on quotes
//
// What works is skipping the shim. A shim names its own target, so resolve that file and
// run it with node: no shell, exact argv semantics, identical to POSIX. Two forms are
// read, both written by npm: cmd-shim's (`"%dp0%\node_modules\<pkg>\cli.js" %*`, every
// package's bin and npm itself before npm 9) and npm 9+'s own `npm.cmd` and `npx.cmd`,
// which name the script in a variable (`SET "NPM_CLI_JS=%~dp0\node_modules\npm\bin\npm-cli.js"`).
// `npm root -g` is NOT the way to find a target; with a version manager in play that
// points somewhere else entirely, while the shim always knows where its own package is.
//
// On POSIX none of this happens: the extensionless shim carries a `#!/bin/sh` shebang,
// which Node executes happily, so the bare name is used unchanged. Only a shim needs
// unwrapping, too: a real executable, or a script with a shebang, matches nothing here and
// is left alone, so no platform that already worked changes behaviour.
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";

// The script a shim hands to node, in the two forms above.
const TARGETS = [/%dp0%[\\/]([^"\r\n]+\.js)/, /_CLI_JS=%~dp0[\\/]([^"\r\n]+\.js)/];

// What to spawn, and what to put in front of the caller's arguments, run by THIS node --
// for the engine's own tools (a browser driver, a probe), whatever Node the person has.
export function invocation(bin, env = process.env, deps = {}) {
  const found = unwrapped(bin, env, deps);
  return found ? { file: deps.node ?? process.execPath, prefix: [found.target] } : { file: bin, prefix: [] };
}

// The same, run by the node the shim itself would use: the one beside it, else `node` on
// PATH. A project's own command is started with the Node the person's PATH gives it -- the
// one whose version was checked -- never with whichever Node Orbit happens to run on.
export function launchable(bin, env = process.env, deps = {}) {
  const found = unwrapped(bin, env, deps);
  return found ? { file: nodeBeside(found.shim, deps), prefix: [found.target] } : { file: bin, prefix: [] };
}

function unwrapped(bin, env, deps) {
  const exists = deps.exists ?? existsSync;
  const read = deps.read ?? readFileSync;
  return shims(bin, env, exists).map((shim) => ({ shim, target: shimTarget(shim, read) })).find((s) => s.target && exists(s.target)) ?? null;
}

// EVERY .cmd on PATH, in PATH order -- not just the first. A machine can carry a
// WindowsApps execution alias that only forwards to the real npm shim
// (`call "%LOCALAPPDATA%\Programs\nodejs\<bin>.cmd" %*`), and a stub like that names no
// target, so stopping at the first hit found nothing and fell back to the bare name --
// which is the ENOENT this whole file exists to avoid.
function shims(bin, env, exists) {
  const dirs = String(env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  return dirs.map((d) => join(d, `${bin}.cmd`)).filter((p) => exists(p));
}

// `path` is the platform's path module: the running one by default, and node:path's win32
// when a Windows shim is being read from anywhere else.
export function shimTarget(shim, read, path = { join, dirname }) {
  const text = textOf(shim, read);
  const said = TARGETS.map((re) => re.exec(text)).find(Boolean);
  return said ? path.join(path.dirname(shim), said[1]) : null;
}

const nodeBeside = (shim, deps) => {
  const beside = join(dirname(shim), "node.exe");
  return (deps.exists ?? existsSync)(beside) ? beside : "node";
};

function textOf(shim, read) {
  try {
    return String(read(shim, "utf8"));
  } catch {
    return "";
  }
}
