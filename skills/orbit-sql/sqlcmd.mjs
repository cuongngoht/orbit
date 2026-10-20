#!/usr/bin/env node
// Read a Microsoft SQL Server database, three ways:
//
//   node sqlcmd.mjs "SELECT TOP 5 Id, Name FROM Things"   run ONE read-only query
//   node sqlcmd.mjs preflight                             can this machine read it at all?
//   node sqlcmd.mjs setup-hint [--os=mac|win|linux]       the commands that configure it
//                   [--from-env] [--server=S] [--database=D] [--user=U]
//
// The query form is the PORT CONTRACT: the engine appends the SQL as the LAST
// argument and passes nothing else, so no sub-command name can ever be mistaken
// for a query -- a query has to start with SELECT or WITH to get this far.
//
// Wire it once in ui-tests/project.json:
//
//   "sql": { "command": ["node", "<plugin>/skills/orbit-sql/sqlcmd.mjs"] }
//
// The connection comes from ORBIT_SQL_* in the environment, or from ~/.orbit/sql.env
// when the environment is silent (settings.mjs says why both exist) -- never from
// the repository. Exit 0 = ran, 2 = refused or not configured, anything else is
// sqlcmd's own code, which the engine reads as BLOCKED: a database nobody can
// reach is not a product failure.
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { PREFIX, childEnv, connection, readOnlyProblem, sqlcmdArgs } from "./args.mjs";
import { preflight, warningFor } from "./preflight.mjs";
import { CONFIG_FILE, configFile, SECRET, readConfig, redact, resolveSettings } from "./settings.mjs";
import { setupAt, setupLines } from "./setup.mjs";

let settingsFile = CONFIG_FILE;

const USAGE = `usage: node sqlcmd.mjs "SELECT …" | preflight | setup-hint [--os=mac|win|linux] [--from-env]
  needs ${PREFIX}SERVER and ${PREFIX}DATABASE, in the environment or in ${CONFIG_FILE}`;

const argv = process.argv.slice(2);
const COMMANDS = { preflight: sayPreflight, "setup-hint": saySetupHint };

function main() {
  settingsFile = configFile();
  const command = COMMANDS[argv[0]];
  if (command) return command();
  query(argv.at(-1));
}

function query(sql) {
  if (!sql) return refuse(USAGE);
  const { settings } = resolveSettings(process.env, readConfig(settingsFile), settingsFile);
  const c = connection(settings);
  const problem = readOnlyProblem(sql) ?? c.problem;
  return problem ? refuse(`${problem}\n${USAGE}`) : run(c, settings, sql);
}

function run(c, settings, sql) {
  const r = spawnSync(c.bin, sqlcmdArgs(c, sql), { encoding: "utf8", env: childEnv(settings), timeout: (c.timeout + 15) * 1000, killSignal: "SIGKILL" });
  process.stdout.write(redact(r.stdout ?? "", settings[SECRET]));
  process.stderr.write(redact(diagnose(r, c), settings[SECRET]));
  process.exit(r.status ?? 1);
}

// A missing binary is a setup problem with an obvious fix, so it says the fix
// instead of surfacing ENOENT from three frames deeper.
// sqlcmd has its own -l and -t timeouts; this one is the backstop for a process
// that ignores them, because a query that never returns is the engine's problem
// either way.
function diagnose(r, c) {
  if (r.error?.code === "ENOENT") return `${c.bin} is not on PATH — ${installHint()}, or set ${PREFIX}BIN\n`;
  if (r.signal === "SIGKILL") return `${c.bin} was killed after ${c.timeout + 15}s — the query never returned\n`;
  return r.stderr ?? "";
}

function sayPreflight() {
  const out = preflight({ env: process.env, fileText: readConfig(settingsFile), configFile: settingsFile, spawn: spawnSync, which, installHint: installHint(), warning: warningFor(settingsFile) });
  console.log(out.lines.join("\n"));
  process.exit(out.code);
}

// It PRINTS the commands and the user runs them. Writing the file here would
// mean the password came through an agent to get here.
function saySetupHint() {
  const os = flag("os") ?? defaultOs();
  console.log(`Detected OS: ${os}. Run this in YOUR OWN terminal, not through the agent.`);
  console.log(`${argv.includes("--from-env") ? "Values come from what that shell already exported — the password is never retyped." : "Replace the <…> and the password placeholder first."} Do not paste the finished command back into the chat.\n`);
  console.log(setupCommands(os).join("\n"));
}

function setupCommands(os) {
  const values = { SERVER: flag("server"), DATABASE: flag("database"), USER: flag("user") };
  const fromEnv = argv.includes("--from-env");
  return settingsFile === CONFIG_FILE ? setupLines(os, values, fromEnv) : setupAt(os, values, fromEnv, settingsFile);
}

const defaultOs = () => (platform() === "win32" ? "win" : platform() === "darwin" ? "mac" : "linux");
const flag = (n) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3) ?? null;

// Node on Windows does not apply PATHEXT when spawning without a shell, so a
// bare name can fail there even though the terminal finds it. Resolve the real
// path first, and say it -- "which sqlcmd is this" is half of every argument
// about why one machine works.
function which(bin) {
  const win = platform() === "win32";
  const probe = spawnSync(win ? "where" : "which", [bin], { encoding: "utf8", shell: win });
  return probe.status === 0 ? (probe.stdout ?? "").trim().split(/\r?\n/)[0] || null : null;
}

const HINTS = { darwin: "brew install sqlcmd", win32: "winget install --id Microsoft.Sqlcmd -e" };
const installHint = () => HINTS[platform()] ?? "see https://github.com/microsoft/go-sqlcmd#install";

function refuse(msg) {
  console.error(msg);
  process.exit(2);
}

try { main(); }
catch (e) { refuse(e.message); }
