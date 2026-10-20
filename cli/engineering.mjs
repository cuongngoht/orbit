#!/usr/bin/env node
// This project's ENGINEERING memory: how it tends, or is required, to build
// code -- src/architecture/'s "what does this project structurally look
// like" answered for a different question. See AGENTS.md's roadmap for the
// analysers, the working set and the observer agent that will fill this in
// automatically; today a fact arrives only through `record`, and every one is
// reconciled (src/engineering/ingest.mjs) rather than written over.
//
//   node engineering.mjs facts [<kind>]      the index of what is known
//   node engineering.mjs why <fact-id>       one fact: evidence, provenance, what it cannot know
//   node engineering.mjs record [<file>] [--human] [--dry]
//                                             validated candidates, RECONCILED into the store —
//                                             stdin when no file. Confidence is derived, never
//                                             supplied. --human unlocks adopted, and enforced
//                                             with an enforcedBy gate; without it, only
//                                             observed/suggested may be claimed
//   node engineering.mjs where               where the store is kept, and why there
//   node engineering.mjs ensure [--for="…"] [--dry]
//                                             is what is recorded still current, and does it
//                                             speak to the task? restamps status only
//   node engineering.mjs observe [--all | --scopes=a,b] [--dry]
//                                             run the deterministic observer now: candidates from
//                                             file names and the session's checks, reconciled
//   node engineering.mjs journal [<fact-id>]  every observation behind a fact, in order
//   node engineering.mjs replay               re-derive every fact from the journal; writes nothing
//   node engineering.mjs recall [--for="…"] [--json]
//                                             the few facts that bear on a task, each with how
//                                             far it may steer the work (hint · context ·
//                                             convention · constraint)
//   node engineering.mjs doctor [--json]     is the observer on here, has it run, and what
//                                             stopped it: the switches in effect, the observations
//                                             per host, this session's checkpoint queue, and the
//                                             findings a refusal or a failed hook left
//
// The store lives OUTSIDE every repository, in the same machine store as the
// lessons and the architecture facts. Nothing here is ever written into a
// working tree, and no command in this file modifies the project it reads.
//
// Exit 0 = done · 2 = REFUSED (bad usage, an unknown id, a refused batch) ·
// 3 = BLOCKED (no readable checkout, nowhere on this machine to keep a
// snapshot). Never 1: this command asks the product nothing, so it can never
// find the product wrong.
import { taskArguments } from "../src/process/task-input.mjs";
import { readFileSync as readTaskStdin } from "node:fs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Blocked, EXIT, Refused } from "../src/run/errors.mjs";
import { COMMANDS, runEngineering } from "../src/engineering/index.mjs";
import { engineeringContext } from "../src/engineering/context.mjs";
import { createContext } from "../src/run/context.mjs";
import { createArchitecture } from "../src/architecture/store.mjs";
import { createWorkingSet } from "../src/engineering/working-set/store.mjs";
import { fold } from "../src/engineering/working-set/fold.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { realIo } from "../src/store/io.mjs";
import { join } from "node:path";
import { finalizerStore } from "../src/lifecycle/finalizer-store.mjs";
import { PLUGIN_OPTION, fromEnv, sourceName, switchOf } from "../src/project/env.mjs";

import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
const ENV = commandEnvironment(process.env, process.argv);

const [cmd, ...args] = taskArguments(process.argv.slice(2), () => readTaskStdin(0, "utf8"));

function main() {
  if (!COMMANDS[cmd]) return help();
  try {
    runEngineering(ready(), cmd, args);
  } catch (e) {
    stopped(e);
  }
}

// `gates` is computed HERE and handed in as data -- the paths the architecture
// facts say this project runs as a gate on itself -- the same way `cli/`
// hands architecture the layer tooling: nothing under src/engineering/ reads
// the architecture store, so no new lateral edge exists between them.
function ready() {
  const ctx = engineeringContext(createContext({}, ENV), ENV);
  return { ...ctx, seenBy: ENV.ORBIT_SESSION ? { host: ctx.io.host, at: ctx.io.now(), session: ENV.ORBIT_SESSION } : undefined, read: readInput, now: () => new Date().toISOString(), gates: () => gatesOf(ctx), session: () => sessionOf(ctx), near: () => sessionOf(ctx).scopes, switches: () => switchesOf(ENV), queue: () => queueOf(ctx) };
}

// What `doctor` shows of this machine (src/engineering/views/doctor.mjs): each switch the observer depends on, in
// effect, and who set it -- an exported variable, the plugin's setting, or the default.
const SWITCHES = [["engineering_observe", "ENGINEERING_OBSERVE"], ["working_set", "WORKING_SET"], ["trace", "TRACE"]];

const setBy = (env, suffix, key) => (fromEnv(env, suffix) !== undefined ? sourceName(env, suffix) : env[PLUGIN_OPTION + key.toUpperCase()] !== undefined ? "the plugin's setting" : "default");

const switchesOf = (env) => [...SWITCHES.map(([name, suffix]) => ({ name, on: switchOf(env, suffix, name, true), source: setBy(env, suffix, name) })), { name: "lessons (ORBIT_LEARN)", on: String(fromEnv(env, "LEARN") ?? "").toLowerCase() !== "off", source: fromEnv(env, "LEARN") !== undefined ? sourceName(env, "LEARN") : "default" }];

// A protocol-2 session's checkpoint queue, in that session's own room; a protocol-1 host keeps none.
function queueOf(ctx) {
  if (ENV.ORBIT_HOST_PROTOCOL !== "2") return null;
  const jobs = finalizerStore(join(workingSetDir(ctx.project), "finalizer"), realIo()).pending();
  return { pending: jobs.filter((j) => j.state === "pending").length, leased: jobs.filter((j) => j.state === "leased").length };
}

// The session a shell command is working in, as far as anything can tell: the
// working set written to most recently in this checkout. A shell has no host
// session of its own, so this is a best guess and is only ever used to rank.
const sessionOf = (ctx) => fold(currentLines(createWorkingSet(workingSetDir(ctx.project), realIo())));

const gatesOf = (ctx) => new Set(createArchitecture(ctx.store.root, ctx.io).all().filter((f) => f.kind === "invariant").flatMap((f) => f.evidence ?? []));

// stdin when no path is named, because an observer agent has no Write: it
// reports candidates and the parent pipes them here.
function readInput(path) {
  try {
    return readFileSync(path ?? 0, "utf8");
  } catch (e) {
    throw new Refused(`cannot read ${path ?? "stdin"}: ${e.message}`);
  }
}

function help() {
  const lines = readFileSync(fileURLToPath(import.meta.url), "utf8").split("\n").slice(1);
  const end = lines.findIndex((l) => !l.startsWith("//"));
  console.log(lines.slice(0, end).join("\n"));
}

function stopped(e) {
  if (e instanceof Refused) return exitWith("REFUSED", e.message);
  if (e instanceof Blocked) return exitWith("BLOCKED", `BLOCKED: ${e.message}`);
  throw e;
}

function exitWith(status, text) {
  console.error(text);
  process.exit(EXIT[status]);
}

main();

function currentLines(ws) { return ENV.ORBIT_SESSION ? ws.read(ENV.ORBIT_SESSION) : ENV.ORBIT_HOST_PROTOCOL === "2" ? [] : ws.latest(); }
