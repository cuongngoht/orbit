#!/usr/bin/env node
// ORBIT SATELLITE -- a mission journal above Orbit's owners: a goal understood into a structured intent, a work graph
// revised on evidence, roles, agent templates, skills and workflows reused or generated, every agent run dispatched
// through one execution gateway, every result read back from the owner that keeps it, and every action observable in
// Satellite Live. The engine calls no model: the host decides one step at a time, the engine judges and keeps.
//
//   node satellite.mjs mission start "<goal>" | --file=<path> | --stdin
//   node satellite.mjs mission context <msn>                      what stands, what is allowed, the next step
//   node satellite.mjs mission step <msn> [--decision=<file>]     one decision on stdin, through the gateway
//   node satellite.mjs mission reconcile <msn> [--abandon=<arn>]  open actions read back, never resent
//   node satellite.mjs mission finish <msn> [--stop=<REASON> --because="…"]
//   node satellite.mjs mission show|goal|events <msn> [--since=<n>]   the goal: as submitted, its digest checked
//   node satellite.mjs mission list
//   node satellite.mjs agent envelope <msn> <arn>                 what the host hands one agent run
//   node satellite.mjs agent ack <msn> <arn> [--host-agent=<id>]  the host's word that it launched it, and which agent carries it
//   node satellite.mjs agent report <msn> <arn> [--report=<file>] the run's report, on stdin
//   node satellite.mjs definitions list [--kind=<kind>] | show <pin>
//   node satellite.mjs host capabilities [--host=<id>] | detect
//   node satellite.mjs live status|watch|tui|open|where [<msn>] [--plain|--jsonl|--since=o=<n>|--ascii|--until-done[=<s>]|--print]
//   node satellite.mjs settings | where | protocol
//
// Every answer is JSON. Exit 0 = done · 2 = REFUSED (nothing written, or the refusal recorded) · 3 = BLOCKED.
import { command } from "../../src/project/command.mjs";
import { printable } from "../../src/printable.mjs";
import { commandEnvironment } from "../../skills/orbit-learn/hosts/settings.mjs";
import { commandOf } from "../src/index.mjs";
import { bindPorts } from "./bind.mjs";

const ENV = commandEnvironment(process.env, process.argv);

const ARGV = process.argv.slice(2).filter((a) => !a.startsWith("--host=") && !a.startsWith("--protocol="));

function help() {
  console.log(usage());
}

const usage = () => "usage: node satellite.mjs mission|agent|definitions|host|live|settings|where|protocol … (see the header of satellite/cli/satellite.mjs)";

function printed(found, result) {
  console.log(printable(found.entry.say(result)));
  if (result?.refused) process.exitCode = 2;
}

async function livePart(argv) {
  const live = await import("./satellite-live.mjs");
  return live.main(ENV, argv.slice(1));
}

// The ports a command needs: none, the machine's, or the machine's with the project's own capabilities loaded first
// (a command that resolves a capability resolves what the router would).
async function portsFor(found) {
  if (found.entry.needs === "nothing") return null;
  const ports = bindPorts(ENV, process.cwd());
  if (found.entry.resolves) await ports.ready();
  return ports;
}

async function main() {
  if (ARGV[0] === "live") return livePart(ARGV);
  const found = commandOf(ARGV);
  if (!found) return help();
  return printed(found, await found.entry.run(await portsFor(found), found.args));
}

command(main);
