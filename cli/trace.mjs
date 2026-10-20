#!/usr/bin/env node
// The SESSION TRAIL from a terminal: how sessions went, prompt by prompt, and
// how Orbit is used. The same projections Orbit Control's Trace and Analytics
// pages read (src/trace/projections/).
//
//   node trace.mjs turns [--days=1] [--session=<id>] [--limit=20] [--json]
//                                   one line per prompt: what the router decided, the
//                                   path the session took, whether it followed
//   node trace.mjs turn <turn-id> [--json]
//                                   one prompt in full: the requirement graph, every step
//   node trace.mjs usage [--days=30] [--json]
//                                   commands, skills, flows, failures, least privilege
//   node trace.mjs where            where the trail is kept, and what it never keeps
//
// It writes nothing. What the trail holds is recorded by the hooks (the plugin
// option `trace`, or ORBIT_TRACE) and is metadata only: never a prompt's text, a
// response, an argument, a tool's output, a path or a file's contents.
//
// Exit 0 = printed · 2 = REFUSED (bad usage, an unknown turn).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { command } from "../src/project/command.mjs";
import { switchOf } from "../src/project/env.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { traceLog } from "../src/trace/log.mjs";
import { turnsView, turnView, usageView, whereView } from "../src/trace/views.mjs";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);

const COMMANDS = { turns: turnsView, turn: turnView, usage: usageView, where: whereView };

function main() {
  if (!COMMANDS[cmd]) return help();
  COMMANDS[cmd](contextOf(), args);
}

const contextOf = () => ({ log: traceLog(stateRooms(storeBase(process.env)), realIo()), now: () => new Date().toISOString(), on: switchOf(process.env, "TRACE", "trace", true), allowed: () => allowedTools(join(PLUGIN_ROOT, "skills")) });

// Each shipped skill's `allowed-tools`, off its SKILL.md frontmatter -- the
// other half of the least-privilege join.
function allowedTools(dir) {
  const skills = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  return new Map(skills.map((name) => [name, toolsIn(read(join(dir, name, "SKILL.md")))]));
}

function toolsIn(text) {
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const block = /^allowed-tools:\s*\n((?:\s+-\s.*\n?)*)/m.exec(front)?.[1] ?? "";
  return [...block.matchAll(/^\s+-\s+(.*)$/gm)].map((m) => m[1].trim());
}

function read(file) {
  try { return readFileSync(file, "utf8"); }
  catch { return ""; }
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

command(main);
