// Mission Control as control-server answers it, in memory. Like the real server: a decision is a POST
// with the page's token, `human: true` and the revision the page read; a revision the task has moved
// past is a 409 and changes nothing; an approval is decided once (a second decision is a 409); an
// unknown task or approval is a 404. The machine's view and its queue are derived from the same state,
// so a decision shows on every page the way it would.
import type { Approval, HealthView, Lifecycle, MachineView, TaskEvent, TaskRow, TaskView } from "../features/mission-control/mission.types";
import type { LogStream, SandboxView } from "../features/runtime/sandbox.types";
import { TOKEN_HEADER } from "../shared/api/client";
import { DB_ID } from "./fakeRuntime";
import { reply, type Call } from "./fakeServer";
import { fieldOf, isRecord } from "./required";
import type { LiveEvent } from "../features/mission-control/live/live.types";
import type { PlanView } from "../features/mission-control/plan.types";

export const M_KEY = "repo-payments";
export const M_CHECKOUT = "b".repeat(64);
export const TASK = "tsk-0123456789ab";

/** The page of the PBI-482 task, and its address in the API. */
export const TASK_PAGE = `/mission-control/${M_KEY}/checkouts/${M_CHECKOUT}/tasks/${TASK}`;
export const TASK_API = `/api/v1/projects/${M_KEY}/checkouts/${M_CHECKOUT}/tasks/${TASK}`;

/** The sandbox the PBI-482 task's receipt names, and the session its web component runs in. */
export const SANDBOX_ENV = "env-0123456789ab";
export const SANDBOX_SESSION = "rs-0123456789ab";
export const OTHER_SESSION = "rs-ba9876543210";
export const SOURCE_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
export const MOVED_TREE = "9daeafb9864cf43055ae93beb0afd6c7d144bfa4";

const at = (minute: number) => `2026-10-06T21:${String(minute).padStart(2, "0")}:00.000Z`;

const APPROVAL: Approval = {
  id: "apr-1",
  action: "database.migrate",
  environment: "dev",
  reason: "Integration verification needs schema v82.",
  risk: "DEV database state will be changed.",
  attempt: "att-3",
  requestedAt: at(12),
  expires: null,
  state: "pending",
  open: true,
  decision: null,
  decidedAt: null,
  decidedBy: null,
  consumedBy: null,
  consumedAt: null,
};

const DECISION = { id: "dec-1", attempt: "att-1", at: at(8), observed: "2 refund boundary tests failed", hypothesis: "validation occurs after rounding", nextAction: "inspect-refund-validation", evidence: ["test:test-receipt-28"], reason: "both failures share the boundary condition" };

const action = (id: string, attempt: string, label: string, state: TaskView["actions"][number]["state"], minute: number, extra: Partial<TaskView["actions"][number]> = {}): TaskView["actions"][number] => ({ id, attempt, type: label === "Build" ? "build" : "test", tool: null, label, mutates: false, approval: null, startedAt: at(minute), endedAt: state === "running" ? null : at(minute), state, summary: null, reason: null, receipts: [], evidence: "reported", ...extra });

/** PBI-482 three attempts in: build ✓ tests ✗, tests ✗, tests ✓ and a regression running -- and a migration waiting for a person. */
export function pbi482View(): TaskView {
  return {
    version: 1,
    task: { id: TASK, project: M_KEY, checkout: M_CHECKOUT, objective: "PBI-482 — Refund validation", work: "w-0123456789ab", root: "req-0123456789ab", snapshot: "rs-0123456789ab", snapshotDigest: null, baseRevision: "18b833d", workspace: "task-a82f", provider: "devcontainer", actor: "claude-code", host: "laptop", createdAt: at(3), updatedAt: at(12) },
    revision: 30,
    lifecycle: "WAITING_APPROVAL",
    terminal: false,
    stage: "REGRESSION",
    stopReason: "HUMAN_APPROVAL_REQUIRED",
    attempt: { current: "att-3", open: true, number: 3, count: 3, limit: 8 },
    repeats: 0,
    budget: { attempts: { spent: 3, limit: 8 }, actions: { spent: 5, limit: 100 }, minutes: { spent: 9, limit: null } },
    readiness: { requirement: { state: "READY", ref: "rs-0123456789ab" }, environment: { state: "READY", ref: "runtime:rs-aaaaaaaaaaaa", at: at(4), source: "receipt" }, workspace: { state: "READY", ref: "task-a82f" }, agent: { actor: "claude-code", stage: "REGRESSION" } },
    paused: null,
    blocked: null,
    decision: DECISION,
    decisions: [DECISION],
    attempts: [
      { id: "att-1", number: 1, cause: "fresh", startedAt: at(4), endedAt: at(7), outcome: "failed", failureSignature: "a1b2c3d4e5f6", actions: ["act-1", "act-2"], files: 1 },
      { id: "att-2", number: 2, cause: "fix", startedAt: at(8), endedAt: at(9), outcome: "failed", failureSignature: "f6e5d4c3b2a1", actions: ["act-3"], files: 1 },
      { id: "att-3", number: 3, cause: "fix", startedAt: at(9), endedAt: null, outcome: null, failureSignature: null, actions: ["act-4", "act-5"], files: 0 },
    ],
    actions: [
      action("act-1", "att-1", "Build", "succeeded", 6),
      action("act-2", "att-1", "RefundTests", "failed", 7, { summary: "2 failed", receipts: ["test:test-receipt-28"], evidence: "receipt" }),
      action("act-3", "att-2", "RefundTests", "failed", 9, { summary: "1 failed" }),
      action("act-4", "att-3", "RefundTests", "succeeded", 10, { receipts: ["test:test-receipt-31"], evidence: "receipt" }),
      action("act-5", "att-3", "Regression", "running", 11),
    ],
    changes: { files: 1, added: 61, removed: 18, paths: [{ path: "src/RefundService.cs", change: "modified", added: 61, removed: 18, attempts: ["att-1", "att-2"], at: at(9) }] },
    receipts: [
      { key: "test:test-receipt-28", domain: "test", ref: "test-receipt-28", outcome: "FAILED", summary: "2 failed", action: "act-2", at: at(7) },
      { key: "test:test-receipt-31", domain: "test", ref: "test-receipt-31", outcome: "PASSED", summary: null, action: "act-4", at: at(10) },
      { key: `sandbox:${SANDBOX_ENV}`, domain: "sandbox", ref: SANDBOX_ENV, outcome: "READY", summary: "the sandbox is ready", action: null, at: at(11) },
    ],
    verification: [
      { subject: null, obligation: "Refund <= paid amount", evidence: "test:test-receipt-31", state: "satisfied", at: at(10) },
      { subject: null, obligation: "Persisted correctly", evidence: null, state: "not-verified", at: at(10) },
    ],
    approvals: [APPROVAL],
    ended: null,
  };
}

/** A READY sandbox: web on a leased port, the api in a container on its own fixed one, and a database two locations were asked about. */
export function sandboxView(over: Partial<SandboxView> = {}): SandboxView {
  return {
    environment: SANDBOX_ENV,
    owner: { kind: "task", id: TASK },
    workspace: "ws-0123456789ab",
    state: "READY",
    tree: SOURCE_TREE,
    currentTree: SOURCE_TREE,
    stale: false,
    components: [
      { component: "node:web", execution: "native", session: SANDBOX_SESSION, requestedAt: at(11), state: "RUNNING", readiness: { state: "READY" }, endpoint: "http://127.0.0.1:42017" },
      { component: "dotnet:api", execution: "devcontainer", session: OTHER_SESSION, requestedAt: at(11), state: "RUNNING", readiness: { state: "NOT_READY", because: "nothing answers yet" }, endpoint: "http://127.0.0.1:5001" },
    ],
    leases: [{ port: 42017, component: "node:web", since: at(11) }],
    connectivity: [
      { target: DB_ID, from: "native", state: "REACHABLE", because: "db.internal:1433 accepted a connection", checkedAt: at(12), stale: false },
      { target: DB_ID, from: "devcontainer", state: "UNREACHABLE", because: "db.internal did not resolve (ENOTFOUND)", checkedAt: at(12), stale: true },
    ],
    ownership: { processes: 1, containers: 1, external: 0 },
    dataIsolation: { state: "shared-development", because: "Orders database is a shared development server" },
    qa: { modes: ["observe"], entry: "node:web", browser: "isolated" },
    createdAt: at(10),
    updatedAt: at(11),
    ...over,
  };
}

const LOG_LINES: Record<LogStream, string[]> = { out: ["listening on 42017", "GET /health 200"], err: ["(node:42) ExperimentalWarning: something"] };

const event = (n: number, minute: number, kind: string, fields: Record<string, unknown> = {}): TaskEvent => ({ n, at: at(minute), kind, ...fields });

/** The same task's journal, line by line, as the events endpoint answers it. */
export function pbi482Events(): TaskEvent[] {
  const lines: [number, string, Record<string, unknown>][] = [
    [3, "created", { objective: "PBI-482 — Refund validation" }], [3, "stage", { stage: "CONTEXT" }], [4, "workspace", { workspace: "task-a82f" }], [4, "stage", { stage: "IMPLEMENTING" }],
    [4, "attempt-started", { id: "att-1", cause: "fresh" }], [5, "file-changed", { path: "src/RefundService.cs", change: "modified" }], [6, "action-started", { id: "act-1", type: "build" }],
    [6, "action-completed", { id: "act-1", outcome: "succeeded" }], [7, "action-started", { id: "act-2", type: "test" }], [7, "action-completed", { id: "act-2", outcome: "failed", summary: "2 failed" }],
    [7, "attempt-completed", { id: "att-1", outcome: "failed", failureSignature: "a1b2c3d4e5f6" }], [8, "decision", { id: "dec-1", observed: "2 refund boundary tests failed", nextAction: "inspect-refund-validation" }],
    [8, "attempt-started", { id: "att-2", cause: "fix" }], [9, "action-completed", { id: "act-3", outcome: "failed", summary: "1 failed" }], [9, "attempt-started", { id: "att-3", cause: "fix" }],
    [10, "action-completed", { id: "act-4", outcome: "succeeded" }], [11, "action-started", { id: "act-5", type: "test" }], [12, "approval-requested", { id: "apr-1", action: "database.migrate", environment: "dev" }],
  ];
  return lines.map(([minute, kind, fields], n) => event(n, minute, kind, fields));
}

const row = (id: string, project: string, projectName: string, objective: string, lifecycle: Lifecycle, extra: Partial<TaskRow> = {}): TaskRow => ({ id, project, checkout: "a".repeat(64), objective, work: null, root: null, snapshot: null, actor: null, revision: 4, lifecycle, terminal: ["COMPLETED", "FAILED", "CANCELLED"].includes(lifecycle), stage: "TESTING", stopReason: null, attempt: { current: null, open: false, number: 1, count: 1, limit: 8 }, actions: { spent: 1, limit: 100 }, running: 0, decision: null, approvals: [], createdAt: at(1), updatedAt: at(2), endedAt: null, projectName, checkoutRoot: `/work/${projectName}`, checkoutKnown: true, checkoutPresent: true, ...extra });

// The other projects on the machine: one task testing in the shop, one finished, one blocked in admin.
const OTHERS: TaskRow[] = [
  row("tsk-aaaaaaaaaaaa", "repo-shop", "ecommerce", "PBI-500 Checkout totals", "VERIFYING"),
  row("tsk-bbbbbbbbbbbb", "repo-shop", "ecommerce", "BUG-200 Basket rounding", "COMPLETED", { stage: null, endedAt: at(2) }),
  row("tsk-cccccccccccc", "repo-admin", "admin-ui", "BUG-218 Search crash", "BLOCKED", { stage: "REQUIREMENT", stopReason: "REQUIREMENT_BLOCKED" }),
];

const rowOf = (v: TaskView): TaskRow => ({ id: v.task.id, project: v.task.project, checkout: v.task.checkout, objective: v.task.objective, work: v.task.work, root: v.task.root, snapshot: v.task.snapshot, actor: v.task.actor, revision: v.revision, lifecycle: v.lifecycle, terminal: v.terminal, stage: v.stage, stopReason: v.stopReason, attempt: v.attempt, actions: v.budget.actions, running: v.actions.filter((a) => a.state === "running").length, decision: v.decision ? { observed: v.decision.observed, nextAction: v.decision.nextAction, at: v.decision.at } : null, approvals: v.approvals.filter((a) => a.open).map(({ id, action: act, environment, reason, risk, attempt, requestedAt, expires }) => ({ id, action: act, environment, reason, risk, attempt, requestedAt, expires })), createdAt: v.task.createdAt, updatedAt: v.task.updatedAt, endedAt: v.ended?.at ?? null, projectName: "payments-api", checkoutRoot: "/work/payments-api", checkoutKnown: true, checkoutPresent: true });

const RUNNING: readonly Lifecycle[] = ["PREPARING", "EXECUTING", "VERIFYING"];

function machineOf(view: TaskView | null, others: TaskRow[]): MachineView {
  const tasks = [...(view ? [rowOf(view)] : []), ...others];
  const count = (keep: (r: TaskRow) => boolean) => tasks.filter(keep).length;
  const approvals = tasks.flatMap((r) => r.approvals.map((a) => ({ ...a, task: r.id, objective: r.objective, project: r.project, projectName: r.projectName, checkout: r.checkout, revision: r.revision, lifecycle: r.lifecycle })));
  return { version: 1, at: at(13), since: "2026-10-06T00:00:00.000Z", counts: { projects: new Set(tasks.map((r) => r.project)).size, checkouts: new Set(tasks.map((r) => `${r.project}/${r.checkout}`)).size, tasks: tasks.length, running: count((r) => RUNNING.includes(r.lifecycle)), queued: count((r) => r.lifecycle === "QUEUED"), waitingApproval: count((r) => r.lifecycle === "WAITING_APPROVAL"), blocked: count((r) => r.lifecycle === "BLOCKED"), paused: count((r) => r.lifecycle === "PAUSED"), completedToday: count((r) => r.lifecycle === "COMPLETED"), unreadable: 0 }, tasks, approvals, problems: [] };
}

// A person's decision, applied the way src/task/ops.mjs applies it: one more journal line.
const DECIDE: Record<string, (v: TaskView, approval: string) => TaskView> = {
  approve: (v, id) => ({ ...v, lifecycle: "VERIFYING", stopReason: null, approvals: v.approvals.map((a): Approval => (a.id === id ? { ...a, state: "granted", open: false, decision: "granted", decidedAt: at(13), decidedBy: "person" } : a)) }),
  reject: (v, id) => ({ ...v, lifecycle: "VERIFYING", stopReason: null, approvals: v.approvals.map((a): Approval => (a.id === id ? { ...a, state: "rejected", open: false, decision: "rejected", decidedAt: at(13), decidedBy: "person" } : a)) }),
  pause: (v) => ({ ...v, lifecycle: "PAUSED", paused: { at: at(13), by: "person", because: null } }),
  resume: (v) => ({ ...v, lifecycle: "WAITING_APPROVAL", paused: null }),
  cancel: (v) => ({ ...v, lifecycle: "CANCELLED", terminal: true, stopReason: "CANCELLED_BY_HUMAN", ended: { kind: "cancelled", at: at(13), stop: null, summary: null, because: null, by: "person" }, approvals: v.approvals.map((a): Approval => ({ ...a, open: false })) }),
};

/** Health as the server answers it on a machine that keeps a restriction from before and has one task waiting. */
export function healthView(): HealthView {
  const automation = { area: "automation", level: "ok" as const, title: "Nothing needs a person", say: "Autonomous by default: a task named to /orbit-help is coordinated, and every action is gated by its own class." };
  return {
    version: 1,
    at: "2026-10-17T08:00:00.000Z",
    status: "attention",
    areas: ["automation", "tasks", "resources", "hosts"],
    checks: [
      automation,
      { area: "tasks", level: "attention", title: "1 task(s) wait for a person's approval", say: "Each names what it wants to do, why and the risk.", link: { to: "approvals" } },
      { area: "tasks", level: "attention", title: "Its workflow ended, it did not: PBI-482 — Refund validation", say: "Started by tsk-00000000000a, which is over; a person decides whether to cancel it.", link: { task: { key: M_KEY, checkout: M_CHECKOUT, task: TASK } } },
      { area: "resources", level: "attention", title: "Tool sqlcmd is enabled but not ready", say: "not found on PATH", link: { to: "tools/sqlcmd" } },
      { area: "hosts", level: "ok", title: "Nothing needs a person", say: "Every agentic host has what Orbit can use there." },
    ],
    hosts: [{ id: "claude", name: "Claude Code", agents: true, promptRouter: true, statusLine: "installed" }],
  };
}

export interface MissionState {
  /** What Health answers; a lift on its revision clears the kept restriction. */
  health: HealthView;
  /** A coordinated workflow's plan as the server projects it (0.0.4); null for a task that is no workflow. */
  plan: PlanView | null;
  /** How many times the plan was read. */
  planReads: number;
  /** The revisions each lift named. */
  view: TaskView | null;
  /** Lines of investigations begun against the task's sandbox, as the live feed carries them. */
  qa: LiveEvent[];
  /** Task lines written after the page first read the task, appended to the journal. */
  more: TaskEvent[];
  /** How many times the live feed was read once (`/activity`), and from which cursors. */
  activityReads: string[];
  /** The task's sandbox as the runtime would answer for it; null is a task that asked for none. */
  sandbox: SandboxView | null;
  /** The sandbox read is refused in the server's words (a receipt naming another task's sandbox, say). */
  sandboxRefused: boolean;
  /** Somebody released it elsewhere after the page read it: a release now is a 409. */
  releasedElsewhere: boolean;
  others: TaskRow[];
  /** How many times the machine's view answers 503 before it answers. */
  overviewFailures: number;
  /** Something else wrote a line to the task after the page read it. */
  movedSince: boolean;
}

function decided(state: MissionState, call: Call, kind: string, approval: string): Response {
  const v = state.view;
  if (!v) return reply(404, { error: { code: "TASK_UNKNOWN", message: "no task like that in this checkout" } });
  if (!call.headers[TOKEN_HEADER]) return reply(403, { error: { code: "MUTATION_TOKEN_REQUIRED", message: "a change needs the token in the address Control printed" } });
  if (fieldOf(call.body, "human") !== true) return reply(400, { error: { code: "HUMAN_REQUIRED", message: `${kind} is a person's decision` } });
  if (state.movedSince || fieldOf(call.body, "expectedRevision") !== v.revision) return reply(409, { error: { code: "STALE_REVISION", message: `STALE: the task moved since revision ${String(fieldOf(call.body, "expectedRevision"))}` } });
  const target = v.approvals.find((a) => a.id === approval);
  if (approval && !target) return reply(404, { error: { code: "APPROVAL_UNKNOWN", message: `${approval} is not an approval this task asked for` } });
  if (target && target.state !== "pending") return reply(409, { error: { code: "APPROVAL_DECIDED", message: `${approval} is already ${target.state}` } });
  state.view = { ...DECIDE[kind](v, approval), revision: v.revision + 1 };
  return reply(200, { task: state.view });
}

const TOKENLESS = { error: { code: "MUTATION_TOKEN_REQUIRED", message: "a change needs the token in the address Control printed" } };

// Stop and Release, the way control-server judges them: the token, then a body of `{ human: true }` and
// nothing else, then the sandbox -- and the answer is what the runtime said plus the sandbox as it now stands.
function sandboxOperation(state: MissionState, call: Call, operation: "stop" | "release"): Response {
  if (!call.headers[TOKEN_HEADER]) return reply(403, TOKENLESS);
  const body = isRecord(call.body) ? call.body : null;
  if (body === null || Object.keys(body).some((k) => k !== "human")) return reply(400, { error: { code: "SANDBOX_BODY_INVALID", message: "send { human: true } and nothing else" } });
  if (body.human !== true) return reply(400, { error: { code: "HUMAN_REQUIRED", message: `${operation} is a person's` } });
  const current = state.sandbox;
  if (current === null) return reply(404, { error: { code: "SANDBOX_UNKNOWN", message: "this task has no sandbox" } });
  if (operation === "release" && (state.releasedElsewhere || current.state === "RELEASED")) return reply(409, { error: { code: "SANDBOX_RELEASED", message: `${current.environment} was released already` } });
  const stopped = current.components.map((c) => ({ ...c, state: "STOPPED", readiness: null, endpoint: null }));
  state.sandbox = operation === "stop" ? { ...current, components: stopped, ownership: { ...current.ownership, processes: 0, containers: 0 } } : { ...current, state: "RELEASED", components: stopped, leases: [], ownership: { processes: 0, containers: 0, external: 0 } };
  const result = operation === "stop" ? { stopped: current.components.map((c) => ({ component: c.component, how: "SIGTERM" })), gone: [], refused: [] } : { released: true, environment: current.environment, leases: current.leases.map((l) => l.port), containers: [] };
  return reply(200, { result, sandbox: state.sandbox });
}

function sandboxLogs(state: MissionState, path: string): Response {
  const [route = "", query = ""] = path.split("?");
  const session = decodeURIComponent(route.split("/").at(-1) ?? "");
  if (!state.sandbox?.components.some((c) => c.session === session)) return reply(404, { error: { code: "SESSION_UNKNOWN", message: `${session} is not a session of this sandbox` } });
  const params = new URLSearchParams(query);
  const stream: LogStream = params.get("stream") === "err" ? "err" : "out";
  const from = params.get("from");
  if (from !== null) return reply(200, logPage(session, stream, Number(from)));
  return reply(200, { session, stream, lines: LOG_LINES[stream], truncated: false, bytes: LOG_LINES[stream].join("\n").length });
}

// A log read from a byte offset, as the runtime answers it: whole lines only, and where the next read starts.
export function logPage(session: string, stream: LogStream, from: number) {
  const text = `${LOG_LINES[stream].join("\n")}\n`;
  const lines = text.slice(from).split("\n").filter((l) => l.length > 0);
  return { session, stream, from, next: text.length, size: text.length, lines, truncated: false, bytes: text.length - from };
}

/** The task's lines and its QA lines, as the live feed carries them. */
export function liveEvents(state: Pick<MissionState, "qa" | "more">): LiveEvent[] {
  return [...[...pbi482Events(), ...state.more].map((e) => ({ ...e, source: "task" })), ...state.qa];
}

const cursorOf = (events: LiveEvent[]) => {
  const task = events.filter((e) => e.source === "task").length;
  const inv = [...new Set(events.filter((e) => e.source !== "task").map((e) => e.source))].map((id) => `${id}=${events.filter((e) => e.source === id).length}`);
  return [`t=${task}`, ...inv].join(";");
};

// The cursor grammar the server keeps: t=<next task line>;<inv-id>=<next line of it>.
function after(cursor: string, events: LiveEvent[]): LiveEvent[] {
  const parts = new Map(cursor.split(";").map((p) => p.split("=")).map(([k = "", v = "0"]) => [k, Number(v)]));
  return events.filter((e) => e.n >= (parts.get(e.source === "task" ? "t" : e.source) ?? 0));
}

function activity(state: MissionState, path: string): Response {
  if (!state.view) return reply(404, { error: { code: "TASK_UNKNOWN", message: "no task like that in this checkout" } });
  const since = new URLSearchParams(path.split("?")[1] ?? "").get("since") ?? "t=0";
  state.activityReads.push(since);
  const all = liveEvents(state);
  return reply(200, { version: 1, task: TASK, cursor: cursorOf(all), terminal: state.view.terminal, view: state.view, events: after(since, all) });
}

function sandboxRead(state: MissionState): Response {
  if (state.sandboxRefused) return reply(409, { error: { code: "SANDBOX_OWNER_MISMATCH", message: `${SANDBOX_ENV} is not ${TASK}'s sandbox: it belongs to another task` } });
  return reply(200, state.sandbox ? { sandbox: state.sandbox } : { sandbox: null, because: "this task has not asked for a sandbox: the agent's prepare-sandbox makes one, and Control starts nothing" });
}

// A lift on the revision Health showed clears the restriction; any other is a 409, as the server's is.

export function fakeMission(over: Partial<MissionState> = {}) {
  const state: MissionState = { health: healthView(), plan: null, planReads: 0, view: pbi482View(), qa: [], more: [], activityReads: [], sandbox: sandboxView(), sandboxRefused: false, releasedElsewhere: false, others: OTHERS, overviewFailures: 0, movedSince: false, ...over };
  const handle = (call: Call): Response | null => {
    if (call.path === "/api/v1/mission-control") return state.overviewFailures-- > 0 ? reply(503, { error: { code: "UNAVAILABLE", message: "the store could not be read just now" } }) : reply(200, machineOf(state.view, state.others));
    if (call.path === "/api/v1/mission-control/approvals") return reply(200, { version: 1, approvals: machineOf(state.view, state.others).approvals });
    if (call.path === "/api/v1/mission-control/health") return reply(200, state.health);
    if (call.path === TASK_API && call.method === "GET") return state.view ? reply(200, { task: state.view }) : reply(404, { error: { code: "TASK_UNKNOWN", message: "no task like that in this checkout" } });
    if (call.path === `${TASK_API}/sandbox` && call.method === "GET") return sandboxRead(state);
    if (call.path.startsWith(`${TASK_API}/sandbox/logs/`) && call.method === "GET") return sandboxLogs(state, call.path);
    if ((call.path === `${TASK_API}/sandbox/stop` || call.path === `${TASK_API}/sandbox/release`) && call.method === "POST") return sandboxOperation(state, call, call.path.endsWith("/stop") ? "stop" : "release");
    if (call.path.startsWith(`${TASK_API}/activity`) && call.method === "GET") return activity(state, call.path);
    if (call.path === `${TASK_API}/plan` && call.method === "GET") return (state.planReads++, reply(200, { task: TASK, revision: state.view?.revision ?? null, terminal: state.view?.terminal ?? false, plan: state.plan }));
    if (call.path === `${TASK_API}/events`) return reply(200, { version: 1, task: TASK, revision: state.view?.revision ?? 0, since: 0, events: pbi482Events() });
    const decision = /^\/api\/v1\/projects\/[^/]+\/checkouts\/[^/]+\/tasks\/[^/]+\/(?:approvals\/([^/]+)\/)?(approve|reject|pause|resume|cancel)$/.exec(call.path);
    return decision && call.method === "POST" ? decided(state, call, decision[2], decision[1] ?? "") : null;
  };
  return { handle, state };
}

/** A declared playbook's run as the server projects it (0.0.4): its evidence read through a project capability and
 * answered within its contract, its notes asked through a managed server -- REPORTED, never VERIFIED, for nothing an
 * owner keeps proved either. */
export function workflowPlan(): PlanView {
  const step = (id: string, capability: string, tool: string | null, provider: string, n: number) => ({ id, capability, tool, required: true, evidence: "report", approval: "none", word: "CONTRACT_MET", because: "answered, and its output contract held — reported, not proven", provider, action: `act-${n + 2}`, startedAt: at(20 + n), endedAt: at(20 + n), calls: 1, retries: 0, waiting: null, verification: null, receipt: `skillstep:srun-0123456789ab.${id}`, invocation: `invocation:srun-0123456789ab.${id}.${n}` });
  return {
    ref: "0123456789abcdef", n: 1, workflow: "playbook", readable: true, goal: { goal: "goal-0123456789ab", unit: "gu-11111111" },
    steps: [
      { id: "context", kind: "context", after: [], for: null, because: "what the project already knows is read first", state: "REPORTED", summary: null, at: at(18) },
      { id: "playbook", kind: "playbook", after: ["context"], for: "release.readiness.verification", because: "the objective needs release.readiness.verification", state: "REPORTED", summary: null, at: at(22) },
    ],
    progress: { done: 2, verified: 0, reported: 2, total: 2 },
    replans: [],
    runs: [{ run: "srun-0123456789ab", pin: "release-readiness-verification:0.1.0:7c195e58", step: "playbook", word: "REPORTED", state: "REPORTED", unread: false, calls: 2, at: at(22), summary: null, steps: [step("evidence", "release.evidence.read", null, "acme:acme.evidence", 1), step("notes", "release.notes.search", "search", "managed:corp", 2)] }],
  };
}
