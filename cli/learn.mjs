#!/usr/bin/env node
// Learn across sessions from this project's own history, and say what the
// evidence was.
//
//   node learn.mjs where [--root]            where this project's store is, and why there (--root: the path alone)
//   node learn.mjs lessons                   the index of what is known  [--about= --state= --max=]
//   node learn.mjs why <id>                  one lesson: its evidence, what it does not know, what to do
//   node learn.mjs recall [<about>]          only the lessons that apply to this case or screen
//   node learn.mjs remember <about> "<what>" something you want remembered  [--not="…"] [--id=…]
//   node learn.mjs forget <id> "<why>"       delete it, and stop deriving it again  [--forever]
//   node learn.mjs auto on|off               stop or resume deriving new lessons
//   node learn.mjs analyse                   read new runs and notes, update what is known  [--since= --family= --dry]
//   node learn.mjs accept|reject|applied <rec id>    what you decided  [--because="…"] [--commit=…]
//
// Lessons live OUTSIDE every repository -- in ~/.orbit, or wherever
// ORBIT_LEARN_DIR points -- because they are a machine's provisional judgement and
// not a team artifact. Nothing this command writes ever lands in a working tree.
// The run ledger and the notes it reads from stay exactly where they were.
//
// A lesson needs more than one session before it is written down at all. One
// failure is an observation, and the ledger already has it.
//
// Exit 0 = done · 2 = REFUSED (bad usage, an unknown id, learning switched off) ·
// 3 = BLOCKED (nowhere on this machine to keep what it learns). Never 1: this
// command asks the product nothing, so it can never find the product wrong.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Blocked, EXIT, Refused } from "../src/run/errors.mjs";
import { COMMANDS, runLearn } from "../src/learn/index.mjs";
import { createContext } from "../src/run/context.mjs";
import { learnContext } from "../src/learn/context.mjs";

const [cmd, ...args] = process.argv.slice(2);

function main() {
  if (!COMMANDS[cmd]) return help();
  try {
    runLearn(ready(), cmd, args);
  } catch (e) {
    stopped(e);
  }
}

function ready() {
  return learnContext(createContext());
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
