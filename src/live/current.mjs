// WHAT THE TASK IS DOING NOW, for a viewer that has room for one line: the same answer Orbit Control's page
// gives (control-panel/.../live/live.reducer.ts currentActivity), first matching row wins -- that it ended;
// that it waits for a person; that a person paused it or something blocked it; the QA in flight; the action
// running; what is being diagnosed; or only the stage it is in. Never a percentage, never an estimate: every
// word is a field of the task's view or a line an investigation journaled.
//
//   qaFold(events) -> { <inv-id>: progress }           one investigation's progress, from its qa.* events
//   currentOf(view, qa) -> { kind, ... }                the first CURRENT row that matches
//
// CURRENT is exported as data so the page's order and this one are held equal by a test.

// ---- one investigation's progress ----------------------------------------------------------------

import { DISPATCH_WORDS } from "./words.mjs";

const emptyQa = (id, at) => ({ id, mode: null, origin: null, startedAt: at, step: null, url: null, lastFailure: null, consoleErrors: 0, screenshots: 0, steps: 0, runs: { passed: 0, failed: 0 }, findings: 0, ended: null, tests: null });

const str = (v) => (typeof v === "string" ? v : null);
const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const firstRequest = (e) => (Array.isArray(e.requests) ? e.requests.find((r) => r && typeof r === "object") : undefined);
const failureOf = (r) => ({ method: str(r.method), endpoint: str(r.endpoint), status: num(r.status) });
const stepOf = (e) => ({ verb: str(e.do) ?? "step", on: str(e.on), url: str(e.url), state: str(e.state), at: e.at });
const runsAfter = (runs, e) => (e.status === "PASS" ? { ...runs, passed: runs.passed + 1 } : { ...runs, failed: runs.failed + 1 });

const FOLDS = {
  "qa.started": (qa, e) => ({ ...qa, mode: str(e.mode), origin: str(e.origin), startedAt: e.at }),
  "qa.step": (qa, e) => ({ ...qa, steps: qa.steps + 1, screenshots: qa.screenshots + (e.screenshot === true ? 1 : 0), url: str(e.url) ?? qa.url, step: stepOf(e) }),
  "qa.console": (qa, e) => ({ ...qa, consoleErrors: qa.consoleErrors + (num(e.errors) ?? 0) }),
  "qa.network": (qa, e) => ({ ...qa, lastFailure: ((r) => (r ? failureOf(r) : qa.lastFailure))(firstRequest(e)) }),
  "qa.run": (qa, e) => ({ ...qa, runs: runsAfter(qa.runs, e), screenshots: qa.screenshots + (e.evidence === true ? 1 : 0) }),
  "qa.finding": (qa) => ({ ...qa, findings: qa.findings + 1 }),
  "qa.ended": (qa, e) => ({ ...qa, ended: { at: e.at, lifecycle: str(e.lifecycle) } }),
  "qa.discovery": tested((t, e) => ({ ...t, discovery: { state: str(e.state), count: num(e.count) } })),
  "qa.obligation.discovered": tested((t, e) => (str(e.obligation) && !t.obligations[e.obligation] ? withObligation(t, e.obligation, { state: "discovered", outcome: null, at: e.at }) : t)),
  "qa.test.designed": tested((t, e) => (str(e.design) ? { ...t, designs: { ...t.designs, [e.design]: str(e.obligation) } } : t)),
  "qa.draft.persisted": tested((t, e) => (str(e.version) ? { ...t, versions: { ...t.versions, [e.version]: str(e.design) } } : t)),
  "qa.test.started": tested((t, e) => newer(withExecution(t, e), obligationOfVersion(t, e.version), { state: "running", outcome: null, at: e.at })),
  "qa.result.evaluated": tested((t, e) => newer(t, str(e.obligation) ?? obligationOfVersion(t, t.executions[e.execution]), { state: "evaluated", outcome: str(e.outcome), at: e.at })),
};

// ---- a generated test's progress (0.1.0): one entry per OBLIGATION, never per attempt ----------
// A retry is the same test again; a delivery the channel repeats is not a test at all. So a count is
// how many obligations stand where -- the latest word each one earned -- and an event folded twice
// (a reconnect, a replayed line) changes nothing: it is folded once by its eventId. An event older
// than what an obligation already shows (an attempt's start read after its result) moves nothing.
// Until a test's first event arrives `tests` is null, which a viewer draws as nothing -- never 0.
const emptyTests = () => ({ discovery: null, obligations: {}, designs: {}, versions: {}, executions: {}, seen: {} });

function tested(fold) {
  return (qa, e) => {
    const t = qa.tests ?? emptyTests();
    if (str(e.eventId) && t.seen[e.eventId]) return qa;
    return { ...qa, tests: fold({ ...t, seen: str(e.eventId) ? { ...t.seen, [e.eventId]: true } : t.seen }, e) };
  };
}

const withObligation = (t, id, entry) => ({ ...t, obligations: { ...t.obligations, [id]: entry } });

const withExecution = (t, e) => (str(e.execution) ? { ...t, executions: { ...t.executions, [e.execution]: str(e.version) } } : t);

const obligationOfVersion = (t, version) => t.designs[t.versions[version]] ?? null;

const newer = (t, id, entry) => (id && !((t.obligations[id]?.at ?? "") > entry.at) ? withObligation(t, id, entry) : t);

// -> { total, satisfied, contradicted, running, done, discovering } for one investigation, or null when
// it has said nothing about a generated test yet.
export function testCountsOf(q) {
  if (!q?.tests) return null;
  const all = Object.values(q.tests.obligations);
  const outcome = (word) => all.filter((o) => o.outcome === word).length;
  return { total: all.length, satisfied: outcome("SATISFIED"), contradicted: outcome("CONTRADICTED"), running: all.filter((o) => o.state === "running").length, done: all.filter((o) => o.state === "evaluated").length, discovering: q.tests.discovery?.state === "open" };
}

const isQa = (e) => e.source !== "task" && typeof e.kind === "string" && e.kind.startsWith("qa.");

function folded(all, e) {
  const current = all[e.source] ?? emptyQa(e.source, e.at);
  const fold = FOLDS[e.kind];
  return { ...all, [e.source]: fold ? fold(current, e) : current };
}

export const qaFold = (events, from = {}) => events.filter(isQa).reduce(folded, from);

// ---- what the task is doing now ------------------------------------------------------------------

const latest = (items, at) => [...items].sort((a, b) => (at(a) < at(b) ? -1 : at(a) > at(b) ? 1 : 0)).at(-1);

const runningAction = (view) => latest(view.actions.filter((a) => a.state === "running"), (a) => a.startedAt);
const inFlightQa = (qa) => latest(Object.values(qa).filter((q) => q.ended === null), (q) => q.startedAt);
const failedAction = (view) => latest(view.actions.filter((a) => a.state === "failed" || a.state === "error"), (a) => a.endedAt ?? a.startedAt);
const labelOf = (a) => a.label ?? a.type;
const failureWords = (a) => (a ? `${labelOf(a)}${a.summary ? `: ${a.summary}` : a.reason ? `: ${a.reason}` : ""}` : null);

export const CURRENT = [
  { kind: "ended", when: (v) => v.terminal && v.ended, of: (v) => ({ ended: v.ended, lifecycle: v.lifecycle }) },
  { kind: "approval", when: (v) => v.approvals.some((a) => a.open), of: (v) => ({ approval: v.approvals.find((a) => a.open) }) },
  { kind: "paused", when: (v) => v.paused, of: (v) => ({ paused: v.paused }) },
  { kind: "blocked", when: (v) => v.blocked, of: (v) => ({ blocked: v.blocked }) },
  { kind: "qa", when: (v, qa) => inFlightQa(qa) && v.stage !== "DIAGNOSING", of: (v, qa) => ({ qa: inFlightQa(qa), stage: v.stage }) },
  { kind: "dispatch", when: (v) => Boolean(DISPATCH_WORDS[runningAction(v)?.type]), of: (v) => ((a) => ({ action: a, via: DISPATCH_WORDS[a.type].word, provider: a.tool ?? null, label: labelOf(a), stage: v.stage }))(runningAction(v)) },
  { kind: "action", when: (v) => runningAction(v), of: (v) => ((a) => ({ action: a, label: labelOf(a), stage: v.stage }))(runningAction(v)) },
  { kind: "diagnosing", when: (v) => v.stage === "DIAGNOSING", of: (v) => ({ lastFailure: failureWords(failedAction(v)), next: v.decision?.nextAction ?? null }) },
  { kind: "stage", when: () => true, of: (v) => ({ stage: v.stage, lifecycle: v.lifecycle }) },
];

export function currentOf(view, qa = {}) {
  const row = CURRENT.find((r) => r.when(view, qa));
  return { kind: row.kind, ...row.of(view, qa) };
}

// The latest thing that went wrong, for a viewer's third line: a failed request or console error the browser
// saw, a failed action, a violated verification -- whichever came last. Null when nothing did.
const FAILURES = [
  (e) => (e.kind === "qa.network" ? ((r) => r && { at: e.at, what: "request", ...failureOf(r) })(firstRequest(e)) : null),
  (e) => (e.kind === "qa.console" && num(e.errors) > 0 ? { at: e.at, what: "console", errors: num(e.errors) } : null),
  (e) => (e.kind === "qa.run" && e.status !== "PASS" ? { at: e.at, what: "run", case: str(e.case), status: str(e.status) } : null),
  (e) => (e.kind === "action-failed" || (e.kind === "action-completed" && e.outcome === "failed") ? { at: e.at, what: "action", action: str(e.id), summary: str(e.summary) ?? str(e.reason) } : null),
  (e) => (e.kind === "verification" && e.state === "violated" ? { at: e.at, what: "verification", obligation: str(e.obligation) } : null),
];

const failureIn = (e) => FAILURES.map((f) => f(e)).find(Boolean) ?? null;

export const latestFailure = (events) => events.map(failureIn).filter(Boolean).at(-1) ?? null;
