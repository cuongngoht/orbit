// The terminal view of a run: one line per step, headers per screen, a
// result. `--json` silences all of it -- a machine gets one object instead.
import { trunc } from "./errors.mjs";
import { EXECUTORS } from "./verbs/index.mjs";

// Defaulted to the engine's own behaviours, because src/report/ renders a step
// out of a finished run-log with no context in hand -- and a report is always
// about verbs that existed when the run happened. A live run passes its own.
export const label = (s, executors = EXECUTORS) => executors.resolve(s.do).label?.(s) ?? "";
const nn = (s) => String(s.i).padStart(2);

export function createPrinter(enabled, write = console.log, executors = EXECUTORS) {
  const say = (...a) => { if (enabled) write(...a); };
  return { say, header: (c, values) => header(say, c, values), recall: (notes) => recall(say, notes), screen: (id, url) => say(`▶ ${id}  ${url ?? ""}`), ok: (s, r) => say(`  ✓ ${nn(s)} ${s.do.padEnd(10)} ${label(s, executors)}  ${tail(s, r, executors)}`), blocked: (s, msg) => say(`  ⊘ ${nn(s)} ${s.do.padEnd(10)} ${msg}`), refused: (s, msg) => say(`  ⊘ ${nn(s)} ${s.do.padEnd(10)} REFUSED: ${msg}`), fail: (s, err, ev) => (ev.pageless ? failPageless(say, s, err, ev, executors) : fail(say, s, err, ev, executors)) };
}

// What somebody already wrote down about this case or this screen, BEFORE the
// run rather than after it. The engine has recorded notes since the corpus
// existed and nothing in src/run/ ever read one: "recall first" was advice in a
// playbook, and advice an agent skips is advice nobody can tell was skipped.
//
// A note never changes a verdict. It is printed, and it is logged, so a reader
// of the report knows what the tester was told before the first click.
function recall(say, notes) {
  if (!notes.length) return;
  say(`recall : ${notes.length} note(s) about this case or screen`);
  for (const n of notes) say(`  · ${n.title}${n.stale ? "  (STALE — recorded against another build)" : ""}`);
}

function header(say, c, values) {
  say(`case   : ${c.id}  ${c.name}${c.destructive ? "  DESTRUCTIVE" : ""}`);
  say(`params : ${Object.entries(values).map(([k, v]) => `${k}=${v}`).join("  ") || "(none)"}`);
}

export function tail(s, r, executors = EXECUTORS) {
  const own = executors.resolve(s.do).tail;
  if (own) return own(s, r);
  const secs = `${(r.ms / 1000).toFixed(1)}s`;
  return r.polls ? `${r.polls} poll${r.polls > 1 ? "s" : ""} ${secs}` : secs;
}

function fail(say, s, err, ev, executors) {
  say(`  ✗ ${nn(s)} ${s.do.padEnd(10)} ${label(s, executors)}`);
  say(`     ${err.message}`);
  if (s.why) say(`     why: ${trunc(s.why, 200)}`);
  say(`     url: ${ev.url}  console: ${(ev.consoleOut.match(/Errors: \d+/) ?? ["?"])[0]}`);
  netAndEvidence(say, s, ev);
}

// A run with no page failed on what it asked a capability or the database; its
// evidence is the log, and saying "url: null" would be a line about nothing.
function failPageless(say, s, err, ev, executors) {
  say(`  ✗ ${nn(s)} ${s.do.padEnd(10)} ${label(s, executors)}`);
  say(`     ${err.message}`);
  if (s.why) say(`     why: ${trunc(s.why, 200)}`);
  say(`     evidence: ${ev.outRel}/run-log.jsonl  (a pageless run: no screen, console or browser network to capture)`);
}

function netAndEvidence(say, s, ev) {
  const bad = ev.bad.length ? " — " + ev.bad.slice(0, 3).map((l) => trunc(l, 90)).join("; ") : "";
  say(`     network: ${ev.calls} call(s), ${ev.bad.length} non-2xx${bad}`);
  say(`     evidence: ${ev.outRel}/  (step-${String(s.i).padStart(2, "0")}.png, -network.txt, run-log.jsonl)`);
}
