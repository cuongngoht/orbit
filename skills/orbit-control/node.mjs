// Which Node on THIS machine can run Orbit Control -- pure, so it is tested
// without a single real binary.
//
// The engine runs on the Node a shell hands it, which may well be 20 or 22;
// control-server/ needs what its own package.json declares (>= 24.15). So the
// question is not "which Node is this" but "is there one here that will do",
// asked in a fixed order, first answer wins:
//
//   ORBIT_CONTROL_NODE   a path somebody typed -- the override, always first
//   the running Node    free, and usually the answer on a machine already on 24
//   the private runtime what `start.mjs --install-runtime` put in the plugin's
//                       own store (install.mjs), newest first
//   nvm                 every installed version, newest first (nvm-sh's
//                       NVM_DIR or ~/.nvm; nvm-windows' NVM_HOME)
//
// A candidate is ASKED its version, never trusted by its directory name: a
// folder called v24.15.0 can hold anything.
import { join } from "node:path";
import { fromEnv } from "../../src/project/env.mjs";

// `runtime` is { root, bin }: where install.mjs keeps its runtimes, and the
// binary's path inside one. Absent, there is nothing private to look at.
export function candidates({ env, home, execPath, list, runtime }) {
  const typed = fromEnv(env, "CONTROL_NODE");
  return [...(typed ? [typed] : []), execPath, ...privateRuntimes(runtime, list), ...nvmSh(env, home, list), ...nvmWindows(env, list)];
}

function privateRuntimes(runtime, list) {
  if (!runtime) return [];
  return newestFirst(list(runtime.root)).map((v) => join(runtime.root, v, runtime.bin));
}

function nvmSh(env, home, list) {
  const root = join(env.NVM_DIR || join(home, ".nvm"), "versions", "node");
  return newestFirst(list(root)).map((v) => join(root, v, "bin", "node"));
}

function nvmWindows(env, list) {
  if (!env.NVM_HOME) return [];
  return newestFirst(list(env.NVM_HOME)).map((v) => join(env.NVM_HOME, v, "node.exe"));
}

// The first three numbers: "v24.21.0-darwin-arm64" is 24, 21, 0.
const parts = (v) => (String(v).match(/\d+/g) ?? []).slice(0, 3).map(Number);

// Only names that look like a version -- a directory also holds .DS_Store and
// nvm-windows keeps its settings beside the versions.
function newestFirst(names) {
  const later = (a, b) => parts(b).reduce((d, n, i) => d || n - (parts(a)[i] ?? 0), 0);
  return names.filter((v) => /^v?\d+\.\d+/.test(v)).sort(later);
}

// The first candidate that answers with a version the server accepts, or null.
// `versionOf` answers null for a path that is not a working node. Asked one at
// a time and stopping at the first that will do: every ask may be a process.
export function pick(paths, versionOf, supported) {
  for (const node of paths) {
    const version = versionOf(node);
    if (version && supported(version)) return { node, version };
  }
  return null;
}
