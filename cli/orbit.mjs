#!/usr/bin/env node
// ORBIT — goal-driven orchestration above Orbit automation, work and tasks.
//
//   node orbit.mjs goal start [--stdin | --file=<path> | "<text>"] [--ref=<item>] [--json]
//   node orbit.mjs goal analyze <goal-id> [--stdin | --file=<path>] [--json]
//   node orbit.mjs goal plan|status|resume|step|verify|report|list|doctor …
//   node orbit.mjs live [<args…>]
//
// Exit 0 = done · 2 = REFUSED · 3 = BLOCKED. Never 1.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { OPS, sayOps } from "../src/goal/index.mjs";
import { printable } from "../src/printable.mjs";
import { command } from "../src/project/command.mjs";
import { orbitPorts } from "./orbit-bind.mjs";
import { runOrbit } from "./orbit-run.mjs";
import { engineVersion } from "../src/version.mjs";

const ENV = commandEnvironment(process.env, process.argv);
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function main() {
  const deps = {
    argv: process.argv.slice(2),
    env: ENV,
    pluginRoot: PLUGIN_ROOT,
    portsHere: (env) => orbitPorts(env, PLUGIN_ROOT, automationStart),
    delegateLive,
    delegateControl,
    printVersion,
    help,
    ops: OPS,
    sayOps,
    printable,
  };
  runOrbit(deps);
}

function printVersion() {
  console.log(engineVersion() ?? "unknown");
}

function delegateControl(args) {
  execFileSync(process.execPath, [join(PLUGIN_ROOT, "skills/orbit-control/start.mjs"), ...args], { stdio: "inherit", env: ENV });
}

function automationStart(spec, cwd, env, root) {
  const args = ["start", `--for=${spec.objective}`, "--json"];
  if (spec.ref) args.push(`--ref=${spec.ref}`);
  if (spec.capabilities?.length) args.push(`--capability=${spec.capabilities.join(",")}`);
  const out = execFileSync(process.execPath, [join(root, "cli/automation.mjs"), ...args], { cwd, env: ENV, encoding: "utf8" });
  return JSON.parse(out);
}

function delegateLive(args) {
  execFileSync(process.execPath, [join(PLUGIN_ROOT, "cli/live.mjs"), ...args], { stdio: "inherit", env: ENV });
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log("ORBIT — From Goal to Verified Outcome\n");
  console.log(lines.slice(0, end).join("\n"));
}

command(main);
