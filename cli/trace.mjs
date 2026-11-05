#!/usr/bin/env node
// The SESSION TRAIL from a terminal: how sessions went, prompt by prompt, and
// how Orbit is used. The same projections Orbit Control's Trace and Analytics
// pages read (src/trace/projections/).
//
//   node trace.mjs turns [--days=1] [--session=<id>] [--limit=20] [--json]
//                                   one line per prompt: what the router decided, the
//                                   path the session took, whether it followed
//   node trace.mjs turn <turn-id> [--json]
//                                   one prompt in full: the requirement graph, every step
//   node trace.mjs usage [--days=30] [--json]
//                                   commands, skills, flows, failures, least privilege
//   node trace.mjs activation [--days=1] [--session=<id>] [--limit=20] [--json]
//                                   0.5.0: each turn's activation chain -- suggested, selected,
//                                   dispatched, executed, verified -- each link from its own
//                                   source with its basis, and per work; a turn that dispatched
//                                   more of Orbit's agents than its strategy accounted for is
//                                   OVER-DELEGATED. Verified comes only from the work view of
//                                   this checkout's tracked works, read back from their owners
//   node trace.mjs where            where the trail is kept, and what it never keeps
//
// It writes nothing. What the trail holds is recorded by the hooks (the plugin
// option `trace`, or ORBIT_TRACE) and is metadata only: never a prompt's text, a
// response, an argument, a tool's output, a path or a file's contents.
//
// Exit 0 = printed · 2 = REFUSED (bad usage, an unknown turn).
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { CHECKS as CHECK_CLASSES } from "../src/engineering/working-set/collect.mjs";
import { short } from "../src/hash.mjs";
import { sessionActivityOf, sessionLinesOf } from "../src/live/session.mjs";
import { taskSessionMark } from "../src/memory/session.mjs";
import { command } from "../src/project/command.mjs";
import { switchOf } from "../src/project/env.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { runtimeProject } from "../src/runtime/context.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { machineContext } from "../src/store/context.mjs";
import { realIo } from "../src/store/io.mjs";
import { COMMANDS as TASK_COMMANDS } from "../src/task/index.mjs";
import { createTasks } from "../src/task/store.mjs";
import { traceLog } from "../src/trace/log.mjs";
import { activationView, turnsView, turnView, usageView, whereView } from "../src/trace/views.mjs";
import { createWorks } from "../src/work/store.mjs";
import { readView } from "../src/work/track/read.mjs";
import { scanOf, timelineOf, trackedIn } from "../src/work/track/resolve.mjs";
import { workingSetOf } from "../src/work/track/tail.mjs";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = process.argv.slice(2);

const COMMANDS = { turns: turnsView, turn: turnView, usage: usageView, activation: activationView, where: whereView };

function main() {
  if (!COMMANDS[cmd]) return help();
  COMMANDS[cmd](contextOf(), args);
}

const contextOf = () => ({ log: traceLog(stateRooms(storeBase(process.env)), realIo()), now: () => new Date().toISOString(), on: switchOf(process.env, "TRACE", "trace", true), allowed: () => allowedTools(join(PLUGIN_ROOT, "skills")), ...(cmd === "activation" ? { work: workReader(), via: viaOf() } : {}) });

// ---- what the activation chain is handed (0.5.0): the work views, and the catalog's `via` -----------------------------

// The agents a parent skill alone dispatches, as the catalog says (catalog/components.json `via`).
const viaOf = () => quietly(() => Object.fromEntries(Object.entries(readCatalog(realIo(), catalogFile(PLUGIN_ROOT, "components")).agents ?? {}).filter(([, row]) => Array.isArray(row.via)).map(([id, row]) => [id, row.via]))) ?? {};

// The work a turn served, read back the way `track status` reads it (src/work/track/read.mjs): the work this turn's
// session was bound to when the turn ended, in THIS checkout -- a turn of another project, or of no tracked work, is
// handed no view, and its verified link says so.
function workReader() {
  const here = quietly(() => runtimeProject(process.env, process.cwd()));
  if (here?.paths?.layout !== 3 || !here.paths.checkoutId) return () => null;
  return viewsFor(workContext(here.paths, here.config), short(here.paths.storeKey ?? "?", 12));
}

function viewsFor(ctx, project) {
  const scan = once(() => scanOf(ctx.works));
  const views = new Map();
  return (turn) => (turn.session && turn.project === project ? quietly(() => viewOfTurn(ctx, scan(), views, turn)) : null);
}

function viewOfTurn(ctx, scan, views, turn) {
  const end = turn.endedAt ?? ctx.now();
  const bound = timelineOf(trackedIn(scan, ctx.checkout), taskSessionMark(turn.session)).find((b) => b.at <= end);
  if (!bound) return null;
  if (!views.has(bound.work)) views.set(bound.work, readView(ctx, bound.work, scan));
  return views.get(bound.work);
}

function workContext(paths, config) {
  const io = machineContext({ project: paths, config: config ?? {} }, process.env).io;
  const tasks = createTasks(paths.storeRoot, io);
  const now = () => new Date().toISOString();
  return { works: createWorks(paths.storeRoot, io), now, nowMs: Date.now(), idleAfterMs: 120_000, checkout: paths.checkoutId, host: null, workingSet: workingSetOf(realIo(), quietly(() => workingSetDir(paths)) ?? join(paths.sessionDir, "working-set"), "ok"), activity: { linesOf: sessionLinesOf, activityOf: sessionActivityOf, checks: CHECK_CLASSES }, taskView: (id) => TASK_COMMANDS.show.run({ tasks, checkout: paths.checkoutId, now }, [id]) };
}

function once(fn) {
  const memo = {};
  return () => ("value" in memo ? memo.value : (memo.value = fn()));
}

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

// Each shipped skill's `allowed-tools`, off its SKILL.md frontmatter -- the
// other half of the least-privilege join.
function allowedTools(dir) {
  const skills = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
  return new Map(skills.map((name) => [name, toolsIn(read(join(dir, name, "SKILL.md")))]));
}

function toolsIn(text) {
  const front = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
  const block = /^allowed-tools:\s*\n((?:\s+-\s.*\n?)*)/m.exec(front)?.[1] ?? "";
  return [...block.matchAll(/^\s+-\s+(.*)$/gm)].map((m) => m[1].trim());
}

function read(file) {
  try { return readFileSync(file, "utf8"); }
  catch { return ""; }
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

command(main);
