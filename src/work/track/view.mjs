// THE ONE PICTURE of a tracked work, for whoever reads it: `cli/track.mjs status --json`, Orbit Live's pane, status line and
// `live status`, and Orbit Control's page. One function, so a terminal and a page cannot tell two stories about one work.
//
//   workViewOf(input) -> view
//     input.id          the work's id (w-…)
//     input.fold        trackOf(records): what the journal says (fold.mjs)
//     input.sessions    [{ session, host, activity }]   each bound session's folded activity INSIDE its binding windows
//                       (observe.mjs), or null when its working set could not be read
//     input.editedAt    the newest edit any bound session was seen making, or null
//     input.contested   the paths another session was also seen writing: attribution there is `shared`
//     input.tasks       { <tsk-…>: the task's view (src/task/views.mjs) | null }   read back from their owner, never copied
//     input.snapshot    the requirement snapshot the work adopted, or null
//     input.checks      the working set's check classes (collect.mjs CHECKS), handed in
//     input.coverage    what this host lets tracking observe (coverage.mjs)
//     input.source      why there is no activity, when there is none (src/live/session.mjs SOURCES)
//
// Three axes, never folded into one word: LIFECYCLE (where it stands: a table, first row that holds), EVIDENCE (what stands
// behind it: only an owner's completed task earns `verified`, and only while nothing was edited after it) and LIVENESS
// (whether a bound session is moving: a quiet session is not a stuck work, and a tick is not progress).
import { limitsOf } from "./coverage.mjs";
import { lastReport, modeOf } from "./fold.mjs";
import { checksOf, filesOf, mergedActivity } from "./observe.mjs";
import { EVIDENCE, LIFECYCLE, LIMITS, lifecycleRow } from "./vocab.mjs";

const OBSERVE_LIMITS = Object.freeze({ ...LIMITS, RECENT: 30 });

const failedLike = (v) => v?.terminal && v.lifecycle !== "COMPLETED";

const tasksOf = (fold, tasks) => fold.links.filter((l) => l.what !== "investigation").map((l) => ({ link: l, view: tasks?.[l.target] ?? null }));

const activeTask = (rows) => rows.filter((t) => t.view && !t.view.terminal).at(-1) ?? null;

const lastEnded = (rows) => rows.filter((t) => failedLike(t.view)).at(-1) ?? null;

// A reported waiting or blocked is about a moment: tool activity after it says the work went on. A pause is a person's, and
// only the person resumes it.
const superseded = (c) => c.fold.reported !== null && c.activity.lastAt !== null && c.activity.lastAt > c.fold.reported.at;

const standing = (c, ...states) => c.fold.reported !== null && states.includes(c.fold.reported.state) && (c.fold.reported.state === "paused" || !superseded(c));

const closedAs = (outcome) => (c) => c.fold.closed?.outcome === outcome;

const taskIs = (...lifecycles) => (c) => lifecycles.includes(c.active?.view?.lifecycle);

const endedSessions = (c) => c.sessions.length > 0 && c.sessions.every((s) => s.activity?.state === "ENDED") && c.active === null;

// First row that holds, the last always: the SAME table for a developer's session and an autonomous task.
const ROWS = [
  { state: "CANCELLED", when: closedAs("cancelled") },
  { state: "FAILED", when: closedAs("failed") },
  { state: "REPORTED_DONE", when: closedAs("done") },
  { state: "PAUSED", when: (c) => standing(c, "paused") || taskIs("PAUSED")(c) },
  { state: "BLOCKED", when: (c) => standing(c, "blocked") || taskIs("BLOCKED")(c) || (c.active === null && c.ended !== null && c.mode === "autonomous") },
  { state: "WAITING", when: (c) => standing(c, "waiting") || taskIs("WAITING_APPROVAL")(c) },
  { state: "INTERRUPTED", when: endedSessions },
  { state: "IN_PROGRESS", when: (c) => c.activity.observed > 0 || c.activity.running.length > 0 || c.rows.length > 0 },
  { state: "RECEIVED", when: () => true },
];

if (ROWS.map((r) => r.state).join() !== LIFECYCLE.map((r) => r.state).join()) throw new Error("src/work/track/view.mjs and vocab.mjs disagree about the lifecycle states");

const whyOf = [
  { when: (c, s) => s === "BLOCKED" && c.ended !== null && c.active === null && !standing(c, "blocked"), say: (c) => `task ${c.ended.link.target} ended ${c.ended.view.lifecycle}; the work is not closed until it is reported` },
  { when: (c, s) => ["PAUSED", "BLOCKED", "WAITING"].includes(s) && c.fold.reported !== null, say: (c) => c.fold.reported.why ?? c.fold.reported.summary ?? null },
  { when: (c, s) => s === "WAITING" && c.active !== null, say: (c) => `task ${c.active.link.target} waits for an approval` },
  { when: (c) => c.fold.closed !== null, say: (c) => c.fold.closed.why ?? null },
  { when: () => true, say: () => null },
];

const waitOf = (c, state) => (state === "WAITING" ? (standing(c, "waiting") ? c.fold.reported.wait ?? null : "permission") : null);

function lifecycleOf(c) {
  const state = ROWS.find((r) => r.when(c)).state;
  const row = lifecycleRow(state);
  return { state, word: row.word, glyph: row.glyph, tone: row.tone, terminal: row.terminal, say: row.say, why: whyOf.find((w) => w.when(c, state)).say(c, state), wait: waitOf(c, state) };
}

// ---- evidence ------------------------------------------------------------------------------------

const completed = (c) => c.rows.filter((t) => t.view?.lifecycle === "COMPLETED");

const afterTask = (c, t) => c.editedAt !== null && Boolean(t.view.ended?.at) && c.editedAt > t.view.ended.at;

const verifiedBy = (c) => completed(c).filter((t) => !afterTask(c, t));

const EVIDENCE_ROWS = [
  { level: "verified", when: (c) => c.fold.closed?.outcome === "done" && verifiedBy(c).length > 0, why: (c) => `task ${verifiedBy(c)[0].link.target} completed, as its own journal says, and no edit was seen after it` },
  { level: "reported", when: (c) => c.fold.closed !== null || c.fold.reports.length > 0 || c.fold.reported !== null, why: (c) => (completed(c).some((t) => afterTask(c, t)) ? "an edit was seen after the linked task completed, so its completion is not evidence of what the work is now" : "reported by the host or a person; no owner confirmed it") },
  { level: "observed", when: (c) => c.activity.observed > 0 || c.rows.length > 0, why: () => "edits and commands were seen by the host's hooks; nothing reported an outcome" },
  { level: "none", when: () => true, why: () => "nothing has been observed or reported" },
];

const evidenceOf = (c) => ((row) => ({ level: row.level, why: row.why(c), say: EVIDENCE.find((e) => e.level === row.level).say }))(EVIDENCE_ROWS.find((r) => r.when(c)));

// ---- the parts -----------------------------------------------------------------------------------

const taskView = ({ link, view }) => ({ task: link.target, what: link.what, role: link.role ?? null, lifecycle: view?.lifecycle ?? null, stage: view?.stage ?? null, terminal: Boolean(view?.terminal), readable: view !== null, linkedAt: link.at });

const sessionView = (s) => ({ session: s.session, host: s.host ?? null, state: s.activity?.state ?? "NONE", lastAt: s.activity?.lastAt ?? null });

const handoffView = (h) => ({ at: h.at, from: h.from ?? null, to: h.to, task: h.task ?? null, because: h.because ?? null });

const routeOf = (fold) => ((b) => (b ? { to: b.route ?? null, because: b.because ?? null, skill: b.skill ?? null, at: b.at } : null))(fold.bindings.at(-1));

const liveActivity = (c, input) => ({ observed: c.activity.observed, partial: c.activity.partial, truncated: c.activity.truncated, running: c.activity.running, last: c.activity.recent[0] ?? null, files: filesOf(c.activity.files, input.contested ?? new Set()), checks: checksOf(c.activity, c.editedAt, input.checks ?? []) });

const reportView = (r) => (r ? { at: r.at, outcome: r.outcome, summary: r.summary ?? null, changed: r.changed ?? [], checks: r.checks ?? [], proved: r.proved ?? [], unverified: r.unverified ?? [], blocked: r.blocked ?? [], evidence: r.evidence ?? [] } : null);

// What a finished work SAYS it did: the request, what was observed changing, what was checked, what is proved and what is not.
// A closed work reads the report's own snapshot (the working set expires; the report does not); one still going reads what is
// observed now. "Proved" is only what the report claimed, labelled so; the evidence level says whether an owner agrees.
function summaryOf(c, live, report) {
  const closedWith = c.fold.closed !== null && report !== null;
  const files = closedWith ? report.changed : live.files;
  const checks = closedWith ? report.checks : live.checks;
  return { request: c.title, changes: { files, count: files.length, shared: files.filter((f) => f.attribution === "shared").length, basis: "edit tools seen writing these paths -- not the checkout's diff" }, checks, proved: report?.proved ?? [], unverified: [...(report?.unverified ?? []), ...(report?.blocked ?? [])], reportedBy: report ? "host-or-person" : null };
}

const warningsOf = (fold, coverage, source) => [...(fold.ignored ? [`${fold.ignored} line(s) arrived after the work was closed and moved nothing`] : []), ...(fold.duplicates ? [`${fold.duplicates} repeated line(s) were folded once`] : []), ...limitsOf(coverage, source)];

// What every row and part reads, made once.
function contextOf(input) {
  const rows = tasksOf(input.fold, input.tasks);
  const activity = mergedActivity(input.sessions.map((s) => s.activity), OBSERVE_LIMITS);
  return { fold: input.fold, rows, activity, sessions: input.sessions, active: activeTask(rows), ended: lastEnded(rows), editedAt: input.editedAt ?? null, title: input.fold.meta?.objective ?? null, mode: modeOf(input.fold) };
}

const identityOf = (input, c) => ({ schema: 1, work: input.id, title: c.title, ref: c.fold.meta?.ref ?? c.fold.meta?.root?.id ?? null, requirement: { root: c.fold.meta?.root?.id ?? null, snapshot: input.snapshot ?? c.fold.meta?.snapshot ?? null }, checkout: c.fold.meta?.checkout ?? null, tracked: c.fold.tracked, mode: c.mode, route: routeOf(c.fold) });

const standingOf = (c) => ({ lifecycle: lifecycleOf(c), liveness: c.activity.state, evidence: evidenceOf(c) });

const partsOf = (input, c) => ((live, report) => ({ sessions: input.sessions.map(sessionView), tasks: c.rows.map(taskView), handoffs: c.fold.handoffs.map(handoffView), activity: live, report, summary: summaryOf(c, live, report) }))(liveActivity(c, input), reportView(lastReport(c.fold)));

export function workViewOf(input) {
  const c = contextOf(input);
  return { ...identityOf(input, c), ...standingOf(c), ...partsOf(input, c), coverage: input.coverage, warnings: warningsOf(c.fold, input.coverage, input.source), createdAt: c.fold.meta?.at ?? null, updatedAt: c.fold.updatedAt ?? null };
}
