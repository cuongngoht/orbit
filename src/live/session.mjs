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
//   sessionActivityOf(lines, { nowMs, idleAfterMs, source, checks, coverage }) -> activity
//     activity: { source, observed, running: [entry], recent: [entry], files: [path], checks: [entry], lastAt,
//                 ended, truncated, partial, state }         recent, files and checks newest first, each bounded;
//                                                            partial: the lines are a tail, so `observed` counts recent calls
//     entry: { at, kind, what, ok, bg, class, exe }           kind: read · edit · search · command · other
//     state: NONE · ENDED · ACTIVE (a command running, or a line within idleAfterMs) · QUIET
//     source: the caller's word for where the lines came from -- ok · off · no-session · no-project · unreadable
//     checks: which command classes are a CHECK -- the working set's own list (collect.mjs CHECKS), handed in by the
//             composition root, so this module imports nothing beside it
//   sessionLinesOf(text, cut) -> [line]                       a tail's lines; `cut`: its first line may be partial
//
// WHICH AGENT (0.2.2, ADR 0044). Where the host's payload names the subagent that made a call, the activity also says,
// per agent, what the hooks saw it do -- never which agent made a call no payload named:
//   agents: [{ agent, type, lifecycle, startedAt, endedAt, observed, running, recent, lastAt, by, run }]
//           one per hashed agent id a line named, in the order they were first seen, at most AGENTS (agentsCut says how
//           many more); lifecycle is the host's word: STARTED (a start, no stop yet -- a quiet agent is not a dead one),
//           ENDED (its stop), SEEN (calls, and neither in this tail); by: the agent whose Agent call launched it, or
//           "session"; run: the qualified mission run that call's envelope named
//   own:    { observed, running, recent }   the calls that name no agent: the session's own where the host names a
//           subagent's calls, otherwise every call, whoever made it (coverage.agents says which)
//   invocations: [{ at, kind, name, agent, launched, run, ok }]   finished calls that started a skill or an agent
//   coverage: what the host lets the hooks see (src/work/track/coverage.mjs), handed in by the composition root
// A subagent working in the background outlives its parent's turn: a turn's end closes only the session's own runs,
// an agent's stop closes its own, and the session's end or the size cap close every one.

import { attributionOf } from "../attribution.mjs";

export const SESSION_LIMITS = Object.freeze({ RECENT: 30, FILES: 40, CHECKS: 10, TAIL_BYTES: 64 * 1024, AGENTS: 12, AGENT_RECENT: 8, INVOCATIONS: 20 });

export const SOURCES = Object.freeze(["ok", "off", "no-session", "no-project", "unreadable"]);

// Two plugins of one engine installed side by side each run the same hook, so one tool call can arrive twice.
const DUPLICATE_MS = 500;

const TOOL_EVENTS = new Set(["post-tool", "post-tool-failure"]);

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

const keyOf = (l) => JSON.stringify([l.ev, l.tool ?? null, l.paths ?? [], l.cmd ?? null, callKey(l), l.bg === true, l.agent ?? null, l.launched ?? null]);

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

// A call that started a skill or an agent is said as what it started, and a subagent's call that touched no path by its
// tool's name (0.2.2).
const whatOf = (l) => (l.cmd ? whatOfCommand(l.cmd) : l.invokes ? l.invokes.name : whatOfPaths(l.paths) ?? l.name ?? null);

const entryOf = (l) => ({ at: l.t, kind: l.invokes?.kind ?? l.tool ?? "other", what: whatOf(l), ok: okOfLine(l), bg: l.bg === true, class: l.cmd?.class ?? null, exe: l.cmd?.exe ?? null, ...(l.agent ? { agent: l.agent } : {}) });

// ---- what is running: started, and nothing ended it --------------------------------------------------------------

const sameRun = (a, b) => b.cmd?.exe === a.cmd?.exe && b.cmd?.class === a.cmd?.class && (b.agent ?? null) === (a.agent ?? null) && (b.invokes?.name ?? null) === (a.invokes?.name ?? null);

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

// What ends a run, by who made it: a turn's end ends the session's own, an agent's stop ends that agent's, and a
// session's end or the size cap end every one -- a post-tool after it belongs to a command started after it, never to
// one whose end was written somewhere else.
const endsRunOf = (agent) => (l) => l.ev === "session-end" || l.ev === "truncated" || (agent ? l.ev === "agent-end" && l.agent === agent : l.ev === "turn-end");

const resetWhere = (s, l) => void Object.assign(s, { open: s.open.filter(({ l: o }) => !endsRunOf(o.agent ?? null)(l)), orphans: s.orphans.filter((o) => !endsRunOf(o.agent ?? null)(l)) });

const RESETS = new Set(["turn-end", "agent-end", "session-end", "truncated"]);

const PAIRING = { "pre-tool": opened, "post-tool": closed, "post-tool-failure": closed, "turn-end": resetWhere, "agent-end": resetWhere, "session-end": resetWhere, truncated: resetWhere };

const pairable = (l) => !callKey(l) && (l.ev === "pre-tool" || l.tool === "command" || RESETS.has(l.ev));

const paired = (s, l, i) => (pairable(l) ? (PAIRING[l.ev]?.(s, l, i), s) : s);

const byId = (lines) => ((ends) => lines.map((l, i) => ({ l, i })).filter(({ l }) => l.ev === "pre-tool" && callKey(l) && !ends.has(callKey(l))))(new Set(lines.filter((l) => TOOL_EVENTS.has(l.ev)).map(callKey).filter(Boolean)));

// Nothing runs past what ends it (endsRunOf) -- past the size cap nothing more is written, so a command started before
// it could never be seen to end.
// Each agent's last boundary, found once: a tail with many calls still open is read once per agent, never once per call.
const boundariesOf = (lines, open) => new Map([...new Set(open.map(({ l }) => l.agent ?? null))].map((agent) => [agent, lines.findLastIndex(endsRunOf(agent))]));

function runningOf(lines) {
  const open = [...lines.reduce((s, l, i) => paired(s, l, i), { open: [], orphans: [] }).open, ...byId(lines)];
  const boundaries = boundariesOf(lines, open);
  return open.filter(({ l, i }) => i > boundaries.get(l.agent ?? null)).sort((x, y) => x.i - y.i).map(({ l }) => entryOf(l));
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

// ---- which agent: what the host's payload named, per agent (0.2.2) ----------------------------------------------

const AGENT_LIFE = new Set(["agent-start", "agent-end"]);

const AGENT_LIFECYCLE = [
  { word: "ENDED", when: (own) => own.some((l) => l.ev === "agent-end") },
  { word: "STARTED", when: (own) => own.some((l) => l.ev === "agent-start") },
  { word: "SEEN", when: () => true },
];

const agentIdsOf = (lines) => [...new Set(lines.flatMap((l) => [l.agent, l.launched]).filter(Boolean))];

const launchOf = (lines, id) => ((l) => (l ? { by: l.agent ?? "session", run: l.run ?? null, launchedAs: l.invokes?.name ?? null } : { by: null, run: null, launchedAs: null }))(lines.find((l) => l.launched === id));

const timeOf = (own, ev) => own.find((l) => l.ev === ev)?.t ?? null;

function agentOf(lines, running, id) {
  const own = lines.filter((l) => l.agent === id);
  const tools = own.filter((l) => TOOL_EVENTS.has(l.ev));
  const { launchedAs, ...launch } = launchOf(lines, id);
  return { agent: id, type: own.find((l) => l.agentType)?.agentType ?? launchedAs, lifecycle: AGENT_LIFECYCLE.find((r) => r.when(own)).word, startedAt: timeOf(own, "agent-start"), endedAt: timeOf(own, "agent-end"), observed: tools.length, running: running.filter((e) => e.agent === id), recent: newestFirst(tools, SESSION_LIMITS.AGENT_RECENT).map(entryOf), lastAt: own.at(-1)?.t ?? null, ...launch };
}

// The session's own calls are HOST_OBSERVED as its own only on a host that names every subagent's call; anywhere else
// nobody can say which agent made them (src/attribution.mjs).
const ownWord = (coverage) => (coverage?.namesAgents === true ? "HOST_OBSERVED" : "UNATTRIBUTED");

const ownOf = (tools, running) => ((mine) => ({ observed: mine.length, running: running.filter((e) => !e.agent), recent: newestFirst(mine, SESSION_LIMITS.RECENT).map(entryOf) }))(tools.filter((l) => !l.agent));

const invocationsOf = (tools) => newestFirst(tools.filter((l) => l.invokes), SESSION_LIMITS.INVOCATIONS).map((l) => ({ at: l.t, kind: l.invokes.kind, name: l.invokes.name, agent: l.agent ?? null, launched: l.launched ?? null, run: l.run ?? null, ok: okOfLine(l) }));

const agentsOf = (lines, running) => ((ids) => ({ agents: ids.slice(-SESSION_LIMITS.AGENTS).map((id) => agentOf(lines, running, id)), agentsCut: Math.max(0, ids.length - SESSION_LIMITS.AGENTS) }))(agentIdsOf(lines));

// A subagent's stop can land after the session's own end (its hook runs in the background): the session ended when
// its last line that is not an agent's says so.
const sessionEnded = (lines) => lines.filter((l) => !AGENT_LIFE.has(l.ev)).at(-1)?.ev === "session-end";

function folded(lines, source, checks) {
  const tools = lines.filter((l) => TOOL_EVENTS.has(l.ev));
  const running = runningOf(lines);
  return { source, observed: tools.length, running, recent: newestFirst(tools, SESSION_LIMITS.RECENT).map(entryOf), files: filesOf(tools), checks: newestFirst(tools.filter((l) => checks.includes(l.cmd?.class)), SESSION_LIMITS.CHECKS).map(entryOf), lastAt: lines.at(-1)?.t ?? null, ended: sessionEnded(lines), truncated: lines.some((l) => l.ev === "truncated"), ...agentsOf(lines, running), own: ownOf(tools, running), invocations: invocationsOf(tools) };
}

const withOwnWord = (a) => ({ ...a, own: { ...a.own, attribution: attributionOf(ownWord(a.coverage)).id } });

export function sessionActivityOf(lines, opts = {}) {
  const source = SOURCES.includes(opts.source) ? opts.source : "ok";
  const a = withOwnWord({ ...folded(deduped(lines ?? []), source, opts.checks ?? []), partial: opts.partial === true, coverage: opts.coverage ?? null });
  const o = { nowMs: opts.nowMs ?? 0, idleAfterMs: opts.idleAfterMs ?? 120_000 };
  return { ...a, state: STATES.find((r) => r.when(a, o)).state };
}

// Nothing to fold, and why: a viewer says the reason instead of an empty block.
export const noSessionActivity = (source) => sessionActivityOf([], { source });
