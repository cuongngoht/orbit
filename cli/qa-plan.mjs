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
//   node qa-plan.mjs new <id> (--screen=<screen> | --no-screen --feature=<f>) ["Title"]   a plan to fill in
//   node qa-plan.mjs expects <contract.json> [--operation=<id> --status=<n>] [--channel=<id> --within=<s>] [--at=<ISO>]
//                                               an accepted OpenAPI 3.x, AsyncAPI 2/3 or schedule policy, READ into
//                                               candidate expectations a person puts in a criterion (JSON; writes nothing)
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
import { openapiExpects } from "../skills/orbit-api-test/contracts/openapi.mjs";
import { asyncapiExpects } from "../skills/orbit-backend-test/contracts/asyncapi.mjs";
import { scheduleExpects } from "../skills/orbit-backend-test/contracts/schedule.mjs";

const [cmd, ...args] = process.argv.slice(2);

// With the project's own extensions loaded, so coverage validates a linked case
// with the vocabulary and the rules run-case would hold it to.
async function main() {
  if (cmd === "expects") return expects(args);
  if (!COMMANDS[cmd]) return usage();
  try {
    runQaPlan(await withExtensions(createContext()), cmd, args);
  } catch (e) {
    stopped(e);
  }
}

const usage = () => console.log(readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1, 16).join("\n"));

// An accepted contract READ by the reader its own kind names -- the open standard's version field, or a schedule
// policy's dialect -- each in the pack that speaks it. What it gives is CANDIDATES: a criterion's authority is still
// the plan's, and nothing here writes a plan.
const READERS = [
  { kind: "openapi", is: (d) => typeof d?.openapi === "string" || typeof d?.swagger === "string", read: (d, f) => openapiExpects(d, { operation: f.operation, status: f.status }) },
  { kind: "asyncapi", is: (d) => typeof d?.asyncapi === "string", read: (d, f) => asyncapiExpects(d, { channel: f.channel, within: f.within }) },
  { kind: "schedule", is: (d) => typeof d?.dialect === "string" || typeof d?.expression === "string", read: (d, f) => scheduleExpects(d, { at: f.at }) },
];

function expects(argv) {
  const f = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => [a.slice(2).split("=")[0], a.slice(2).split("=").slice(1).join("=")]));
  const doc = contractOf(argv.find((a) => !a.startsWith("--")));
  const reader = READERS.find((r) => r.is(doc));
  if (!reader) return exitWith(EXIT.REFUSED, "this is not a contract any reader here reads: an OpenAPI 3.x, an AsyncAPI 2.x or 3.0, or a schedule policy");
  return answeredWith({ kind: reader.kind, ...reader.read(doc, f) });
}

function contractOf(file) {
  if (!file) return exitWith(EXIT.REFUSED, "name the contract: qa-plan.mjs expects <contract.json>");
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch (e) { return exitWith(EXIT.REFUSED, `${file} is not a JSON contract this reads: ${e.message}`); }
}

function answeredWith(out) {
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exitCode = EXIT.REFUSED;
}

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
