// `live watch --plain`: one line per event, for a pipe, a CI log or a terminal that should not be painted.
// No colour, no escape sequence, no cursor movement: what a journal's text holds is cleaned to one line, and
// the same event always prints the same line, so a parser (or a diff of two runs) can rely on it.
//
//   plainLine(frame) -> string | null      frame: { event, id, data } as a feed sends it; a ping prints nothing
import { clean } from "./ansi.mjs";
import { lineOf } from "./lines.mjs";

const pad = (text, n) => String(text).padEnd(n);

const eventLine = (e) => ((l) => `${l.at ?? "-"}  ${pad(l.source, 5)} ${pad(e.kind, 20)} ${l.summary}`.trimEnd())(lineOf(e));

const attemptWords = (v) => (v.attempt?.number ? ` attempt=${v.attempt.number}/${v.attempt.limit ?? "?"}` : "");

const viewLine = (v) => `${v.task?.updatedAt ?? "-"}  ${pad("state", 5)} ${pad(v.lifecycle, 20)} stage=${v.stage ?? "-"}${attemptWords(v)} revision=${v.revision}`;

const FRAMES = {
  "task-event": (f) => eventLine(f.data),
  "qa-event": (f) => eventLine(f.data),
  "task-view": (f) => viewLine(f.data.view),
  end: (f) => `-  ${pad("end", 5)} ${f.data.reason}`,
};

export const plainLine = (frame) => (FRAMES[frame.event] ? clean(FRAMES[frame.event](frame)) : null);

// ---- a check's observation, for a log (1.8.5) ----------------------------------------------------------------

// One line when a check starts being observed, one per failure its runner reports, one when it ends -- never a line
// per case, and the same observation always prints the same lines. `prev` is the projection last printed, or null.
export function activityPlainLines(prev, next) {
  const head = `${next.lastAt ?? next.startedAt ?? "-"}  ${pad("check", 5)} ${pad(next.action ?? "?", 20)}`;
  return [...startedLines(prev, next, head), ...failureLines(prev, next, head), ...endedLines(prev, next, head)].map(clean);
}

const countsWords = (v) => [`${v.counts.passed} passed`, `${v.counts.failed} failed`, `${v.counts.skipped} skipped`, Number.isInteger(v.total) ? `total ${v.total} (the runner's)` : "total not said"].join(" · ");

const startedLines = (prev, next, head) => (prev ? [] : [`${head} observed: ${next.command?.declaredAs ?? "?"} on ${next.command?.component ?? "?"}, read with ${next.adapter?.id ?? "generic"}${next.why ? ` · ${next.why}` : ""}`]);

const failureLines = (prev, next, head) => next.failures.slice(prev?.failures?.length ?? 0).map((f) => `${head} ✗ ${f.name ?? f.key} — ${f.category}${f.message ? `: ${f.message}` : ""}`);

const endedLines = (prev, next, head) => (next.state !== "running" && prev?.state !== next.state ? [`${head} ${next.state}: ${countsWords(next)}${next.gaps.length ? ` · ${next.gaps.join("; ")}` : ""}`] : []);
