#!/usr/bin/env node
// One tester session as one page: every case that ran in a window, what each of
// them proved, and what is LEFT for a person to check by hand.
//
//   node review.mjs [--since=2026-09-18] [--case=<id>] [--all] [--out=FILE]
//
// The default window is what THIS machine ran today; --all is every run in the
// shared ledger, from every machine. The rows come from ui-tests/memory/runs/,
// so a review can be written after the fact by somebody who was not there -- and
// a case with NO run in the window is listed as something still to do rather
// than quietly left out.
//
// It reports the verdicts the runs earned and never re-judges them: a run is the
// only thing that may decide PASS.
//
// Exit 0 = written · 2 = nothing matched the window.
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { loadCases } from "../src/dsl/index.mjs";
import { dayOf } from "../src/memory/session.mjs";
import { writeReview } from "../src/report/review.mjs";
import { REPORT_ROOMS } from "../src/tests-tree.mjs";
import { createContext } from "../src/run/context.mjs";

const argv = process.argv.slice(2);
const ALL = argv.includes("--all");
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function main() {
  const ctx = createContext();
  const runs = selected(ctx);
  if (!runs.length) return nothing(ctx);
  console.log(`review: ${relative(process.cwd(), written(ctx, runs))}   ${runs.length} run(s)`);
}

// The same day-boundary `learn` counts independent sessions by, imported rather
// than spelled twice: a review and a lesson disagreeing about what "one session"
// means would be two tools telling one tester two different stories.
const today = (ctx) => dayOf({ at: new Date(ctx.now()).toISOString() });

function selected(ctx) {
  const since = flag("since") ?? today(ctx);
  const one = flag("case");
  return ctx.memory.runs().filter((r) => mine(r, ctx, since) && (!one || r.case === one));
}

// This machine, today, by default. The ledger is shared, and a review that
// quietly swept in a colleague's laptop would be signed off as though one person
// had watched all of it.
const mine = (r, ctx, since) => ALL || (r.host === ctx.memory.host && String(r.at ?? "") >= since);

function written(ctx, runs) {
  const file = flag("out") ?? join(ctx.config.reports, REPORT_ROOMS.sessions, `review-${today(ctx)}.html`);
  mkdirSync(dirname(file), { recursive: true });
  const page = writeReview(file, runs, options(ctx));

  return page;
}

const options = (ctx) => ({
  project: ctx.config.name, window: ALL ? "the whole ledger" : `since ${flag("since") ?? today(ctx)}`,
  generated: new Date(ctx.now()).toISOString().slice(0, 16).replace("T", " "),
  cases: loadCases(ctx.project.screensDir).map((c) => c.id), has: existsSync, reports: ctx.config.reports,
});

function nothing(ctx) {
  console.error(`no run to review${ALL ? " in the ledger" : ` on ${ctx.memory.host} since ${flag("since") ?? today(ctx)}`} — run a case first, or widen the window: --since=YYYY-MM-DD, --all`);
  process.exit(2);
}

main();
