// ONE PICTURE of a task for a viewer to draw, made from what a feed collected: the task's view (its own fold),
// what it is doing now, each investigation's progress, the latest thing that went wrong, and the viewer's own
// state. Pure: a status line builds it once and exits, a terminal builds it again after every batch.
//
//   snapshotOf({ association, collected, events, read, nowMs, idleAfterMs, activity }) -> snapshot
//     collected  a feed's collected answer ({ view, events, cursor, activity, ... }) or null when nothing was read
//     events     every event a long-running viewer has seen so far (defaults to collected.events)
//     read       { reads, failures, good, partial }   how the viewer's reads went
//     activity   { <act-id>: observation }   what each check was observed doing (defaults to collected.activity)
// `activities` is one per action, what/why/where/how/progress/result/next, from the journal and those observations
// (activity.mjs); `observations` is the map itself; `plan` a coordinated workflow's active plan as its source
// projected it (1.8.6), or null.
import { activitiesOf } from "./activity.mjs";
import { currentOf, latestFailure, qaFold } from "./current.mjs";
import { presentationOf } from "./presentation.mjs";

const running = (view) => Boolean(view?.actions?.some((a) => a.state === "running"));

const lastAt = (events) => events.map((e) => e.at).filter((at) => typeof at === "string").sort().at(-1) ?? null;

// The newest line of any check's observation (1.8.5's sidecar): what its command printed is evidence the task moves.
const lastObserved = (observations) => Object.values(observations ?? {}).map((o) => o?.lastAt).filter((at) => typeof at === "string").sort().at(-1) ?? null;

// How many lines of evidence there are: each source's last index (a journal's, an investigation's) and each
// observation's sequence -- one more with every line that arrives, whatever window a viewer keeps of them.
const lastIndexes = (events) => events.reduce((by, e) => (Number.isInteger(e?.n) ? by.set(e.source, Math.max(by.get(e.source) ?? -1, e.n)) : by), new Map());

const evidenceMarkOf = (events, observations) => [...lastIndexes(events).values()].reduce((n, x) => n + x + 1, 0) + Object.values(observations ?? {}).reduce((n, o) => n + Math.max(0, Number.isInteger(o?.seq) ? o.seq + 1 : 0), 0);

const READ = { reads: 1, failures: 0, good: true, partial: false };

function factsOf(input, events) {
  const read = { ...READ, ...(input.read ?? {}) };
  const view = input.collected?.view ?? null;
  const observations = input.activity ?? input.collected?.activity;
  return { ...read, terminal: Boolean(view?.terminal), running: running(view), lastEventAt: lastAt(events), lastObservedAt: lastObserved(observations), evidenceMark: evidenceMarkOf(events, observations), now: input.nowMs, idleAfterMs: input.idleAfterMs };
}

export function snapshotOf(input) {
  const events = input.events ?? input.collected?.events ?? [];
  const view = input.collected?.view ?? null;
  const qa = qaFold(events);
  const observations = input.activity ?? input.collected?.activity ?? {};
  return { association: input.association, view, cursor: input.collected?.cursor ?? null, current: view ? currentOf(view, qa) : null, qa, failure: latestFailure(events), presentation: presentationOf(factsOf(input, events)), nowMs: input.nowMs, events, child: input.child ?? null, observations, activities: activitiesOf({ view, events, observations }), plan: input.plan ?? input.collected?.plan ?? null };
}
