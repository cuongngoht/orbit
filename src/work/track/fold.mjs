// A tracked work as its journal says it, and nothing else: a fold over the lines src/work/vocab.mjs KINDS keeps
// (`created`, `bound`, `handoff`, `linked`, `state`, `report`). What is OBSERVED -- the session's tools, a linked
// task's own fold -- is never in here: src/work/track/view.mjs joins them on every read.
//
// Three rules the fold holds, because a hook or a callback may resend, and may arrive late:
//   - a line with an `eid` already seen is folded once;
//   - a work that was CLOSED (a failed or cancelled state, a done/failed/cancelled report) is moved only by an explicit
//     reopening (`reopen`, written when a person continues it) -- a progress line that arrives after it is counted as
//     `ignored` and moves nothing;
//   - a progress line that says it OCCURRED before the one standing is late, whatever order it was written in.
// A journal with none of these lines (a work started before 1.8.8) folds to an untracked work, never an error.
import { CLOSING_STATES } from "./vocab.mjs";

const empty = () => ({ meta: null, bindings: [], handoffs: [], links: [], states: [], reports: [], reported: null, closed: null, ignored: 0, duplicates: 0, seen: new Set() });

export const stamp = (line) => line.occurred ?? line.at ?? "";

export const closing = (line) => (line.outcome ? line.outcome !== "blocked" : CLOSING_STATES.includes(line.state));

const closeOf = (line) => ({ outcome: line.outcome ?? line.state, at: line.at, n: line.n, by: line.kind, why: line.why ?? line.summary ?? null });

export const late = (m, line) => (m.closed !== null && !line.reopen) || (m.reported !== null && stamp(line) < stamp(m.reported));

const ignore = (m) => void (m.ignored += 1);

// A line that closes the work, or one that only says how it stands: the second never touches `closed`.
const settled = (m, line, standing) => (closing(line) ? void (m.closed = closeOf(line)) : void (m.reported = standing));

function foldState(m, line) {
  if (late(m, line)) return ignore(m);
  m.states.push(line);
  if (line.reopen) m.closed = null;
  return settled(m, line, line);
}

function foldReport(m, line) {
  if (m.closed !== null && !closing(line)) return ignore(m);
  m.reports.push(line);
  return settled(m, line, { ...line, state: "blocked" });
}

const linkedAlready = (m, line) => m.links.some((l) => l.what === line.what && l.target === line.target);

function foldBound(m, line) {
  m.bindings.push(line);
  if (line.reopen) Object.assign(m, { closed: null, reported: null });
}

const FOLDS = {
  created: (m, line) => { m.meta = line; },
  bound: foldBound,
  handoff: (m, line) => { m.handoffs.push(line); },
  linked: (m, line) => { if (!linkedAlready(m, line)) m.links.push(line); },
  state: foldState,
  report: foldReport,
};

// An event a callback sent twice: the second is not folded, and is counted.
function repeated(m, line) {
  if (line.eid === undefined) return false;
  const known = m.seen.has(line.eid);
  m.seen.add(line.eid);
  return known;
}

const folded = (m, line) => (repeated(m, line) ? void (m.duplicates += 1) : FOLDS[line.kind]?.(m, line));

export function trackOf(records) {
  const m = empty();
  for (const [n, line] of (records ?? []).entries()) folded(m, { ...line, n });
  return Object.assign(m, { tracked: m.bindings.length > 0, position: (records ?? []).length, updatedAt: records?.at(-1)?.at ?? null });
}

// The mode the work is in now: the last handoff's, else the one it was bound with, else the developer's -- a work
// nobody handed over is the host's.
export const modeOf = (m) => m.handoffs.at(-1)?.to ?? m.bindings.at(-1)?.mode ?? m.meta?.mode ?? "developer";

// The mode and task standing at a moment: what an activity line observed THEN belongs to.
export const phaseAt = (m, at) => ((h) => ({ mode: h?.to ?? m.bindings[0]?.mode ?? "developer", task: h?.task ?? null }))(m.handoffs.filter((x) => x.at <= at).at(-1));

// The latest binding of a session to this work, and the interval of each (until the session bound itself elsewhere).
export const bindingsOf = (m, session) => m.bindings.filter((b) => b.session === session);

export const sessionsOf = (m) => [...new Set(m.bindings.map((b) => b.session).filter(Boolean))];

export const lastReport = (m) => m.reports.at(-1) ?? null;
