// The run ledger, read back -- every machine's file merged into one history.
// `check` and `verify` ask whether the MAP is still true; this asks what
// happened the last times somebody actually ran the thing, and on whose machine.
import { disagree, forCase, summarize } from "../memory/history.mjs";
import { out } from "./format.mjs";

export function history(ctx, [id]) {
  const runs = ctx.memory.runs();
  if (!runs.length) return out("no runs recorded in this repository yet");
  return id ? one(id, forCase(runs, id)) : all(runs);
}

function one(id, runs) {
  if (!runs.length) return out(`no recorded run of ${id}`);
  out(`\n${runs.length} recorded run(s) of ${id}, newest last:`);
  for (const r of runs) out(`  ${r.at ?? "?"}  ${String(r.status).padEnd(12)} ${r.done}/${r.of}${part(r)}  ${(r.host ?? "?").padEnd(14)} ${why(r)}`);
}

// A slice is named on the line, so "3/3" never reads as a whole case.
const part = (r) => (r.slice && r.slice.whole === false ? ` (steps ${r.slice.from}..${r.slice.to} of ${r.steps})` : "");

const why = (r) => (r.failedStep ? `failed at step ${r.failedStep.i} ${r.failedStep.do} ${r.failedStep.on ?? ""}`.trim() : `fe ${r.fe_commit ?? "?"}`);

function all(runs) {
  out(`\n${runs.length} recorded run(s) across ${new Set(runs.map((r) => r.case)).size} case(s) and ${new Set(runs.map((r) => r.host)).size} machine(s):`);
  for (const s of summarize(runs)) out(`  ${s.case.padEnd(24)} ${s.last.padEnd(12)} ${s.pass}/${s.runs} passed${flag(s)}`);
}

const flag = (s) => (disagree(s.hosts) ? `   SPLIT — ${verdicts(s)}` : s.flaky ? "   FLAKY" : "");

const verdicts = (s) => s.hosts.map((h) => `${h.host} ${h.last}`).join(" · ");

export function flaky(ctx) {
  const rows = summarize(ctx.memory.runs()).filter((s) => s.flaky || disagree(s.hosts));
  if (!rows.length) return out("no case disagrees with itself — same verdict everywhere, no flipping");
  out(`\n${rows.length} case(s) that do not give one answer — fix the case or quarantine it:`);
  for (const s of rows) out(`  ${s.case.padEnd(24)} ${s.pass}/${s.runs} passed, last ${s.last} at ${s.at ?? "?"}\n${detail(s)}`);
}

// A case passing on one machine and failing on another is a different bug from
// one that flips on a single machine, and saying which is half the diagnosis.
// Only the machines that actually flipped are named: sending a tester to look at
// a laptop that has only ever been green is worse than saying nothing.
const detail = (s) => (disagree(s.hosts) ? `      machines disagree: ${verdicts(s)}` : `      verdict flipped over time on ${s.flapped.join(", ")}`);
