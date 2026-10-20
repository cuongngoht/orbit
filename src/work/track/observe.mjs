// WHAT A WORK'S SESSIONS WERE OBSERVED DOING, attributed by the work's own binding and by nothing else.
//
// The working set (src/engineering/working-set/) is one file per SESSION: what that session's tools did, as the host's
// hooks saw it. A work is bound to a session by a `bound` line at a moment, and stays bound until that session binds
// itself to another work. So what belongs to a work is the session's lines INSIDE those intervals -- read off the
// binding, never stamped on every tool call by a hook, never inferred from a title, and never taken from another
// session: two sessions in one checkout cannot receive each other's activity because their files are different.
//
// What it says is OBSERVED: an edit tool was seen writing a path, a command was seen to end, a command's words name a
// check. It is not the checkout's dirty files (a file dirty before the work began is not the work's until an edit
// tool is seen writing it), and a path another session was also seen writing in the same period is `shared` -- the
// hunks cannot be told apart. Pure: the composition root reads the files and hands the lines and a fold in.
const byAt = (a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0);

const nextOther = (sorted, i, work) => sorted.slice(i + 1).find((e) => e.work !== work)?.at ?? null;

// The intervals of one session during which `work` was the work it was bound to: from each binding of it that did not
// continue one, until the session was bound to another. `timeline`: [{ at, work }] of that session, across works.
export function intervalsOf(timeline, work) {
  const sorted = [...timeline].sort(byAt);
  return sorted.flatMap((e, i) => (e.work === work && sorted[i - 1]?.work !== work ? [{ from: e.at, to: nextOther(sorted, i, work) }] : []));
}

const inside = (intervals) => (line) => intervals.some((w) => line.t >= w.from && (w.to === null || line.t < w.to));

export const windowed = (lines, intervals) => (lines ?? []).filter(inside(intervals));

// The newest edit a window saw: a check taken before it is not a check of what the work is now.
export const lastEditAt = (lines) => lines.filter((l) => l.tool === "edit").map((l) => l.t).sort().at(-1) ?? null;

const editedPaths = (lines) => lines.filter((l) => l.tool === "edit" && (l.ev === "post-tool" || l.ev === "post-tool-failure")).flatMap((l) => l.paths ?? []);

// The paths other sessions were seen writing since `since`: `others` is [{ session, lines }] for every session that is
// NOT one of this work's, whether it is bound to another work or to none.
export const contestedBy = (others, since) => new Set(others.flatMap((o) => editedPaths((o.lines ?? []).filter((l) => !since || l.t >= since))));

const newest = (list, n) => [...list].sort((a, b) => byAt(b, a)).slice(0, n);

const STATE_RANK = { ACTIVE: 3, QUIET: 2, ENDED: 1, NONE: 0 };

const strongest = (states) => states.reduce((best, s) => ((STATE_RANK[s] ?? 0) > (STATE_RANK[best] ?? 0) ? s : best), "NONE");

// Several sessions' folded activity, as one: counts add, lists merge newest first and stay bounded.
export function mergedActivity(parts, limits) {
  const some = parts.filter(Boolean);
  const files = [...new Set(some.flatMap((a) => a.files))].slice(0, limits.FILES);
  return { observed: some.reduce((n, a) => n + a.observed, 0), running: some.flatMap((a) => a.running), recent: newest(some.flatMap((a) => a.recent), limits.RECENT), files, checks: newest(some.flatMap((a) => a.checks), limits.CHECKS), lastAt: some.map((a) => a.lastAt).filter(Boolean).sort().at(-1) ?? null, partial: some.some((a) => a.partial), truncated: some.some((a) => a.truncated), state: strongest(some.map((a) => a.state)) };
}

const resultOf = (e) => (e.bg ? "unknown" : e.ok === true ? "exit-ok" : e.ok === false ? "exit-error" : "unknown");

// What a check is CALLED. The hooks keep a command's class and its bare executable, and the class came from the command's
// WORDS: so the label says the command was named like a check and never that it was one, and a result is only how the
// command ended.
export const namedLike = (e) => `${e.exe || "a command"} (named like a ${e.class})`;

// A check, as the work shows it. `basis` says what the label stands on, and `current` is false the moment an edit was
// seen after it.
export const checkOf = (e, editedAt) => ({ at: e.at, class: e.class, exe: e.exe ?? null, what: namedLike(e), result: resultOf(e), current: !(editedAt && editedAt > e.at), basis: "command-words" });

export const runningCheckOf = (e) => ({ at: e.at, class: e.class, exe: e.exe ?? null, what: namedLike(e), result: "running", current: true, basis: "command-words" });

export const checksOf = (activity, editedAt, checkClasses) => [...activity.running.filter((e) => checkClasses.includes(e.class)).map(runningCheckOf), ...activity.checks.map((e) => checkOf(e, editedAt))];

// Each file, and whether the work can claim it alone.
export const filesOf = (paths, contested) => paths.map((path) => ({ path, attribution: contested.has(path) ? "shared" : "observed" }));
