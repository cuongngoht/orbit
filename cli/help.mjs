#!/usr/bin/env node
// The project navigator: one bounded read of what this project already knows
// — architecture, the UI map, the QA plans, the lessons — and exactly one
// recommended `orbit-*` workflow to run next, with the reason.
//
//   node help.mjs             the recommendation, printed
//   node help.mjs --for="…"   the same, for one task: a change to the code goes to
//                             orbit-develop, a question about MCP servers or tools
//                             to orbit-control -- once architecture is current
//   node help.mjs --json      the same gathered state, for a machine
//
// It never scans (that is `architecture ensure`'s job), never validates a plan
// into the store and never drives a browser. Its ONE write (1.8.9) is the
// project's seat in the machine store (src/seat.mjs), the first time anybody
// asks in a Git checkout: the checkout bound, and the least its store needs to
// hold its test data -- never a screen, a case or a guess, and never a byte in
// the checkout. A store that cannot be written here is said under BLOCKERS and
// the navigator reads what it can. What it cannot back with evidence is
// reported as UNKNOWN, never guessed, and a task's text is classified in memory
// and never kept.
//
// Exit 0 = printed · 2 REFUSED (an invalid project.json) · 3 BLOCKED (the
// machine store could not be resolved).
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { drainLater, hostFlags, protocolTwo } from "../skills/orbit-learn/hosts/drain.mjs";
import { effectiveOf, readAutomation } from "../src/automation/settings.mjs";
import { workflowOf } from "../src/automation/workflows.mjs";
import { Blocked } from "../src/errors.mjs";
import { command } from "../src/project/command.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { createContext } from "../src/run/context.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { automationOnly, help } from "../src/help/view.mjs";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { taskArg } from "../src/help/model.mjs";
import { learnContext } from "../src/learn/context.mjs";
import { classify } from "../src/routing/classify.mjs";
import { runtimeProject } from "../src/runtime/context.mjs";
import { ensureProject } from "../src/seat.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";

const args = process.argv.slice(2);
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// With the project's own extensions loaded: help counts plans that do not
// check, and a plan is checked against the vocabulary its cases really use.
async function main() {
  const seat = seated();
  drained();
  const automation = automationOf(taskArg(args));
  const ctx = await readable(automation);
  if (ctx) help({ ...ctx, automation, seat, capabilities: capabilities() }, args);
}

// The workflows this plugin ships, as its own catalog lists them (catalog/components.json): what CAPABILITIES shows
// when nobody named a task. A catalog that cannot be read leaves the list empty, never the navigator.
function capabilities() {
  try { return Object.entries(readCatalog(realIo(), catalogFile(PLUGIN_ROOT, "components")).skills ?? {}).map(([id, row]) => ({ id, summary: row.summary ?? "", provides: row.provides ?? [] })); }
  catch { return []; }
}

// A protocol-2 session's queued engineering checkpoints, drained in the background by the session's own command
// (skills/orbit-learn/hosts/drain.mjs) -- the fallback for a host that let its hook's own drain go. A session of any
// other host has no queue, and nothing is started for it.
function drained() {
  if (protocolTwo(process.env, process.argv)) drainLater(PLUGIN_ROOT, process.env, { flags: hostFlags(process.argv) });
}

// The project seated in the machine store, or why not: outside a Git checkout there is nothing to seat (the
// navigator then says what it can, as before), and a store this machine cannot write is a blocker, never a reason
// to write anywhere else.
function seated() {
  try { return ensureProject(process.env, process.cwd()); }
  catch (e) { return e instanceof Blocked ? { status: "blocked", because: e.message, created: [] } : null; }
}

// The project as the navigator reads it -- or, where it cannot (no UI test data), the coordinator's answer
// for a task Automation would take, and the same refusal as before for anything else.
async function readable(automation) {
  try { return learnContext(await withExtensions(createContext())); }
  catch (e) { if (automationOnly(automation, taskArg(args), args, checkoutName()) === null) throw e; return null; }
}

function checkoutName() {
  try { return runtimeProject(process.env, process.cwd()).paths.storeKey ?? null; }
  catch { return null; }
}

// What the automation settings say, and whether a coordinated workflow fits the task -- read here, in
// memory, and handed to the navigator. Reading writes nothing; with no settings document at all (a fresh
// install) the defaults coordinate the task, and only a restriction a person kept says otherwise.
function automationOf(task) {
  if (!task) return null;
  const io = realIo();
  const docs = [{ by: "machine", content: readAutomation(io, join(stateRooms(storeBase(process.env)).automation, "settings.json")).content }, { by: "project", content: projectContent(io) }];
  return described(effectiveOf(docs), task);
}

function projectContent(io) {
  try { return readAutomation(io, join(runtimeProject(process.env, process.cwd()).paths.storeRoot, "automation", "settings.json")).content; }
  catch { return {}; }
}

function described(e, task) {
  const c = classify(task);
  const workflow = workflowOf({ ref: null, intent: c.intent.id, matched: c.matched, startable: [], playbook: { capability: c.requirements[0] ?? null } });
  return { coordinates: workflow.id !== "none", workflow: workflow.id };
}

command(main);
