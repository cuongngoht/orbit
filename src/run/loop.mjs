// The run loop: each step in order, recorded, printed, until the end, a SKIP, a
// BLOCKED precondition or a FAILED step -- which captures its own evidence.
import { captureOf } from "./capture.mjs";
import { captureEvidence, captureScreen, pagelessEvidence } from "./evidence.mjs";
import { Blocked, Refused, trunc } from "./errors.mjs";
import { runStep } from "./step.mjs";


export function runSteps(ctx, run) {
  try {
    for (const s of run.slice) if (one(ctx, run, s)) break;
  } catch (err) {
    stopped(ctx, run, run.at ?? run.slice[run.done], err);
  }
}

function one(ctx, run, s) {
  announceScreen(ctx, run, s);
  const r = runStep(ctx, run, s);
  recordStep(ctx, run, run.at, r);
  run.print.ok(run.at, r);
  return advance(ctx, run, run.at, r);
}

function recordStep(ctx, run, s, r) {
  run.log.record({ kind: "step", i: s.i, ...asked(ctx, s), ok: true, polls: r.polls, ms: r.ms, ...proof(ctx, run, s), ...(ctx.executors.resolve(s.do).logged?.(r) ?? {}) });
}

// A PASS has to SHOW what it proved, not only count it -- an illustrated report
// only ever produced by a failing run teaches a team that a green run is not
// worth reading. So the screen behind a ui verdict is captured when the verdict
// HELD, exactly as it already was when one broke. Asked of the vocabulary, so
// this file still names neither a verb nor a layer.
const proof = (ctx, run, s) => (ctx.dsl.showsScreen(s) ? { screenshot: captureScreen(ctx, s, run.out) } : {});

// What the step ASKED, as the run resolved it: the SQL with its ${PARAM}s
// filled in, the js that was evaluated, the url pattern that had to match. The
// log kept three of those fields by name and dropped the rest, so the one thing
// a tester needs to check a result by hand -- the exact query the database was
// sent -- was the one thing never written down. Derived from the EFFECTIVE field
// table, so the next field is in the log the day its row exists -- including one a
// project's own extension registered, which a list captured at import time would
// have been too early to see.
const asked = (ctx, s) => Object.fromEntries(ctx.dsl.fieldNames().filter((f) => s[f] !== undefined && s[f] !== null).map((f) => [f, s[f]]));

function announceScreen(ctx, run, s) {
  if (s.screen === run.shown) return;
  run.shown = s.screen;
  run.print.screen(s.screen, ctx.graph.screens.get(s.screen)?.url);
}

// advance() is reached only when the step did NOT throw, so a verdict is counted
// only once it has executed AND held -- which is what a PASS has to be able to
// claim.
function advance(ctx, run, s, r) {
  run.done++;
  tally(ctx, run, s);
  learned(ctx, run, s, r);
  if (stops(ctx, s, r)) run.status = "SKIP";
  return stops(ctx, s, r);
}

// One verdict is one LAYER proved. The number a PASS needs and the three layers
// a report has to name are the same event, so they are counted in the same
// place and cannot disagree. Counted per step, not per `times` iteration: a
// times: 3 assert is one verdict asked three times.
function tally(ctx, run, s) {
  const layer = ctx.dsl.provedBy(s);
  if (!layer) return;
  run.verdicts++;
  run.proved[layer]++;
}

// What the run KNOWS after this step: whatever the verb keeps (`after`), and any
// name the step bound with `into` -- the only way a runtime value reaches a
// later step. Both are asked of the verb, so neither is a name this file knows.
function learned(ctx, run, s, r) {
  ctx.executors.resolve(s.do).after?.(run, r.result);
  if (s.into) bindInto(ctx, run, s, r);
}

function bindInto(ctx, run, s, r) {
  const value = captureOf(ctx.executors.resolve(s.do), s, r.result);
  run.values[s.into] = value;
  run.captured.push({ at: s.i, into: s.into, value });
  run.log.record({ kind: "capture", at: s.i, into: s.into, value });
}

// Only the verb that owns the sentinel reads it, so a report whose page
// expression happened to return "SKIP" can no longer end the case at exit 0.
const stops = (ctx, s, r) => Boolean(ctx.executors.resolve(s.do).stops?.(r.result));

function stopped(ctx, run, s, err) {
  if (err instanceof Refused) return refused(ctx, run, s, err);
  if (err instanceof Blocked) return blocked(ctx, run, s, err);
  if (!(err instanceof Error) || err instanceof TypeError) throw err;
  failed(ctx, run, s, err);
}

// A refusal is not a product failure. It used to be filed as one -- FAIL, exit 1,
// evidence captured, a FAIL line in the shared ledger -- because `Refused`
// extends Error without setting `name`, so the TypeError guard let it through to
// failed(). The very same condition, detected one step earlier by a gate, exits
// 2. It cannot mean two different things depending on where it was noticed.
function refused(ctx, run, s, err) {
  run.status = "REFUSED";
  run.print.refused(s, err.message);
  run.log.record({ kind: "step", i: s.i, ...asked(ctx, s), ok: false, refused: err.message, phase: phaseOf(err), ...typedOf(err) });
  noted(run, s, err, "refused");
}

function blocked(ctx, run, s, err) {
  run.status = "BLOCKED";
  run.print.blocked(s, err.message);
  run.log.record({ kind: "step", i: s.i, ...asked(ctx, s), ok: false, blocked: err.message, phase: phaseOf(err), ...typedOf(err) });
  noted(run, s, err, "blocked");
}

function failed(ctx, run, s, err) {
  run.status = "FAIL";
  const ev = run.page === false ? pagelessEvidence(run.out) : captureEvidence(ctx, s, run.out);
  run.log.record({ kind: "step", i: s.i, ...asked(ctx, s), ok: false, error: err.message, phase: phaseOf(err), url: ev.url, screenshot: ev.shot, console: ev.consoleOut, network: ev.netFile, networkCalls: ev.calls, networkFailures: ev.bad, observed: ev.observed });
  noted(run, s, err, "error");
  run.print.fail(s, err, ev);
}

// Where the run stopped, kept on the run so the RESULT object can carry it.
// The message used to live only in run-log.jsonl -- so `--json`, the thing a
// script and an agent actually read, said a run had failed and not one word
// about why, and every reader had to go and parse the log to find out. `s` here
// is run.at: the step as it was DRIVEN, so `selector` is the one the browser
// was really given.
//
// Truncated, because this reaches the committed ledger; the full text stays in
// the evidence directory, which remains the detailed source.
function noted(run, s, err, kind) {
  run.failure = { kind, phase: phaseOf(err), message: trunc(err.message, 200), step: s.i, do: s.do, on: s.on ?? null, selector: s.selector ?? null, ...typedOf(err) };
}

// What a helper or an adapter said about WHY it stopped (ADR 0036): its class, the capability gap
// it named and the operation key of a write whose outcome is unknown -- the facts verification
// classifies by (CAPABILITY_MISSING, AMBIGUOUS), never the text of a message.
const typedOf = (err) => Object.fromEntries([["helperClass", err.helperClass], ["gap", err.gap], ["ambiguous", err.ambiguous]].filter(([, v]) => v !== undefined && v !== null));

// Set by whoever threw (poll.mjs, step.mjs); a browser command that simply
// failed carries nothing, and "act" is the honest default for it.
const phaseOf = (err) => err.phase ?? "act";
