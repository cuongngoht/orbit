// WHEN the engineering observer is worth running -- never after every tool.
//
// PostToolUse only appends a line to the working set (src/lifecycle/). This
// table reads what the session has done since the observer last looked
// (src/engineering/working-set/fold.mjs `since`) and decides whether now is a
// moment where observing tells anybody something new. Pure; first match wins;
// the last row always matches; every row says what it decided.
//
// The order is the argument:
//
//   nothing changed      nothing to observe, whatever else happened
//   budget spent         a runaway session cannot observe forever
//   COMMITTED            the strongest moment: the source port reads git's
//                        index, so a file is evidence only once it is committed
//   SESSION_END          the last chance this session gets
//   debounced            within DEBOUNCE_MS of the last observation, the two
//                        natural boundaries above still count; nothing else does
//   VERIFIED             a check (test · lint · build) passed AFTER the last edit
//   BREADTH              enough changed that the shape of the work may have moved
export const MAX_PER_SESSION = 4;
export const DEBOUNCE_MS = 10 * 60 * 1000;
export const BREADTH_FILES = 8;
export const BREADTH_SCOPES = 3;

export const MILESTONES = [
  { name: "OFF", run: false, when: (s, o) => !o.enabled, say: () => "the observer is turned off on this machine (ORBIT_ENGINEERING_OBSERVE=off, or the engineering_observe setting)" },
  { name: "NOTHING_CHANGED", run: false, when: (s) => s.since.changed.length === 0, say: () => "nothing changed since the last observation" },
  { name: "BUDGET_SPENT", run: false, when: (s) => s.observes >= MAX_PER_SESSION, say: (s) => `${s.observes} observation(s) this session already — the budget` },
  { name: "COMMITTED", run: true, when: (s) => s.since.committed, say: (s) => `a commit landed over ${s.since.changed.length} changed file(s)` },
  { name: "SESSION_END", run: true, when: (s) => s.ended, say: (s) => `the session ended with ${s.since.changed.length} file(s) unobserved` },
  { name: "DEBOUNCED", run: false, when: (s, o) => recent(s.lastObserve, o.nowMs), say: () => "observed moments ago — waiting for a commit or the end of the session" },
  { name: "VERIFIED", run: true, when: (s) => s.since.checked, say: () => "a check passed after the last edit" },
  { name: "BREADTH", run: true, when: (s) => s.since.changed.length >= BREADTH_FILES || s.since.scopes.length >= BREADTH_SCOPES, say: (s) => `${s.since.changed.length} file(s) across ${s.since.scopes.length} scope(s) changed` },
  { name: "NOT_YET", run: false, when: () => true, say: () => "no milestone yet" },
];

const recent = (at, nowMs) => Boolean(at) && nowMs - Date.parse(at) < DEBOUNCE_MS;

export function due(summary, opts = {}) {
  const row = MILESTONES.find((m) => m.when(summary, opts));
  return { name: row.name, run: row.run, say: row.say(summary) };
}
