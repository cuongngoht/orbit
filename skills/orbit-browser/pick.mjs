#!/usr/bin/env node
// Show the Chromium-family browsers on THIS machine and the profiles each one
// holds, then copy one chosen profile into a test copy the launcher can open.
//
//   node pick.mjs --json
//   node pick.mjs --use --channel chrome --profile "Profile 1" --as work [--force]
//
// The list prints a profile's directory AND its display name, because renaming
// a profile makes those two different strings and nothing may guess one from
// the other. The copy goes to ~/.claude/playwright-profiles/<as>/ -- outside
// every repository, because it holds cookies. No password is ever read: the
// signing in already happened, by a human, in the browser being copied.
//
// Exit 0 done, 2 refused.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { emailIn, installed, isRunning, processName, profilesIn } from "./browsers.mjs";
import { PROFILE_HOME, choiceFile, choiceOf, copyPlan, profilePath, profileHome } from "./profile.mjs";

import { adapterProject, runtimePath } from "../../src/project/runtime.mjs";
import { machineContext } from "../../src/store/context.mjs";

let project = null;

const USAGE = `usage: node pick.mjs --json\n       node pick.mjs --use --channel <chrome|msedge|chromium> --profile "<directory>" --as <name> [--force]`;
const PS = { win32: ["tasklist", ["/FO", "CSV", "/NH"]], other: ["ps", ["-A", "-o", "comm"]] };
const argv = process.argv.slice(2);
const flag = (name) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : null);

function main() {
  project = adapterProject();
  if (argv.includes("--json")) return list();
  const opts = { channel: flag("--channel"), profile: flag("--profile"), as: flag("--as") };
  if (!argv.includes("--use") || !opts.channel || !opts.profile || !opts.as) return refuse(USAGE);
  use(opts);
}

function list() {
  const browsers = found().map(withProfiles);
  console.log(JSON.stringify({ profileHome: profileHome(project), browsers }, null, 2));
}

const found = () => installed(process.platform, process.env, existsSync);

function withProfiles(b) {
  const emailOf = (dir) => emailIn(readText(join(b.dataDir, dir, "Preferences")));
  return { ...b, profiles: profilesIn(readText(join(b.dataDir, "Local State")), emailOf) };
}

function use(opts) {
  const b = found().find((x) => x.channel === opts.channel);
  const problem = unusable(b, opts);
  if (problem) return refuse(problem);
  guardRunning(opts.channel, b.name);
  record(b, opts, preparedCopy(b, opts));
}

function preparedCopy(b, opts) {
  if (project?.layout === 3) machineContext({ project, config: project.config }).prepare();
  return copy(b, opts);
}

function unusable(b, opts) {
  if (!b) return `no user data for channel "${opts.channel}" on this machine — run with --json to see what is installed`;
  if (!existsSync(join(b.dataDir, opts.profile))) return `${b.name} has no profile directory "${opts.profile}" — run with --json and use a "dir" value from that list, not a display name`;
  return null;
}

// Copying a live profile captures a cookie database mid-write, and the copy
// then opens signed OUT -- which reads exactly like the product logging you out.
function guardRunning(channel, name) {
  if (argv.includes("--force")) return;
  const running = isRunning(processList(), processName(channel, process.platform));
  if (running) refuse(`${name} is running — close every window of it and run this again, or pass --force.\n  A profile copied while its browser is open is very likely to open signed out.`);
}

function processList() {
  const [bin, args] = PS[process.platform] ?? PS.other;
  try { return execFileSync(bin, args, { encoding: "utf8" }); } catch { return ""; }
}

function copy(b, opts) {
  const target = profilePath(opts.as, project);
  const wanted = copyPlan(b.dataDir, opts.profile, target).filter((p) => existsSync(p.from));
  mkdirSync(join(target, "Default"), { recursive: true });
  wanted.forEach((p) => cpSync(p.from, runtimePath(project, p.to), { recursive: true, dereference: true }));
  return { target, items: wanted.length };
}

function record(b, opts, copied) {
  const file = choiceFile(process.env.ORBIT_UI_TESTS || join(process.cwd(), "ui-tests"), project);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(choiceOf(b.channel, opts.as, opts.profile, Date.now()), null, 2) + "\n");
  console.log(`profile : ${b.name} "${opts.profile}" → ${copied.target}  (${copied.items} items copied)`);
  console.log(`choice  : ${file}\nnext    : node open.mjs --channel ${b.channel} --headed --env <env> --profile ${opts.as}`);
}

const readText = (f) => { try { return readFileSync(f, "utf8"); } catch { return ""; } };

function refuse(msg) {
  console.error(msg);
  process.exit(2);
}

try { main(); }
catch (e) { refuse(e.message); }
