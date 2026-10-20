// THIS SESSION'S OWN ACTIVITY (1.8.7): what a viewer shows of the work when no task's journal speaks for it -- a
// /orbit-help that went the developer's way (a read-only question, or a restriction a person kept), or a step a
// coordinated workflow handed to the HOST, which the host then works in this session and no journal follows. The
// source is the WORKING SET the host's hooks already keep, one file per session (src/engineering/working-set/: a
// tool's kind, repo-relative paths, a command's class and bare executable, whether it ended well -- never an
// argument, a file's contents, a prompt, a reply or a model's reasoning). The composition root reads the TAIL of
// this session's own file and hands the lines in; this folds them, and is pure.
//
// It is OBSERVED tool activity and nothing more. It never says a task moved, completed or passed: a command that
// ended well is "exit ok", never PASSED, and a check here has no denominator, so nothing about it is a percentage.
// A command is RUNNING only between its own pre-tool and post-tool lines (paired by the delivery id a protocol-2 host
// gives, else by what ran), and never past the end of the turn or the session it started in.
//
//   sessionActivityOf(lines, { nowMs, idleAfterMs, source, checks }) -> activity
//     activity: { source, observed, running: [entry], recent: [entry], files: [path], checks: [entry], lastAt,
//                 ended, truncated, partial, state }         recent, files and checks newest first, each bounded;
//                                                            partial: the lines are a tail, so `observed` counts recent calls
//     entry: { at, kind, what, ok, bg, class, exe }           kind: read · edit · search · command · other
//     state: NONE · ENDED · ACTIVE (a command running, or a line within idleAfterMs) · QUIET
//     source: the caller's word for where the lines came from -- ok · off · no-session · no-project · unreadable
//     checks: which command classes are a CHECK -- the working set's own list (collect.mjs CHECKS), handed in by the
//             composition root, so this module imports nothing beside it
//   sessionLinesOf(text, cut) -> [line]                       a tail's lines; `cut`: its first line may be partial

export const SESSION_LIMITS = Object.freeze({ RECENT: 30, FILES: 40, CHECKS: 10, TAIL_BYTES: 64 * 1024 });

export const SOURCES = Object.freeze(["ok", "off", "no-session", "no-project", "unreadable"]);

// Two plugins of one engine installed side by side each run the same hook, so one tool call can arrive twice.
const DUPLICATE_MS = 500;

const TOOL_EVENTS = new Set(["post-tool", "post-tool-failure"]);

const BOUNDARY_EVENTS = new Set(["turn-end", "session-end"]);

const parsed = (line) => {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
};

export const sessionLinesOf = (text, cut = false) => String(text ?? "").split("\n").slice(cut ? 1 : 0).filter(Boolean).map(parsed).filter((l) => l && typeof l.ev === "string" && typeof l.t === "string");

// ---- one tool call, once -------------------------------------------------------------------------------------

const callKey = (l) => l.call ?? l.delivery ?? null;

const keyOf = (l) => JSON.stringify([l.ev, l.tool ?? null, l.paths ?? [], l.cmd ?? null, callKey(l), l.bg === true]);

const twin = (a, b) => keyOf(a) === keyOf(b) && (callKey(a) !== null || Math.abs(Date.parse(a.t) - Date.parse(b.t)) <= DUPLICATE_MS);

function deduped(lines) {
  const kept = [];
  for (const l of lines) if (!kept.slice(-8).some((k) => twin(k, l))) kept.push(l);
  return kept;
}

// ---- what each line says ---------------------------------------------------------------------------------------

// What a command is CALLED. Its class came from the command's WORDS (collect.mjs CLASSES), and the hooks keep no arguments:
// `grep test` has the class `test` and is not a test. So a class is said as a name -- "named like a test" -- never as a result.
const whatOfCommand = (cmd) => (cmd.class === "other" ? cmd.exe || "a command" : `${cmd.exe || "a command"} (named like a ${cmd.class})`);

const whatOfPaths = (paths) => (paths?.length ? `${paths[0]}${paths.length > 1 ? ` +${paths.length - 1} more` : ""}` : null);

const okOfLine = (l) => (l.ev === "post-tool-failure" ? false : l.cmd ? l.cmd.ok ?? null : true);

const entryOf = (l) => ({ at: l.t, kind: l.tool ?? "other", what: l.cmd ? whatOfCommand(l.cmd) : whatOfPaths(l.paths), ok: okOfLine(l), bg: l.bg === true, class: l.cmd?.class ?? null, exe: l.cmd?.exe ?? null });

// ---- what is running: started, and nothing ended it --------------------------------------------------------------

const sameRun = (a, b) => b.cmd?.exe === a.cmd?.exe && b.cmd?.class === a.cmd?.class;

// With no id, what ran pairs them, in order: a post-tool ends the OLDEST open pre-tool of the same command, and one
// that finds none open is an orphan a pre-tool written just after it may still claim -- the hooks run in the
// background, so a quick command's post-tool hook can finish writing first. A post-tool pairs once, so a command
// started right after another of its kind ended is running, never ended by its predecessor's end.
const PAIR_MS = 3000;

const near = (l) => (o) => sameRun(o, l) && Date.parse(l.t) - Date.parse(o.t) <= PAIR_MS;

function opened(s, l, i) {
  const k = s.orphans.findIndex(near(l));
  if (k >= 0) return void s.orphans.splice(k, 1);
  s.open.push({ l, i });
}

function closed(s, l) {
  const k = s.open.findIndex(({ l: p }) => sameRun(p, l));
  if (k >= 0) return void s.open.splice(k, 1);
  s.orphans.push(l);
}

// A turn's end, a session's end or the size cap closes every run still open: a post-tool after it belongs to a
// command started after it, never to one whose end was written somewhere else.
const reset = (s) => void Object.assign(s, { open: [], orphans: [] });

const PAIRING = { "pre-tool": opened, "post-tool": closed, "post-tool-failure": closed, "turn-end": reset, "session-end": reset, truncated: reset };

const pairable = (l) => !callKey(l) && (l.ev === "pre-tool" || l.tool === "command" || PAIRING[l.ev] === reset);

const paired = (s, l, i) => (pairable(l) ? (PAIRING[l.ev]?.(s, l, i), s) : s);

const byId = (lines) => ((ends) => lines.map((l, i) => ({ l, i })).filter(({ l }) => l.ev === "pre-tool" && callKey(l) && !ends.has(callKey(l))))(new Set(lines.filter((l) => TOOL_EVENTS.has(l.ev)).map(callKey).filter(Boolean)));

// Nothing runs past a turn's end, a session's end, or the working set's size cap -- past it nothing more is written,
// so a command started before it could never be seen to end.
function runningOf(lines) {
  const boundary = lines.findLastIndex((l) => BOUNDARY_EVENTS.has(l.ev) || l.ev === "truncated");
  const open = [...lines.reduce((s, l, i) => paired(s, l, i), { open: [], orphans: [] }).open, ...byId(lines)];
  return open.filter(({ i }) => i > boundary).sort((x, y) => x.i - y.i).map(({ l }) => entryOf(l));
}

// ---- the fold ----------------------------------------------------------------------------------------------------

const newestFirst = (list, n) => list.slice(-n).reverse();

const filesOf = (tools) => [...new Set(tools.filter((l) => l.tool === "edit").flatMap((l) => l.paths ?? []).reverse())].slice(0, SESSION_LIMITS.FILES);

const STATES = [
  { state: "NONE", when: (a) => a.observed === 0 && a.running.length === 0 },
  { state: "ENDED", when: (a) => a.ended },
  { state: "ACTIVE", when: (a) => a.running.length > 0 },
  { state: "ACTIVE", when: (a, o) => Number.isFinite(Date.parse(a.lastAt)) && o.nowMs - Date.parse(a.lastAt) <= o.idleAfterMs },
  { state: "QUIET", when: () => true },
];

function folded(lines, source, checks) {
  const tools = lines.filter((l) => TOOL_EVENTS.has(l.ev));
  const ended = lines.at(-1)?.ev === "session-end";
  return { source, observed: tools.length, running: runningOf(lines), recent: newestFirst(tools, SESSION_LIMITS.RECENT).map(entryOf), files: filesOf(tools), checks: newestFirst(tools.filter((l) => checks.includes(l.cmd?.class)), SESSION_LIMITS.CHECKS).map(entryOf), lastAt: lines.at(-1)?.t ?? null, ended, truncated: lines.some((l) => l.ev === "truncated") };
}

export function sessionActivityOf(lines, opts = {}) {
  const source = SOURCES.includes(opts.source) ? opts.source : "ok";
  const a = { ...folded(deduped(lines ?? []), source, opts.checks ?? []), partial: opts.partial === true };
  const o = { nowMs: opts.nowMs ?? 0, idleAfterMs: opts.idleAfterMs ?? 120_000 };
  return { ...a, state: STATES.find((r) => r.when(a, o)).state };
}

// Nothing to fold, and why: a viewer says the reason instead of an empty block.
export const noSessionActivity = (source) => sessionActivityOf([], { source });
