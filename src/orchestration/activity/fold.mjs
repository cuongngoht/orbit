// THE PROJECTION of one observation (ADR 0020): what a viewer is sent and what a check's record keeps, folded from
// the observation's lines in order. The same fold whoever folds -- the check runner as it writes, a viewer as it
// reads -- so a page, a terminal and the record can never count one run two ways.
//
//   emptyObservation() -> state
//   foldObservation(state, line) -> state          one line at a time; the state is the fold's own accumulator
//   observationView(state) -> view                  bounded, plain JSON
//
// What it will not do: invent a total (only a runner's own summary is one), call a reported case "running", count a
// suite or a file wrapper as a case (an adapter reports leaves only), count one case twice (a case reported again --
// a runner's retry -- counts by its LAST word, and keeps the word before it), or hide what it could not see: a line
// missing from the sequence, an event the budget dropped, a runner whose totals disagree with what was observed.
import { ACTIVITY_SCHEMA, CASE_STATES, ENDINGS, LIMITS } from "./vocab.mjs";

export const emptyObservation = () => ({ identity: null, command: null, why: null, adapter: null, state: "starting", startedAt: null, lastAt: null, endedAt: null, gen: null, seq: -1, holes: 0, stale: 0, keys: new Map(), approximate: false, counts: Object.fromEntries(CASE_STATES.map((k) => [k, 0])), recent: [], failures: [], failuresMore: 0, totals: null, summaries: 0, output: null, outcome: null, dropped: 0, gapWhy: [], lines: 0, aborted: null });

// ---- the envelope: one generation, a sequence that only grows ------------------------------------------------------

const ordered = (s, line) => Number.isInteger(line.seq) && line.seq > s.seq && (s.gen === null || line.gen === s.gen);

export function foldObservation(s, line) {
  if (!line || typeof line !== "object" || !ordered(s, line)) return Object.assign(s, { stale: s.stale + 1 });
  Object.assign(s, { holes: s.holes + Math.max(0, line.seq - s.seq - 1), seq: line.seq, gen: s.gen ?? line.gen, lastAt: line.at ?? s.lastAt, lines: s.lines + 1 });
  (FOLDS[line.kind] ?? (() => null))(s, line);
  return s;
}

// ---- what each kind of line moves --------------------------------------------------------------------------------

const ended = (state) => (s, line) => Object.assign(s, { state, endedAt: line.at ?? null, outcome: line.outcome ?? s.outcome, output: line.output ?? s.output });

const FOLDS = {
  "activity.started": (s, l) => Object.assign(s, { identity: { task: l.task ?? null, action: l.action ?? null, attempt: l.attempt ?? null, check: l.check ?? null }, command: l.command ?? null, why: l.why ?? null, adapter: l.adapter ?? null, state: "running", startedAt: l.at ?? null }),
  "activity.adapter": (s, l) => Object.assign(s, { adapter: l.adapter ?? s.adapter }),
  "activity.progress": (s, l) => Object.assign(s, { output: l.output ?? s.output }),
  "case.reported": (s, l) => counted(s, l),
  "case.failure": (s, l) => failed(s, l),
  "runner.summary": (s, l) => Object.assign(s, { totals: summed(s.totals, l.totals), summaries: s.summaries + 1 }),
  "runner.aborted": (s, l) => Object.assign(s, { aborted: { why: typeof l.why === "string" ? l.why : null, category: l.category ?? "unknown" } }),
  "activity.gap": (s, l) => Object.assign(s, { dropped: s.dropped + (Number.isInteger(l.dropped) ? l.dropped : 0), gapWhy: [...new Set([...s.gapWhy, String(l.why ?? "")].filter(Boolean))].slice(0, 5) }),
  "activity.completed": ended("completed"),
  "activity.failed": ended("failed"),
  "activity.interrupted": ended("interrupted"),
};

export const isEnding = (kind) => ENDINGS.includes(kind);

// A case reported again counts by its last word; the one before is kept on the row, never lost.
function counted(s, l) {
  if (!CASE_STATES.includes(l.state)) return;
  const was = s.keys.get(l.key) ?? null;
  if (was) s.counts[was] -= 1;
  s.counts[l.state] += 1;
  keptKey(s, l, was);
}

function keptKey(s, l, was) {
  if (was || s.keys.size < LIMITS.KEYS_KEPT) s.keys.set(l.key, l.state);
  if (!was && s.keys.size >= LIMITS.KEYS_KEPT) s.approximate = true;
  s.recent.push({ key: l.key, name: l.name ?? null, suite: l.suite ?? null, state: l.state, durationMs: l.durationMs ?? null, seq: l.seq, before: was });
  if (s.recent.length > LIMITS.CASES_KEPT) s.recent.shift();
}

function failed(s, l) {
  if (s.failures.length >= LIMITS.FAILURES_KEPT) return Object.assign(s, { failuresMore: s.failuresMore + 1 });
  s.failures.push({ key: l.key ?? null, name: l.name ?? null, suite: l.suite ?? null, category: l.category ?? "unknown", message: l.message ?? null, expected: l.expected ?? null, actual: l.actual ?? null, location: l.location ?? null, stack: Array.isArray(l.stack) ? l.stack : [], seq: l.seq });
}

const TOTAL_KEYS = ["tests", "passed", "failed", "skipped", "todo", "cancelled"];

// A runner may say its totals once (TAP) or once per unit it ran (an assembly): they add up.
const summed = (was, add) => Object.fromEntries(TOTAL_KEYS.map((k) => [k, plus(was?.[k], add?.[k])]).filter(([, v]) => v !== null));

const plus = (a, b) => (Number.isInteger(a) || Number.isInteger(b) ? (Number.isInteger(a) ? a : 0) + (Number.isInteger(b) ? b : 0) : null);

// ---- the view ---------------------------------------------------------------------------------------------------

const reported = (s) => CASE_STATES.reduce((n, k) => n + s.counts[k], 0);

// What a runner's own totals say that the observation does not: only for the states the adapter observes in full.
function mismatchOf(s) {
  const observes = s.adapter?.observes ?? [];
  if (!s.totals || isRunning(s)) return [];
  return observes.filter((k) => Number.isInteger(s.totals[k]) && s.totals[k] !== s.counts[k]).map((k) => `the runner said ${s.totals[k]} ${k}; ${s.counts[k]} were observed`);
}

const isRunning = (s) => s.state === "running" || s.state === "starting";

const GAPS = [
  (s) => (s.holes ? `${s.holes} line(s) of the observation are missing` : null),
  (s) => (s.dropped ? `${s.dropped} event(s) not kept: ${s.gapWhy.join("; ") || "the observation's budget"}` : null),
  (s) => (s.stale ? `${s.stale} line(s) out of order or of another run, ignored` : null),
  (s) => (s.adapter?.capabilities?.cases === "none" ? "the command printed nothing Orbit reads as case results: only its progress is shown" : null),
  (s) => (s.approximate ? `more than ${LIMITS.KEYS_KEPT} cases: those beyond are counted, not de-duplicated` : null),
  (s) => (s.outcome?.observerFailed ? "the observer stopped part-way on an error of its own; the check's outcome is not affected" : null),
  (s) => (s.state === "interrupted" ? "the run was interrupted before the observation ended" : null),
];

export function observationView(s) {
  const gaps = [...GAPS.map((g) => g(s)).filter(Boolean), ...mismatchOf(s)];
  return { version: ACTIVITY_SCHEMA, ...(s.identity ?? { task: null, action: null, attempt: null, check: null }), command: s.command, why: s.why, adapter: s.adapter, state: s.state, startedAt: s.startedAt, lastAt: s.lastAt, endedAt: s.endedAt, counts: { ...s.counts }, reported: reported(s), total: s.totals?.tests ?? null, totals: s.totals, summaries: s.summaries, recent: s.recent.map((r) => ({ ...r })), failures: s.failures.map((f) => ({ ...f, stack: [...f.stack] })), failuresMore: s.failuresMore, output: s.output, outcome: s.outcome, aborted: s.aborted, seq: s.seq, complete: !isRunning(s) && gaps.length === 0, mismatch: mismatchOf(s).length > 0, gaps };
}

// What a check's record keeps of it once the command ended: the counts, the runner's word, the first failures, the
// gaps -- never the stream itself, and never a verdict.
export const summaryOf = (view) => ({ adapter: view.adapter ? { id: view.adapter.id, runner: view.adapter.runner ?? null, cases: view.adapter.capabilities?.cases ?? null } : null, state: view.state, counts: view.counts, reported: view.reported, total: view.total, totals: view.totals, failures: view.failures.slice(0, 10).map((f) => ({ name: f.name, suite: f.suite, category: f.category, location: f.location })), complete: view.complete, mismatch: view.mismatch, gaps: view.gaps, aborted: view.aborted ?? null });
