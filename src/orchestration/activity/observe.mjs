// AN OBSERVATION of one running check (ADR 0020): what its output says, as it arrives, written beside the task and
// never in it. The check runner (checks.mjs) creates one per run when the composition root binds an observer, hands
// it every chunk the Process port reads (`runObserved`), and settles it when the command has ended.
//
//   createObservation({ identity, command, why, adapters, sink, clock, budget }) -> { chunk(stream, bytes), settled(answer) }
//     identity  { task, action, attempt, check }   the engine's own ids, never new ones
//     command   the declared check; its argument list decides which adapter CLAIMS it and is never written -- only
//               the program's own name is (`program`: `npm`, `dotnet`), so a viewer can say what runs
//     adapters  tried in order: the first that claims the command reads it from the start; else each line is offered
//               to every adapter's `sniff`, and the first a line proves reads from that line on; else none (generic)
//     sink      { append(text) }   one call per chunk read; one that throws stops the writing, never the run
//     budget    bytes the action's file may hold: case events are dropped first (and counted); the end of an
//               observation always fits (LIMITS.ENDING_BYTES is kept back for it)
//   settled(answer) -> view     the Process port's answer as FACTS (did it start, time out, overflow, exit how): the
//                               observation ends; the check's verdict is the receipt's, never this
//
// Nothing here reads a clock of its own, writes a disk of its own or judges anything. A line is untrusted text: it is
// cut by bytes, cleaned and masked before a parser sees it (text.mjs), and only an adapter's allow-listed fields,
// themselves cleaned and bounded, are kept.
import { emptyObservation, foldObservation, observationView } from "./fold.mjs";
import { GENERIC, described } from "./generic.mjs";
import { createSplitter, cleaned, plain } from "./text.mjs";
import { ACTIVITY_SCHEMA, AUTHORITY, ENDINGS, KINDS, LIMITS, PRODUCER } from "./vocab.mjs";

export function createObservation(o) {
  const s = stateOf(o);
  queued(s, [startedEvent(s)]);
  flushedOut(s);
  return { chunk: (stream, bytes) => chunked(s, stream, bytes), settled: (answer) => settledObservation(s, answer) };
}

const claimedBy = (o) => o.adapters.find((a) => safely(() => a.claims(o.command), false)) ?? null;

function stateOf(o) {
  const claimed = claimedBy(o);
  return { ...o, seq: -1, folded: -1, bytes: 0, splitters: { out: createSplitter(LIMITS.LINE_BYTES), err: createSplitter(LIMITS.LINE_BYTES) }, adapter: claimed ?? GENERIC, parser: claimed ? claimed.parser() : null, fold: emptyObservation(), output: { lines: 0, bytes: { out: 0, err: 0 }, lastAt: null }, progressAt: -Infinity, progressLines: -1, dropped: 0, dropWhy: new Set(), sinkError: null, pending: [] };
}

const programOf = (c) => ((name) => (name ? cleaned(name.replace(/\.(exe|cmd|bat)$/i, ""), 60) || null : null))(String(c.argv?.[0] ?? "").split(/[\\/]/).pop());

const brief = (c) => ({ id: c.id ?? null, purpose: c.purpose ?? null, component: c.component ?? null, declaredAs: c.declaredAs ?? null, program: programOf(c) });

const startedEvent = (s) => ({ kind: "activity.started", ...s.identity, producer: PRODUCER, authority: AUTHORITY, command: brief(s.command), why: s.why ? cleaned(s.why, 240) : null, adapter: described(s.adapter) });

// ---- a chunk: its lines, what they say, written once ---------------------------------------------------------

function chunked(s, stream, bytes) {
  s.output.bytes[stream] += bytes.length;
  const events = s.splitters[stream].push(bytes).flatMap((line) => lineEvents(s, stream, line));
  queued(s, [...events, ...progressDue(s)]);
  flushedOut(s);
}

function lineEvents(s, stream, raw) {
  const text = plain(raw);
  Object.assign(s.output, { lines: s.output.lines + 1, lastAt: iso(s.clock()) });
  const switched = s.parser ? [] : sniffed(s, text);
  return [...switched, ...(s.parser ? safely(() => s.parser.line(text, stream), []) : [])];
}

// Nothing claimed the command: the first line an adapter recognises as its own producer's starts it, from that line.
function sniffed(s, text) {
  const found = s.adapters.find((a) => a !== GENERIC && safely(() => a.sniff(text), false));
  if (!found) return [];
  Object.assign(s, { adapter: found, parser: found.parser() });
  return [{ kind: "activity.adapter", adapter: described(found) }];
}

// A progress line when the output moved and the last one is old enough: a silent command writes none.
function progressDue(s) {
  const now = s.clock();
  if (s.output.lines === s.progressLines || now - s.progressAt < LIMITS.PROGRESS_MS) return [];
  Object.assign(s, { progressAt: now, progressLines: s.output.lines });
  return [{ kind: "activity.progress", output: outputOf(s) }];
}

const outputOf = (s) => ({ lines: s.output.lines, bytes: { ...s.output.bytes }, lastAt: s.output.lastAt });

// ---- keeping a line: the envelope, the allow-list, the budget --------------------------------------------------

const iso = (ms) => new Date(ms).toISOString();

const allowed = (e) => Object.fromEntries((KINDS[e.kind] ?? []).filter((k) => e[k] !== undefined && e[k] !== null).map((k) => [k, e[k]]));

function queued(s, events) {
  for (const e of events.filter((x) => KINDS[x.kind])) kept(s, e);
}

// Every event is folded here, whatever the sink does: the view settled returns is the whole run's. Only what fits the
// budget is written, and what was not is counted and said at the end.
function kept(s, e) {
  const body = { ...allowed(e), kind: e.kind };
  foldObservation(s.fold, { v: ACTIVITY_SCHEMA, seq: (s.folded += 1), gen: 1, at: iso(s.clock()), ...body });
  const line = `${JSON.stringify({ v: ACTIVITY_SCHEMA, seq: s.seq + 1, gen: 1, at: iso(s.clock()), ...body })}\n`;
  if (!fits(s, e, line)) return droppedEvent(s, s.sinkError ? "the observation could not be written" : "the observation's budget");
  Object.assign(s, { seq: s.seq + 1, bytes: s.bytes + Buffer.byteLength(line) }).pending.push(line);
}

const ending = (e) => ENDINGS.includes(e.kind) || e.kind === "activity.gap" || e.kind === "activity.started";

const fits = (s, e, line) => !s.sinkError && Buffer.byteLength(line) <= LIMITS.EVENT_BYTES && (ending(e) || s.bytes + Buffer.byteLength(line) <= s.budget - LIMITS.ENDING_BYTES);

function droppedEvent(s, why) {
  s.dropped += 1;
  s.dropWhy.add(why);
}

// One append per chunk read. A sink that throws (a full disk, a store gone) is let go: the run goes on, and what was
// not written is said at the end, in the view settled returns.
function flushedOut(s) {
  if (!s.pending.length || s.sinkError) return;
  const text = s.pending.splice(0).join("");
  try { s.sink.append(text); }
  catch (e) { s.sinkError = String(e?.code ?? e?.message ?? e).slice(0, 120); }
}

// ---- the end --------------------------------------------------------------------------------------------------

const ENDING_KIND = (a) => (a.started === false || a.timedOut || a.overflow ? "activity.failed" : "activity.completed");

const outcomeOf = (a) => ({ started: a.started !== false, timedOut: a.timedOut === true, overflow: a.overflow === true, status: Number.isInteger(a.status) ? a.status : null, durationMs: Number.isFinite(a.durationMs) ? a.durationMs : null, observerFailed: a.observerFailed === true });

const gapOf = (s) => (s.dropped || s.sinkError ? [{ kind: "activity.gap", dropped: s.dropped, why: [...s.dropWhy, ...(s.sinkError ? [`the sink failed: ${s.sinkError}`] : [])].join("; ") }] : []);

function settledObservation(s, answer) {
  const tail = ["out", "err"].flatMap((stream) => s.splitters[stream].end().flatMap((line) => lineEvents(s, stream, line)));
  queued(s, [...tail, ...(s.parser ? safely(() => s.parser.end(), []) : []), ...gapOf(s)]);
  queued(s, [{ kind: ENDING_KIND(answer ?? {}), outcome: outcomeOf(answer ?? {}), output: outputOf(s) }]);
  flushedOut(s);
  return observationView(s.fold);
}

function safely(fn, fallback) {
  try { return fn(); }
  catch { return fallback; }
}
