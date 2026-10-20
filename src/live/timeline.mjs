// The ACTIVITY TIMELINE (1.8.6, ADR 0022): every source a viewer follows -- the task's journal, its investigations'
// QA activity, its checks' observations and its plan's revisions -- as ONE list of normalized events a pane draws,
// newest last. A pure FOLD over what the feed already delivered: no store of its own, nothing written, and the same
// answer for the same lines, so a reconnect that delivers a line again adds nothing (an event's id is its source and
// its index there).
//
// Each event says where it comes from and how much it can be trusted (PROVENANCE): OBSERVED -- a record the engine or
// a check runner wrote from what happened; REPORTED -- what a host or an agent said, which proves nothing; INFERRED --
// what the engine worked out from evidence (a plan revision). A kind this table does not name is kept as `other`,
// never dropped and never guessed at.
//
//   timelineOf({ sources: [{ task, events, observations }], replans, plan, view, limit }) -> [event]
//     a coordinated workflow and the engineering task it started are two sources, merged in time; an event's id names
//     its task too. Each source's events arrive in the feed's own time order, so only its newest few times `limit`
//     are read: a pane asks every few seconds, and the oldest of 3000 lines can never reach the last `limit`.
//   event: { schema, id, task, plan?, revision?, source, provenance, type, title, status?, expected?, actual?, evidence?, at }
import { knownKind, lineOf } from "./render/lines.mjs";

export const TIMELINE_SCHEMA = 1;

export const TIMELINE_LIMIT = 40;

const FAILURES_PER_CHECK = 5;

// A journal line's provenance: the first row that holds, the last always answering.
export const PROVENANCE = [
  { provenance: "reported", when: (e) => e.kind === "decision" || e.kind === "qa.decision" },
  { provenance: "reported", when: (e) => e.kind === "receipt" && e.outcome === "REPORTED" },
  { provenance: "reported", when: (e) => e.kind === "action-completed" && !e.receipt },
  { provenance: "reported", when: (e) => e.kind === "verification" && e.state === "not-verified" },
  { provenance: "inferred", when: (e) => e.kind === "qa.finding" && e.confidence !== "high" },
  { provenance: "observed", when: () => true },
];

const provenanceOf = (e) => PROVENANCE.find((r) => r.when(e)).provenance;

const STATUS = { "action-completed": (e) => e.outcome ?? null, "action-failed": () => "failed", receipt: (e) => e.outcome ?? null, verification: (e) => e.state ?? null, "qa.run": (e) => e.status ?? null, "qa.finding": (e) => e.outcome ?? null, failed: () => "failed", completed: () => "completed", blocked: () => "blocked" };

const evidenceOf = (e) => (e.kind === "receipt" && e.domain && e.ref ? `${e.domain}:${e.ref}` : e.receipt ?? null);

const journalEvent = (task) => (e) => ({ schema: TIMELINE_SCHEMA, id: `${task}:${e.source}:${e.n}`, task, source: e.source === "task" ? "task" : "qa", provenance: provenanceOf(e), type: knownKind(e) ? e.kind : "other", title: lineOf(e).summary || String(e.kind ?? "line"), status: STATUS[e.kind]?.(e) ?? null, ...(e.expected ? { expected: e.expected } : {}), ...(e.actual ? { actual: e.actual } : {}), evidence: evidenceOf(e), at: e.at ?? null });

// ---- a check's observation: when it started, what failed, when it ended ------------------------------------------

const checkTitle = (o) => [o.command?.purpose, o.command?.program, o.command?.declaredAs].filter((x) => typeof x === "string" && x).join(" · ") || "a check";

const failureEvent = (task, o) => (f) => ({ schema: TIMELINE_SCHEMA, id: `${task}:act:${o.action}:fail:${f.seq ?? f.key}`, task, source: "activity", provenance: "observed", type: "test.case.failed", title: f.name ?? f.key ?? "a case", status: "failed", ...(f.expected ? { expected: f.expected } : {}), ...(f.actual ? { actual: f.actual } : {}), evidence: `act:${o.action}`, at: o.lastAt ?? null });

// What a check came to, in the runner's own totals once it said them (a VSTest run prints only its failures, so the
// cases observed would say "0 passed"), else the cases observed; its status is the observation's own word -- the
// outcome is a record of the end (an exit code, an observer's failure), never a word to print.
const countsWords = (o) => (Number.isInteger(o.totals?.tests) ? `${o.totals.passed ?? 0} passed · ${o.totals.failed ?? 0} failed of ${o.totals.tests}, as the runner said` : `${o.counts?.passed ?? 0} passed · ${o.counts?.failed ?? 0} failed`);

const endedEvent = (task, o) => (o.endedAt ? [{ schema: TIMELINE_SCHEMA, id: `${task}:act:${o.action}:end`, task, source: "activity", provenance: "observed", type: "check.ended", title: `${checkTitle(o)} · ${countsWords(o)}${o.aborted ? " · aborted" : ""}`, status: o.aborted ? "aborted" : typeof o.state === "string" ? o.state : null, evidence: `act:${o.action}`, at: o.endedAt }] : []);

const observedEvents = (task, o) => [...(o.startedAt ? [{ schema: TIMELINE_SCHEMA, id: `${task}:act:${o.action}:start`, task, source: "activity", provenance: "observed", type: "check.started", title: checkTitle(o), status: "running", evidence: `act:${o.action}`, at: o.startedAt }] : []), ...(o.failures ?? []).slice(0, FAILURES_PER_CHECK).map(failureEvent(task, o)), ...endedEvent(task, o)];

// ---- a plan's revisions: the engine's reading of the evidence -------------------------------------------------

// When a revision took effect: the journal line that first named its plan ACTIVE (the revision itself keeps no clock,
// and the task's fold keeps only a receipt's LAST line -- a plan replaced later would read the time it was replaced).
const isActive = (n) => (e) => e.kind === "receipt" && e.domain === "plan" && e.outcome === "ACTIVE" && String(e.summary ?? "").startsWith(`plan-${n} `);

const revisedAt = (view, n, events) => events.find(isActive(n))?.at ?? (view?.receipts ?? []).find((r) => r.domain === "plan" && String(r.summary ?? "").startsWith(`plan-${n} `))?.at ?? null;

const replanEvent = (task, plan, view, events) => (r) => ({ schema: TIMELINE_SCHEMA, id: `${task}:plan:${r.n}`, task, plan: plan?.ref ?? null, revision: r.n, source: "plan", provenance: "inferred", type: "plan.revised", title: `plan-${r.n}: ${r.trigger ?? "revised"}${r.step ? ` at ${r.step}` : ""}${r.summary ? ` — ${r.summary}` : ""}`, status: r.response ?? null, evidence: null, at: revisedAt(view, r.n, events) });

// ---- the fold --------------------------------------------------------------------------------------------------

// In time order -- an event its source gave no time takes the time of the one before it, so it stays where its
// source put it -- and each id once: a line delivered again by a reconnect is the same event.
function keyed(list) {
  const out = [];
  for (const [i, e] of list.entries()) out.push({ e, i, at: e.at ?? out.at(-1)?.at ?? "" });
  return out;
}

const unique = (list) => [...list.reduce((seen, e) => (seen.has(e.id) ? seen : seen.set(e.id, e)), new Map()).values()];

const ordered = (list) => keyed(unique(list)).sort((a, b) => (a.at === b.at ? a.i - b.i : a.at < b.at ? -1 : 1)).map((x) => x.e);

const isRecord = (e) => Boolean(e) && typeof e === "object";

const journalOf = (limit) => (s) => (s.events ?? []).slice(-limit * 3).filter(isRecord).map(journalEvent(s.task ?? null));

const checksOf = (s) => Object.values(s.observations ?? {}).filter(isRecord).flatMap((o) => observedEvents(s.task ?? null, o));

const newestOf = (list, n) => list.slice(Math.max(0, list.length - n));

// A plan's revision is never scrolled out (1.8.6): it explains every step after it, and a busy check would push it out
// of a docked pane within minutes. The rest are the newest of everything else, so the timeline still holds `limit`.
const keptOf = (rest, revised, limit) => ((pinned) => [...newestOf(ordered(rest), limit - pinned.length), ...pinned])(newestOf(revised, limit));

export function timelineOf({ sources = [], replans = [], plan = null, view = null, limit = TIMELINE_LIMIT }) {
  const journal = sources.flatMap(journalOf(limit));
  const checks = sources.flatMap(checksOf);
  const revised = replans.map(replanEvent(sources[0]?.task ?? null, plan, view, sources[0]?.events ?? []));
  return ordered(keptOf([...journal, ...checks], revised, limit));
}
