// Report delivery never changes the verdict. Pruning is a separate, optional
// consequence of a successful publication, and cannot hide its path either.
import { basename } from "node:path";
import { EXIT } from "../run/errors.mjs";
import { reportReady, writeReport } from "./index.mjs";
import { reportLock } from "./destination.mjs";

export function publishRun(ctx, outcome, render = writeReport) {
  try { return delivered(ctx, outcome, render); }
  catch (e) { ctx.warn(`report not written: ${e.message}; evidence retained at ${outcome.run.out}`); }
  return null;
}

function delivered(ctx, outcome, render) {
  const file = render(outcome.run.out, ctx.config.reports, undefined, ctx.memory.runs(), reportLock(ctx));
  sweep(ctx);

  return file;
}

function sweep(ctx) {
  try { pruneReports(ctx); }
  catch (e) { ctx.warn(`evidence not pruned: ${e.message}`); }
}

export function pruneReports(ctx) {
  const runs = ctx.memory.runs(Infinity);
  const unresolved = new Set(runs.filter((r) => (EXIT[r.status] ?? 0) !== 0 && r.evidence).map(dirOf));
  const rendered = new Set(runs.filter((r) => r.evidence && reportReady(ctx.config.reports, r.evidence)).map(dirOf));
  return ctx.memory.prune({ n: ctx.config.retention, unresolved, rendered });
}

const dirOf = (r) => basename(r.evidence);
