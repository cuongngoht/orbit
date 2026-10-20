// WHAT THE TASK IS DOING, one ACTIVITY per action it started (1.8.5, ADR 0020): what, why, where, how, how far, how
// it ended, and what comes next -- every field read off the task's own journal or a check's observation, and a
// field nothing says is absent, never filled in. Pure: a terminal, a status line and Orbit Control's page draw it.
//
//   activitiesOf({ view, events, observations }) -> [activity]       oldest first; `current` is the running ones
//     view          the task's view (src/task/views.mjs)
//     events        its journal lines, as a feed delivered them (a decision's `observed`/`hypothesis` are there)
//     observations  { <act-id>: observation view }   what each check was observed doing, when it was
//
// WHY is, in order: what the engine itself says a check runs for (the observation's `why`, in the journal's terms:
// a baseline, or a check the change reaches), else the hypothesis of the decision that started the action -- one
// sentence the decision contract allows, never a chain of thought -- else nothing. NEXT is the orchestrator's
// latest decision when one was made after the action, else, with nothing running and the task going on, that it
// waits for one; never a guess at what it will choose. PROGRESS is a check's observation (what its runner reported)
// or, for every other action, only how long it has run: a timer is never a progress bar.
const str = (v) => (typeof v === "string" && v.length > 0 ? v : null);

const decisionBefore = (events, id) => ((i) => (i < 0 ? null : events.slice(0, i).reverse().find((e) => e.source === "task" && e.kind === "decision") ?? null))(events.findIndex((e) => e.source === "task" && e.kind === "action-started" && e.id === id));

const whyOf = (a, obs, events) => str(obs?.why) ?? str(decisionBefore(events, a.id)?.hypothesis) ?? null;

const whereOf = (a, obs) => str(obs?.command?.component) ?? null;

const howOf = (a, obs) => str(obs?.command?.declaredAs) ?? str(a.tool) ?? null;

// The decision written AFTER the action's own end line, by the journal's order (never by a clock): what the
// orchestrator decided next, or null.
const endLineOf = (events, id) => events.find((e) => e.source === "task" && (e.kind === "action-completed" || e.kind === "action-failed") && e.id === id) ?? null;

const decidedAfter = (events, id) => ((end) => (end ? events.filter((e) => e.source === "task" && e.kind === "decision" && e.n > end.n).at(-1) ?? null : null))(endLineOf(events, id));

const NEXT = [
  { when: (c) => c.view.terminal || c.a.state === "running", next: () => null },
  { when: (c) => decidedAfter(c.events, c.a.id), next: (c) => ((d) => ({ decided: str(d.nextAction), at: d.at ?? null }))(decidedAfter(c.events, c.a.id)) },
  { when: (c) => !c.view.actions.some((x) => x.state === "running"), next: () => ({ decided: null, waiting: "the orchestrator's next decision" }) },
  { when: () => true, next: () => null },
];

const nextOf = (view, events, a) => ((c) => NEXT.find((r) => r.when(c)).next(c))({ view, events, a });

const resultOf = (a) => (a.state === "running" ? null : { state: a.state, summary: str(a.summary) ?? str(a.reason), evidence: a.evidence, receipts: a.receipts ?? [] });

function activityOf(view, events, observations, a) {
  const obs = observations?.[a.id] ?? null;
  return { id: a.id, kind: a.type, attempt: a.attempt ?? null, what: str(a.label) ?? a.type, why: whyOf(a, obs, events), where: whereOf(a, obs), how: howOf(a, obs), state: a.state, startedAt: a.startedAt ?? null, endedAt: a.endedAt ?? null, observation: obs, result: resultOf(a), next: nextOf(view, events, a), evidence: a.evidence ?? null };
}

export function activitiesOf({ view, events = [], observations = {} }) {
  if (!view) return [];
  return view.actions.map((a) => activityOf(view, events, observations, a));
}

export const currentOf = (activities) => activities.filter((a) => a.state === "running");

// The one a person's eye goes to first: what runs now (the newest), else what ended last.
export const focusOf = (activities) => currentOf(activities).at(-1) ?? activities.at(-1) ?? null;

// What a check's observation can say of its progress, as words a viewer prints -- only what was reported.
export function progressWords(obs) {
  if (!obs) return null;
  const c = obs.counts ?? {};
  const parts = [c.passed ? `${c.passed} passed` : null, c.failed ? `${c.failed} failed` : null, c.skipped ? `${c.skipped} skipped` : null, c.todo ? `${c.todo} todo` : null, c.cancelled ? `${c.cancelled} cancelled` : null].filter(Boolean);
  return { cases: parts.length ? parts.join(" · ") : null, total: Number.isInteger(obs.total) ? `${obs.reported} of ${obs.total} reported` : obs.reported ? `${obs.reported} reported · total unknown` : null, unavailable: obs.adapter?.capabilities?.cases === "none" ? "case progress unavailable: the command prints nothing Orbit reads as case results" : null, onlyFailures: obs.adapter?.capabilities?.cases === "failures" ? "this runner prints only the cases that did not pass" : null, aborted: obs.aborted ? `no case ran: ${obs.aborted.why ?? "the runner aborted"} (${obs.aborted.category ?? "unknown"})` : null };
}
