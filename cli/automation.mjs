#!/usr/bin/env node
// A COORDINATED WORKFLOW: one objective taken through several owners' workflows -- the requirement,
// project context, runtime, an engineering task, a QA investigation, regression and review -- one decided
// step at a time, inside Orbit's governance, every step recorded in a task of its own that Orbit Live and
// Mission Control read. `/orbit-help <objective>` starts it by default (ADR 0023: nothing to turn on). The host's
// model reasons and runs the skills; this engine keeps the plan, the state, the gates and the evidence, and
// reads every step's evidence back from the owner that keeps it.
//
//   node automation.mjs start --for="<objective>" [--ref=<work item|req-…|rs-…|w-…>] [--capability=<a.b,c.d>] [--intent=<routing intent>] [--goal=<goal-…:gu-…>] [--attempts= --actions= --minutes=]
//                                          classify the objective, plan its workflow as a graph, create the
//                                          coordinator's task (or pick up the one running for the same objective).
//                                          --capability names capabilities the objective needs beyond what the
//                                          router's table reads off it: each gets a step, and one nothing here
//                                          provides gets its playbook drafted first when a person allows that.
//                                          --intent DECLARES the routing intent (a goal unit's kind names one), so
//                                          the objective's words are not classified at all; --goal links the goal
//                                          and unit it was started for, and picks up THAT unit's running workflow.
//                                          Run it, and every command below, from YOUR checkout
//   node automation.mjs context <task>     the plan, each step's state from the journal, the engineering task it
//                                          started, what runs next and how, how to watch it. Writes nothing
//   node automation.mjs resume <task|ref|objective>
//                                          the running workflow for a task id, a work item or the same objective,
//                                          from the store alone. It never un-pauses: a person resumes, in Control
//   node automation.mjs step <task> [--decision=<file>]
//                                          ONE decided step (the decision on stdin, or in the file): judged,
//                                          recorded before anything runs; an engine step runs and settles here,
//                                          a skill or agent step answers how the host runs it
//   node automation.mjs settle <task> [--outcome=<file>]
//                                          what a host-run step came to: its evidence read back from its owner,
//                                          never the host's word alone
//   node automation.mjs reconcile <task>   a step whose host or process is gone: read back, or closed as
//                                          interrupted -- never run again by itself
//   node automation.mjs finish <task> [--stop=<REASON> --because="…"]
//                                          completed when every step is done; otherwise ended with a stop the
//                                          journal supports, or refused
//   node automation.mjs plan --for="<objective>" [--capability=<a.b,c.d>] | plan <task>
//                                          the workflow an objective WOULD get -- each step, what it waits for,
//                                          every capability read and which gap it is, what is missing and who
//                                          says it (writes nothing) -- or a workflow's active plan with each
//                                          step's state and every revision and why
//   node automation.mjs status             the effective automation settings, who set each, and the policy matrix
//   node automation.mjs doctor             whether automation can run here: the settings, this host, the rooms
//   node automation.mjs protocol           the decision and outcome shapes, the step kinds and the stops
//   node automation.mjs where              where the automation settings and rooms are kept
//
// Every command takes --json. There is NO command that writes the automation settings: a person changes
// them in Orbit Control (Automation), the one door that proves a person.
//
// This file is the one COMPOSITION ROOT for src/automation/: the task's write door, the settings documents,
// the routing classifier, the resolver over the effective registry, requirements, runtime, project context,
// autonomous engineering's own CLI (for the engineering task a step hands on), investigations and the skill
// factory are bound here and handed in as ports. The coordinator itself reads no environment, spawns
// nothing and imports none of them.
//
// A workflow that ended makes sure its engineering task taught engineering memory (1.8.9): the task does
// that at its own finish (cli/autonomous-engineering.mjs), and a child that ended without passing there is
// taught here, once, through the same untrusted door. It never changes how the command answered.
//
// Exit 0 = done (a workflow that stopped for a reason is a state) · 2 = REFUSED · 3 = BLOCKED. Never 1.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { drainLater, hostFlags, protocolTwo } from "../skills/orbit-learn/hosts/drain.mjs";
import { createArchitecture } from "../src/architecture/store.mjs";
import { childOf } from "../src/automation/dispatch.mjs";
import { engineeringContext } from "../src/engineering/context.mjs";
import { learnedFrom } from "../src/engineering/observe/task.mjs";
import { attendedOf } from "../skills/orbit-learn/hosts/attended.mjs";
import { owns, target } from "../skills/orbit-learn/hosts/claude-statusline.mjs";
import { requirementWorld } from "../skills/orbit-requirements/bind.mjs";
import { realWorld } from "../skills/orbit-control/world.mjs";
import { bindRuntime } from "../skills/orbit-runtime/bind.mjs";
import { COMMANDS } from "../src/automation/index.mjs";
import { effectiveOf, readAutomation } from "../src/automation/settings.mjs";
import { readCatalog } from "../src/catalog.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { short } from "../src/hash.mjs";
import { modelOf as investigationModel } from "../src/investigation/model.mjs";
import { createInvestigations } from "../src/investigation/store.mjs";
import { OUTCOMES } from "../src/investigation/vocab.mjs";
import { resolved } from "../src/knowledge/verify.mjs";
import { taskSessionMark } from "../src/memory/session.mjs";
import { printable } from "../src/printable.mjs";
import { createProcess } from "../src/process/index.mjs";
import { command } from "../src/project/command.mjs";
import { componentOn } from "../src/project/components.mjs";
import { switchOf } from "../src/project/env.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { requirementsContext } from "../src/requirements/context.mjs";
import { status as requirementStatus } from "../src/requirements/views/status.mjs";
import { effectiveResourcesOf, mcpInvokeContext } from "../src/resources/compose.mjs";
import { connectionEnvFor, connectionReader } from "../skills/orbit-requirements/bind.mjs";
import { fingerprintOf as bindingFingerprint, resourceOf } from "../src/work/bind.mjs";
import { invokeBound } from "../src/work/invoke.mjs";
import { classify, declared } from "../src/routing/classify.mjs";
import { createContext } from "../src/run/context.mjs";
import { runtimeProject } from "../src/runtime/context.mjs";
import { COMMANDS as RUNTIME } from "../src/runtime/index.mjs";
import { ensureProject } from "../src/seat.mjs";
import { look } from "../src/runtime/understanding.mjs";
import { checksOf } from "../src/orchestration/checks.mjs";
import { scrub } from "../src/scrub.mjs";
import { sourcesContext } from "../src/sources/context.mjs";
import { writeAtomic } from "../src/store/atomic.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { machineContext } from "../src/store/context.mjs";
import { realIo } from "../src/store/io.mjs";
import { readLive } from "../src/live/settings.mjs";
import { withLock } from "../src/store/lock.mjs";
import { fingerprintOf } from "../src/task/approvals.mjs";
import { loadTask } from "../src/task/load.mjs";
import { apply, createTask } from "../src/task/ops.mjs";
import { createTasks } from "../src/task/store.mjs";
import { eventsView, taskView } from "../src/task/views.mjs";
import { createEmitter } from "../src/trace/emit.mjs";
import { traceLog } from "../src/trace/log.mjs";
import { latestIn, requirementOf } from "../src/work/requirement.mjs";
import { createWorks, rootOf } from "../src/work/store.mjs";
import { attach, attached, attachedLine } from "../src/work/track/auto.mjs";
import { hostFrom } from "../src/work/track/coverage.mjs";
import { factoryPort, gapPort, projectSkillsOf } from "../skills/orbit-help/factory.mjs";

const ENV = commandEnvironment(process.env, process.argv);
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);

const CHILD_TIMEOUT_MS = 10 * 60000;
const CONTEXT_TIMEOUT_MS = 15 * 60000;
const BUSY = "another session is taking a step on this workflow — try again in a moment";

// What a terminal may run when orbit-help is switched off: reading only.
const READS = ["context", "resume", "plan", "status", "doctor", "protocol", "where"];

async function main() {
  const entry = Object.hasOwn(COMMANDS, cmd ?? "") ? COMMANDS[cmd] : null;
  if (!entry) return help();
  switchedOn();
  const result = await entry.run(entry.needs === "nothing" ? {} : await portsHere(), args);
  printed(entry, cmd === "start" ? tracked(result) : result);
}

// The workflow's own task joins the session's tracked work (src/work/track/auto.mjs); no work, nothing happens, and a
// failure to track is a warning that never touches the workflow.
function tracked(result) {
  const tracking = result?.task && BOUND.track ? attached(() => attach({ ...BOUND.track, now: () => new Date().toISOString(), session: session(), host: hostFrom(ENV) }, { task: result.task, what: "workflow", because: "a coordinated workflow took the work" })) : null;
  return tracking ? { ...result, tracking } : result;
}

function switchedOn() {
  if (READS.includes(cmd) || componentOn({ kind: "skill", name: "orbit-help" }, process.env, "orbit")) return;
  throw new Refused("orbit-help is switched off (skill_help, or ORBIT_SKILL_HELP) — automation reads, and takes no step");
}

function printed(entry, result) {
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : printable([entry.say(result), attachedLine(result.tracking)].filter(Boolean).join("\n")));
  emitted(result);
  learnedAfter(result);
  if (cmd === "start") viewerOpened(result).catch(() => null);
}

// ---- what a finished workflow's engineering task taught (1.8.9) ---------------------------------------

// The coordinator keeps step receipts and teaches nothing of its own. Its engineering task teaches at its own
// finish; one that ended without passing there is taught here, and one that already holds its `learning` receipt is
// left alone. Fail-open, and a protocol-2 session's queued checkpoints are drained beside it.
function learnedAfter(result) {
  const event = Object.hasOwn(EVENTS, cmd) ? EVENTS[cmd](result) : null;
  if (event?.[0] !== "task.finished") return;
  quietly(() => childTaught(event[1].task));
  if (protocolTwo(ENV, process.argv)) drainLater(PLUGIN_ROOT, ENV, { flags: hostFlags(process.argv) });
}

function childTaught(id) {
  const h = here();
  const port = taskPort(taskContext(h));
  const child = childOf(port.view(id));
  const view = child ? port.view(child) : null;
  if (view?.terminal && !view.receipts.some((r) => r.domain === "learning")) port.apply(child, "link-receipt", learnedFrom(engineeringFor(h), view, checksDeclared(h)));
}

function engineeringFor(h) {
  const ctx = engineeringContext({ project: h.paths, config: h.config ?? { frontend: { roots: [] } } }, ENV);
  return { ...ctx, now: () => new Date().toISOString(), gates: () => new Set(createArchitecture(ctx.store.root, ctx.io).all().filter((f) => f.kind === "invariant").flatMap((f) => f.evidence ?? [])), trace: (type, data) => (switchOf(ENV, "TRACE", "trace", true) ? quietly(() => emitterFor()(type, data)) : null) };
}

const checksDeclared = (h) => quietly(() => checksOf(look(bindRuntime({ pluginRoot: PLUGIN_ROOT, env: ENV, cwd: h.paths.root })).view.components)) ?? [];

// A workflow started or was picked up: this session's viewer is told to show it -- through the one launcher
// /orbit-help uses (`live ensure --entry=workflow`, cli/live-ensure.mjs), which reuses the viewer already open, opens
// one only where none was opened for this session, never brings back one a person closed, and decides from the
// person's switches (src/live/ensure.mjs POLICY). Started detached and forgotten: it waits a few seconds for the
// viewer to say it is ready, and this command's one JSON object is never mixed with what it says.
// The hosts a person said they use interactively (live settings): the attendance a host with no mark of its own has.
function declaredHosts() {
  try {
    return readLive(realIo(), join(stateRooms(storeBase(ENV)).live, "settings.json")).settings.attendedHosts;
  } catch {
    return [];
  }
}

async function viewerOpened(result) {
  const o = await import("./live-open.mjs");
  if (!switchOf(ENV, "LIVE", "live", true) || !attendedOf(ENV, declaredHosts()) || !result?.task || !o.taskShaped(result.task)) return;
  spawn(process.execPath, [join(PLUGIN_ROOT, "cli", "live.mjs"), "ensure", result.task, "--entry=workflow", "--quiet"], { cwd: process.cwd(), detached: true, stdio: "ignore" }).on("error", () => null).unref();
}

// ---- the checkout, its rooms and its settings ------------------------------------------------------

const BOUND = { project: null, track: null };

// What a trail event and a tracked work need of the checkout, once a command has found it.
const remembered = (paths, io) => Object.assign(BOUND, { project: paths.storeKey, track: { works: createWorks(paths.storeRoot, io), checkout: paths.checkoutId } });

// The checkout a command runs in. A workflow's `start` first seats its project in the machine store, as /orbit-help
// does (1.8.9, src/seat.mjs), so every owner a step is handed to finds where its project's test data is kept.
function located() {
  if (cmd === "start") ensureProject(ENV, process.cwd());
  const found = runtimeProject(ENV, process.cwd());
  if (found.paths.layout !== 3 || !found.paths.checkoutId) throw new Refused("automation works from a Git checkout — run it inside one");
  return found;
}

function here() {
  const { paths, config } = located();
  const machine = machineContext({ project: paths, config: config ?? {} }, ENV);
  remembered(paths, machine.io);
  return { paths, config, io: machine.io, proc: createProcess() };
}

const parsed = (text) => {
  try { return text === null || text === undefined ? null : JSON.parse(text); }
  catch { return null; }
};

const roomDir = (h, id) => join(h.paths.storeRoot, "automation", id);

const roomAt = (io, dir) => ({ read: (name) => parsed(io.read(join(dir, `${name}.json`))), write: (name, value) => writeAtomic(join(dir, `${name}.json`), `${JSON.stringify(value, null, 2)}\n`, io, false), remove: (name) => io.removeFile(join(dir, `${name}.json`)) });

function locked(h, id, fn) {
  h.io.ensureDir(roomDir(h, id));
  return withLock(roomDir(h, id), fn, h.io, BUSY);
}

const machineFile = () => join(stateRooms(storeBase(ENV)).automation, "settings.json");

const projectFile = (h) => join(h.paths.storeRoot, "automation", "settings.json");

// On by default; a restriction a person kept from before is named, with where they lift it.

function settingsOf(h) {
  const machine = readAutomation(h.io, machineFile());
  const project = readAutomation(h.io, projectFile(h));
  return { machine, project, effective: effectiveOf([{ by: "machine", content: machine.content }, { by: "project", content: project.content }]) };
}

// ---- the task: its one write door, with no door that proves a person -------------------------------

const session = () => taskSessionMark(ENV.ORBIT_SESSION);

const taskContext = (h) => ({ tasks: createTasks(h.paths.storeRoot, h.io), project: h.paths.storeKey, checkout: h.paths.checkoutId, session: session(), now: () => new Date().toISOString() });

const viewed = (ctx, id) => ((t) => taskView(t.model, t.now))(loadTask(ctx, id));

const taskPort = (ctx) => ({ create: (given) => createTask(ctx, { project: ctx.project, checkout: ctx.checkout, ...given }), apply: (id, op, given) => apply(ctx, id, op, given), view: (id) => viewed(ctx, id), events: (id) => eventsView(loadTask(ctx, id).model).events, list: () => ctx.tasks.list(), fingerprint: (g) => fingerprintOf(g) });

// ---- the objective, read the way the prompt router reads it ------------------------------------------

// `matched`: every intent with a cue of its own in the objective -- a cue inside another intent's longer cue is
// that intent's (src/routing/classify.mjs), so "find bugs" is an investigation and asks for no change.
const classified = (text) => ((c) => ({ intent: c.intent, matched: c.matched, requirements: c.requirements }))(classify(text));

// ---- requirements ----------------------------------------------------------------------------------

const lazy = (make) => {
  let made = null;
  return () => (made ??= make());
};

function requirementRooms(h) {
  const base = { project: h.paths, config: h.config ?? {} };
  const req = requirementsContext(base, ENV);
  return { ...req, world: requirementWorld(sourcesContext(base, ENV).sources) };
}

const brief = (s) => (s ? { id: s.id, digest: s.digest, clarity: s.clarity, authority: s.authority } : null);

const looked = (rctx, root) => ({ latest: brief(latestIn(rctx, root)), blocking: requirementStatus(rctx, root).open.filter((q) => q.blocking).length });

const requirementsPort = (rooms) => ({ resolve: (ref) => requirementOf(rooms(), /^w-[0-9a-f]{12}$/.test(ref) ? rootOf(ref) : ref), look: (root) => looked(rooms(), root) });

// ---- runtime: what the checkout needs and whether it runs here (memory first) -----------------------

const startsOf = (c) => (c.commands ?? []).some((x) => x.purpose === "start" && x.safe === true);

function startable(rt) {
  try { return look(rt()).view.components.filter(startsOf).map((c) => c.key); }
  catch { return []; }
}

async function readiness(rt) {
  await RUNTIME.discover.run(rt(), []);
  const status = await RUNTIME.status.run(rt(), []);
  return { understanding: status.understanding.state, components: status.plan.components, startable: startable(rt), checks: checksOf(look(rt()).view.components) };
}

// ---- owners asked through their own commands ---------------------------------------------------------

function spawned(h, cli, argv, opts = {}) {
  const r = h.proc.run(process.execPath, [join(PLUGIN_ROOT, "cli", cli), ...argv, "--json"], { input: opts.input, env: ENV, cwd: h.paths.root, timeoutMs: opts.timeoutMs ?? CHILD_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024 });
  const got = r.ok ? parsed(r.out) : null;
  if (!got) throw new Blocked(`${cli} answered nothing usable here: ${scrub(r.err || r.error || "no output").slice(0, 200)}`);
  return got;
}

// The engineering task a step hands on: autonomous engineering's own start, which picks up the task already
// running for the same work instead of starting a second.
const childStart = (h, spec) => ((r) => ({ task: r.task, created: r.created === true }))(spawned(h, "autonomous-engineering.mjs", ["start", ...(spec.ref ? [`--ref=${spec.ref}`] : [spec.objective]), ...(spec.minutes ? [`--minutes=${spec.minutes}`] : []), ...(spec.parent ? [`--parent=${spec.parent}`] : [])]));

const gathered = (h, text) => spawned(h, "context.mjs", ["--for-stdin"], { input: text, timeoutMs: CONTEXT_TIMEOUT_MS });

const DEFECT = new Set(OUTCOMES.filter((o) => o.defect).map((o) => o.id));

// `task`: the task whose sandbox the investigation was begun against (its first line says), so a workflow
// accepts only an investigation of its own change.
const summarized = (m) => ({ lifecycle: m.lifecycle, ended: ["completed", "cancelled"].includes(m.lifecycle), reason: m.completed.at(-1)?.reason ?? null, findings: m.findings.length, defects: m.findings.filter((f) => DEFECT.has(f.outcome)).length, task: m.meta?.runtime?.task ?? null });

function outcomeOf(h, id) {
  try { return summarized(investigationModel(createInvestigations(h.paths.storeRoot, h.io).read(id))); }
  catch { return null; }
}

// ---- the resolver, over the SAME effective registry the prompt router and Control build ---------------

async function extended(h) {
  try { return await withExtensions(createContext({}, ENV, h.paths.root)); }
  catch (e) { if (e instanceof Refused) return null; throw e; }
}

const effectiveFor = (h, caps) => effectiveResourcesOf({ ...realWorld({ pluginRoot: PLUGIN_ROOT, projectRoot: h.paths.root, env: ENV }), capabilities: () => caps?.capabilities?.list?.() ?? [], projectSkills: projectSkillsOf(h, settingsOf(h).effective.values) });

const resolvedOne = (effective, capability) => resolved([{ capability, proves: { subject: capability } }], effective).results[0];

// ---- the host this runs under ----------------------------------------------------------------------

const hostId = () => (/^[a-z][a-z0-9-]{0,39}$/.test(ENV.ORBIT_HOST ?? "") ? ENV.ORBIT_HOST : "claude");

function statusLineInstalled(io) {
  const doc = parsed(io.read(target(ENV, homedir())));
  return owns(doc?.statusLine, stateRooms(storeBase(ENV)));
}

function hostOf(h) {
  const row = (readCatalog(h.io, join(PLUGIN_ROOT, "catalog", "hosts.json"))?.hosts ?? []).find((x) => x.id === hostId());
  return { id: hostId(), agents: row?.capabilities?.nativeAgents === true, statusLine: row?.capabilities?.statusLine === true && statusLineInstalled(h.io) };
}

// ---- doctor and where --------------------------------------------------------------------------------

const docRow = (name, d) => ({ name, ok: !d.unreadable, say: d.unreadable ? `unreadable (${d.unreadable}) — Control copies it aside on the next save` : d.exists ? `revision ${d.revision}${d.updatedAt ? `, saved ${d.updatedAt}` : ""}` : "not set — defaults apply" });

function doctorOf(h) {
  const s = settingsOf(h);
  const v = s.effective.values;
  const host = hostOf(h);
  return { rows: [docRow("machine settings", s.machine), docRow("project settings", s.project), { name: "automation", ok: true, say: "on by default: a task named to /orbit-help is coordinated" }, { name: "skill factory", ok: true, say: "instruction-only, bounded by current limits" }, { name: `host ${host.id}`, ok: true, say: host.agents ? "dispatches agents natively" : "no native agents proven: skills run in the main session, one step at a time" }, { name: "status line", ok: host.statusLine, say: host.statusLine ? "Orbit Live is in Claude Code's status line" : host.id === "claude" ? "not installed — node <engine>/cli/host.mjs render --host=claude --kind=statusline, then apply --human" : "unavailable on this host — use node <engine>/cli/live.mjs watch <task>" }] };
}

const whereOf = (h) => ({ machine: machineFile(), project: projectFile(h), rooms: join(h.paths.storeRoot, "automation"), skills: join(h.paths.storeRoot, "generated-skills") });

// ---- the ports ------------------------------------------------------------------------------------

const actor = () => (/^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/.test(ENV.ORBIT_HOST ?? "") ? ENV.ORBIT_HOST : undefined);

// The project's own capabilities are loaded first, so what a step resolves against is what the router sees.
async function portsHere() {
  const h = here();
  const caps = ["start", "step", "plan", "context"].includes(cmd) ? await extended(h) : null;
  const lz = { rt: lazy(() => bindRuntime({ pluginRoot: PLUGIN_ROOT, env: ENV, cwd: h.paths.root })), rooms: lazy(() => requirementRooms(h)), effective: lazy(() => effectiveFor(h, caps)), caps };
  return assembled(h, lz);
}

// ---- a declared playbook's calls (0.0.4): the doors that already exist, and no other -----------------------

// The provider the resolver picked, bound by its registry key and the fingerprint of what made it eligible -- what
// the door checks again the moment it is asked.
const boundOf = (effective, r) => ((res) => (res ? { provider: r.provider, fingerprint: bindingFingerprint(res) } : null))(resourceOf(effective, r?.provider));

// A capability that names a connection is asked in a context that holds that one credential for the moment of its call.
async function capabilityContextOf(caps, real, io, connection) {
  if (!connection || !caps) return caps;
  return { ...caps, ...(await connectionEnvFor({ providerId: connection, connections: connectionReader(real.rooms, io), secrets: real.secrets, env: real.env })) };
}

// The broker over the SAME managed state the registry read, and the project's capabilities as the step loaded them.
function invokePort(h, lz) {
  const real = lazy(() => realWorld({ pluginRoot: PLUGIN_ROOT, projectRoot: h.paths.root, env: ENV }));
  const w = { effective: () => lz.effective(), get mcp() { return mcpInvokeContext(real()); }, capabilityContext: (connection) => capabilityContextOf(lz.caps, real(), h.io, connection), host: h.io.host, session: session() };
  return { bind: (r) => boundOf(lz.effective(), r), call: (binding, ask) => invokeBound(w, binding, ask) };
}

function assembled(h, lz) {
  const tctx = taskContext(h);
  const factory = factoryPort(h, () => settingsOf(h).effective.values, (cap) => resolvedOne(lz.effective(), cap));
  return { task: taskPort(tctx), settings: () => settingsOf(h).effective, settingsView: () => settingsOf(h), classify: classified, declared: (id) => declared(id), resolve: (cap) => resolvedOne(lz.effective(), cap), gapOf: gapPort(h, (cap) => resolvedOne(lz.effective(), cap)), requirements: requirementsPort(lz.rooms), invoke: invokePort(h, lz), runtime: { readiness: () => readiness(lz.rt), startable: () => startable(lz.rt) }, context: { gather: async (text) => gathered(h, text) }, child: { start: async (spec) => childStart(h, spec), view: (id) => viewed(tctx, id) }, investigations: { outcome: (id) => outcomeOf(h, id) }, factory, host: hostOf(h), roomOf: (id) => roomAt(h.io, roomDir(h, id)), lock: (id, fn) => locked(h, id, fn), liveness: livenessOf(h), session: session(), now: () => new Date().toISOString(), hostName: h.io.host, pid: process.pid, actor: actor(), readInput: (file) => readFileSync(file ?? 0, "utf8"), doctor: () => doctorOf(h), where: () => whereOf(h) };
}

// Whether the process that ran an engine step is still alive on this machine.
const LIVE = [
  { when: (h, r) => r.host !== h.io.host, alive: () => null },
  { when: (h, r) => !h.proc.alive(r.pid), alive: () => false },
  { when: () => true, alive: () => true },
];

const livenessOf = (h) => (r) => LIVE.find((l) => l.when(h, r)).alive();

// ---- the session trail: ids and words, never a sentence of a workflow --------------------------------

const ENDED = { COMPLETED: "COMPLETED", FAILED: "FAILED", CANCELLED: "CANCELLED" };

const EVENTS = {
  start: (r) => (r.created ? ["task.started", { task: r.task }] : null),
  settle: (r) => (ENDED[r.lifecycle] ? ["task.finished", { task: r.task, lifecycle: ENDED[r.lifecycle] }] : null),
  step: (r) => (ENDED[r.lifecycle] ? ["task.finished", { task: r.task, lifecycle: ENDED[r.lifecycle] }] : null),
  finish: (r) => (["completed", "failed"].includes(r.state) ? ["task.finished", { task: r.task, lifecycle: r.state === "completed" ? "COMPLETED" : "FAILED" }] : null),
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
