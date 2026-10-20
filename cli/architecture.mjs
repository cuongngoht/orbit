#!/usr/bin/env node
// Learn this project's technical architecture once, and reuse it after that.
//
//   node architecture.mjs ensure [--for="…"]  the entry point: decide, say why, do only that
//   node architecture.mjs ensure --dry        …and write nothing
//   node architecture.mjs scan [--dry]        re-read everything, whatever the snapshot says
//   node architecture.mjs facts [<kind>]      the index of what is known
//   node architecture.mjs why <fact-id>       one fact: evidence, provenance, and what it cannot know
//   node architecture.mjs capabilities        what this project can be held to, and the gaps
//   node architecture.mjs diff                what has moved under the snapshot
//   node architecture.mjs record [<file>]     validated candidate facts — stdin when no file
//   node architecture.mjs project [--force]   copy the distilled form into Claude Code's memory
//   node architecture.mjs where               where the snapshot is kept, and why there
//
// MEMORY FIRST. `ensure` reads the snapshot and decides whether the repository
// has to be read at all. The normal answer is CURRENT and the normal cost is a
// handful of git calls — a scan happens when nothing has been learned yet, when
// a scope a fact depends on has moved, or when the task needs a capability
// nobody has asked about before.
//
// The snapshot lives OUTSIDE every repository, beside the lessons, in
// ~/.orbit or wherever ORBIT_LEARN_DIR points. It is derived and
// rebuildable: nothing here is ever written into a working tree, and no command
// in this file modifies the project it reads.
//
// Exit 0 = done · 2 = REFUSED (bad usage, an unknown id, a refused batch) ·
// 3 = BLOCKED (no readable checkout, nowhere on this machine to keep a
// snapshot). Never 1: this command asks the product nothing, so it can never
// find the product wrong.
import { taskArguments } from "../src/process/task-input.mjs";
import { readFileSync as readTaskStdin } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Blocked, EXIT, Refused } from "../src/run/errors.mjs";
import { COMMANDS, runArchitecture } from "../src/architecture/index.mjs";
import { architectureContext } from "../src/architecture/context.mjs";
import { createContext } from "../src/run/context.mjs";

const [cmd, ...args] = taskArguments(process.argv.slice(2), () => readTaskStdin(0, "utf8"));

function main() {
  if (!COMMANDS[cmd]) return help();
  try {
    runArchitecture(ready(), cmd, args);
  } catch (e) {
    stopped(e);
  }
}

function ready() {
  const ctx = architectureContext(createContext());
  return { ...ctx, read: readInput, now: () => new Date().toISOString() };
}

// stdin when no path is named, because the scanner agent has no Write: it
// reports candidates and the parent pipes them here. A temp file inside the
// project would break the one rule every command in this file is held to.
function readInput(path) {
  try {
    return readFileSync(path ?? 0, "utf8");
  } catch (e) {
    throw new Refused(`cannot read ${path ?? "stdin"}: ${e.message}`);
  }
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

function stopped(e) {
  if (e instanceof Refused) return exitWith("REFUSED", e.message);
  if (e instanceof Blocked) return exitWith("BLOCKED", `BLOCKED: ${e.message}`);
  throw e;
}

function exitWith(status, text) {
  console.error(text);
  process.exit(EXIT[status]);
}

main();
