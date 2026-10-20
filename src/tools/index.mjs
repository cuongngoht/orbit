// The Tools PORT: is a command this project needs actually usable here?
//
// Installing the plugin installs the ENGINE. It does not install the browser
// driver the engine steers, or the database client a project pointed
// `sql.command` at -- and a missing one of those does not announce itself: the
// first case to run just fails somewhere that reads like a product defect. So
// the question gets asked once, up front, by `query doctor`.
//
// `--version` is the probe, because every CLI worth depending on answers it. The
// answer does not matter; only whether the process could start at all.
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { invocation } from "../process/shim.mjs";

const EXTS = ["", ".cmd", ".exe", ".bat", ".ps1"];

const WHY = {
  ENOENT: "not found on PATH",
  EINVAL: "on PATH, but Node cannot execute it directly",
  EACCES: "found, but not executable",
};

// "Installed, but unusable from here" is a completely different thing to tell
// somebody than "not installed", which is why the diagnosis carries its own fix:
// the requirement that asked for the tool has no idea this is what went wrong.
//
// The probe goes through the same invocation resolver the runner uses, so an
// ordinary npm shim on Windows is unwrapped and simply WORKS. This message is
// what is left when even that fails.
const SHIM = (found) => ({
  why: `installed at ${found}, but not runnable from here`,
  fix: "a shim is on PATH but the entry point it forwards to could not be resolved. The engine unwraps an npm shim by reading the .js path out of it (src/process/shim.mjs), so this one is either a stub that only forwards, or from a different installer: reinstall it with npm so the shim names its own package.",
});

export function createTools(spawn = spawnSync, env = process.env) {
  return { present: (bin) => present(spawn, env, bin), install: (pkg) => install(spawn, pkg) };
}

// Installing is the one thing in this file that CHANGES the machine, so it is
// never implied -- cli/setup.mjs asks for it explicitly. Output is inherited,
// because a global npm install can take a minute and silence reads as a hang.
function install(spawn, pkg) {
  const r = spawn("npm", ["i", "-g", pkg], { stdio: "inherit", timeout: 600000 });
  if (r?.error?.code === "ENOENT") return { ok: false, why: "npm is not on PATH — install Node.js, which ships it" };
  if (r.status !== 0) return { ok: false, why: `npm i -g ${pkg} exited ${r.status}` };
  return { ok: true };
}

// Asked EXACTLY the way the engine will ask it: through the same invocation
// resolver the browser port uses. A doctor that probes differently to the runner
// is a doctor that can pass while the run fails.
function present(spawn, env, bin) {
  const call = invocation(bin, env);
  const r = spawn(call.file, [...call.prefix, "--version"], { encoding: "utf8", timeout: 10000 });
  const code = r?.error?.code;
  if (!code) return { ok: true, said: firstLine(r) };
  return { ok: false, ...whyNot(code, onPath(env, bin)) };
}

const whyNot = (code, found) => (found ? SHIM(found) : { why: WHY[code] ?? `could not be started (${code})` });

function onPath(env, bin) {
  const dirs = String(env.PATH ?? env.Path ?? "").split(delimiter).filter(Boolean);
  const hit = dirs.flatMap((d) => EXTS.map((e) => join(d, bin + e))).find((p) => existsSync(p));
  return hit ?? null;
}

// A tool that answers `--version` with an error is still installed, which is all
// this asks. Its own message is worth showing when it gave one.
const firstLine = (r) => String(r.stdout ?? "").trim().split("\n")[0] ?? "";
