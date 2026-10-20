#!/usr/bin/env node
// Turn a click-path through the UI map into a runnable playwright-cli script.
//
//   node plan.mjs <from-screen> <to-screen>     emit the script for a click-path
//   ... --out=run.sh                            write it to a file
//
// The script is meant to be READ before it is run: it clicks a real UI in a
// real environment, and an inferred path has never been driven as a whole. A
// whole task with values, order and waits is a CASE (screens/<screen>/cases/*.json, run-case.mjs).
import { command } from "../src/project/command.mjs";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { emit } from "../src/plan/emit.mjs";
import { createContext } from "../src/run/context.mjs";

import { dirname, join, resolve } from "node:path";
import { storePath } from "../src/store/guard.mjs";

const [from, to, ...rest] = process.argv.slice(2);

function main() {
  if (!from || !to) return console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 9).join("\n"));
  const ctx = createContext();
  const text = emit(ctx, from, to).join("\n") + "\n";
  const outFlag = rest.find((a) => a.startsWith("--out="));
  return outFlag ? write(destination(ctx, outFlag.slice(6)), text) : console.log(text);
}

function destination(ctx, file) {
  if (ctx.project.layout !== 3) return file;
  const scratch = join(ctx.store(true), "scratch");
  return storePath(scratch, resolve(scratch, file));
}

function write(file, text) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, text);
  console.log(`wrote ${file}`);
}

command(main);
