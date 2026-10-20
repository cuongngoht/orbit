// The orchestrator's whole world, for a test: the REAL task write door on a temp store (the task
// harness, with no door -- a terminal's, never Control's), the REAL check runner over the fake
// Process port, and small fakes for every other owner the orchestrator asks: requirements, work,
// runtime, the workspace, project context, capabilities and investigations.
//
// What a scenario varies is data: which commands the checkout declares, what each check run prints
// and exits with (`script`), what the workspace holds (`edit`), what the requirement says now
// (`requirement`), which capabilities exist. Nothing here spawns, sleeps or touches the network.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { short } from "../../src/hash.mjs";
import { ADAPTERS } from "../../skills/orbit-engineer/observers/index.mjs";
import { createObservation } from "../../src/orchestration/activity/observe.mjs";
import { LIMITS as ACTIVITY_LIMITS } from "../../src/orchestration/activity/vocab.mjs";
import { createCheckRunner } from "../../src/orchestration/checks.mjs";
import { createTasks, JOURNAL } from "../../src/task/store.mjs";
import { taskView } from "../../src/task/views.mjs";
import { fakeIo } from "./io.mjs";
import { fingerprintOf } from "../../src/task/approvals.mjs";
import { loadTask } from "../../src/task/load.mjs";
import { apply, createTask } from "../../src/task/ops.mjs";
import { eventsView } from "../../src/task/views.mjs";
import { start, step } from "../../src/orchestration/loop.mjs";
import { fakeProcess } from "./process.mjs";
import { CHECKOUT, START, taskWorld } from "../task.harness.mjs";

export const BASE = "0123456789abcdef0123456789abcdef01234567";
export const BUILD = "rt-command-0000b01d";
export const TEST = "rt-command-0000a7e5";
export const TEST_API = "rt-command-0000a7e6";

export const DECLARED = [
  { id: BUILD, purpose: "build", component: "node:.", declaredAs: "build", argv: ["npm", "run", "build"], cwd: "." },
  { id: TEST, purpose: "test", component: "node:.", declaredAs: "test", argv: ["npm", "run", "test"], cwd: "." },
];

export const SNAPSHOT = { id: "rs-0123456789ab", digest: "a".repeat(64), clarity: "complete", authority: "accepted" };
export const ROOT = "req-0123456789ab";
export const WORK = "w-0123456789ab";

// ---- a check run, as the Process port would answer it ----------------------------------------

export const passes = (out = "ok") => ({ ok: true, out, err: "", status: 0 });
export const fails = (out, status = 1) => ({ ok: false, out, err: "", error: out.split("\n")[0], status });
export const unstarted = () => ({ ok: false, out: "", error: "npm could not be started — ENOENT", unstarted: true });

// `script[purpose]` is a queue of answers; the last one repeats.
function scripted(script) {
  return (args) => {
    const queue = script[args[1]] ?? [passes()];
    return queue.length > 1 ? queue.shift() : queue[0];
  };
}

// ---- a workspace: real directory, files as versions, trees as snapshots ---------------------

// A tree id is hex, like git's: the journal holds one (a receipt's `sourceTree`), and a path in it
// would be refused. `c0de` + the snapshot's number, so a test can read which snapshot it names.
const treeId = (i) => `c0de${String(i).padStart(36, "0")}`;

const sameFiles = (a, b) => a.size === b.size && [...a].every(([k, v]) => b.get(k) === v);

function fakeWorkspace(dir) {
  const state = { prepared: new Set(), files: new Map(), trees: [new Map()], removed: [] };
  const snapshotOf = (from) => (from === BASE ? state.trees[0] : state.trees[Number(String(from).slice(4))] ?? state.trees[0]);
  const rowsAgainst = (from) => [...new Set([...snapshotOf(from).keys(), ...state.files.keys()])].filter((p) => snapshotOf(from).get(p) !== state.files.get(p)).sort().map((path) => rowOf(path, snapshotOf(from), state.files));
  // A tree is named by its CONTENT, as git names one: the first snapshot that holds exactly these files.
  const contentId = () => treeId(state.trees.findIndex((t) => sameFiles(t, state.files)));
  const changes = (task, from) => {
    state.trees.push(new Map(state.files));
    return { rows: rowsAgainst(from), tree: contentId() };
  };
  // The tree the workspace holds NOW: the snapshot it equals when one was taken, else a tree nobody
  // recorded (`dirty`) -- what git would name for a working tree edited since the last read-back.
  const treeOf = () => ((at) => (at >= 0 ? treeId(at) : short(JSON.stringify([...state.files.entries()].sort()), 40)))(state.trees.findIndex((t) => sameFiles(t, state.files)));
  return {
    state,
    edit: (path, version = (state.files.get(path) ?? 0) + 1) => ((state.writes = (state.writes ?? 0) + 1), state.files.set(path, version)),
    found: (task) => (state.prepared.has(task) ? { id: `ws-${task.slice(4)}`, path: dir, baseRevision: BASE, reused: true } : null),
    prepare: (head) => (state.prepared.add(head.task), { id: `ws-${head.task.slice(4)}`, path: dir, baseRevision: head.baseRevision, reused: false }),
    changes,
    treeOf,
    treeAt: (task, revision) => (revision === BASE ? treeId(0) : null),
    stateOf: (task) => ({ tree: treeOf(task), ignored: state.ignored ?? 0, stamp: state.writes ?? 0 }),
    remove: (head) => (state.removed.push(head.task), { id: `ws-${head.task.slice(4)}`, removed: true }),
  };
}

function rowOf(path, before, now) {
  const was = before.get(path);
  const is = now.get(path);
  if (was === undefined) return { path, change: "added", added: 3, removed: 0 };
  return is === undefined ? { path, change: "deleted", added: 0, removed: 3 } : { path, change: "modified", added: 1, removed: 1 };
}

// ---- a sandbox: runtime's answers for ONE task, over the workspace it holds --------------------------

// What the orchestrator's `ports.sandbox` is, as runtime answers it (docs/plans/release-1.7.9-task-
// sandbox-runtime.md, section 5). `trust: false` is a sandbox a person has not trusted yet: prepare and
// start answer BLOCKED as DATA, needing a person. `startable` is what the checkout declares it could
// run (empty: a library). `exitsNext` makes the next start's application stop by itself.
// Controls a test turns: `state.trusted`, `state.exitsNext = { status, lines }`, `state.startable`.
export function fakeSandbox(ws, opts = {}) {
  const state = { trusted: opts.trust !== false, startable: opts.startable ?? [], prepared: null, sessions: [], exitsNext: null, released: false, calls: [], policy: opts.policy ?? { modes: ["observe"] } };
  const now = opts.now ?? (() => new Date().toISOString());
  const envOf = (task) => `env-${task.slice("tsk-".length)}`;
  const note = (op, task, extra = {}) => state.calls.push({ op, task, ...extra });
  const running = () => state.sessions.filter((x) => x.state === "RUNNING");
  const blockedFor = (task) => ({ environment: envOf(task), tree: ws.treeOf(task), blocked: { needs: "person", because: "this sandbox is not trusted yet: a person trusts it in Orbit Control" } });
  const sessionOf = (component) => ({ id: `rs-${(0xb0 + state.sessions.length).toString(16).padStart(12, "0")}`, component, state: "RUNNING", requestedAt: now() });
  const stop = (rows, to) => rows.map((x) => Object.assign(x, { state: to }));
  const prepareAt = (task) => {
    const tree = ws.treeOf(task);
    const reused = state.prepared?.tree === tree;
    state.prepared = { tree };
    return { environment: envOf(task), state: "READY", tree, reused, placements: {}, endpoints: [], blocked: null };
  };
  return {
    state,
    calls: state.calls,
    startable: () => state.startable,
    prepare: async ({ task }) => (note("prepare", task), state.trusted ? prepareAt(task) : { ...blockedFor(task), state: "BLOCKED", reused: false, placements: {}, endpoints: [] }),
    start: async ({ task, component }) => {
      note("start", task, { component });
      if (!state.trusted) return { ...blockedFor(task), blocked: [{ component: component ?? state.startable[0], needs: "person", because: "this sandbox is not trusted yet: a person trusts it in Orbit Control" }], started: [], reused: [], replaced: [], exited: [], notReady: [], skipped: [], endpoints: [] };
      const stale = state.prepared !== null && state.prepared.tree !== ws.treeOf(task);
      const replaced = stale ? stop(running(), "STOPPED").map((x) => ({ component: x.component, session: x.id })) : [];
      const at = prepareAt(task);
      const wanted = component ?? state.startable[0];
      const held = running().find((x) => x.component === wanted);
      if (held) return { environment: at.environment, tree: at.tree, started: [], reused: [{ component: wanted, session: held.id }], replaced, exited: [], blocked: [], notReady: [], skipped: [], endpoints: [] };
      const session = sessionOf(wanted);
      state.sessions.push(session);
      const gone = state.exitsNext;
      state.exitsNext = null;
      if (gone) stop([session], "LOST");
      return { environment: at.environment, tree: at.tree, started: [{ component: wanted, session: session.id, executionProvider: "native", requestedAt: session.requestedAt }], reused: [], replaced, exited: gone ? [{ component: wanted, session: session.id, status: gone.status, lines: gone.lines }] : [], blocked: [], notReady: [], skipped: [], endpoints: [{ component: wanted, kind: "http", port: 5173, source: "lease", url: "http://127.0.0.1:5173/" }] };
    },
    status: async ({ task }) => (note("status", task), { environment: envOf(task), owner: { kind: "task", id: task }, state: state.released ? "RELEASED" : state.prepared ? "READY" : "ALLOCATED", tree: state.prepared?.tree ?? null, currentTree: ws.treeOf(task), stale: state.prepared !== null && state.prepared.tree !== ws.treeOf(task), components: state.sessions.map((x) => ({ component: x.component, execution: "native", session: x.id, requestedAt: x.requestedAt, state: x.state, readiness: "process", endpoint: null })), leases: [], connectivity: [], dataIsolation: { state: "unknown", because: "no target says" }, qa: { ...state.policy, entry: null, browser: null } }),
    stop: async ({ task }) => (note("stop", task), { stopped: stop(running(), "STOPPED").map((x) => ({ session: x.id })), gone: [], refused: [] }),
    release: async ({ task }) => (note("release", task), (state.released = true), { released: true, environment: envOf(task), leases: [], containers: [] }),
    sessions: async ({ task }) => (note("sessions", task), state.sessions.map((x) => ({ ...x }))),
  };
}

// ---- the component graph runtime understanding would hand over ----------------------------------------

// One component per component key the declared checks name, living where its checks run; `dependsOn`
// adds edges ({ "node:api": ["node:."] }). A scenario that needs more passes `graph` whole, or null for none.
export const graphOf = (declared, dependsOn = {}) => ({ components: [...new Map(declared.map((c) => [c.component, { key: c.component, dir: c.cwd ?? ".", kind: "library", live: null, dependsOn: dependsOn[c.component] ?? [], inherits: [], unresolved: [] }])).values()] });

// ---- the requirement and the work ---------------------------------------------------------------

function fakeRequirements(state) {
  return {
    resolve: (ref) => ({ root: ROOT, identity: { id: ref, provider: "tracker" } }),
    latest: () => state.latest,
    look: () => ({ snapshot: state.snapshot, latest: state.latest, status: { open: state.open, sources: state.sources }, work: { snapshot: state.workSnapshot } }),
  };
}

const fakeWork = (state) => ({ ensure: () => ({ work: WORK, snapshot: state.workSnapshot }), objectiveOf: () => "PBI-482 Refund validation", find: (ref) => (["PBI-482", WORK, ROOT].includes(ref) ? WORK : null) });

// ---- the rooms ------------------------------------------------------------------------------------

function roomIn(rooms, id) {
  if (!rooms.has(id)) rooms.set(id, { json: new Map(), logs: new Map() });
  const r = rooms.get(id);
  return { read: (name) => (r.json.has(name) ? structuredClone(r.json.get(name)) : null), write: (name, value) => r.json.set(name, structuredClone(value)), remove: (name) => r.json.delete(name), log: (ref) => r.logs.get(ref) ?? null, keep: (ref, text) => r.logs.set(ref, text), raw: r };
}

// ---- the task room, in memory ---------------------------------------------------------------------

// The task store needs a listing of the task DIRECTORIES; the in-memory io lists files only.
// Both sides resolved first: on Windows one is `\store\…` and the other `C:\store\…`.
const slashed = (p) => resolve(String(p)).replace(/\\/g, "/");
const children = (io, p) => ((at) => [...new Set([...io.files.keys(), ...io.dirs].map(slashed).filter((f) => f.startsWith(`${at}/`)).map((f) => f.slice(at.length + 1).split("/")[0]))])(slashed(p));

// The task harness's world (test/task.harness.mjs), with the journal in memory: the real write door,
// rules and fold, and none of a disk's cost -- a whole loop is hundreds of locked appends.
function memoryTasks(opts) {
  const clock = { at: Date.parse(opts.start ?? START) };
  const now = () => new Date(clock.at).toISOString();
  const io = opts.io ?? ((base) => Object.assign(base, { list: (p) => children(base, p) }))(fakeIo({ host: "laptop-a", now, backoff: [1, 1, 1] }));
  const tasks = createTasks("/store/repo-a", io);
  const ctx = { tasks, project: "repo-a", checkout: CHECKOUT, session: null, door: null, now };
  return { io, tasks, ctx, clock, now, tick: (minutes = 1) => { clock.at += minutes * 60000; }, view: (id) => taskView(loadTask(ctx, id).model, now()), text: (id) => io.read(join(tasks.dirOf(id), JOURNAL)), kinds: (id) => tasks.read(id).map((l) => l.kind) };
}

// ---- the world ------------------------------------------------------------------------------------

// opts.again: another world's { w, dir, rooms, ws } -- a second PROCESS over the same store, rooms
// and workspace, holding nothing of the first one's memory. opts.at: { dir, project, checkout } -- a
// project's own store root, for a test that reads the task back through Orbit Control.
export function orchestrationWorld(t, opts = {}) {
  const w = opts.at ? taskWorld(t, { door: null, ...opts.at }) : memoryTasks(opts.again ? { io: opts.again.w.io, start: opts.again.w.now() } : {});
  const dir = opts.again?.dir ?? mkdtempSync(join(tmpdir(), "orbit-ws-"));
  if (!opts.again) t.after(() => rmSync(dir, { recursive: true, force: true }));
  const requirement = { snapshot: SNAPSHOT, latest: SNAPSHOT, open: [], sources: [], workSnapshot: SNAPSHOT.id, ...opts.requirement };
  const script = opts.script ?? {};
  const process = fakeProcess({ npm: scripted(script) });
  const rooms = opts.again?.rooms ?? new Map();
  const ws = opts.again?.ws ?? fakeWorkspace(dir);
  const calls = { context: 0, invoked: [], started: [], stopped: [] };
  const box = fakeSandbox(ws, { now: w.now, ...opts.sandbox });
  const capabilities = opts.capabilities ?? {};
  const investigations = new Map(Object.entries(opts.investigations ?? {}));
  const runtime = opts.runtime ?? { readiness: async () => ({ understanding: "CURRENT", components: [{ key: "node:.", state: "not-startable", provider: "native", because: "a library", blocking: [] }], checks: opts.declared ?? DECLARED, unsafeTests: false }), start: async (a) => (calls.started.push(a), { started: [{ component: a.component ?? "node:.", session: "rs-0000000000aa" }], skipped: [], blocked: [] }), stop: async (a) => (calls.stopped.push(a), { stopped: [{ session: a.session }], gone: [], refused: [] }), sessions: async () => [] };
  const roomOf = (id) => roomIn(rooms, id);
  const activity = new Map();
  const ports = {
    task: { create: (g) => createTask(w.ctx, { project: w.ctx.project, checkout: w.ctx.checkout, ...g }), apply: (id, op, g) => apply(w.ctx, id, op, g), view: (id) => w.view(id), events: (id) => eventsView(loadTask(w.ctx, id).model).events, list: () => w.tasks.list(), fingerprint: (g) => fingerprintOf(g) },
    requirements: fakeRequirements(requirement),
    work: fakeWork(requirement),
    runtime,
    sandbox: box,
    workspace: ws,
    base: { head: () => BASE, dirty: () => false },
    checks: { declared: () => opts.declared ?? DECLARED, graph: () => (opts.graph === undefined ? graphOf(opts.declared ?? DECLARED, opts.dependsOn) : opts.graph), run: (command, at) => createCheckRunner({ process, env: { PATH: "/bin", HOME: "/home/x", API_TOKEN: "s3cr3t-value" }, envNamesOf: () => opts.envNames ?? [], clock: () => w.clock.at, keep: (where, text) => roomOf(where.task).keep(where.ref, text), observer: opts.observe ? observerOf(activity, w, opts) : undefined }).run(command, at) },
    context: { gather: async (text) => (calls.context++, { sections: [{ id: "architecture", title: "ARCHITECTURE", known: true, lines: [`for: ${text.slice(0, 40)}`] }], ...(opts.contextStatus ? { status: opts.contextStatus } : {}) }) },
    capabilities: { describe: (id) => capabilities[id] ?? null, invoke: async (id, input, o) => (calls.invoked.push({ id, input, approved: o.approved }), { written: 1 }) },
    investigations: { outcome: (id) => investigations.get(id) ?? null },
    roomOf,
    lock: (id, fn) => fn(),
    liveness: opts.liveness ?? (() => false),
    now: w.now,
    host: "laptop-a",
    pid: 4242,
    pidStartedAt: () => "2026-10-06T21:00:00.000Z",
    actor: "claude-code",
    readDecision: () => "{}",
    where: () => ({ orchestration: "/store/orchestration", workspaces: "/store/workspaces" }),
  };
  return { w, ports, process, ws, box, dir, rooms, calls, requirement, investigations, roomOf, activity, activityLines: (action) => (activity.get(action) ?? "").split("\n").filter(Boolean).map((l) => JSON.parse(l)) };
}

// `opts.observe`: each check run is OBSERVED (src/orchestration/activity/, 1.8.5), its lines kept in memory by action
// id, as cli/autonomous-engineering.mjs keeps them in the task's room. `opts.observe.throws` makes the observer
// factory itself fail, as a store that cannot be read would.
function observerOf(activity, w, opts) {
  return (command, at) => {
    if (opts.observe.throws) throw new Error("the observer could not be made");
    return createObservation({ identity: { task: at.task, action: at.action, attempt: at.attempt ?? null, check: at.ref }, command, why: at.why, adapters: ADAPTERS, sink: { append: (text) => activity.set(at.action, (activity.get(at.action) ?? "") + text) }, clock: () => w.clock.at, budget: ACTIVITY_LIMITS.ACTION_BYTES });
  };
}

// A decision on the task as it stands NOW.
export const decided = (ports, id, action, extra = {}) => ({ schemaVersion: 1, expectedRevision: ports.task.view(id).revision, action, observed: "the context says what the stage allows", hypothesis: "this is the next step the evidence supports", ...extra });

export const kindsOf = (w, id) => w.kinds(id);

export const stagesOf = (w, id) => w.tasks.read(id).filter((l) => l.kind === "stage").map((l) => l.stage);

// ---- the way a scenario gets where it is going ----------------------------------------------------

export const FAILING = fails("FAIL RefundTests.rejects_amount_over_paid\nExpected: false Received: true\n1 failed");

export const PLAN = { kind: "plan", intent: "reject a refund whose amount exceeds what was paid", scope: ["src/RefundValidator.cs", "test/RefundTests.cs"] };

// Started, and through CONTEXT, ENVIRONMENT and WORKSPACE.
export async function prepared(o, spec = { ref: "PBI-482" }) {
  const id = (await start(o.ports, spec)).task;
  const go = (action, extra) => step(o.ports, id, decided(o.ports, id, action, extra));
  for (const action of [{ kind: "gather-context" }, { kind: "check-environment" }, { kind: "prepare-workspace" }]) await go(action);
  return { id, go };
}

export async function changed(o, go, path = "src/RefundValidator.cs") {
  await go({ kind: "implement" });
  o.ws.edit(path);
  return go({ kind: "record-changes" });
}

// Planned, changed and built: in TESTING.
export async function testing(o, spec) {
  const at = await prepared(o, spec);
  await at.go(PLAN);
  await changed(o, at.go);
  await at.go({ kind: "check", command: BUILD });
  return at;
}
