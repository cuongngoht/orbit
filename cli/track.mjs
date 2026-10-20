#!/usr/bin/env node
// TRACK: the ONE work a request is, from /orbit-help to what it came to -- whether the host works it in this session
// (developer) or an engineering task or a coordinated workflow takes it (autonomous). A tracked work keeps identity, links,
// a reported lifecycle and a short summary in the work journal, and nothing else: what a task did, which verdict a check
// earned and what was changed stay with their owners and are READ BACK on every `status`. Tracking turns no Automation
// on, creates no task or sandbox, grants nothing and runs no workflow; a /orbit-help with no concrete task tracks nothing.
//
//   node track.mjs track "<the request, in one sentence>" [--route=<the NEXT help named> --because="<why>"
//                        --skill=<orbit-help> --ref=<item id | req-… | rs-…> --continue=<w-…> --mode=developer|autonomous
//                        --eid=<event id>]
//                                          create the work (or find it) and bind THIS session to it. --continue names a work,
//                                          reopened when it was closed; --ref names the item's work (the requirement's, when
//                                          one is kept); neither derives the id from this session, this checkout and the
//                                          request -- a replay finds the open work, a repeat after it closed is a new one, and
//                                          a title alone never merges two sessions. With no session mark and no --ref or
//                                          --continue nothing is tracked, and that is not an error
//   node track.mjs status [<work>]         the one picture: lifecycle, evidence, files and checks OBSERVED, linked tasks,
//                                          handoffs and the host's limits. No work named: this session's current one
//   node track.mjs current                 the work this session is bound to, if any
//   node track.mjs link [<work>] --task=<tsk-…> | --workflow=<tsk-…> | --investigation=<inv-…> [--role=<word>]
//                                          a task, a coordinated workflow or an investigation joins the work (repeat is a no-op)
//   node track.mjs handoff [<work>] --to=developer|autonomous [--task=<tsk-…> | --workflow=<tsk-…>] [--because="…"]
//                                          the work changes hands; the same id and history, one line more. A no-op when it is
//                                          already there
//   node track.mjs state [<work>] --state=working|waiting|blocked|paused|failed|cancelled
//                        [--wait=user|permission|environment --why="…" --occurred=<ISO> --reopen --eid=<event id>]
//                                          how the work stands, as reported. failed and cancelled close it; a closed work
//                                          moves only with --reopen, so a late line changes nothing
//   node track.mjs report [<work>] --outcome=done|failed|cancelled|blocked [--summary="…" --proved="…" --unverified="…"
//                        --blocked="…" --evidence=<task:tsk-…> --eid=<event id>]
//                                          what the host says it came to. The files changed and the checks run are copied from
//                                          what was OBSERVED, never typed; "done" is reported, and it is `verified` only when a
//                                          linked task completed and nothing was edited after it
//   node track.mjs list                    this checkout's tracked works
//   node track.mjs coverage [--host=<name>] what this host lets tracking observe, and what it cannot
//
// Every command takes --json. A <work> is a w- id; left out, it is this session's current work.
//
// This file is the one COMPOSITION ROOT for src/work/track/ here: the work room, the session's mark, the working set's
// tail and the linked tasks' views are bound HERE and handed in, so nothing under src/work/ reads the environment, a
// terminal or a task's journal. It needs no ui-tests/: a Git checkout is enough. The working set is read only for what the
// host's hooks already kept; a host that keeps none is said so by `coverage`, and nothing is made up.
//
// Exit 0 = done (nothing tracked, or nothing to change, is not a failure) · 2 = REFUSED (bad usage, an unknown or untracked
// work, an id that is not that thing's shape) · 3 = BLOCKED (another session holds the work, nowhere to keep anything). Never 1.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { CHECKS as CHECK_CLASSES } from "../src/engineering/working-set/collect.mjs";
import { Refused } from "../src/errors.mjs";
import { sessionActivityOf, sessionLinesOf } from "../src/live/session.mjs";
import { taskSessionMark } from "../src/memory/session.mjs";
import { printable } from "../src/printable.mjs";
import { command } from "../src/project/command.mjs";
import { switchOf } from "../src/project/env.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { requirementsContext } from "../src/requirements/context.mjs";
import { runtimeProject } from "../src/runtime/context.mjs";
import { machineContext } from "../src/store/context.mjs";
import { realIo } from "../src/store/io.mjs";
import { COMMANDS as TASK_COMMANDS } from "../src/task/index.mjs";
import { createTasks } from "../src/task/store.mjs";
import { requirementOf } from "../src/work/requirement.mjs";
import { createWorks } from "../src/work/store.mjs";
import { COMMANDS } from "../src/work/track/index.mjs";
import { observeOf } from "../src/work/track/read.mjs";
import { workingSetOf } from "../src/work/track/tail.mjs";

const ENV = commandEnvironment(process.env, process.argv);
const [cmd, ...args] = process.argv.slice(2);
const IDLE_AFTER_MS = 120_000;

function main() {
  const entry = Object.hasOwn(COMMANDS, cmd ?? "") ? COMMANDS[cmd] : null;
  if (!entry) return help();
  const ctx = here();
  printed(entry, entry.run(entry.needs === "view" ? { ...ctx, observe: (id) => observeOf(ctx, id) } : ctx, args));
}

function printed(entry, result) {
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : printable(entry.say(result)));
}

const quietly = (fn) => {
  try {
    return fn();
  } catch {
    return null;
  }
};

const hostName = () => (/^[a-z][a-z0-9-]{0,39}$/.test(ENV.ORBIT_HOST ?? "") ? ENV.ORBIT_HOST : "claude");

// The requirement kept for an item, or none: asked only when `--ref` names one, and never able to stop the tracking.
const requirementIn = (paths, config) => (ref) => quietly(() => requirementOf({ requirements: requirementsContext({ project: paths, config: config ?? {} }, ENV).requirements }, ref));

const workingDirOf = (paths) => quietly(() => workingSetDir(paths)) ?? join(paths.sessionDir, "working-set");

const sourceOf = () => (switchOf(ENV, "WORKING_SET", "working_set", true) ? "ok" : "off");

// A task as its own journal says: this checkout's only, through the same `show` every reader uses.
const taskViewIn = (tasks, checkout, now) => (id) => TASK_COMMANDS.show.run({ tasks, checkout, now }, [id]);

const activity = () => ({ linesOf: sessionLinesOf, activityOf: sessionActivityOf, checks: CHECK_CLASSES });

// The checkout this command runs in, keyed the way every subject keys it. Reading binds nothing: the first write does.
function here() {
  const { paths, config } = runtimeProject(ENV, process.cwd());
  if (paths.layout !== 3 || !paths.checkoutId) throw new Refused("a tracked work belongs to a Git checkout — run this inside one");
  const machine = machineContext({ project: paths, config: config ?? {} }, ENV);
  return bound(paths, config, machine.io);
}

function bound(paths, config, io) {
  const now = () => new Date().toISOString();
  const tasks = createTasks(paths.storeRoot, io);
  return { works: createWorks(paths.storeRoot, io), now, nowMs: Date.now(), idleAfterMs: IDLE_AFTER_MS, session: taskSessionMark(ENV.ORBIT_SESSION), checkout: paths.checkoutId, host: hostName(), requirementOf: requirementIn(paths, config), workingSet: workingSetOf(realIo(), workingDirOf(paths), sourceOf()), activity: activity(), taskView: taskViewIn(tasks, paths.checkoutId, now) };
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

command(main);
