#!/usr/bin/env node
// One exploration session as one page: what was on the surface, what happened on
// every layer when each control was touched, what contradicted itself, and every
// question a browser could not answer.
//
//   node explore.mjs <observations.jsonl> [--out=FILE]
//
// The input is what the session wrote as it went, one JSON object per line; the
// orbit-ui-explore playbook says what the kinds mean. The page lands with the run
// evidence by default, beside the reports and the reviews, because a session is
// read next to the runs it produced.
//
// It reports what a session SAW and never decides PASS -- a case it left behind
// is judged by run-case, like every other case.
//
// Exit 0 = written · 2 = usage, or a file with no charter in it.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { hasCharter, readObservations, writeExplore } from "../src/report/explore.mjs";
import { REPORT_ROOMS } from "../src/tests-tree.mjs";
import { createContext } from "../src/run/context.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const input = argv.find((a) => !a.startsWith("--"));

function main() {
  if (!input || !existsSync(input)) return usage();
  const records = readObservations(readFileSync(input, "utf8"));
  if (!hasCharter(records)) return noCharter();
  const ctx = createContext();
  console.log(`explore: ${relative(process.cwd(), written(ctx, records))}   ${records.length} observation(s)`);
}

function usage() {
  console.error("usage: node explore.mjs <observations.jsonl> [--out=FILE]");
  console.error("the input is what an exploration session wrote as it went, one JSON object per line");
  process.exit(2);
}

// A file with no charter is one somebody pointed at by mistake. Every section
// would render empty and the page would read as "nothing to report", which is
// the one thing an exploration must never be able to say by accident.
function noCharter() {
  console.error(`${input} has no "charter" record — a session says what it set out to do before it says what it found`);
  process.exit(2);
}

function written(ctx, records) {
  const file = flag("out") ?? join(ctx.config.reports, REPORT_ROOMS.sessions, `explore-${today(ctx)}.html`);
  mkdirSync(dirname(file), { recursive: true });
  const page = writeExplore(file, records, options(ctx));

  return page;
}

const today = (ctx) => new Date(ctx.now()).toISOString().slice(0, 10);

const options = (ctx) => ({
  project: ctx.config.name, host: ctx.memory.host,
  generated: new Date(ctx.now()).toISOString().slice(0, 16).replace("T", " "),
});

main();
