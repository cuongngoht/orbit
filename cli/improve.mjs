#!/usr/bin/env node
// AUTONOMOUS SELF-IMPROVEMENT (0.3.0, ADR 0045), as a terminal and a host reach it: what this project's reusable
// definitions -- the playbooks the skill factory keeps, the roles Satellite keeps -- showed in independent sessions,
// a successor of one drafted through its owner, compared with the version it would replace on the same frozen inputs,
// chosen to run only on that evidence and through its owner's door, watched afterwards, and put back when it regresses.
//
//   node improve.mjs status                what self-improvement is doing here: its switches, the opportunities, every
//                                          campaign that is open and the last that ended
//   node improve.mjs analyse [--dry] [--hook]
//                                          read what the owners' records show, keep one opportunity per problem, start a
//                                          campaign for each eligible one and carry every campaign as far as it goes
//                                          without a provider being asked (--dry writes nothing; --hook is what a hook's
//                                          own process runs: debounced, and it never evaluates)
//   node improve.mjs opportunities         every opportunity kept: its evidence, why it is or is not eligible
//   node improve.mjs candidates            every candidate a campaign kept, and what became of it
//   node improve.mjs show <imp-…|cand-…|opp-…>
//                                          one campaign, candidate or opportunity in full
//   node improve.mjs start <opp-…>         a campaign for an eligible opportunity (analyse starts them by itself)
//   node improve.mjs step <imp-…>          ONE step of a campaign: what it did, and what it needs next
//   node improve.mjs resume <imp-…>        a campaign stepped until it needs the host, a person or another session
//   node improve.mjs evaluate <imp-…|cand-…>
//                                          the candidate compared with the version it would replace, in this session
//   node improve.mjs candidate <imp-…> --file=<content.json>
//                                          a Satellite role's successor the host proposes, held to Satellite's rules
//   node improve.mjs link <imp-…> --mission=<msn-…> --side=baseline|candidate
//                                          a Satellite mission the host ran under one version, linked to the evaluation
//   node improve.mjs reconcile <imp-…>     what a gone process left open, closed as interrupted -- never run again by itself
//   node improve.mjs history <playbook-id|definition-id>
//                                          every campaign and opportunity about one definition
//   node improve.mjs metrics               the nine quality metrics, each with its numerator and denominator, or unknown
//   node improve.mjs doctor                the switches in effect and who set each, damaged or unreadable state, and
//                                          the evaluations that are open
//   node improve.mjs where                 where this project's improvement room is
//
// Every command takes --json. There is NO command that promotes, reverts or rejects a candidate, or that changes a
// setting: those are a person's, in Orbit Control (Advanced → Improvement), the one door that proves a person -- a
// terminal cannot prove who typed it, and an agent must never promote its own candidate or raise its own autonomy.
//
// This file is the one COMPOSITION ROOT for src/improvement/: the campaign store, the task door an evaluation is
// written through (`improvement`), the skill factory, the coordinator's own skill runner and the resolver it runs
// with, Satellite's definitions and missions, the learn port and the session trail are bound here and handed in as
// ports. The engine itself reads no environment, spawns nothing and imports none of them.
//
// Exit 0 = done (a campaign waiting for the host, a person or another session is a state) · 2 = REFUSED · 3 = BLOCKED.
// Never 1.
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { factoryPort, improvementSubject } from "../skills/orbit-help/factory.mjs";
import { effectiveFor, extended, invokePort, resolvedOne } from "../skills/orbit-help/invoke.mjs";
import { interruptedRunOps, interruptedStepOps, runIdOf, skillRun } from "../src/automation/skill-run.mjs";
import { effectiveOf, readAutomation } from "../src/automation/settings.mjs";
import { Refused } from "../src/errors.mjs";
import { short } from "../src/hash.mjs";
import { COMMANDS } from "../src/improvement/index.mjs";
import { modelOf as campaignModel } from "../src/improvement/model.mjs";
import { createImprovement } from "../src/improvement/store.mjs";
import { createLessons } from "../src/learn/lessons.mjs";
import { promote } from "../src/learn/promote.mjs";
import { skillRunsOf } from "../src/live/plan.mjs";
import { taskSessionMark } from "../src/memory/session.mjs";
import { printable } from "../src/printable.mjs";
import { createProcess } from "../src/process/index.mjs";
import { command } from "../src/project/command.mjs";
import { switchOf } from "../src/project/env.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { runtimeProject } from "../src/runtime/context.mjs";
import { projectionOf } from "../src/skill-factory/source.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { machineContext } from "../src/store/context.mjs";
import { realIo } from "../src/store/io.mjs";
import { fingerprintOf } from "../src/task/approvals.mjs";
import { loadTask } from "../src/task/load.mjs";
import { apply, createTask } from "../src/task/ops.mjs";
import { recentOf } from "../src/task/recent.mjs";
import { createTasks } from "../src/task/store.mjs";
import { eventsView, taskView } from "../src/task/views.mjs";
import { createEmitter } from "../src/trace/emit.mjs";
import { traceLog } from "../src/trace/log.mjs";
import { improvementPorts } from "../satellite/cli/improvement.mjs";

const ENV = commandEnvironment(process.env, process.argv);
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);
const HOOK = args.includes("--hook");

// What a session or a hook may run with this project's own capabilities loaded: every command that may validate a
// candidate (its needs must be provided) or run an evaluation through the resolver.
const RESOLVING = ["analyse", "start", "step", "resume", "evaluate", "candidate", "link"];

async function main() {
  const entry = Object.hasOwn(COMMANDS, cmd ?? "") ? COMMANDS[cmd] : null;
  if (!entry) return help();
  const result = await entry.run(await portsHere(), args);
  if (!HOOK) console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : printable(entry.say(result)));
}

const nowIso = () => new Date().toISOString();

const quietly = (fn) => {
  try { return fn(); }
  catch { return null; }
};

const lazy = (make) => {
  let made = null;
  return () => (made ??= make());
};

// ---- the checkout, its settings and its rooms ------------------------------------------------------------------------

function here() {
  const { paths, config } = runtimeProject(ENV, process.cwd());
  if (paths.layout !== 3 || !paths.checkoutId) throw new Refused("self-improvement works from a Git checkout — run it inside one");
  return { paths, config, io: machineContext({ project: paths, config: config ?? {} }, ENV).io, proc: createProcess() };
}

const machineFile = () => join(stateRooms(storeBase(ENV)).automation, "settings.json");

const projectFile = (h) => join(h.paths.storeRoot, "automation", "settings.json");

function settingsOf(h) {
  const machine = readAutomation(h.io, machineFile());
  const project = readAutomation(h.io, projectFile(h));
  return { machine, project, effective: effectiveOf([{ by: "machine", content: machine.content }, { by: "project", content: project.content }]) };
}

const session = () => taskSessionMark(ENV.ORBIT_SESSION);

// ---- the evaluation task's door: the improvement engine's own, which proves no person ---------------------------------

const taskContext = (h) => ({ tasks: createTasks(h.paths.storeRoot, h.io), project: h.paths.storeKey, checkout: h.paths.checkoutId, session: session(), now: nowIso, door: "improvement" });

const viewed = (ctx, id) => ((t) => taskView(t.model, t.now))(loadTask(ctx, id));

const taskPort = (ctx) => ({ apply: (id, op, given) => apply(ctx, id, op, given), view: (id) => viewed(ctx, id), events: (id) => eventsView(loadTask(ctx, id).model).events, fingerprint: (g) => fingerprintOf(g) });

// A running action a gone process left on an evaluation task: closed the way the coordinator's reconcile closes one --
// INTERRUPTED (it read, so the next attempt asks again), never run again by itself.
function closedDead(task, id) {
  const view = task.view(id);
  const open = view.actions.filter((a) => a.state === "running");
  open.forEach((act) => [...interruptedRunOps(view, act), ...interruptedStepOps(view, act)].forEach(([op, given]) => task.apply(id, op, given)));
  return open.length;
}

const projections = (factory, pins) => Object.fromEntries(pins.map((pin) => [pin, quietly(() => projectionOf(factory.workflow(pin)))]).filter(([, v]) => v));

function evaluationPort(h, tctx, factory, skillPorts) {
  const task = taskPort(tctx);
  return { create: (spec) => createTask(tctx, { project: tctx.project, checkout: tctx.checkout, objective: spec.objective, provider: "improvement", actions: spec.actions, attempts: 1 }).task, apply: task.apply, view: task.view, events: task.events, run: (lw, step, dispatch) => skillRun(skillPorts, lw, step, dispatch), runIdOf, runsOf: (id, pins) => skillRunsOf(null, task.view(id), task.events(id), projections(factory, pins)), closeDead: (id) => closedDead(task, id) };
}

// The inputs an evaluation runs on: the coordinator tasks whose runs showed the problem, as THIS checkout sees them.
const inputsOf = (tctx) => (tasks) => (tasks ?? []).map((id) => quietly(() => viewed(tctx, id))).filter(Boolean).map((v) => ({ task: v.task.id, objective: v.task.objective, ref: v.task.root ?? null }));

// ---- Satellite: bound beside its own composition root (satellite/cli/improvement.mjs) ------------------------------------

const satellitePorts = (h) => improvementPorts({ io: h.io, storeRoot: h.paths.storeRoot, now: nowIso });

// ---- the skill factory, as the owner of every playbook version -----------------------------------------------------------

const skillRecords = (factory) => factory.list().filter((r) => r.runs === "declared").flatMap((r) => quietly(() => factory.runs(r.id)) ?? []);

// ---- learning, the trail, the reuse a metric needs ---------------------------------------------------------------------

function learned(h, finding) {
  const store = createLessons(h.paths.storeRoot, h.io, { envOff: switchOf(ENV, "LEARN", "learn", true) ? null : "ORBIT_LEARN=off" });
  if (!store.auto().on) return { kept: false, because: `learning is off here (${store.auto().why}) — nothing was kept` };
  const r = promote(store, [finding], { now: nowIso });
  return r.written.length ? { id: r.written[0].id, state: r.written[0].state, kept: true, because: `kept as a lesson (${r.written[0].state}): ${r.written[0].because}` } : { id: r.observations[0]?.id ?? r.suppressed[0]?.id ?? null, kept: false, because: r.observations[0]?.why ?? r.suppressed[0]?.why ?? "nothing to keep" };
}

function emitterFor(h) {
  const io = realIo();
  const emit = createEmitter({ log: traceLog(stateRooms(storeBase(ENV)), io), now: io.now, session: ENV.ORBIT_SESSION ?? null, meta: ENV.ORBIT_HOST_PROTOCOL === "2" ? { v: 2, agentHost: ENV.ORBIT_HOST } : {}, project: short(h.paths.storeKey ?? "?", 12) });
  return (type, data) => (switchOf(ENV, "TRACE", "trace", true) ? emit(type, data) : null);
}

const promotedModels = (store) => store.list().map((id) => campaignModel(store.read(id) ?? [])).filter((m) => m.promoted);

const reuseOf = (store, history) => () => ((pairs) => (pairs.length ? { reused: pairs.reduce((n, p) => n + p.reused, 0), eligible: pairs.reduce((n, p) => n + p.eligible, 0) } : null))(promotedModels(store).map((m) => ((runs) => ({ reused: runs.filter((r) => (r.pin ?? r.rolePin) === m.promoted.to).length, eligible: runs.length }))((quietly(() => history({ kind: m.meta.subjectKind, id: m.meta.subjectId })) ?? []).filter((r) => String(r.at) > String(m.promoted.at)))).filter((p) => p.eligible > 0));

const docRow = (name, d) => ({ name, ok: !d.unreadable, say: d.unreadable ? `unreadable (${d.unreadable})` : d.exists ? `revision ${d.revision}` : "not set — defaults apply" });

const switchRow = (s, key) => ((f) => ({ name: key, ok: true, say: `${f.value} (set by ${f.by})` }))(s.effective.fields[key]);

const doctorOf = (h, store) => () => ((s) => [docRow("machine settings", s.machine), docRow("project settings", s.project), ...["improvement.detect", "improvement.generate", "improvement.evaluate", "improvement.promote", "improvement.minSessions", "improvement.isolation"].map((k) => switchRow(s, k)), { name: "learning", ok: true, say: switchOf(ENV, "LEARN", "learn", true) ? "on — a settled campaign's finding goes to learn's own ladder" : "off (ORBIT_LEARN) — nothing is kept" }, { name: "last analyse", ok: true, say: store.analysed()?.at ?? "never" }])(settingsOf(h));

// ---- the ports --------------------------------------------------------------------------------------------------------

async function portsHere() {
  const h = here();
  const caps = RESOLVING.includes(cmd) ? await extended(ENV, h.paths.root) : null;
  return assembled(h, { effective: lazy(() => effectiveFor(h, caps, { pluginRoot: PLUGIN_ROOT, env: ENV, values: settingsOf(h).effective.values })), caps });
}

function assembled(h, lz) {
  const tctx = taskContext(h);
  const store = createImprovement(h.paths.storeRoot, h.io);
  const factory = factoryPort(h, () => settingsOf(h).effective.values, (cap) => resolvedOne(lz.effective(), cap), { history: { tasks: lazy(() => recentOf({ tasks: tctx.tasks, now: nowIso }, "automation")), runsOf: skillRunsOf } });
  const skillPorts = { task: taskPort(tctx), resolve: (cap) => resolvedOne(lz.effective(), cap), invoke: invokePort(h, lz, { pluginRoot: PLUGIN_ROOT, env: ENV, session: session() }), factory, investigations: { outcome: () => null }, child: { view: (id) => viewed(tctx, id) }, requirements: { look: () => null }, now: nowIso };
  return portsOf(h, { tctx, store, factory, skillPorts, sat: satellitePorts(h) });
}

function portsOf(h, p) {
  const history = (subject) => (subject.kind === "satellite" ? p.sat.records().filter((r) => String(r.rolePin).startsWith(`${subject.id}:`)) : quietly(() => p.factory.runs(subject.id)) ?? []);
  return { store: p.store, ctx: { store: p.store, door: "improvement", session: session(), host: h.io.host, pid: process.pid, now: nowIso }, values: () => settingsOf(h).effective.values, now: nowIso, nowMs: () => Date.now(), records: () => [...skillRecords(p.factory), ...(quietly(p.sat.records) ?? [])], history, inputsOf: inputsOf(p.tctx), subjects: { skill: improvementSubject(p.factory), satellite: p.sat.subject }, evaluation: evaluationPort(h, p.tctx, p.factory, p.skillPorts), missions: p.sat.missions, liveness: ({ host, pid }) => (host !== h.io.host ? null : h.proc.alive(pid)), learn: (finding) => learned(h, finding), trace: emitterFor(h), reuse: reuseOf(p.store, history), doctor: doctorOf(h, p.store), readJson: (file) => readJson(file) };
}

function readJson(file) {
  try { return JSON.parse(readFileSync(file, "utf8")); }
  catch { throw new Refused(`${file} is not a JSON document this command can read`); }
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

// A hook's own process says nothing and always ends well: what it could not do is the next session's to find.
const hooked = async () => {
  try { await main(); }
  catch { process.exitCode = 0; }
};

command(HOOK ? hooked : main);
