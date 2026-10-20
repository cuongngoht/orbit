// What the report is ABOUT, separated from how it looks: the run, the three
// layers it ruled on, and the exact text of every question it asked.
//
// The grouping comes from the verb table's `proves` column, so this file names
// no verb and cannot claim a layer the engine has no verb for.
import { LAYERS, noneProved, provedBy } from "../dsl/verbs.mjs";
import { SECRET_NAME, scrubbed } from "../scrub.mjs";

export function model(all, history = []) {
  const records = shown(all);
  const steps = records.filter((r) => r.kind === "step");
  const result = one(records, "result");
  const run = one(records, "run");
  return {
    run, result, proved: result.proved ?? noneProved(),
    identities: records.filter((r) => r.kind === "identity"), captured: records.filter((r) => r.kind === "capture"),
    resolved: records.filter((r) => r.kind === "resolve").flatMap((r) => r.resolved ?? []),
    steps, layers: layered(steps), failed: steps.find((s) => s.ok === false) ?? null,
    shots: shotSteps(steps), history: recent(history, run.case),
    inputComplete: all.complete !== false && all.filter((r) => r.kind === "run").length === 1 && all.filter((r) => r.kind === "result").length === 1,
  };
}

// What may LEAVE, decided by an ALLOW-LIST.
//
// run-log.jsonl is raw on purpose -- it is the run talking to itself, inside
// the machine store. A report is the opposite: the one artefact that travels,
// mailed and attached to tickets, with every screenshot embedded in it. The
// rendering is where raw stops.
//
// An allow-list, and not a list of what to mask, for exactly the reason
// src/learn/evidence.mjs `pickRun` is one: a field added to the log next year is
// masked BY DEFAULT instead of leaking until somebody remembers to deny it.
//
// A deny-list cannot be right here. `loop.mjs asked()` logs EVERY declared
// field of the resolved step -- the js, the selector, the url, with their
// ${PARAM}s already filled in -- so the set of free text grows the day
// `dsl/fields.mjs` gains a row, and nothing in this repo would fail if this
// file had not been updated. That is a list pretending to be a concept.
//
// STRUCTURAL is the concept: what a reader needs to NAVIGATE a run, and nothing
// a product typed. Counts, ids, paths, hashes, a verb name, a screen name, a
// variable name, and which roles were held -- which is the point of recording
// an identity at all, while the `upn` beside it is not.
const STRUCTURAL = new Set([
  "kind", "i", "do", "on", "screen", "ok", "polls", "ms", "at", "host",
  "times", "tries", "timeout", "into", "file", "identity", "method",
  "case", "origin", "runDir", "fe_commit", "env", "slice", "case_digest",
  "status", "done", "of", "steps", "verdicts", "proved",
  "screenshot", "network", "evidence", "as", "atStep", "roles",
  "screens", "slowest", "budget", "runSec", "usedPct", "start",
]);

// The disclosures this engine makes ON PURPOSE, at any depth -- a resolve row
// carries its own `sql`, and the report renders the line that re-runs it.
// Asserted in test/security.test.mjs so nobody "fixes" them into uselessness:
//
//   the SQL and the command that repeats it -- a masked query is one nobody can
//   run, and repeating the check by hand is what the report is FOR
//   `source`, the case's own JSON -- a masked case is one that runs a different
//   test, and the report is the copy you re-run from when the file is gone
//
// Both are authored content, not runtime values: a case carries ${PARAM}
// placeholders, and the values that fill them are `params`, which is masked.
const VERBATIM = new Set(["query", "sql", "sqlCommand", "source"]);

const kept = (k) => STRUCTURAL.has(k) || VERBATIM.has(k);

const shown = (records) => records.map(rebuilt);

function rebuilt(value) {
  if (Array.isArray(value)) return value.map(rebuilt);
  if (!isObject(value)) return scrubbed(value);
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decided(k, v)]));
}

// The key is asked FIRST, because a secret in a record is a name and a value in
// two different strings and no pattern over the value alone can see it.
function decided(k, v) {
  if (SECRET_NAME.test(k)) return "[redacted]";
  if (kept(k)) return v;
  return isObject(v) || Array.isArray(v) ? rebuilt(v) : scrubbed(v);
}

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

// The LAST FIVE runs of this case, oldest first -- the one question a single
// run cannot answer about itself: is this case steady, or is it flipping?
//
// It comes from the ledger, the report's only input that is not run-log.jsonl.
// Optional on purpose: a report rendered months later, or from an evidence
// directory somebody copied to a share, still renders. It just has no band,
// rather than refusing to be built.
const BAND = 5;

// Filtered here, not by the caller: filtering first needs the case id, and the
// only thing that knows it is the log the caller has not read yet.
const recent = (history, id) => history.filter((r) => r.case === id).slice(-BAND).map((r) => ({ at: r.at, status: r.status, host: r.host, ms: r.ms }));

const one = (records, kind) => records.find((r) => r.kind === kind) ?? {};

// A step that captured a screen without ruling on anything: `layered()` groups
// by the `proves` column, so a step that proves nothing appears in no layer and
// its picture would never be shown. Keyed on the table, so this names no verb.
const shotSteps = (steps) => steps.filter((s) => s.screenshot && provedBy(s) === null);

// Every step that RULED on this layer, held or not: a failed verdict is the one
// a reader most needs the text of.
const layered = (steps) => LAYERS.map((id) => ({ id, steps: steps.filter((s) => provedBy(s) === id) }));

// The command a tester repeats a query with, as a line they can paste. The run
// recorded which command the project uses for SQL, so this is the real one and
// not an example of one.
export function sqlCommandLine(run, query) {
  if (!run.sqlCommand?.length) return null;
  return `${run.sqlCommand.join(" ")} ${shellArg(query)}`;
}

// Double quotes, because a SQL literal is single-quoted far more often than not.
const shellArg = (s) => `"${String(s).replace(/(["\\$`])/g, "\\$1")}"`;
