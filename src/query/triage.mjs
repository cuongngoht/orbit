// `query triage`: one run's evidence, sorted into what it DEMONSTRATES, what it
// is merely consistent with, and what it cannot tell at all.
//
// The failure that motivated this view is a sentence: "the click timed out, so
// the selector must have changed." Sometimes it had. Often the product had not
// reached that state, or the wait was asking about something the click never
// causes -- and a session that has already decided it is drift spends its next
// hour editing a map record that was right. A spent wait records that the
// predicate never held. It does not record why, and no amount of reading it
// will make it.
//
// So the bands are the point, not the diagnosis: a stop is classified only as
// far as the log can carry it, every remaining hypothesis is printed WITH the
// one command that would settle it, and the ambiguity is named out loud instead
// of being resolved by whichever explanation came to mind first.
//
// It reads run-log.jsonl through the report's reader and the report's model,
// because that file already has exactly one reader and a second one would be a
// second story about the same run. For the same reason the words for "why this
// status still needs a person" come from the session review's own table.
// A run is the only thing that may decide a verdict; this prints the one the run
// earned and never re-judges it.
import { join, resolve } from "node:path";
import { LAYERS, isVerdict } from "../dsl/verbs.mjs";
import { memoryPaths } from "../memory/store.mjs";
import { STEP_FIELDS } from "../dsl/fields.mjs";
import { selectorOf } from "../dsl/selector.mjs";
import { model } from "../report/model.mjs";
import { latestRun, readRun } from "../report/read.mjs";
import { UNJUDGED, WITNESSES } from "../report/review.mjs";
import { LOG_FILE } from "../run/log.mjs";
import { checkFindings } from "./check.mjs";
import { classify } from "./classify.mjs";
import { out } from "./format.mjs";

// Every declared field, so a field added to the table shows up here by itself.
// `do` is the row heading, and `url` is dropped because a failed step's record
// overwrites the declared one with the url the browser was actually on
// (run/loop.mjs `failed()`) -- and it is printed on its own line below.
const FIELDS = Object.keys(STEP_FIELDS).filter((f) => !["do", "url"].includes(f));

// How the run stopped, asked of the RECORD and of the verb table -- never of a
// verb name. `isVerdict` is the distinction that matters: a step that ruled on
// the product failed differently from one that never got there.
const KINDS = [
  ["blocked", (s) => Boolean(s.blocked)],
  ["refused", (s) => Boolean(s.refused)],
  ["verdict", (s) => isVerdict(s)],
  ["unreached", () => true],
];

// One row per way a run can stop. `maybe` is every explanation still standing,
// each with the command that settles it; `cannot` is what no command in this
// repo will settle, which is the half a reader skips unless it is printed.
const BANDS = {
  blocked: {
    maybe: [
      ["a precondition this machine could not establish — the product was never asked", () => "query.mjs doctor"],
      ["a resolve that matched no row: the shape the case named is not in this environment", (m) => `query.mjs case ${m.run.case}`],
    ],
    cannot: ["anything whatever about the product — BLOCKED is the harness giving up, and is never a defect"],
  },
  refused: {
    maybe: [
      ["the case, or the way it was invoked: a rule stopped it before the browser", () => "query.mjs check"],
      ["a gate --dry does not run: destructive, stale, session, identity, start screen", (m) => `run-case.mjs ${m.run.case} --dry`],
    ],
    cannot: ["anything about the product — nothing was observed, so nothing was ruled on"],
  },
  verdict: {
    maybe: [
      ["the product: it answered, and the answer is not what the case requires", (m) => `query.mjs history ${m.run.case}`],
      ["the case: the right layer, the wrong question asked of it", (m, s) => (s.on ? `query.mjs effect "${s.on}"` : `query.mjs case ${m.run.case}`)],
    ],
    cannot: ["which of those two it is — the log records the answer the product gave, never whether the question was fair"],
  },
  unreached: {
    maybe: [
      ["the map: the control is no longer where the record says it is", () => "query.mjs verify"],
      ["the product: it never reached the state the wait describes", (m, s) => `query.mjs screen ${s.screen ?? m.run.case}`],
      ["the case: the wait asks about something this step does not cause", (m) => `query.mjs case ${m.run.case}`],
    ],
    cannot: [
      "which of those three it is — a spent wait records that the predicate never held, never why",
      "so a timeout is NOT evidence of map drift: `query verify` is the only thing that names a drifted record",
    ],
  },
};

const ALWAYS = [
  "how long the failing step took — a step that threw records no duration",
  "what the same case did on another machine — `query history` merges every machine's ledger",
];

export function triage(ctx, args = []) {
  const read = loaded(ctx, args.find((a) => !a.startsWith("--")));
  if (read.why) return out(read.why);
  const said = { ...facts(ctx, read.m), ...classify(facts(ctx, read.m)) };
  return args.includes("--json") ? out(JSON.stringify(json(read, said))) : report(read.m, read.dir, said);
}

// Everything the classifier is allowed to reason from, and every one of them
// something the engine can demonstrate. Two are deliberately left null: whether
// the session was signed out and whether a record has drifted are both refused
// BEFORE the first step or answered by `verify`, so neither is in this log --
// the reader supplies them, and the table says so in the row that needs them.
function facts(ctx, m) {
  const s = m.failed;
  return {
    status: m.result.status, whole: m.result.slice?.whole ?? null, failure: failureOf(s),
    ruled: s ? isVerdict(s) : null, edgeKnown: knownEdge(ctx, s), selectorResolved: resolvable(ctx, s),
    invalid: about(ctx, m.run.case), nonTwoXx: s?.networkFailures ?? [],
    passedHereAtSameBuild: passedBefore(ctx, m), signedOut: null, identityProblem: null, driftedRecord: null,
  };
}

// Built from whichever field the record actually carries, never from the text
// of the message: a step stopped by a gate records `refused`, a precondition
// records `blocked`, a product failure records `error`.
//
// A missing `phase` stays null rather than defaulting. A log written before the
// engine recorded it genuinely does not say which part of the step stopped, and
// filling that in with "act" would read every historical timeout as a locator
// that no longer matches -- the exact mistake this whole table exists to stop.
const failureOf = (s) =>
  (s ? { kind: s.blocked ? "blocked" : s.refused ? "refused" : "error", phase: s.phase ?? null, message: s.error ?? s.refused ?? s.blocked ?? "", step: s.i, do: s.do, on: s.on ?? null, selector: s.selector ?? null } : null);

const knownEdge = (ctx, s) => (s?.on ? ctx.graph.edgeOn.has(s.on) : null);

const resolvable = (ctx, s) => (s ? Boolean(selectorOf(s, ctx.graph)) : null);

// The validator's own findings about THIS case, matched on the prefix `check`
// itself writes. If there are any, nothing below the DSL is worth diagnosing:
// the case does not yet say what it means.
const about = (ctx, id) => checkFindings(ctx).filter((f) => f.startsWith(`case ${id}`));

// "Nothing changed and it used to work" is the one timing signal the ledger can
// give: the same case, the same machine, the same frontend commit, already PASS.
function passedBefore(ctx, m) {
  const runs = ctx.memory?.runs?.() ?? [];
  const here = runs.filter((r) => r.case === m.run.case && r.status === "PASS" && r.fe_commit === m.run.fe_commit);
  return here.length > 0;
}

// A directory with no run in it is a usage mistake, not a crash: the reader is
// pointed at the command that makes one.
function loaded(ctx, given) {
  try {
    const dir = given ? resolve(given) : latestRun(memoryPaths(ctx.store()).evidence);
    return { dir, m: model(readRun(dir)) };
  } catch (e) {
    return { why: `${e.message}` };
  }
}

function report(m, dir, said) {
  out(`\nTRIAGE  ${m.run.case ?? "?"}  ${m.result.status ?? "?"}`);
  out(`evidence: ${dir}`);
  shown(m);
  classification(said);
  bands(m);
}

function bands(m) {
  maybe(m);
  cannot(m);
}

// The classification, with its confidence and -- when it has one -- the
// specialist that owns the repair. A low confidence prints no handoff, so
// nothing downstream can read one that was never earned.
function classification(said) {
  out(`\nclassified as ${said.type}  (confidence ${said.confidence})`);
  out(`  because      ${said.because}`);
  out(`  next         ${said.next}`);
  out(`  hand to      ${said.handoff ?? "nobody — this is not a repair anybody may start from here"}`);
}

// One object for whoever is routing rather than reading. The field names are
// the contract: type, case, step, edge, reason, evidence, confidence.
const json = (read, said) => ({
  type: said.type, confidence: said.confidence, case: read.m.run.case, status: said.status,
  step: said.failure?.step ?? null, do: said.failure?.do ?? null, edge: said.failure?.on ?? null,
  phase: said.failure?.phase ?? null, reason: said.because, next: said.next, handoff: said.handoff,
  proved: read.m.proved, invalid: said.invalid, evidence: join(read.dir, LOG_FILE), case_digest: read.m.run.case_digest ?? null,
});

function shown(m) {
  out("\nshown by this evidence");
  out(`  verdict      ${m.result.status ?? "?"} — the run earned it; a triage never re-judges one`);
  out(`  proved       ${tally(m.proved)}`);
  out(`  ran          ${sliceSaid(m.result)}`);
  stopped(m);
}

const tally = (proved) => LAYERS.map((l) => `${l} ${proved?.[l] ?? 0}`).join(" · ");

const sliceSaid = (r) =>
  r.slice?.whole === false
    ? `steps ${r.slice.from}..${r.slice.to} of ${r.steps} — a fact about those steps, not about the case`
    : `the whole case (${r.steps ?? "?"} steps, ${r.verdicts ?? 0} of them ruling)`;

function stopped(m) {
  const s = m.failed;
  if (!s) return out("  stopped at   nowhere — no step reported a failure");
  out(`  stopped at   step ${s.i} ${s.do}${s.on ? ` ${s.on}` : ""}`);
  out(`  said         ${s.error ?? s.refused ?? s.blocked ?? "nothing recorded"}`);
  observed(s);
}

// Every field the step actually carried, as the run resolved it -- the SQL with
// its params filled in, the js that was evaluated, the url pattern that had to
// match. Printed from the field table, so a new field appears here by itself.
function observed(s) {
  out(`  asked        ${FIELDS.filter((f) => s[f] !== undefined).map((f) => `${f}=${trim(s[f], 120)}`).join("  ") || "nothing"}`);
  if (s.url) out(`  url          ${s.url}`);
  out(`  outside 2xx  ${s.networkFailures?.length ? s.networkFailures.join(" · ") : `none recorded (of ${s.networkCalls ?? 0} calls)`}`);
  if (s.observed) out(`  on screen    ${trim(s.observed, 200)}`);
}

const trim = (v, n) => flat(v).length > n ? `${flat(v).slice(0, n - 1)}…` : flat(v);

const flat = (v) => String(v).replace(/\s+/g, " ").trim();

function maybe(m) {
  if (!m.failed) return leftOver(m);
  out("\nconsistent with — each needs one command to settle, and none of them is settled yet");
  for (const [say, how] of bandOf(m.failed).maybe) out(`  ${say}\n      node <engine>/cli/${how(m, m.failed)}`);
}

const bandOf = (s) => BANDS[KINDS.find(([, is]) => is(s))[0]];

// A run that did not fail still owes a reader something: whether its verdict
// covers what they will assume it covers.
function leftOver(m) {
  out("\nwhat this still leaves for a person");
  for (const line of unsettled(m)) out(`  ${line}`);
}

function unsettled(m) {
  const status = m.result.status;
  if (UNJUDGED[status]) return [`${status}: ${UNJUDGED[status]}`];
  if (!witnessed(m)) return [`it passed on the screen alone — a screen can show a write that never happened, so check the ${WITNESSES.join("/")} side yourself`];
  return [`PASS proving ${tally(m.proved)} — it ruled below the screen as well as on it`];
}

const witnessed = (m) => WITNESSES.some((l) => (m.proved?.[l] ?? 0) > 0);

function cannot(m) {
  out("\nthis evidence cannot tell");
  for (const line of unknowable(m)) out(`  ${line}`);
  out("\nNothing above changes the verdict printed at the top. Only a run may decide that.");
}

const unknowable = (m) => [...(m.failed ? bandOf(m.failed).cannot : passCannot(m)), ...ALWAYS];

const passCannot = (m) => [`whether anything the case did not ask about is right — ${m.result.verdicts ?? 0} question(s) were put to the product`];
