// A task as the full-screen viewer receives it, written once for every TUI test: a view of an engineering task
// on its second attempt (a build that passed, a test that failed, a test running again), its journal lines and
// an investigation's QA activity -- and a coordinator that started it. Times are relative to NOW.
import { initialState } from "../src/live/tui/model.mjs";
import { reduce } from "../src/live/tui/reducer.mjs";

export const NOW = Date.parse("2026-10-12T11:37:16.000Z");
export const ago = (s) => new Date(NOW - s * 1000).toISOString();
export const ENG = "tsk-375de395af89";
export const WF = "tsk-d39609c044a8";
export const INV = "inv-20261012-113702-3f1a";
export const HERE = "c".repeat(64);
export const PLACE = Object.freeze({ key: "refunds", project: "refunds", checkoutId: HERE, branch: "feature/refunds", root: "/work/refunds" });
export const SETTINGS = Object.freeze({ idleAfterSec: 120, finishedForSec: 600, terminal: { maxRows: 200, showQa: true, showLogs: false } });

const action = (id, type, state, s, e, over = {}) => ({ id, type, tool: type, label: type, state, startedAt: ago(s), endedAt: e === null ? null : ago(e), receipts: [], evidence: "reported", attempt: "att-1", summary: null, ...over });

export const engView = (over = {}) => ({
  task: { id: ENG, provider: "autonomous-engineering", host: "mbp", createdAt: ago(300), updatedAt: ago(3) }, revision: 41, lifecycle: "EXECUTING", terminal: false, stage: "TESTING", stopReason: null,
  attempt: { current: "att-2", open: true, number: 2, count: 2, limit: 5 }, attempts: [{ id: "att-1", cause: "fresh" }, { id: "att-2", cause: "fix" }], approvals: [], paused: null, blocked: null, decision: { nextAction: "run tests" },
  receipts: [{ key: "check:chk-4", domain: "check", ref: "chk-4", outcome: "failed", summary: "test · app · npm test · exit 1 · 8s", at: ago(20) }], verification: [{ subject: "test", obligation: "the tests pass", state: "violated", evidence: "check:chk-4" }],
  changes: { files: 2, added: 41, removed: 3, paths: [] }, budget: { attempts: { spent: 2, limit: 5 }, actions: { spent: 3, limit: null }, minutes: { spent: 5, limit: 40 } }, readiness: { requirement: { state: "READY", ref: "rs-0123456789ab" }, environment: { state: "UNKNOWN", ref: null }, workspace: { state: "READY", ref: "ws-1" } },
  actions: [action("act-4", "build", "succeeded", 60, 48, { receipts: ["check:chk-3"], evidence: "receipt" }), action("act-5", "test", "failed", 30, 22, { summary: "exit 1 · 3 of 12 failing", receipts: ["check:chk-4"], evidence: "receipt" }), action("act-6", "test", "running", 3, null, { attempt: "att-2" })],
  ended: null, ...over,
});

const t = (n, s, kind, over = {}) => ({ source: "task", n, at: ago(s), kind, ...over });
const q = (n, s, kind, over = {}) => ({ source: INV, n, at: ago(s), kind, ...over });

export const engEvents = () => [
  t(0, 300, "created", { objective: "refund rule" }), t(1, 70, "stage", { stage: "BUILDING" }), t(2, 60, "action-started", { id: "act-4", type: "build" }), t(3, 48, "action-completed", { id: "act-4", outcome: "succeeded" }),
  t(4, 31, "stage", { stage: "TESTING" }), t(5, 30, "action-started", { id: "act-5", type: "test" }), t(6, 22, "action-completed", { id: "act-5", outcome: "failed", summary: "3 of 12 failing" }),
  t(7, 10, "attempt-started", { id: "att-2", cause: "fix" }), t(8, 3, "action-started", { id: "act-6", type: "test" }),
  q(0, 40, "qa.started", { mode: "observe" }), q(1, 5, "qa.step", { do: "click", on: "Save", state: "done" }), q(2, 4, "qa.network", { requests: [{ method: "POST", endpoint: "/api/refunds", status: 500 }] }), q(3, 2, "qa.finding", { outcome: "SUSPECTED_DEFECT", confidence: "low", reproduced: true }),
];

export const wfView = (over = {}) => ({
  ...engView(), task: { id: WF, provider: "automation", host: "mbp", createdAt: ago(400), updatedAt: ago(5) }, stage: "IMPLEMENTING", attempt: { current: "att-1", number: 1, count: 1, limit: 3 }, attempts: [{ id: "att-1", cause: "fresh" }], verification: [{ subject: "a", state: "satisfied" }, { subject: "b", state: "not-verified" }],
  receipts: [{ key: "plan:p1", domain: "plan", ref: "p1", outcome: "ACTIVE", summary: "plan-1 (engineering): 4 step(s): requirement, context, engineering, review", at: ago(390) }, { key: "step:requirement", domain: "step", ref: "requirement", outcome: "SUCCEEDED", action: "act-1", at: ago(380) }, { key: "step:context", domain: "step", ref: "context", outcome: "REPORTED", at: ago(370) }, { key: "step:engineering", domain: "step", ref: "engineering", outcome: "RUNNING", action: "act-3", at: ago(300) }, { key: `task:${ENG}`, domain: "task", ref: ENG, outcome: "STARTED", at: ago(300) }],
  actions: [action("act-1", "engine.run", "succeeded", 390, 380), action("act-3", "agent.dispatch", "running", 300, null, { tool: "orbit-engineer" })], ...over,
});

const frames = (view, events) => [...events.map((e) => ({ event: e.source === "task" ? "task-event" : "qa-event", id: `t=${e.n + 1}`, data: e })), { event: "task-view", id: "t=9", data: { source: "task", revision: view.revision, view } }];

export function stateOf(over = {}) {
  const base = initialState({ association: { how: "session", task: over.root ?? ENG, ids: [over.root ?? ENG] }, root: over.root ?? ENG, place: PLACE, columns: over.columns ?? 120, rows: over.rows ?? 34, colour: over.colour ?? false, ascii: over.ascii ?? false, nowMs: NOW, settings: SETTINGS, ...(over.start ?? {}) });
  return reduce(base, { type: "tick", nowMs: NOW });
}

export const fed = (state, id, view, events, role = "root") => reduce(reduce(state, { type: "feed-opened", task: id, role }), { type: "frames", task: id, frames: frames(view, events) });

export const engineering = (over = {}) => fed(stateOf(over), ENG, engView(over.view ?? {}), over.events ?? engEvents());

export const workflow = (over = {}) => fed(fed(stateOf({ ...over, root: WF }), WF, wfView(), [t(0, 400, "created"), t(1, 300, "stage", { stage: "IMPLEMENTING" })]), ENG, engView(), engEvents(), "child");

export const keys = (state, ...actions) => actions.reduce((s, a) => reduce(s, typeof a === "string" ? { type: a } : a), state);
