#!/usr/bin/env node
// AUTONOMOUS ENGINEERING: a requirement (or an objective) taken to a verified change, one decided
// step at a time, inside Orbit's governance -- and every step recorded in a TASK that Mission
// Control reads. The host's model reasons; this engine keeps the state, the gates, the evidence
// and the reasons to stop. Autonomous by default (0.2.0): it commits a verified change in the task's own
// workspace on its own, and pushes that exact commit only once a person approved exactly that push in Orbit
// Control (a protected boundary, src/protected/). It never merges, grants an approval or runs a shell.
//
//   node autonomous-engineering.mjs start --ref=<item|req-…|rs-…|w-…> [--objective="…"]
//                                          [--attempts=8 --actions=100 --minutes=<n>]
//                                          the requirement's newest snapshot, its work, a task on
//                                          them (or the one already running), the requirement read
//                                          back. Run it, and every command below, from YOUR checkout
//   node autonomous-engineering.mjs start "<objective>" [--attempts= --actions= --minutes=] [--parent=<tsk-…>]
//                                          an ad-hoc change: no requirement, starts at CONTEXT. Either start
//                                          takes --parent: the coordinated workflow that started it
//                                          (automation.mjs passes it), recorded as a link and deciding nothing
//   node autonomous-engineering.mjs context <task>
//                                          where it stands and what may come next: stage, attempt,
//                                          budget, the workspace's path, the latest failure, the
//                                          declared checks, what completion still needs. Writes nothing
//   node autonomous-engineering.mjs resume <ref|task>
//                                          the running task for a work item or a task id, from the
//                                          store alone. It never un-pauses: a person resumes, in Control
//   node autonomous-engineering.mjs step <task> [--decision=<file>]
//                                          ONE decided action -- the decision on stdin, or in the file:
//                                          judged, recorded before it runs, run, settled
//   node autonomous-engineering.mjs reconcile <task>
//                                          an action whose step died before it settled: read back,
//                                          or closed as interrupted -- never run again by itself
//   node autonomous-engineering.mjs finish <task> [--stop=<REASON> --because="…"]
//                                          completed when every completion row holds; otherwise
//                                          ended with a stop the journal supports, or refused
//   node autonomous-engineering.mjs cleanup <task>
//                                          an ended task: runtime asked to stop each session it
//                                          started (and its sandbox's, once), under runtime's own
//                                          ownership rules, and the sandbox released
//   node autonomous-engineering.mjs remove-workspace <task>
//                                          an ended task's workspace, removed when it is provably its own
//   node autonomous-engineering.mjs log <task> <chk-n|sbx-n>
//                                          what one check printed, or what an application a sandbox
//                                          started printed before it stopped; bounded and scrubbed
//   node autonomous-engineering.mjs protocol
//                                          the decision's shape and every action, as the tables say
//   node autonomous-engineering.mjs where  where the orchestration rooms and workspaces are kept
//
// Every command takes --json. A task is this checkout's: run from inside its workspace, a command
// finds no task (a workspace is a second checkout to every subject) and says so.
//
// This file is the one COMPOSITION ROOT for orchestration: the task's write door, requirements,
// work, runtime, the workspace's git, the check runner, project context, capabilities and
// investigations are bound here and handed to src/orchestration/ as ports, which reads no
// environment, spawns nothing and imports none of them. The task context it builds has no door,
// so a person's grant can never be written from here.
//
// A command that ENDED a task (a step that completed it, a finish) then hands the task's view to
// engineering memory (1.8.9, src/engineering/observe/task.mjs): a completed task's changed scopes
// and the declared checks that passed after its last change, through the observer's untrusted
// door, once -- and links one `learning` receipt saying what it taught, or why nothing. It never
// changes how the command answered.
//
// Exit 0 = done (a task that stopped for a reason is a state) · 2 = REFUSED (bad usage, a decision
// the protocol refuses, a rule that said no) · 3 = BLOCKED (a lock held, a machine that could not
// answer). Never 1.
import { readFileSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { drainLater, hostFlags, protocolTwo } from "../skills/orbit-learn/hosts/drain.mjs";
import { requirementWorld } from "../skills/orbit-requirements/bind.mjs";
import { createArchitecture } from "../src/architecture/store.mjs";
import { engineeringContext } from "../src/engineering/context.mjs";
import { learnedFrom } from "../src/engineering/observe/task.mjs";
import { bindRuntime, bindSandbox } from "../skills/orbit-runtime/bind.mjs";
import { invokeCapability } from "../src/capability/invoke.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { createLocalClones } from "../src/frontend/local-clones.mjs";
import { short } from "../src/hash.mjs";
import { taskSessionMark } from "../src/memory/session.mjs";
import { modelOf as investigationModel } from "../src/investigation/model.mjs";
import { createInvestigations } from "../src/investigation/store.mjs";
import { OUTCOMES } from "../src/investigation/vocab.mjs";
import { ADAPTERS } from "../skills/orbit-engineer/observers/index.mjs";
import { createObservation } from "../src/orchestration/activity/observe.mjs";
import { activityFile } from "../src/orchestration/activity/source.mjs";
import { LIMITS as ACTIVITY_LIMITS } from "../src/orchestration/activity/vocab.mjs";
import { createCheckRunner, checksOf, unsafeTestsOf } from "../src/orchestration/checks.mjs";
import { COMMANDS } from "../src/orchestration/index.mjs";
import { flag } from "../src/learn/args.mjs";
import { createWorkspaces } from "../src/orchestration/workspace.mjs";
import { printable } from "../src/printable.mjs";
import { createProcess } from "../src/process/index.mjs";
import { within } from "../src/project/boundary.mjs";
import { command } from "../src/project/command.mjs";
import { componentOn } from "../src/project/components.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { switchOf } from "../src/project/env.mjs";
import { requirementsContext } from "../src/requirements/context.mjs";
import { status as requirementStatus } from "../src/requirements/views/status.mjs";
import { createContext } from "../src/run/context.mjs";
import { runtimeProject } from "../src/runtime/context.mjs";
import { COMMANDS as RUNTIME } from "../src/runtime/index.mjs";
import { look } from "../src/runtime/understanding.mjs";
import { liveOf } from "../src/runtime/vocab.mjs";
import { scrub } from "../src/scrub.mjs";
import { sourcesContext } from "../src/sources/context.mjs";
import { writeAtomic } from "../src/store/atomic.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { machineContext } from "../src/store/context.mjs";
import { realIo } from "../src/store/io.mjs";
import { withLock } from "../src/store/lock.mjs";
import { fingerprintOf } from "../src/task/approvals.mjs";
import { loadTask } from "../src/task/load.mjs";
import { apply, createTask } from "../src/task/ops.mjs";
import { createTasks } from "../src/task/store.mjs";
import { eventsView, taskView } from "../src/task/views.mjs";
import { createEmitter } from "../src/trace/emit.mjs";
import { traceLog } from "../src/trace/log.mjs";
import { findWork, startWork } from "../src/work/actions.mjs";
import { latestIn, requirementOf, snapshotIn } from "../src/work/requirement.mjs";
import { standing } from "../src/work/resume.mjs";
import { createWorks, rootOf, workOf } from "../src/work/store.mjs";
import { attach, attached, attachedLine } from "../src/work/track/auto.mjs";
import { hostFrom } from "../src/work/track/coverage.mjs";

const ENV = commandEnvironment(process.env, process.argv);
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);

// The coordinated workflow that started this task, when `start` was told one (`--parent`, which automation.mjs passes):
// bound into the task's first line here, at the composition root, as a link back that decides nothing. Its shape is
// the task field's (src/task/fields.mjs), refused there like any other.
const lineage = () => (cmd === "start" && flag(args, "parent") ? { parent: flag(args, "parent") } : {});

const CONTEXT_TIMEOUT_MS = 15 * 60000;
const BUSY = "another session is taking a step on this task — try again in a moment";

// What a terminal may run when the skill is switched off: reading only.
const READS = ["context", "resume", "log", "protocol", "where"];

async function main() {
  const entry = Object.hasOwn(COMMANDS, cmd ?? "") ? COMMANDS[cmd] : null;
  if (!entry) return help();
  switchedOn(entry);
  const result = await entry.run(await portsFor(entry), args);
  printed(entry, cmd === "start" ? tracked(result) : result);
}

// A task that starts beside the session's tracked work joins it (src/work/track/auto.mjs); no work, nothing happens, and a
// failure to track is a warning that never touches the task.
function tracked(result) {
  const tracking = result?.task && BOUND.track ? attached(() => attach({ ...BOUND.track, now: () => new Date().toISOString(), session: session(), host: hostFrom(ENV) }, { task: result.task, what: "task", because: "an engineering task was started" })) : null;
  return tracking ? { ...result, tracking } : result;
}

// A step may ask a capability, so the project's registered ones are loaded before it is judged.
async function portsFor(entry) {
  if (entry.needs === "nothing") return {};
  const ports = portsHere();
  if (cmd === "step") await ports.prepare();
  return ports;
}

function switchedOn() {
  if (READS.includes(cmd) || componentOn({ kind: "skill", name: "orbit-engineering-agent" }, process.env, "orbit")) return;
  throw new Refused("orbit-engineering-agent is switched off (skill_autonomous_engineering, or ORBIT_SKILL_AUTONOMOUS_ENGINEERING) — it reads, and takes no step");
}

function printed(entry, result) {
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : printable([entry.say(result), attachedLine(result.tracking)].filter(Boolean).join("\n")));
  emitted(result);
  learnedAfter(result);
}

// ---- what a finished task teaches (1.8.9) --------------------------------------------------------

// Once per task: a second finish finds the task's `learning` receipt and leaves it. Fail-open, and a protocol-2
// session's queued checkpoints are drained beside it (skills/orbit-learn/hosts/drain.mjs).
function learnedAfter(result) {
  const event = Object.hasOwn(EVENTS, cmd) ? EVENTS[cmd](result) : null;
  if (event?.[0] !== "task.finished") return;
  quietly(() => taught(event[1].task));
  if (protocolTwo(ENV, process.argv)) drainLater(PLUGIN_ROOT, ENV, { flags: hostFlags(process.argv) });
}

function taught(id) {
  const h = here();
  const port = taskPort(taskContext(h));
  const view = port.view(id);
  if (view.receipts.some((r) => r.domain === "learning")) return;
  port.apply(id, "link-receipt", learnedFrom(engineeringFor(h), view, declared(lazy(() => bindRuntime({ pluginRoot: PLUGIN_ROOT, env: ENV, cwd: h.paths.root })))));
}

// The engineering store over the primary checkout's tracked tree, with the gates architecture's invariants cite --
// bound the way cli/engineering.mjs binds it.
function engineeringFor(h) {
  const ctx = engineeringContext({ project: h.paths, config: h.config ?? { frontend: { roots: [] } } }, ENV);
  return { ...ctx, now: () => new Date().toISOString(), gates: () => new Set(createArchitecture(ctx.store.root, ctx.io).all().filter((f) => f.kind === "invariant").flatMap((f) => f.evidence ?? [])), trace: (type, data) => (switchOf(ENV, "TRACE", "trace", true) ? quietly(() => emitterFor()(type, data)) : null) };
}

// ---- the checkout, and the rooms it keeps -----------------------------------------------------

// The NATIVE realpath on both sides: on Windows the store may be spelled with a short name
// (RUNNER~1) and git's root with the long one, and one directory must not read as two.
function spelled(p) {
  try { return realpathSync.native(p); }
  catch { return resolve(p); }
}

// A command run from inside a task's workspace would be a second checkout to every subject.
function inWorkspace(paths) {
  if (within(spelled(paths.storeBase), spelled(paths.root))) throw new Refused("this is a task's workspace, not your checkout — edit files here, but run Orbit from your own checkout");
  return paths;
}

// The project a trail event is marked with, once a command has found it.
const BOUND = { project: null, track: null };

// What a trail event and a tracked work need of the checkout, once a command has found it.
const remembered = (paths, io) => Object.assign(BOUND, { project: paths.storeKey, track: { works: createWorks(paths.storeRoot, io), checkout: paths.checkoutId } });

function here() {
  const { paths, config } = runtimeProject(ENV, process.cwd());
  if (paths.layout !== 3 || !paths.checkoutId) throw new Refused("autonomous engineering works from a Git checkout — run it inside one");
  const machine = machineContext({ project: inWorkspace(paths), config: config ?? {} }, ENV);
  remembered(paths, machine.io);
  return { paths, config, io: machine.io, proc: createProcess() };
}

const parsed = (text) => {
  try { return text === null ? null : JSON.parse(text); }
  catch { return null; }
};

const roomDir = (h, id) => join(h.paths.storeRoot, "orchestration", id);

// One task's room: small JSON artifacts, and the bounded, scrubbed log of each check.
const roomAt = (io, dir) => ({ read: (name) => parsed(io.read(join(dir, `${name}.json`))), write: (name, value) => writeAtomic(join(dir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, io, false), remove: (name) => io.removeFile(join(dir, `${name}.json`)), log: (ref) => io.read(join(dir, "checks", `${ref}.log`)), keep: (ref, text) => io.write(join(dir, "checks", `${ref}.log`), text) });

function locked(h, id, fn) {
  h.io.ensureDir(roomDir(h, id));
  return withLock(roomDir(h, id), fn, h.io, BUSY);
}

// ---- the task: its one write door, with no door that proves a person --------------------------

const session = () => taskSessionMark(ENV.ORBIT_SESSION);

const taskContext = (h) => ({ tasks: createTasks(h.paths.storeRoot, h.io), project: h.paths.storeKey, checkout: h.paths.checkoutId, session: session(), now: () => new Date().toISOString() });

const viewed = (ctx, id) => ((t) => taskView(t.model, t.now))(loadTask(ctx, id));

const taskPort = (ctx) => ({ create: (given) => createTask(ctx, { project: ctx.project, checkout: ctx.checkout, ...given, ...lineage() }), apply: (id, op, given) => apply(ctx, id, op, given), view: (id) => viewed(ctx, id), events: (id) => eventsView(loadTask(ctx, id).model).events, list: () => ctx.tasks.list(), fingerprint: (g) => fingerprintOf(g) });

// ---- requirements and work ------------------------------------------------------------------------

function requirementRooms(h) {
  const base = { project: h.paths, config: h.config ?? {} };
  const req = requirementsContext(base, ENV);
  const rctx = { ...req, world: requirementWorld(sourcesContext(base, ENV).sources) };
  return { rctx, wctx: workContext(req) };
}

function workContext(req) {
  const w = { requirements: req.requirements, store: req.store, io: req.io, works: createWorks(req.store.root, req.io), now: () => new Date().toISOString(), session: ENV.ORBIT_SESSION ?? undefined, by: "session" };
  return Object.assign(w, { snapshot: (id, root) => snapshotIn(w, id, root), latestSnapshot: (root) => latestIn(w, root) });
}

const brief = (s) => (s ? { id: s.id, digest: s.digest, clarity: s.clarity, authority: s.authority } : null);

const workStanding = (wctx, id) => (wctx.works.exists(id) ? standing(wctx, id) : null);

const looked = (r, task) => ({ snapshot: brief(snapshotIn(r.rctx, task.snapshot, task.root)), latest: brief(latestIn(r.rctx, task.root)), status: requirementStatus(r.rctx, task.root), work: task.work ? { snapshot: workStanding(r.wctx, task.work)?.snapshot ?? null } : null });

const requirementsPort = (r) => ({ resolve: (ref) => requirementOf(r.rctx, /^w-[0-9a-f]{12}$/.test(ref) ? rootOf(ref) : ref), latest: (root) => brief(latestIn(r.rctx, root)), look: (task) => looked(r, task) });

// The work a task rests on: found, or started on the snapshot -- a FIRST adoption only. A work that
// already rests on a snapshot is never moved to another one from here.
function ensuredWork(wctx, spec) {
  const id = workOf(spec.root);
  const adopted = workStanding(wctx, id)?.snapshot ?? null;
  startWork(wctx, { objective: spec.objective, root: spec.root, identity: spec.identity, snapshot: adopted ? undefined : spec.snapshot });
  return { work: id, snapshot: workStanding(wctx, id).snapshot };
}

function foundWork(wctx, ref) {
  try { return findWork(wctx.works, ref); }
  catch (e) { if (e instanceof Refused) return null; throw e; }
}

const workPort = (r) => ({ ensure: (spec) => ensuredWork(r.wctx, spec), objectiveOf: (root) => workStanding(r.wctx, workOf(root))?.objective ?? null, find: (ref) => foundWork(r.wctx, ref) });

// ---- runtime: understanding, readiness, start and stop of the PRIMARY checkout ----------------------

const lazy = (make) => {
  let made = null;
  return () => (made ??= make());
};

const planRow = ({ key, state, provider, because, blocking }) => ({ key, state, provider, because, blocking });

async function readiness(rt) {
  await RUNTIME.discover.run(rt, []);
  const status = await RUNTIME.status.run(rt, []);
  const view = look(rt).view;
  return { understanding: status.understanding.state, components: status.plan.components.map(planRow), checks: checksOf(view.components), unsafeTests: unsafeTestsOf(view.components) };
}

function declared(rt) {
  try { return checksOf(look(rt()).view.components); }
  catch { return []; }
}

// The checkout's COMPONENT GRAPH, as understanding read it from the files: where each component lives, what
// it depends on, the shared files it inherits, and the references nothing read resolves. Orchestration
// derives a change's impact from it (src/orchestration/impact.mjs); unreadable here is null, and then every
// component with a check is held to it.
const edgesOf = (c) => c.dependencies ?? [];

const nodeOf = (c) => ({ key: c.key, dir: c.dir, kind: c.kind, live: liveOf(c.kind), dependsOn: edgesOf(c).filter((d) => d.dependsOn).map((d) => d.dependsOn), inherits: edgesOf(c).filter((d) => d.via === "shared").map((d) => d.reference), unresolved: edgesOf(c).filter((d) => d.via === "manifest" && !d.dependsOn).map((d) => d.reference) });

function graphOf(rt) {
  try { return { components: look(rt()).view.components.map(nodeOf) }; }
  catch { return null; }
}

// Only a PERSON's sessions: a task's own sandbox keeps its sessions in the same room, owned by the task.
const runtimePort = (rt) => ({ readiness: () => readiness(rt()), start: (a) => RUNTIME.start.run(rt(), a.component ? [`--component=${a.component}`] : []), stop: (a) => RUNTIME.stop.run(rt(), [`--session=${a.session}`]), sessions: async () => rt().sessions.list({ env: rt().envId, owner: { kind: "human" } }) });

// ---- the sandbox: the environment a task owns, bound to ITS workspace --------------------------------

// What the checkout declares a sandbox could start: a component with a command a file declared for
// bringing it up, and one Orbit may launch (an argument list, never a shell line). Memory only.
const startsOf = (c) => (c.commands ?? []).some((x) => x.purpose === "start" && x.safe === true);

function startable(rt) {
  try { return look(rt()).view.components.filter(startsOf).map((c) => c.key); }
  catch { return []; }
}

// One sandbox context per task, bound on first use: a task with no workspace of its own here has none,
// and asking for it is a refusal the action turns into its own error.
function boxes(h) {
  const bound = new Map();
  return (task) => (bound.has(task) ? bound.get(task) : bound.set(task, bindSandbox({ pluginRoot: PLUGIN_ROOT, env: ENV, cwd: h.paths.root, task })).get(task));
}

const sandboxPort = (boxOf, rt) => ({
  prepare: ({ task }) => RUNTIME["sandbox-prepare"].run(boxOf(task), []),
  start: ({ task, component }) => RUNTIME["sandbox-start"].run(boxOf(task), component ? [`--component=${component}`] : []),
  status: ({ task }) => RUNTIME.sandbox.run(boxOf(task), []),
  stop: ({ task }) => RUNTIME["sandbox-stop"].run(boxOf(task), []),
  release: ({ task }) => RUNTIME["sandbox-release"].run(boxOf(task), []),
  sessions: async ({ task }) => ((box) => box.sessions.list({ env: box.envId, owner: box.owner }))(boxOf(task)),
  startable: () => startable(rt),
});

// ---- checks, context, capabilities, investigations ------------------------------------------------

const envNamesOf = (rt) => (key) => rt().readSettings().settings.components?.[key]?.env ?? [];

// ---- what a running check is observed doing (src/orchestration/activity/, ADR 0020) -----------------------------

// The bytes this task's observations already hold: a new one gets what the task's budget leaves, never more than an
// action's, and always room for its own end.
const heldBytes = (h, dir) => h.io.list(dir).reduce((n, f) => n + (h.io.size(join(dir, f)) ?? 0), 0);

const budgetFor = (h, file) => Math.max(ACTIVITY_LIMITS.ENDING_BYTES, Math.min(ACTIVITY_LIMITS.ACTION_BYTES, ACTIVITY_LIMITS.TASK_BYTES - heldBytes(h, dirname(file))));

// One file per check action, appended once per chunk the check printed; the room is made on the first write.
function activitySink(h, file) {
  h.io.ensureDir(dirname(file));
  return { append: (text) => h.io.append(file, text) };
}

// The observer the check runner asks for each run: null when the action has no id to file it under.
function observerFor(h) {
  return (command, at) => (at.action ? ((file) => createObservation({ identity: { task: at.task, action: at.action, attempt: at.attempt ?? null, check: at.ref }, command, why: at.why, adapters: ADAPTERS, sink: activitySink(h, file), clock: () => Date.now(), budget: budgetFor(h, file) }))(activityFile(h.paths.storeRoot, at.task, at.action)) : null);
}

const checksPort = (h, rt) => ({ declared: () => declared(rt), graph: () => graphOf(rt), run: (command, at) => createCheckRunner({ process: h.proc, env: ENV, envNamesOf: envNamesOf(rt), clock: () => Date.now(), keep: (where, text) => roomAt(h.io, roomDir(h, where.task)).keep(where.ref, text), observer: observerFor(h) }).run(command, at) });

function gathered(h, text) {
  const r = h.proc.run(process.execPath, [join(PLUGIN_ROOT, "cli", "context.mjs"), "--for-stdin", "--json"], { input: text, env: ENV, cwd: h.paths.root, timeoutMs: CONTEXT_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
  const got = r.ok ? parsed(r.out) : null;
  if (!got?.sections) throw new Blocked(`project context could not be gathered here: ${scrub(r.error ?? "it printed no context")}`);
  return got;
}

// A project's own capabilities, when it registered any: a checkout with no ui-tests/ has none.
async function extended(h) {
  try { return await withExtensions(createContext({}, ENV, h.paths.root)); }
  catch (e) { if (e instanceof Refused) return null; throw e; }
}

function describedBy(ctx, id) {
  try { return ctx ? ctx.capabilities.resolve(id) : null; }
  catch { return null; }
}

// `approved`: the orchestrator authorized this call (it is autonomous, or it spent an approval); `authorized`: for one
// that crossed a protected boundary, the fingerprint of the action whose approval it spent -- the capability pipeline
// holds the call to exactly that action (src/capability/invoke.mjs `boundary`), and nothing a host sends can set it.
const runOf = (opts) => ({ c: { id: "autonomous-engineering", destructive: opts.approved === true }, page: false, values: {}, ...(opts.authorized ? { authorized: opts.authorized } : {}) });

function invokedBy(ctx, id, input, opts) {
  const cap = describedBy(ctx, id);
  if (!cap) throw new Refused(`${id} is not a capability this project registered`);
  if (cap.connection) throw new Blocked(`${id} needs a connection, which autonomous engineering does not bind yet — ask it through work invoke`);
  return invokeCapability(ctx, runOf(opts ?? {}), { capability: id, input });
}

// What a capability DECLARES, as the protected-boundary leaf reads a call to it (src/protected/capability.mjs).
const declaration = (c) => ({ id: c.id, mutates: c.mutates === true, effects: c.effects ?? [], environment: c.environment ?? null, connection: c.connection ?? null, inputSchema: c.inputSchema ?? {} });

const capabilitiesPort = (caps) => ({ describe: (id) => ((c) => (c ? declaration(c) : null))(describedBy(caps(), id)), invoke: (id, input, opts) => invokedBy(caps(), id, input, opts) });

const DEFECT = new Set(OUTCOMES.filter((o) => o.defect).map((o) => o.id));

function outcomeOf(h, id) {
  try { return summarized(investigationModel(createInvestigations(h.paths.storeRoot, h.io).read(id))); }
  catch { return null; }
}

// `runtime`: the sandbox and source tree an investigation was made against, when it was (its journal's creation says).
const summarized = (m) => ({ lifecycle: m.lifecycle, ended: ["completed", "cancelled"].includes(m.lifecycle), reason: m.completed.at(-1)?.reason ?? null, findings: m.findings.length, defects: m.findings.filter((f) => DEFECT.has(f.outcome)).length, runtime: m.meta?.runtime ?? null });

// ---- liveness of the process that runs a step -------------------------------------------------------

const LIVE = [
  { when: (h, r) => r.host !== h.io.host, alive: () => null },
  { when: (h, r) => !h.proc.alive(r.pid), alive: () => false },
  { when: (h, r) => Boolean(r.pidStartedAt) && h.proc.startedAtOf(r.pid) !== r.pidStartedAt, alive: () => false },
  { when: () => true, alive: () => true },
];

const livenessOf = (h) => (r) => LIVE.find((l) => l.when(h, r)).alive();

// ---- the ports ------------------------------------------------------------------------------

const actor = () => (/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(ENV.ORBIT_HOST ?? "") ? ENV.ORBIT_HOST : undefined);

function portsHere() {
  const h = here();
  const rt = lazy(() => bindRuntime({ pluginRoot: PLUGIN_ROOT, env: ENV, cwd: h.paths.root }));
  const rooms = lazy(() => requirementRooms(h));
  const caps = lazy(() => extended(h));
  return assembled(h, rt, rooms, caps);
}

function assembled(h, rt, rooms, caps) {
  const trees = createLocalClones(h.paths.root, h.proc, { noHooks: join(h.paths.storeRoot, "workspaces", ".no-hooks"), inherit: ENV });
  const lazyRooms = { resolve: (ref) => requirementsPort(rooms()).resolve(ref), latest: (root) => requirementsPort(rooms()).latest(root), look: (task) => requirementsPort(rooms()).look(task) };
  const lazyWork = { ensure: (spec) => workPort(rooms()).ensure(spec), objectiveOf: (root) => workPort(rooms()).objectiveOf(root), find: (ref) => workPort(rooms()).find(ref) };
  const ready = { caps: null };
  return { task: taskPort(taskContext(h)), requirements: lazyRooms, work: lazyWork, runtime: runtimePort(rt), sandbox: sandboxPort(boxes(h), rt), workspace: createWorkspaces({ root: h.paths.storeRoot, io: h.io, trees, host: h.io.host, now: () => new Date().toISOString() }), base: { head: () => trees.head(), dirty: () => trees.dirty() }, checks: checksPort(h, rt), context: { gather: async (text) => gathered(h, text) }, capabilities: capabilitiesPort(() => ready.caps), investigations: { outcome: (id) => outcomeOf(h, id) }, roomOf: (id) => roomAt(h.io, roomDir(h, id)), lock: (id, fn) => locked(h, id, fn), liveness: livenessOf(h), now: () => new Date().toISOString(), host: h.io.host, pid: process.pid, pidStartedAt: () => h.proc.startedAtOf(process.pid), actor: actor(), readDecision: (file) => readFileSync(file ?? 0, "utf8"), where: () => ({ orchestration: join(h.paths.storeRoot, "orchestration"), workspaces: join(h.paths.storeRoot, "workspaces") }), prepare: async () => { ready.caps = await caps(); } };
}

// ---- the session trail: ids and words, never a sentence of a task ---------------------------------

const ENDED = { COMPLETED: "COMPLETED", FAILED: "FAILED", CANCELLED: "CANCELLED" };

const EVENTS = {
  start: (r) => (r.created ? ["task.started", { task: r.task }] : null),
  step: (r) => (ENDED[r.lifecycle] ? ["task.finished", { task: r.task, lifecycle: ENDED[r.lifecycle] }] : null),
  finish: (r) => (["completed", "failed", "stopped"].includes(r.state) ? ["task.finished", { task: r.task, lifecycle: r.state === "completed" ? "COMPLETED" : "FAILED" }] : null),
};

function emitted(result) {
  const event = Object.hasOwn(EVENTS, cmd) ? EVENTS[cmd](result) : null;
  if (event && switchOf(ENV, "TRACE", "trace", true)) quietly(() => emitterFor()(...event));
}

function emitterFor() {
  const io = realIo();
  const emit = createEmitter({ log: traceLog(stateRooms(storeBase(ENV)), io), now: io.now, session: ENV.ORBIT_SESSION ?? null, meta: ENV.ORBIT_HOST_PROTOCOL === "2" ? { v: 2, agentHost: ENV.ORBIT_HOST } : {}, project: short(BOUND.project ?? "?", 12) });
  return (type, data) => emit(type, data);
}

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

command(main);
