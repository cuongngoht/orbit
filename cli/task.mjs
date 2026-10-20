#!/usr/bin/env node
// TASK: one autonomous EXECUTION of a work, recorded as it happens -- its stage, its attempts,
// what it decided and why, the actions it started, the receipts other domains hold for them --
// and governed by a person, here or in Orbit Control's Mission Control. A task RECORDS what an
// execution does; nothing here runs, stops, installs or writes anything but the task's journal.
//
//   node task.mjs create "<objective>" [--work=w-… --root=req-… --snapshot=rs-… --digest=<hex>
//                        --base=<commit> --workspace=<id> --provider=<id> --actor=<label>
//                        --attempts=8 --actions=100 --minutes=<n>]
//                                          start a task in this checkout; one at a time per work
//   node task.mjs stage <task> <STAGE> [--because="…"]
//                                          REQUIREMENT CONTEXT ENVIRONMENT WORKSPACE PLANNING
//                                          IMPLEMENTING BUILDING TESTING DIAGNOSING FIXING
//                                          REGRESSION REVIEWING
//   node task.mjs attempt start <task> [--cause=fresh|fix|retest|retry]
//                         attempt complete <task> --outcome=succeeded|failed|abandoned
//                                          [--signature=<12-hex hash of the failure>]
//   node task.mjs decide <task> --observed="…" --hypothesis="…" --next=<next-action>
//                                          [--evidence=<id>,<id>] [--reason="…"]
//                                          what was seen and what comes next -- a sentence each,
//                                          never a chain of thought
//   node task.mjs act start <task> --type=<action> [--tool= --label="…" --mutates]
//                                          [--approval=apr-n --environment= --params='{…}']
//                     act complete <task> <act> --outcome=… [--receipt=<domain:ref> --summary="…"]
//                     act fail <task> <act> [--reason="…" --summary="…"]
//   node task.mjs link workspace <task> --workspace=<id> [--base=<commit>]
//                      link file <task> --path=<repo-relative> --change=modified|added|deleted|renamed
//                                          [--added=<n> --removed=<n>]
//                      link receipt <task> --domain=<owner> --ref=<id> [--outcome=<its word>
//                                          --summary="…" --action=<act>]
//                      link verification <task> --obligation="…" --state=<…> [--evidence=<domain:ref>
//                                          --subject=<id>]
//   node task.mjs request-approval <task> --type=<action> --environment=<env> --reason="…" --risk="…"
//                                          [--tool= --params='{…}' --expires=<iso>]
//   node task.mjs approval expire <task> <apr>
//   node task.mjs block <task> --stop=<REASON> --needs=environment|capability|person|requirement
//   node task.mjs unblock <task> [--because="…"]
//   node task.mjs complete <task> [--summary="…"]
//   node task.mjs fail <task> --stop=<REASON> [--because="…"]
//   node task.mjs pause <task> --human --expect=<revision> [--because="…"]
//   node task.mjs cancel <task> --human --expect=<revision> [--because="…"]
//   node task.mjs reject <task> <apr> --human --expect=<revision> [--reason="…"]
//                                          a PERSON's decisions that STOP work, relayed: refused
//                                          without --human, and refused when the task moved past
//                                          the revision read.
//                                          Approve once and resume ALLOW something, so they are
//                                          decided in Orbit Control's Mission Control, whose page
//                                          proves a person: a terminal cannot prove who typed a
//                                          command, and this one refuses them
//   node task.mjs show <task>              where it stands: state, stage, attempt, decision, approvals
//   node task.mjs events <task> [--since=<n>]
//                                          its journal, line by line, from a position on
//   node task.mjs list                     this checkout's tasks
//   node task.mjs machine                  every task on this machine, across the projects Orbit knows
//   node task.mjs where                    where this checkout's tasks are kept
//
// Every command takes --json. A task is in THIS checkout's project, or in the one named with
// --project=<key> --checkout=<id> (`node cli/runtime.mjs projects` lists them).
//
// This file is the one COMPOSITION ROOT for tasks: the store, the registry, the clock and the
// session trail are bound here, so nothing under src/task/ reads the environment or a disk of
// its own. The trail gets the ids and counts of four moments -- never a sentence of a task.
//
// Exit 0 = done · 2 = REFUSED (bad usage, an unknown task, a rule that said no, a stale
// revision) · 3 = BLOCKED (another session holds the task, nowhere to keep anything). Never 1.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { Refused } from "../src/errors.mjs";
import { short } from "../src/hash.mjs";
import { taskSessionMark } from "../src/memory/session.mjs";
import { flag } from "../src/learn/args.mjs";
import { printable } from "../src/printable.mjs";
import { command } from "../src/project/command.mjs";
import { switchOf } from "../src/project/env.mjs";
import { projectStoreRoot, storeBase } from "../src/project/repository.mjs";
import { runtimeProject } from "../src/runtime/context.mjs";
import { machineContext } from "../src/store/context.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { guardedIo } from "../src/store/guard.mjs";
import { realIo } from "../src/store/io.mjs";
import { createRegistry } from "../src/store/registry.mjs";
import { COMMANDS } from "../src/task/index.mjs";
import { localDayStart } from "../src/task/machine.mjs";
import { createTasks } from "../src/task/store.mjs";
import { createWorks } from "../src/work/store.mjs";
import { attached, attachedLine, attachNamed } from "../src/work/track/auto.mjs";
import { hostFrom } from "../src/work/track/coverage.mjs";
import { createEmitter } from "../src/trace/emit.mjs";
import { traceLog } from "../src/trace/log.mjs";

const ENV = commandEnvironment(process.env, process.argv);
const [cmd, ...args] = process.argv.slice(2);

function main() {
  const entry = Object.hasOwn(COMMANDS, cmd ?? "") ? COMMANDS[cmd] : null;
  if (!entry) return help();
  if (entry.door === "control") throw new Refused(`${cmd} allows what a person withheld, so it is decided in Orbit Control's Mission Control, where the page proves the decision is a person's — a terminal cannot prove who typed it`);
  const ctx = BIND[entry.needs]();
  printed(entry, ctx, ran(entry, ctx));
}

const ran = (entry, ctx) => ((result) => (cmd === "create" ? tracked(ctx, result) : result))(entry.run(ctx, args));

function printed(entry, ctx, result) {
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : printable([entry.say(result), attachedLine(result.tracking)].filter(Boolean).join("\n")));
  emitted(ctx, result);
}

// A task that NAMES a tracked work (--work=w-…) joins it; a work nobody tracks is left as it was, and a failure to track is a
// warning that never touches the task.
function tracked(ctx, result) {
  const work = flag(args, "work");
  const tracking = work && result?.task && ctx.works ? attached(() => attachNamed({ works: ctx.works, checkout: ctx.checkout, session: ctx.session, host: hostFrom(ENV), now: ctx.now }, work, { task: result.task, what: "task", because: "an engineering task was recorded for this work" })) : null;
  return tracking ? { ...result, tracking } : result;
}

const session = () => taskSessionMark(ENV.ORBIT_SESSION);

const registryAt = (base, io) => createRegistry(stateRooms(base), io);

const bound = (project, checkout, checkoutSummary, tasks, works) => ({ tasks, works, project, checkout, checkoutSummary, session: session(), now: () => new Date().toISOString() });

// A checkout named on the line, found in the registry: its project's store, guarded.
function addressed() {
  const base = storeBase(ENV);
  const found = registryAt(base, realIo()).find(flag(args, "project"), flag(args, "checkout"));
  if (!found) throw new Refused("no project and checkout like that is known on this machine — `node cli/runtime.mjs projects` lists them");
  const root = projectStoreRoot(base, found.project.key);
  return bound(found.project.key, found.checkout.id, found.checkout, createTasks(root, guardedIo(root, realIo())), createWorks(root, guardedIo(root, realIo())));
}

// The checkout this command runs in: keyed the way every subject keys it, and bound to this
// machine's registry by its first write, the way every subject's first write binds it.
function here() {
  const { paths, config } = runtimeProject(ENV, process.cwd());
  if (paths.layout !== 3 || !paths.checkoutId) throw new Refused("a task belongs to a Git checkout — run this inside one, or name it with --project=<key> --checkout=<id>");
  const machine = machineContext({ project: paths, config: config ?? {} }, ENV);
  const entry = registryAt(paths.storeBase, realIo()).find(paths.storeKey, paths.checkoutId)?.checkout ?? null;
  return bound(paths.storeKey, paths.checkoutId, entry, createTasks(paths.storeRoot, machine.io), createWorks(paths.storeRoot, machine.io));
}

function machineBound() {
  const base = storeBase(ENV);
  const now = new Date().toISOString();
  return { registry: registryAt(base, realIo()), rootOf: (key) => projectStoreRoot(base, key), io: realIo(), now, since: localDayStart(now) };
}

// What each command's `needs` column asks the root to bind.
const BIND = { checkout: () => (flag(args, "project") || flag(args, "checkout") ? addressed() : here()), machine: machineBound };

// ---- the session trail: ids and counts, never a sentence of a task --------------------------

const firstLine = (r) => r.lines?.[0] ?? {};

const EVENTS = {
  create: (r) => ["task.started", { task: r.task }],
  attempt: (r) => ["task.attempt", { task: r.task, attempt: firstLine(r).id ?? null, outcome: firstLine(r).outcome ?? null }],
  reject: (r) => ["task.approval.decided", { task: r.task, approval: firstLine(r).id ?? null, decision: "rejected" }],
  complete: (r) => ["task.finished", { task: r.task, lifecycle: "COMPLETED" }],
  fail: (r) => ["task.finished", { task: r.task, lifecycle: "FAILED" }],
  cancel: (r) => ["task.finished", { task: r.task, lifecycle: "CANCELLED" }],
};

function emitted(ctx, result) {
  const event = Object.hasOwn(EVENTS, cmd) ? EVENTS[cmd](result) : null;
  if (event && switchOf(ENV, "TRACE", "trace", true)) quietly(() => emitterFor(ctx.project)(...event));
}

function emitterFor(project) {
  const io = realIo();
  const emit = createEmitter({ log: traceLog(stateRooms(storeBase(ENV)), io), now: io.now, session: ENV.ORBIT_SESSION ?? null, meta: ENV.ORBIT_HOST_PROTOCOL === "2" ? { v: 2, agentHost: ENV.ORBIT_HOST } : {}, project: short(project ?? "?", 12) });
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
