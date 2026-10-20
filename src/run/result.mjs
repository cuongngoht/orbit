// What a finished run looks like to the outside: the exit code, the RESULT
// line, and the one JSON object a machine reads instead of the log.
import { join, resolve } from "node:path";
import { shownPath } from "../shown-path.mjs";
import { caseDigest } from "../dsl/digest.mjs";
import { memoryPaths } from "../memory/store.mjs";
import { insideRepo } from "../store/context.mjs";
import { EXIT, Refused } from "./errors.mjs";
import { sliceOf } from "./status.mjs";
import { parsed } from "./verdict.mjs";
import { storePath } from "../store/guard.mjs";

// A run's evidence is a room in the machine store, beside the ledger that
// records the run -- not a directory in anybody's checkout, and not configurable
// on its own. `--out` still wins, because "put this one somewhere I can see it"
// is a real thing to want while investigating.
export function outDir(ctx, c, explicit) {
  const given = explicit ? resolve(explicit) : null;
  if (given && insideRepo(given)) throw new Refused("--out must be outside a repository — evidence contains raw runtime values");
  const root = ctx.store(true);
  const file = given ?? join(memoryPaths(root).evidence, `${c.id}-${stamp(new Date())}`);
  return ctx.project?.layout === 3 ? storePath(memoryPaths(root).evidence, file) : file;
}

// Two runs of one case in one day is the NORMAL way a failure gets
// investigated, and a date alone had the second one overwrite the first --
// losing the evidence of the run people were actually looking at. Colons are
// out because Windows refuses them in a path.
const stamp = (d) => d.toISOString().slice(0, 19).replace(/[:T]/g, "-");

export const exitCode = (status) => EXIT[status] ?? 0;

// A status that needs explaining explains itself on the line people read, so
// nobody has to know what the word means to act on it. A table, so the next
// status word costs a row rather than a branch.
const SUFFIX = {
  PARTIAL: (run) => `  steps ${run.from}..${run.to} of ${run.c.steps.length} only — the case as a whole was not run`,
  INCONCLUSIVE: () => "  nothing ruled on the product: no assert/api/sql/expect ran",
};

// WHICH SCREENS this run touched, so "how far has that screen been checked"
// is answerable from the ledger alone -- without re-reading N run-logs, or
// re-parsing the cases, either of which makes the answer depend on files that
// may have moved since. The start screen counts even when no step names it.
function screensOf(run) {
  const named = run.log.records.filter((r) => r.kind === "step").map((r) => r.screen);
  return [...new Set([run.c.start, ...named].filter(Boolean))];
}

// The slowest step, recorded so a case can be warned about BEFORE it flips
// rather than after. A run sitting at 90% of its deadline is one slow commit
// away from a timeout, and a timeout reads as a product failure to everybody
// who was not there. `src/query/triage.mjs` already says a timeout is not a
// diagnosis; this is the number that lets somebody act before it becomes one.
function slowestOf(run) {
  const steps = run.log.records.filter((r) => r.kind === "step" && typeof r.ms === "number");
  const worst = steps.sort((a, b) => a.ms - b.ms).at(-1);
  return worst ? { i: worst.i, do: worst.do, ms: worst.ms } : null;
}

// Of the RUN deadline, not of a step's: the step budget is per-step and says
// nothing about a case creeping toward the wall as it grows.
function budgetSpent(run, ms) {
  const runSec = run.budget?.runSec ?? null;
  if (!runSec) return null;
  return { runSec, usedPct: Math.round((ms / (runSec * 1000)) * 100) };
}

export function resultLine(outcome) {
  const { run, status, ms, log } = outcome;
  const tail = `  (${Math.round(ms / 1000)}s)  log: ${shownPath(log)}`;
  if (status === "FAIL") return `RESULT: FAIL at step ${run.slice[run.done].i}/${run.c.steps.length}${proved(run)}${tail}`;
  return `RESULT: ${status} ${run.done}/${run.slice.length}${SUFFIX[status]?.(run) ?? ""}${proved(run)}${tail}`;
}

// WHAT the run ruled on, not just how many times. A count was a number with no
// subject: three UI asserts and a case that checked the screen, the call it
// made and the row it wrote both printed `3`, and only one of them is a tested
// feature. The words come from the verb table, so nothing can be claimed here
// that no verb proves.
function proved(run) {
  const layers = Object.entries(run.proved).filter(([, n]) => n);
  if (!layers.length) return "";
  return `  proved ${layers.map(([l, n]) => `${l} ${n}`).join(" · ")}`;
}

// One line, the whole outcome: what ran, as whom, what it proved, where the
// evidence is. `report` is the case's own reported value, parsed.
//
// `fe_commit` and `env` are what dates the verdict: a PASS is evidence about the
// build and the environment it was taken on, and a coverage report that cannot
// see either has to treat it as unknown rather than as current.
//
// `failure` is WHERE and WHY it stopped, for the reader that has the JSON and
// not the log: the kind of stop, which part of the step ended it (`bind`, `act`
// or `wait`), the truncated message, and the step as it was driven. It is
// additive -- `failedStep` keeps its exact old shape, because a consumer reads
// it -- and it is present for a REFUSED and a BLOCKED too, which `failedStep`
// never was. The `phase` is the field that stops a spent wait being mistaken
// for a locator that no longer matches.
//
// `case_digest` is the sha of the case AS WRITTEN (src/dsl/digest.mjs): a
// PASS is about that case, and coverage stops counting it the day the file says
// something else (src/qa/states.mjs, the `case` reference).
//
// `params` is what the COMMAND LINE gave (plus defaults) and nothing else. It
// used to be the whole value bag after resolve had mutated it, so a ledger line
// read `params: {NAME:"TC-1", ID:"42"}` and invited a re-run with ID=42 -- which
// bindParams then warns is not a param. Where a value came from is the point:
// `resolved` is what SQL found, `captured` is what a step bound.
export function resultJson(outcome) {
  const { run, status, ms, log } = outcome;
  const failed = run.slice[run.done];
  return {
    case: run.c.id, start: run.c.start ?? null, status, done: run.done, of: run.slice.length, steps: run.c.steps.length, ms,
    slice: sliceOf(run), verdicts: run.verdicts, proved: run.proved,
    params: run.given, resolved: run.resolved.length ? run.resolved : null, captured: run.captured?.length ? run.captured : null,
    identity: run.identities.map((r) => ({ as: r.as, atStep: r.atStep, upn: r.upn, roles: r.roles })),
    report: parsed(run.report),
    failedStep: status === "FAIL" ? { i: failed.i, do: failed.do, on: failed.on ?? failed.selector ?? null } : null,
    failure: run.failure ?? null,
    evidence: run.out, log, fe_commit: run.head, env: run.env ?? null, case_digest: caseDigest(run.c),
    screens: screensOf(run), slowest: slowestOf(run), budget: budgetSpent(run, ms),
  };
}
