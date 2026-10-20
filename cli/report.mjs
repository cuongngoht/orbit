#!/usr/bin/env node
// Turn a run's evidence into HTML. Two shapes, because two different questions
// get asked and one page cannot answer both honestly:
//
//   node report.mjs [<evidence-dir>]   ONE RUN -- the verdict, the three layers
//                                     that earned it, and the exact text of
//                                     every question it asked. Default: the
//                                     most recent run.
//   node report.mjs --screen=<id>      ONE SCREEN -- every case that has touched
//                                     it, on one page: who drove it with which
//                                     rights, every query asked of the data
//                                     underneath, each case's verdict and
//                                     pictures, and what a person still has to
//                                     check. Built from the ledger, so it needs
//                                     no plan and no session.
//
// Both are self-contained: every image is embedded and every case carries its
// own JSON, so the file is the thing you send.
import { join } from "node:path";
import { EXIT, Refused } from "../src/run/errors.mjs";
import { memoryPaths } from "../src/memory/store.mjs";
import { createContext } from "../src/run/context.mjs";
import { latestRun, writeReport } from "../src/report/index.mjs";
import { readRun } from "../src/report/read.mjs";
import { writeScreen } from "../src/report/screen.mjs";
import { REPORT_ROOMS } from "../src/tests-tree.mjs";
import { reportLock } from "../src/report/destination.mjs";

const argv = process.argv.slice(2);
const flag = (name) => argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);

function main() {
  const ctx = createContext();
  const screen = flag("screen");
  console.log(screen ? perScreen(ctx, screen) : perRun(ctx));

}

function perRun(ctx) {
  const dir = argv.find((a) => !a.startsWith("--")) ?? latestRun(memoryPaths(ctx.store()).evidence);
  return writeReport(dir, ctx.config.reports, undefined, ctx.memory.runs(), reportLock(ctx));
}

// A screen with no run is not an error -- it is the answer, and the page says
// so. Refusing here would make "nothing has been checked yet" indistinguishable
// from a broken command.
function perScreen(ctx, screen) {
  const file = flag("out") ?? join(ctx.config.reports, REPORT_ROOMS.screens, `screen-${screen.replace(/[^\w.-]+/g, "-")}.html`);
  return writeScreen(file, screen, ctx.memory.runs(), loader, options(ctx));
}

// Null rather than a throw when the evidence is gone: pruning is normal, and a
// pruned run still has its verdict in the ledger.
const loader = (dir) => { try { return dir ? readRun(dir) : null; } catch { return null; } };

const options = (ctx) => ({ origin: ctx.config.origin, env: ctx.config.launch?.env ?? null, project: ctx.config.name, generated: new Date(ctx.now()).toISOString().slice(0, 16).replace("T", " ") });

try { main(); }
catch (e) {
  console.error(`report not written: ${e.message}`);
  process.exit(e instanceof Refused ? EXIT.REFUSED : EXIT.BLOCKED);
}
