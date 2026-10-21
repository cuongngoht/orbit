// Run one JSON case, start to finish. Returns the outcome; throws Refused or
// Blocked when the run never started. The CLI turns both into exit codes.
//
//   load -> validate -> bind params -> [dry: print plan and stop]
//        -> resolve targets from SQL -> plan steps -> gates -> steps -> result
import { asWritten, caseDigest } from "../dsl/digest.mjs";
import { findCase } from "../dsl/load.mjs";
import { needsPage } from "../dsl/page.mjs";
import { noneProved } from "../dsl/verbs.mjs";
import { validate } from "../dsl/validate.mjs";
import { parseArgs, USAGE } from "./args.mjs";
import { printDry } from "./dry.mjs";
import { Refused } from "./errors.mjs";
import { passGates } from "./gates/index.mjs";
import { createLog } from "./log.mjs";
import { runSteps } from "./loop.mjs";
import { bindParams } from "./params.mjs";
import { planSteps, sliceSteps } from "./plan.mjs";
import { createBudget } from "./budget.mjs";
import { watermarkOf } from "./watermark.mjs";
import { createPrinter } from "./printer.mjs";
import { resolveTargets } from "./resolve-sql.mjs";
import { finalStatus, sliceOf } from "./status.mjs";
import { outDir, resultJson } from "./result.mjs";
import { draftPaths } from "../draft/store.mjs";
import { reserveEvidence } from "../memory/reserve.mjs";
import { isStale, relevant } from "../memory/note.mjs";

export function runCase(ctx, argv) {
  const args = parseArgs(argv);
  const c = validated(ctx, loaded(ctx, args));
  const print = createPrinter(!args.json, console.log, ctx.executors);
  const values = announced(c, args, print, ctx.warn);
  return args.dry ? dryRun(ctx, c, values, args, print) : execute(ctx, c, values, args, print);
}

function announced(c, args, print, warn) {
  const values = bindParams(c, args.given, warn);
  print.header(c, values);
  return values;
}

function loaded(ctx, args) {
  if (!args.ref) throw new Refused(USAGE);
  const dir = args.draft ? draftDir(ctx) : ctx.project.screensDir;
  const c = findCase(dir, args.ref);
  if (!c) throw new Refused(missingWhy(args.ref, args.draft));
  return c;
}

const missingWhy = (ref, draft) => (draft ? `no draft case ${ref}` : `no case ${ref} — try: query cases, or point me at a report.html that ran it`);

const draftDir = (ctx) => draftPaths(ctx.store()).cases;

function validated(ctx, c) {
  const problems = validate(c, ctx.graph, ctx.dsl, ctx.validators, capabilityLookup(ctx));
  if (problems.length) throw new Refused(`case is invalid — fix it before running:\n  ${problems.join("\n  ")}`);
  return c;
}

export const capabilityLookup = (ctx) => (id) => (ctx.capabilities?.has?.(id) ? ctx.capabilities.resolve(id) : null);

// --dry promises to touch nothing -- the database included, so no resolve.
function dryRun(ctx, c, values, args, print) {
  const { slice } = planned(ctx, c, args, print);
  printDry(ctx, print.say, slice, values);
  return { c, status: "DRY", code: 0 };
}

function planned(ctx, c, args, print) {
  const sliced = sliceSteps(planSteps(c, ctx.graph, ctx.executors), args.from, args.to);
  if (sliced.from !== 1 || sliced.to !== c.steps.length) print.say(`slice  : steps ${sliced.from}..${sliced.to} of ${c.steps.length} — recorded as PARTIAL, not as the case passing`);
  return sliced;
}

function execute(ctx, c, values, args, print) {
  const run = prepare(ctx, c, values, args, print);
  const release = reserveEvidence(run.out, Boolean(args.out));
  try { return driven(ctx, run); }
  finally { release(); }
}

function driven(ctx, run) {
  passGates(ctx, run);
  resolve(ctx, run);
  runSteps(ctx, run);
  return conclude(ctx, run);
}

// AFTER the gates. A destructive, stale, signed-out or wrong-identity run has no
// business reading the database first -- it was never going to happen.
function resolve(ctx, run) {
  run.resolved = resolveTargets(ctx, run.c, run.values);
  if (run.resolved.length) run.log.record({ kind: "resolve", resolved: run.resolved });
}

function prepare(ctx, c, values, args, print) {
  const { slice, from, to } = planned(ctx, c, args, print);
  const run = { c, values, given: { ...values }, args, print, slice, from, to, page: paged(ctx, c), budget: createBudget(ctx, ctx.env), watermark: watermarkOf(slice, ctx.dsl), resolved: [], head: ctx.frontend.commit(), env: ctx.config.launch?.env ?? null, out: outDir(ctx, c, args.out), log: createLog(), identities: [], captured: [], status: "PASS", verdicts: 0, proved: noneProved(), done: 0, report: null, shown: null, t0: ctx.now() };
  return recalled(ctx, opened(ctx, run));
}

// Does this run need a browser page? Asked of the case and of every capability
// it calls (src/dsl/page.mjs). A pageless run that claims to rule on the SCREEN
// is refused before anything runs: nothing in it could have looked at one.
function paged(ctx, c) {
  const page = needsPage(c, ctx.dsl, (id) => (ctx.capabilities?.has?.(id) ? ctx.capabilities.resolve(id).page : undefined));
  if (!page && c.steps.some((s) => ctx.dsl.showsScreen(s))) throw new Refused(`${c.id} needs no page, yet a step claims to prove ui — a verdict about the screen needs a page to have looked at`);
  return page;
}

// L3: the memory reaches the RUN. `about` is the key the map already uses, so
// a note filed against the case and one filed against the screen it starts on
// both arrive -- src/memory/note.mjs decides what matches, here as everywhere.
function recalled(ctx, run) {
  const notes = notesFor(ctx, run.c).map((n) => ({ ...n, stale: isStale(n, run.head) }));
  if (notes.length) run.log.record({ kind: "recall", notes: notes.map(said) });
  run.print.recall(notes);
  return run;
}

const said = (n) => ({ about: n.about, title: n.title, host: n.host, at: n.at, stale: n.stale });

// Read ONCE. Asking the port twice returns two sets of distinct objects, and a
// Set over those dedupes nothing -- a note filed against both the case and its
// screen would be recalled twice. A case that starts on no screen asks about
// no screen: `relevant(all, undefined)` is "every note", which is not a recall.
function notesFor(ctx, c) {
  const all = ctx.memory.notes();
  return [...new Set([...relevant(all, `case:${c.id}`), ...(c.start ? relevant(all, c.start) : [])])];
}

function opened(ctx, run) {
  run.log.record({ kind: "run", case: run.c.id, file: run.c._file, source: asWritten(run.c), case_digest: caseDigest(run.c), page: run.page, params: run.given, origin: ctx.config.origin, runDir: run.page ? ctx.browser.dir() : null, sqlCommand: ctx.config.sql.command ?? null, fe_commit: run.head, env: run.env, slice: [run.from, run.to] });
  return run;
}

// The case's own JSON, in the log, so the report can show what was ASKED and
// not only what came back. A reader with the verdict and the evidence but not
// the case has to go and find the file -- which may be on another machine, or
// may have been edited since -- and a report whose point is that it travels
// cannot depend on that. Keys the loader added for itself are dropped: `_file`
// is already its own field, and nobody pastes an underscore back into a case.

// The status the run DESERVES, decided in one place (status.mjs) and written
// back onto `run` so the outcome and the run object cannot disagree.
function conclude(ctx, run) {
  const ms = ctx.now() - run.t0;
  run.status = finalStatus(run);
  run.log.record({ kind: "result", status: run.status, done: run.done, of: run.slice.length, steps: run.c.steps.length, slice: sliceOf(run), verdicts: run.verdicts, proved: run.proved, ms, report: run.report });
  const log = run.log.flush(run.out);
  return remembered(ctx, { c: run.c, run, status: run.status, ms, log });
}

// The evidence directory holds one run; the ledger outlives it, and is the only
// place "has this ever passed" can be answered from.
//
// A run stopped by a GATE does not come through here -- it never produced an
// outcome -- and it is recorded separately by cli/run-case.mjs. That used to be
// deliberate silence on the grounds that nothing was observed, and the grounds
// were half right: nothing was observed about the PRODUCT. Something was
// observed about the MACHINE, and "this laptop refuses twice a week" is a thing
// a team needs and nobody could see, because the only trace was a line that
// scrolled past. REFUSED and BLOCKED raise no coverage (RUN_STATES `verifies`),
// so recording them cannot flatter a number.
function remembered(ctx, outcome) {
  ctx.memory.recordRun(resultJson(outcome));
  return outcome;
}
