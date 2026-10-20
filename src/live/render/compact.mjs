// The STATUS LINE: one to three short lines about the task this session is working on, drawn from a snapshot
// (src/live/snapshot.mjs). Every word is a field of the task's view or a line a journal holds; the only motion
// is the LIVE glyph, and only while lines arrive. Nothing to say is no line at all: a session with no task in
// this checkout leaves the host's row empty, it does not fill it with "no task".
//
//   compactLines(snap, { lines, columns, colour }) -> string[]     at most `lines` lines, each within `columns`
import { durationOf, lineOf } from "./lines.mjs";
import { drawn } from "./width.mjs";
import { progressWords } from "../activity.mjs";
import { LIFECYCLE_WORDS, PRESENTATION_WORDS, PULSE } from "../words.mjs";

const VIEWER_FIRST = new Set(["CONNECTING", "UNAVAILABLE", "RECONNECTING", "DEGRADED"]);

// The LIVE glyph's phase is the evidence's (presentation.mjs, 1.8.6): it moves when a line arrives, never by the clock;
// a person who asked for no motion (`pane.animation: off`, handed in as `still`) gets the still glyph.
const pulsed = (snap) => (snap.still ? PRESENTATION_WORDS.LIVE.glyph : PULSE[snap.presentation.pulse ?? 0]);

// What the first word is: the viewer's trouble when it has some, else the task's lifecycle when that says more
// than "running", else the viewer's LIVE / IDLE / FINISHED.
const HEAD = [
  { when: (s) => VIEWER_FIRST.has(s.presentation.state), head: (s) => PRESENTATION_WORDS[s.presentation.state] },
  { when: (s) => LIFECYCLE_WORDS[s.view?.lifecycle], head: (s) => LIFECYCLE_WORDS[s.view.lifecycle] },
  { when: (s) => s.presentation.state === "LIVE", head: (s) => ({ ...PRESENTATION_WORDS.LIVE, glyph: pulsed(s) }) },
  { when: () => true, head: (s) => PRESENTATION_WORDS[s.presentation.state] },
];

export const headOf = (snap) => HEAD.find((r) => r.when(snap)).head(snap);

export const attemptOf = (view) => (view?.attempt?.number ? `${view.attempt.number}/${view.attempt.limit ?? "?"}` : null);
const sinceOf = (snap, iso) => (iso ? durationOf(snap.nowMs - Date.parse(iso)) : null);
const stepWords = (q) => `QA → ${q.step ? `${q.step.verb} ${q.step.on ?? ""}`.trim() : "starting"} · ${q.steps} steps`;

// What a running check's runner has reported so far (1.8.5): its counts, only what was reported.
const observedOf = (snap, action) => ((w) => (w?.cases ? ` · ${w.cases}` : ""))(progressWords(snap.observations?.[action?.id]));

// What it is doing now, in a few words -- one row per kind of `current` (src/live/current.mjs).
const ACTIVITY = {
  ended: (c) => c.ended.summary ?? c.ended.stop ?? c.ended.kind,
  approval: (c) => `${c.approval.id} · ${c.approval.action} · decide in Orbit Control`,
  paused: (c) => `paused${c.paused.because ? `: ${c.paused.because}` : ""}`,
  blocked: (c) => `${c.blocked.stop}${c.blocked.needs ? ` (needs ${c.blocked.needs})` : ""}`,
  qa: (c) => stepWords(c.qa),
  dispatch: (c, snap) => `▶ ${c.via} ${c.provider ?? ""} · ${c.label} ${sinceOf(snap, c.action.startedAt) ?? ""}`.replace(/ +/g, " ").trim(),
  action: (c, snap) => `▶ ${c.label} ${sinceOf(snap, c.action.startedAt) ?? ""}`.trim() + observedOf(snap, c.action),
  diagnosing: (c) => `diagnosing${c.lastFailure ? `: ${c.lastFailure}` : ""}${c.next ? ` · next: ${c.next}` : ""}`,
  stage: (c, snap) => latestLine(snap),
};

// With nothing running, waiting or failing, the newest line says what happened last -- unless it is the stage
// itself, which the first words already say.
const latestLine = (snap) => ((e) => (e && e.kind !== "stage" ? ((l) => `${l.glyph} ${l.summary}`)(lineOf(e)) : null))(snap.events.at(-1));

export const activityOf = (snap) => (snap.current ? ACTIVITY[snap.current.kind](snap.current, snap) : null);

const FAILURE = {
  request: (f) => `✗ ${f.method ?? "?"} ${f.endpoint ?? "?"} ${f.status ?? "failed"}`,
  console: (f) => `✗ browser console: ${f.errors} error(s)`,
  run: (f) => `✗ case ${f.case ?? "?"}: ${f.status ?? "not passed"}`,
  action: (f) => `✗ ${f.summary ?? f.action ?? "an action failed"}`,
  verification: (f) => `✗ violated: ${f.obligation ?? "a verification"}`,
};

const nextOf = (view) => (view?.decision?.nextAction ? `next: ${view.decision.nextAction}` : null);
export const failureLine = (snap) => [snap.failure ? FAILURE[snap.failure.what](snap.failure) : null, nextOf(snap.view)].filter(Boolean).join(" · ");

const MARK = { checkout: " (checkout)", finished: " (ended)" };

function oneLine(snap, head) {
  const parts = [snap.view?.stage, attemptOf(snap.view), activityOf(snap)].filter(Boolean).join(" · ");
  return [{ text: "Orbit ", tone: "brand" }, { text: `${head.glyph} ${head.word}`, tone: head.tone }, { text: parts ? ` · ${parts}` : "" }, { text: MARK[snap.association.how] ?? "", tone: "subtle" }];
}

function firstLine(snap, head) {
  const where = [snap.view?.lifecycle, snap.view?.stage].filter(Boolean).join(" · ");
  const age = snap.presentation.sinceLastLineMs === null ? null : `${durationOf(snap.presentation.sinceLastLineMs)} ago`;
  return [{ text: "Orbit ", tone: "brand" }, { text: `${head.glyph} ${head.word}`, tone: head.tone }, { text: `  ${snap.association.task}`, tone: "subtle" }, { text: MARK[snap.association.how] ?? "", tone: "subtle" }, { text: where ? `  ${where}` : "" }, { text: attemptOf(snap.view) ? `  attempt ${attemptOf(snap.view)}` : "" }, { text: age ? `  last line ${age}` : "", tone: "subtle" }];
}

const ambiguous = (snap) => [[{ text: "Orbit ", tone: "brand" }, { text: `? ${snap.association.ids.length} tasks in this checkout`, tone: "warning" }, { text: ` · pin one: live pin ${snap.association.ids[0]}`, tone: "subtle" }]];

const unreadable = (snap) => [[{ text: "Orbit ", tone: "brand" }, { text: `${PRESENTATION_WORDS[snap.presentation.state].glyph} ${PRESENTATION_WORDS[snap.presentation.state].word}`, tone: PRESENTATION_WORDS[snap.presentation.state].tone }, { text: ` · ${PRESENTATION_WORDS[snap.presentation.state].say}`, tone: "subtle" }]];

function described(snap, lines) {
  const head = headOf(snap);
  if (lines <= 1) return [oneLine(snap, head)];
  return [firstLine(snap, head), [{ text: `   ${activityOf(snap) ?? ""}` }], [{ text: `   ${failureLine(snap)}`, tone: "danger" }]].slice(0, lines).filter((segs) => segs.some((s) => s.text.trim()));
}

const SHAPES = [
  { when: (s) => s.association.how === "none", lines: () => [] },
  { when: (s) => s.association.how === "ambiguous", lines: (s) => ambiguous(s) },
  { when: (s) => s.view === null, lines: (s) => unreadable(s) },
  { when: () => true, lines: (s, n) => described(s, n) },
];

export function compactLines(snap, { lines = 2, columns = 80, colour = false } = {}) {
  const shape = SHAPES.find((r) => r.when(snap));
  return shape.lines(snap, Math.max(1, Math.min(3, lines))).map((segments) => drawn(segments, columns, colour));
}
