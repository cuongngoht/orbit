// `live watch` in a terminal: the whole task on one screen -- a header, the loop of stages, what it is doing
// now, the timeline of its lines and, when asked, its sandbox's output. Returned as LINES for the caller to
// paint in place (cli/live.mjs owns the terminal: the cursor, the raw keys, the resize); nothing here touches
// a stream. A line from a journal is a line here, never more: data is cleaned to one row and cut to the width.
//
//   screenLines(snap, { columns, rows, colour, showQa, logs }) -> string[]
//     logs: { session, stream, lines } | null     the sandbox console, already read through the runtime's door
import { activityOf, attemptOf, failureLine, headOf } from "./compact.mjs";
import { clockOf, durationOf, lineOf } from "./lines.mjs";
import { drawn } from "./width.mjs";
import { STAGE_STRIP } from "../words.mjs";

const RULE = "─";

function header(snap) {
  const head = headOf(snap);
  const v = snap.view;
  const elapsed = v?.task?.createdAt ? `elapsed ${durationOf(snap.nowMs - Date.parse(v.task.createdAt))}` : null;
  const age = snap.presentation.sinceLastLineMs === null ? null : `last line ${durationOf(snap.presentation.sinceLastLineMs)} ago`;
  return [{ text: " ORBIT LIVE ", tone: "brand" }, { text: `${head.glyph} ${head.word}`, tone: head.tone }, { text: `  ${v?.task?.id ?? snap.association.task ?? ""}` }, { text: `  ${[v?.lifecycle, v?.stage].filter(Boolean).join(" · ")}` }, { text: attemptOf(v) ? `   attempt ${attemptOf(v)}` : "" }, { text: elapsed ? `   ${elapsed}` : "", tone: "subtle" }, { text: v?.task?.host ? `   machine ${v.task.host}` : "", tone: "subtle" }, { text: age ? `   ${age}` : "", tone: "subtle" }];
}

const seenStages = (events) => new Set(events.filter((e) => e.source === "task" && e.kind === "stage").map((e) => e.stage));

const STAGE_MARK = [
  { when: (stage, now) => stage === now.current && !now.ended, mark: "●", tone: "info" },
  { when: (stage, now) => now.seen.has(stage), mark: "✓", tone: "success" },
  { when: () => true, mark: "·", tone: "subtle" },
];

const stageSegment = ([stage, short], now) => ((r) => ({ text: ` ${short} ${r.mark}`, tone: r.tone }))(STAGE_MARK.find((r) => r.when(stage, now)));

function strip(snap) {
  const now = { current: snap.view?.stage ?? null, seen: seenStages(snap.events), ended: Boolean(snap.view?.terminal) };
  const done = now.ended ? [{ text: ` ${snap.view.lifecycle === "COMPLETED" ? "DONE ✓" : `${snap.view.lifecycle} ✗`}`, tone: snap.view.lifecycle === "COMPLETED" ? "success" : "danger" }] : [];
  return [...STAGE_STRIP.map((row) => stageSegment(row, now)), ...done];
}

const qaSummary = (snap) => Object.values(snap.qa).filter((q) => q.ended === null).map((q) => `QA ${q.steps} steps${q.lastFailure ? ` · last failed ${q.lastFailure.method ?? ""} ${q.lastFailure.endpoint ?? ""} ${q.lastFailure.status ?? ""}`.trimEnd() : ""}`)[0] ?? null;

const now = (snap) => [{ text: ` ${activityOf(snap) ?? ""}` }, { text: qaSummary(snap) ? `      ${qaSummary(snap)}` : "", tone: "info" }];

const rule = (label, columns) => [{ text: `${RULE.repeat(Math.max(4, columns - label.length - 2))} ${label}`, tone: "subtle" }];

function timelineRow(e) {
  const l = lineOf(e);
  return [{ text: ` ${clockOf(l.at)}  ` , tone: "subtle" }, { text: l.glyph, tone: l.failed ? "danger" : "info" }, { text: ` ${l.source.padEnd(5)} ` , tone: "subtle" }, { text: `${e.kind.padEnd(20)} ` }, { text: l.summary, tone: l.failed ? "danger" : undefined }];
}

const consoleRows = (logs) => logs.lines.map((line) => [{ text: ` ${line}` }]);

function sections(snap, opts) {
  const top = [header(snap), strip(snap), now(snap), [{ text: ` ${failureLine(snap)}`, tone: "danger" }], rule("timeline · q quit · l logs", opts.columns)];
  const bottom = opts.logs ? [rule(`sandbox ${opts.logs.session} ${opts.logs.stream} · masked, read-only`, opts.columns), ...consoleRows(opts.logs).slice(-Math.max(3, Math.floor(opts.rows / 3)))] : [];
  const events = snap.events.filter((e) => opts.showQa !== false || e.source === "task");
  const room = Math.max(1, opts.rows - top.length - bottom.length);
  return [...top, ...events.slice(-room).map(timelineRow), ...bottom];
}

export function screenLines(snap, opts) {
  const o = { columns: 100, rows: 30, colour: false, ...opts };
  return sections(snap, o).map((segments) => drawn(segments, o.columns, o.colour));
}
