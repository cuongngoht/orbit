import { numberOf, stringOf, stringsOf, isRecord } from "../../../shared/json";
import type { TaskView } from "../mission.types";
import { DISPATCH_WORDS, rowOf } from "./liveWords";
import { isQaKind, isTaskEvent, liveKey, type ConnectionState, type CurrentActivity, type LiveEvent, type LiveState, type QaProgress } from "./live.types";
import { withObservations, type Observation } from "./observation";

// The live feed as a page holds it: rows appended as lines arrive, never rebuilt; a line seen twice
// (a reconnect that resent it) is one row; and only the newest WINDOW rows are kept rendered -- the
// journal keeps everything, and "Load earlier" reads it back. Pure: the hook owns the timers and the
// stream, this owns what they mean.

export const WINDOW = 500;

export type LiveAction =
  | { type: "received"; events: readonly LiveEvent[]; cursor: string | null; labels: ReadonlyMap<string, string> }
  | { type: "viewed"; view: TaskView }
  | { type: "observed"; observations: readonly Observation[] }
  | { type: "connection"; connection: ConnectionState }
  | { type: "replay" }
  | { type: "followed" }
  | { type: "unfollowed" }
  | { type: "loadedEarlier"; events: readonly LiveEvent[]; cursor: string | null; labels: ReadonlyMap<string, string> }
  | { type: "reset" };

export const initialLive = (): LiveState => ({ cursor: null, rows: [], hidden: 0, unbounded: false, seen: new Set(), qa: {}, activity: {}, view: null, connection: "connecting", replay: false, lastEventAt: null, following: true, newSinceFollow: 0 });

export function liveReducer(state: LiveState, action: LiveAction): LiveState {
  if (action.type === "received") return received(state, action.events, action.cursor, action.labels);
  if (action.type === "viewed") return state.view !== null && action.view.revision < state.view.revision ? state : { ...state, view: action.view };
  if (action.type === "observed") return ((activity) => (activity === state.activity ? state : { ...state, activity }))(withObservations(state.activity, action.observations));
  if (action.type === "connection") return state.connection === action.connection ? state : { ...state, connection: action.connection };
  if (action.type === "replay") return { ...state, replay: true, connection: "finished" };
  if (action.type === "followed") return state.following && state.newSinceFollow === 0 ? state : { ...state, following: true, newSinceFollow: 0 };
  if (action.type === "unfollowed") return state.following ? { ...state, following: false } : state;
  if (action.type === "loadedEarlier") return received({ ...initialLive(), view: state.view, activity: state.activity, connection: state.connection, replay: state.replay, unbounded: true, following: state.following }, action.events, action.cursor ?? state.cursor, action.labels);
  return initialLive();
}

function received(state: LiveState, events: readonly LiveEvent[], cursor: string | null, labels: ReadonlyMap<string, string>): LiveState {
  const fresh = unseen(state.seen, events);
  if (fresh.length === 0) return cursor === null || cursor === state.cursor ? state : { ...state, cursor };
  const rows = [...state.rows, ...fresh.map((e) => rowOf(e, labels))];
  const trimmed = state.unbounded ? 0 : Math.max(0, rows.length - WINDOW);
  const seen = new Set(state.seen);
  for (const e of fresh) seen.add(liveKey(e));
  return { ...state, cursor: cursor ?? state.cursor, rows: rows.slice(trimmed), hidden: state.hidden + trimmed, seen, qa: fresh.reduce(foldQa, state.qa), lastEventAt: fresh.at(-1)?.at ?? state.lastEventAt, newSinceFollow: state.following ? 0 : state.newSinceFollow + fresh.length };
}

// The new lines, once each -- also inside one batch.
function unseen(seen: ReadonlySet<string>, events: readonly LiveEvent[]): LiveEvent[] {
  const now = new Set<string>();
  return events.filter((e) => {
    const key = liveKey(e);
    if (seen.has(key) || now.has(key)) return false;
    now.add(key);
    return true;
  });
}

// ---- one investigation's progress, from its lines ---------------------------------------------------

const emptyQa = (id: string, at: string): QaProgress => ({ id, mode: null, origin: null, startedAt: at, step: null, url: null, lastFailure: null, consoleErrors: 0, screenshots: 0, steps: 0, runs: { passed: 0, failed: 0 }, findings: 0, ended: null });

type Fold = (qa: QaProgress, e: LiveEvent) => QaProgress;

const s = (e: LiveEvent, key: string) => stringOf(e[key]);

const firstFailure = (e: LiveEvent) => (Array.isArray(e.requests) ? e.requests.filter(isRecord)[0] : undefined);

const FOLDS: Partial<Record<string, Fold>> = {
  "qa.started": (qa, e) => ({ ...qa, mode: s(e, "mode"), origin: s(e, "origin"), startedAt: e.at }),
  "qa.step": (qa, e) => ({ ...qa, steps: qa.steps + 1, screenshots: qa.screenshots + (e.screenshot === true ? 1 : 0), url: s(e, "url") ?? qa.url, step: { verb: s(e, "do") ?? "step", on: s(e, "on"), url: s(e, "url"), state: s(e, "state"), at: e.at } }),
  "qa.console": (qa, e) => ({ ...qa, consoleErrors: qa.consoleErrors + (numberOf(e.errors) ?? 0) }),
  "qa.network": (qa, e) => ((r) => ({ ...qa, lastFailure: r ? { method: stringOf(r.method), endpoint: stringOf(r.endpoint), status: numberOf(r.status) } : qa.lastFailure }))(firstFailure(e)),
  "qa.run": (qa, e) => ({ ...qa, runs: s(e, "status") === "PASS" ? { ...qa.runs, passed: qa.runs.passed + 1 } : { ...qa.runs, failed: qa.runs.failed + 1 }, screenshots: qa.screenshots + (e.evidence === true ? 1 : 0) }),
  "qa.finding": (qa) => ({ ...qa, findings: qa.findings + 1 }),
  "qa.ended": (qa, e) => ({ ...qa, ended: { at: e.at, lifecycle: s(e, "lifecycle") } }),
};

function foldQa(all: Readonly<Record<string, QaProgress>>, e: LiveEvent): Readonly<Record<string, QaProgress>> {
  if (isTaskEvent(e) || !isQaKind(e.kind)) return all;
  const fold = FOLDS[e.kind];
  const current = all[e.source] ?? emptyQa(e.source, e.at);
  return { ...all, [e.source]: fold ? fold(current, e) : current };
}

// ---- what the task is doing now ---------------------------------------------------------------------

const latest = <T>(items: readonly T[], at: (item: T) => string): T | undefined => [...items].sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0)).at(-1);

const lastFailure = (view: TaskView) => latest(view.actions.filter((a) => a.state === "failed" || a.state === "error"), (a) => a.endedAt ?? a.startedAt);

/**
 * What a person watching most needs to know, first match wins: that it ended; that it waits for a person;
 * that a person paused or something blocked it; the QA in flight; the action running; what is being diagnosed;
 * or only the stage it is in. Never a percentage, never an estimate.
 */
export function currentActivity(view: TaskView, qa: Readonly<Record<string, QaProgress>>, labels: ReadonlyMap<string, string>): CurrentActivity {
  const approval = view.approvals.find((a) => a.open);
  const running = latest(view.actions.filter((a) => a.state === "running"), (a) => a.startedAt);
  const inFlight = latest(Object.values(qa).filter((q) => q.ended === null), (q) => q.startedAt);
  if (view.terminal && view.ended) return { kind: "ended", ended: view.ended, lifecycle: view.lifecycle };
  if (approval) return { kind: "approval", approval };
  if (view.paused) return { kind: "paused", paused: view.paused };
  if (view.blocked) return { kind: "blocked", blocked: view.blocked };
  if (inFlight && view.stage !== "DIAGNOSING") return { kind: "qa", qa: inFlight, stage: view.stage };
  if (running && running.type in DISPATCH_WORDS) return { kind: "dispatch", action: running, via: DISPATCH_WORDS[running.type] ?? "skill", provider: running.tool ?? null, label: labels.get(running.id) ?? running.label ?? running.type, stage: view.stage };
  if (running) return { kind: "action", action: running, label: labels.get(running.id) ?? running.label ?? running.type, stage: view.stage };
  if (view.stage === "DIAGNOSING") return { kind: "diagnosing", lastFailure: ((a) => (a ? `${labels.get(a.id) ?? a.label ?? a.type}${a.summary ? `: ${a.summary}` : a.reason ? `: ${a.reason}` : ""}` : null))(lastFailure(view)), next: view.decision?.nextAction ?? null };
  return { kind: "stage", stage: view.stage, lifecycle: view.lifecycle };
}

/** The ids of the evidence a decision cited, for the feed's detail line. */
export const evidenceOf = (e: LiveEvent) => stringsOf(e.evidence);
