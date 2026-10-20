#!/usr/bin/env node
// Run one JSON test case, step by step, through playwright-cli.
//
// One command runs the whole case: it reads <ui-tests>/screens/<screen>/cases/<id>.json (found by id), issues
// each step as a playwright-cli verb, polls the wait that proves the step
// landed, and prints one line per step. Selectors, timings, observed text and
// screenshots go to run-log.jsonl in the evidence dir, not to the terminal.
//
//   node run-case.mjs <id | path.json> NAME=TC-… [TYPE="…"]
//     --dry                resolve and print the plan; touches no browser, no database
//     --draft              run a draft case stored in the machine store
//     --force-destructive  required when the case is destructive:true
//     --stale-ok           run although fe_commit != the frontend's HEAD
//     --from=N --to=M      run only steps N..M (debugging one screen)
//     --out=DIR            evidence dir outside any repository (default: the store's evidence room)
//     --json               one machine-readable result object, nothing else
//     --report             also write self-contained HTML into the reports directory
//
// Exit 0 = PASS or SKIP · 1 = FAIL (evidence written) · 2 = REFUSED before the
// browser (bad usage, invalid case, missing param, destructive without the
// flag, stale, no signed-in session, wrong identity) · 3 = BLOCKED (database
// unreachable, or `resolve` matched no row -- the product is not broken because
// a laptop is off the VPN).
//
// It never opens a browser. The launcher does, behind the preflight question;
// this drives the session in PT_RUN_DIR (or the project's default run dir).
import { relative } from "node:path";
import { publishRun } from "../src/report/publish.mjs";
import { createContext } from "../src/run/context.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { Blocked, EXIT, Refused } from "../src/run/errors.mjs";
import { exitCode, resultJson, resultLine } from "../src/run/result.mjs";
import { runCase } from "../src/run/run-case.mjs";

const argv = process.argv.slice(2);

// Which case the caller ASKED for -- the first bare word, before any flag or
// NAME=value. A stop may happen before the case is loaded (there may be no such
// case), so the ledger records what was asked for rather than what was found.
const CASE_REF = argv.find((a) => !a.startsWith("--") && !a.includes("=")) ?? null;
const JSON_OUT = argv.includes("--json");
const REPORT = argv.includes("--report");

// The ctx is built inside the try so a broken project.json still becomes a
// typed stop -- and is hoisted so the stop handler can record it when there IS
// one. A stop before the ctx exists is a stop nothing could have recorded.
async function main() {
  let ctx = null;
  try {
    ctx = await withExtensions(createContext());
    finish(ctx, runCase(ctx, argv));
  } catch (e) {
    stopped(e, ctx);
  }
}

function finish(ctx, outcome) {
  if (outcome.status === "DRY") return process.exit(0);
  console.log(JSON_OUT ? JSON.stringify(resultJson(outcome)) : resultLine(outcome));
  reported(ctx, outcome);
  process.exit(exitCode(outcome.status));
}

// Opt-in, and AFTER the result line: the verdict is what the caller waited for,
// and rendering HTML must never be the reason a run's own answer goes missing.
// `--json` stays one object on stdout; publication warnings go to stderr.
function reported(ctx, outcome) {
  if (!REPORT) return;
  const file = publishRun(ctx, outcome);
  if (file && !JSON_OUT) console.log(`report: ${relative(process.cwd(), file)}`);
}

function stopped(e, ctx) {
  if (e instanceof Refused) return refuse("REFUSED", e.message, ctx);
  if (e instanceof Blocked) return refuse("BLOCKED", e.message, ctx);
  throw e;
}

// A stop is EVIDENCE ABOUT THE MACHINE, and it used to leave none.
//
// Nothing was observed about the product, which is why this can never raise
// coverage -- REFUSED and BLOCKED both say `verifies: false`. But "the database
// was unreachable again", "this profile is signed out every Monday", "the
// frontend commit never matches here" are facts about an environment, and the
// only record of them was a line in a terminal that scrolled away.
//
// Best effort, and silent if it fails: a machine with nowhere to write is
// exactly the machine most likely to be refusing, and turning that into a
// second error on top of the first tells nobody anything.
function noted(status, reason, ctx) {
  try {
    ctx?.memory?.recordRun({ case: CASE_REF, status, done: 0, of: 0, failure: reason, stoppedBy: "gate" });
  } catch {}
}

function refuse(status, reason, ctx) {
  noted(status, reason, ctx);
  if (JSON_OUT) return exitWith(status, JSON.stringify({ status, reason }), console.log);
  exitWith(status, status === "BLOCKED" ? `BLOCKED: ${reason}` : reason, console.error);
}

function exitWith(status, text, write) {
  write(text);
  process.exit(EXIT[status]);
}

await main();
