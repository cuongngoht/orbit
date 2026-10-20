#!/usr/bin/env node
// Views and workflows over the QA test plans in ui-tests/screens/<screen>/.
//
//   node qa-plan.mjs plans                      every plan, and whether it is clean
//   node qa-plan.mjs show <id>                  one plan: what it commits to, and where each scenario has got to
//   node qa-plan.mjs render <id> [--write]      the Markdown, generated from the plan
//   node qa-plan.mjs coverage <id> [--out=F]    criterion -> scenario -> case -> run -> evidence
//   node qa-plan.mjs select <id> [--profile=smoke] [--budget=90]   what to run, and what that leaves unproven
//   node qa-plan.mjs impact <id> [--now=REQ1=v3] [--changed=home/Add]   what moved under it
//   node qa-plan.mjs suggest <id>               what past runs suggest — proposals, never edits
//   node qa-plan.mjs new <id> ["Title"]         a plan to fill in
//
// Checking a plan is a GATE and lives in its own command: cli/plan-check.mjs.
//
// Exit 0 = done · 2 = REFUSED (bad usage, an unreadable project.json, a lesson
// store at a path that was typed and failed) · 3 = BLOCKED (nowhere on this
// machine to keep what `suggest` reads). Never 1: these are views, so none of
// them can find the product wrong.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Blocked, EXIT, Refused } from "../src/run/errors.mjs";
import { COMMANDS, runQaPlan } from "../src/qa/index.mjs";
import { createContext } from "../src/run/context.mjs";
import { withExtensions } from "../src/extensions/index.mjs";

const [cmd, ...args] = process.argv.slice(2);

// With the project's own extensions loaded, so coverage validates a linked case
// with the vocabulary and the rules run-case would hold it to.
async function main() {
  if (!COMMANDS[cmd]) return usage();
  try {
    runQaPlan(await withExtensions(createContext()), cmd, args);
  } catch (e) {
    stopped(e);
  }
}

const usage = () => console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 13).join("\n"));

function stopped(e) {
  if (e instanceof Refused) return exitWith(EXIT.REFUSED, e.message);
  if (e instanceof Blocked) return exitWith(EXIT.BLOCKED, `BLOCKED: ${e.message}`);
  throw e;
}

function exitWith(code, text) {
  console.error(text);
  process.exit(code);
}

main();
