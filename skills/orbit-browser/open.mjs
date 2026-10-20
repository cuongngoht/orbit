#!/usr/bin/env node
// The LAUNCHER: open a browser on a copied, signed-in profile and tell the
// engine where the session is.
//
//   node open.mjs --channel chrome --headed --env test --profile work [--run-dir <dir>]
//   node open.mjs --blank --url <origin> --run-dir <dir> [--channel chrome] [--headed]
//
// `--blank` opens a browser with NO profile: an empty one of its own under the run directory, which nothing is
// signed in to and nothing is copied into. It is what an autonomous investigation of a task's sandbox drives
// (its run directory is printed by `autonomous-qa plan --sandbox=<env>`), so it shares no cookie with anybody.
//
// Wire it once in ui-tests/project.json:
//   "launcher": "${CLAUDE_PLUGIN_ROOT}/skills/orbit-browser/open.mjs"
//
// The engine spawns exactly those flags and reads back the two lines printed at
// the end (src/awake/launcher.mjs). The profile is a directory pick.mjs made;
// no credential is read, stored or passed -- signing in stayed a human act, in
// the browser that directory was copied from.
//
// Exit 0 opened, 2 refused.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PREFIX } from "./browsers.mjs";
import { PROFILE_HOME, cliConfig, parseFlags, profilePath, runDirFor, targetUrl } from "./profile.mjs";

import { adapterProject, runtimePath } from "../../src/project/runtime.mjs";
import { machineContext } from "../../src/store/context.mjs";

import { sessionName } from "../../src/browser/session.mjs";

let project = null;
const flags = parseFlags(process.argv.slice(2));

function main() {
  project = adapterProject();
  const problem = unready();
  if (problem) return refuse(problem);
  if (flags.blank) return openBlank();
  open(profilePath(flags.profile, project), targetUrl(process.env, flags.env) || project?.config?.origin);
}

// A blank browser: the run directory holds its profile, and the run directory is the whole of what it shares.
function openBlank() {
  const runDir = runDirFor(flags, process.env, project);
  open(runtimePath(project, join(runDir, "profile")), flags.url, runDir);
}

function unready() {
  if (flags.blank) return blankProblem();
  if (!flags.profile) return `no --profile — the engine passes one; by hand, name a directory under ${PROFILE_HOME}`;
  if (!existsSync(profilePath(flags.profile, project))) return noProfile();
  if (!(targetUrl(process.env, flags.env) || project?.config?.origin)) return `no url for env "${flags.env}" — set ${PREFIX}URL_${envKey(flags.env)} or ORBIT_ORIGIN`;
  return null;
}

const blankProblem = () => (!flags.url ? "--blank needs --url <origin>: the address the blank browser opens" : !flags.runDir ? "--blank needs --run-dir <dir>: the browser's own directory, which is where its session and its profile are" : null);

const envKey = (s) => String(s ?? "").toUpperCase().replace(/[^A-Z0-9]+/g, "_");

const noProfile = () => `no copied profile "${flags.profile}" in ${PROFILE_HOME} — make one first:\n  node pick.mjs --json\n  node pick.mjs --use --channel ${flags.channel ?? "<channel>"} --profile "<directory>" --as ${flags.profile}`;

// `shell: true` is not a convenience: on Windows the binary on PATH is a .cmd
// shim, which Node 20 refuses to execute directly (ENOENT for the bare name,
// EINVAL for the .cmd). The url is the only argument and is quoted here, which
// also stops a `&` in a query string from ending the command on cmd.exe.
function open(userDataDir, url, given = null) {
  const runDir = given ?? runDirFor(flags, process.env, project);
  writeConfig(runDir, userDataDir);
  closeExisting(runDir);
  const r = spawnSync("playwright-cli", [...sessionArgs(runDir), "open", `"${url}"`], { cwd: runDir, encoding: "utf8", shell: true });
  report(r, runDir, url);
}

// A launcher is spawned again on every run, and an earlier run may have been
// told to leave its window open (ORBIT_KEEP_OPEN), or have died without closing.
// playwright-cli refuses to open a second browser on the same profile
// ("already in use"), so the old session goes first -- and this must succeed
// silently when there is nothing at all to close.
const sessionArgs = (dir) => (project?.layout === 3 || project?.isolated) ? [`-s=${sessionName(dir)}`] : [];

const closeExisting = (runDir) => spawnSync("playwright-cli", [...sessionArgs(runDir), "close"], { cwd: runDir, shell: true, stdio: "ignore" });

// playwright-cli reads .playwright/cli.config.json from its working directory,
// so the run directory IS the choice of browser and profile; the engine reads
// the same file back to report which profile a session is driving.
function writeConfig(runDir, userDataDir) {
  const config = cliConfig(flags.channel || "chromium", userDataDir, flags.mode);
  if ((project?.layout === 3 || project?.isolated)) machineContext({ project, config: project.config }).prepare();
  mkdirSync(runtimePath(project, join(runDir, ".playwright")), { recursive: true });
  writeFileSync(runtimePath(project, join(runDir, ".playwright", "cli.config.json")), JSON.stringify(config, null, 2) + "\n");
}

function report(r, runDir, url) {
  process.stderr.write(diagnose(r));
  if (r.status) return refuse(`playwright-cli open exited ${r.status} — its output is above`);
  console.log(`run directory : ${runDir}`);
  console.log(`target        : ${url}`);
}

// A missing binary is a setup problem with an obvious fix, so it says the fix
// instead of surfacing ENOENT from three frames deeper.
function diagnose(r) {
  if (r.error?.code === "ENOENT") return "playwright-cli is not on PATH — install it with: npm i -g @playwright/cli\n";
  return r.stderr ?? "";
}

function refuse(msg) {
  console.error(msg);
  process.exit(2);
}

try { main(); }
catch (e) { refuse(e.message); }
