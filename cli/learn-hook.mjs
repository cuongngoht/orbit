#!/usr/bin/env node
// The host's lifecycle hooks, wired to the engine's subscribers.
//
//   stdin (the host's JSON) → the host adapter's `normalize`
//     → ONE lifecycle event (src/lifecycle/event.mjs)
//     → every subscriber that listens for it (src/lifecycle/dispatch.mjs)
//
// This file composes and does nothing else: it resolves the host, builds the
// lazily-bound contexts a subscriber may ask for, and decides which subscribers
// exist. What each one does is its own module:
//
//   switches      before a skill or an agent of this plugin starts: refused
//                 when its switch in the plugin's settings is off
//                 (`skill_<name>` / `agent_<name>`); unset is on
//   learning      session-start recall · fold a finished case in · hand back
//                 where to look after one of ours failed (writes nothing)
//   working-set   one line of metadata per tool the session used: what it read,
//                 changed, searched and ran -- never content, never output.
//                 a toggle in the plugin's settings (`working_set`), or
//                 ORBIT_WORKING_SET=off on one machine
//   engineering   at a MILESTONE only (a commit, the end of the session, a check
//                 passing after an edit), the deterministic observer proposes
//                 candidates and reconciliation decides. ON by default (1.8.9),
//                 bounded as it always was; the plugin's settings turn it off
//                 (`engineering_observe`), or ORBIT_ENGINEERING_OBSERVE=off on one
//                 machine. A protocol-2 host's checkpoint (Codex, Antigravity) is
//                 drained by a process of its own, bound to the same session
//   trace         the SESSION TRAIL (src/trace/): which skills and agents
//                 started, which Orbit commands and which classes of command ran,
//                 which tools were used, where a turn and a session ended --
//                 metadata as events, never content, never arguments. A toggle
//                 in the plugin's settings (`trace`), or ORBIT_TRACE=off
//
// Only a checkout the machine KNOWS is observed (1.8.9, knownCheckout): one
// somebody used Orbit in, one that commits its test data, or a ui-tests/
// directory named on purpose. Opening any repository with the plugin enabled
// writes nothing about it until a person asks for Orbit there.
//
// It ALWAYS exits 0, whatever happens. A tool that learns must never be able to
// stop a session, fail a turn, or make a passing command look like it failed.
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveHookHost } from "../skills/orbit-learn/hosts/index.mjs";
import { createContext } from "../src/run/context.mjs";
import { learnContext } from "../src/learn/context.mjs";
import { loadProject } from "../src/project/index.mjs";
import { lifecycleEvent } from "../src/lifecycle/event.mjs";
import { dispatch } from "../src/lifecycle/dispatch.mjs";
import { learning } from "../src/lifecycle/subscribers/learning.mjs";
import { workingSet } from "../src/lifecycle/subscribers/working-set.mjs";
import { engineering } from "../src/lifecycle/subscribers/engineering.mjs";
import { switches } from "../src/lifecycle/subscribers/switches.mjs";
import { engineeringContext } from "../src/engineering/context.mjs";
import { createArchitecture } from "../src/architecture/store.mjs";
import { createWorkingSet } from "../src/engineering/working-set/store.mjs";
import { createEngineering } from "../src/engineering/store.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { switchOf } from "../src/project/env.mjs";
import { engineName } from "../src/version.mjs";
import { realIo } from "../src/store/io.mjs";
import { insideRepo } from "../src/store/context.mjs";
import { scrub } from "../src/scrub.mjs";
import { trace } from "../src/lifecycle/subscribers/trace.mjs";
import { machineContext } from "../src/store/context.mjs";
import { within } from "../src/project/boundary.mjs";
import { documented, headerOf } from "../src/trace/commands.mjs";
import { createEmitter } from "../src/trace/emit.mjs";
import { traceLog } from "../src/trace/log.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { knownCheckout, storeBase } from "../src/project/repository.mjs";
import { short } from "../src/hash.mjs";

import { finalizer } from "../src/lifecycle/subscribers/finalizer.mjs";
import { finalizerStore } from "../src/lifecycle/finalizer-store.mjs";
import { hostStore } from "../src/host/store.mjs";
import { engineVersion } from "../src/version.mjs";
import { hostEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { drainLater as drainInBackground } from "../skills/orbit-learn/hosts/drain.mjs";
import { envFileOf, exportedSession } from "../skills/orbit-learn/hosts/claude-session.mjs";
import { liveSession } from "../src/lifecycle/subscribers/live-session.mjs";
import { effectiveSettings } from "../src/host/config.mjs";

let ENV = process.env;
const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Order is priority: the first subscriber with something to say to the host is
// the one the host hears -- so a refusal is heard before any permission answer.
// The trail speaks to nobody, so it goes last.
const SUBSCRIBERS = [switches, learning, workingSet, engineering, finalizer, liveSession, trace];

async function main() {
  const input = stdin();
  const host = await resolveHookHost(input, process.argv);
  ENV = hostEnvironment(process.env, host);
  return handle(host, input);
}

function handle(host, input) {
  const event = quietly(() => lifecycleEvent(host, input, process.argv));
  if (event?.protocol === 2 && event.session) ENV = { ...ENV, ORBIT_SESSION: event.session };
  quietly(() => observedHost(event));
  emit(quietly(() => dispatch(event, world(host, input, event), SUBSCRIBERS)) ?? fallback(host, input, event));
  process.exit(0);
}

function quietly(fn) {
  try {
    return fn();
  } catch {
    return null;
  }
}

function stdin() {
  try {
    return JSON.parse(readFileSync(0, "utf8") || "null");
  } catch {
    return null;
  }
}

function emit(payload) {
  if (payload != null) console.log(JSON.stringify(payload));
}

// Everything a subscriber may reach, bound lazily: a hook that has nothing to do
// must not pay for resolving a store it will never touch.
function world(host, input, event) {
  const bound = { host, input, env: ENV, plugin: engineName(), project: () => located(event?.cwd), light: () => light(event?.cwd), full: () => learnContext(createContext({}, ENV, event?.cwd ?? process.cwd()), ENV) };
  return { ...bound, workingSet: () => sessionWorkingSet(event), finalizer: () => finalizerOf(event?.cwd), drainLater: () => drainLater(event?.cwd), observing: () => (ENV === process.env ? switchOf(process.env, "ENGINEERING_OBSERVE", "engineering_observe", true) : switchOf(ENV, "ENGINEERING_OBSERVE", "engineering_observe", true)), engineering: () => engineeringOf(event), trace: () => traceOf(event), liveSession: () => liveSessionOf(host), failed: (name, e) => failed(bound, name, e) };
}

// A protocol-2 session's checkpoint, drained by a process of its own (skills/orbit-learn/hosts/drain.mjs), bound to
// this session through ENV exactly as every Orbit command of that host is.
const drainLater = (cwd) => drainInBackground(PLUGIN_ROOT, ENV, { cwd });

// Orbit Live's session start (src/lifecycle/subscribers/live-session.mjs), for a host that offers a session
// environment file -- Claude Code's -- and only while its `live` switch is on: the session mark exported to the
// session's shell, and where this plugin was loaded from kept as the host's observation, written only when it moved.
const LIVE_HOSTS = { claude: { envFile: envFileOf } };

function liveSessionOf(host) {
  const live = LIVE_HOSTS[host?.name];
  const store = live ? hostStore(stateRooms(storeBase(ENV)), realIo(), host.name) : null;
  if (!store || !effectiveSettings(ENV, store.read().settings ?? {}).live) return null;
  return { exportSession: (mark) => exportedSession(live.envFile(ENV), mark), observeRoot: () => rootObserved(store) };
}

function rootObserved(store) {
  if (store.status().root === PLUGIN_ROOT) return;
  store.observe({ protocol: 1, engineVersion: engineVersion(), event: "session-start", root: PLUGIN_ROOT });
}

// The session trail, bound for one event: the machine's trail room, a short
// hash of the project's store key (never a path), and the lookup that decides
// what of a command line may be kept -- a script this plugin SHIPS, reached as
// the plugin's own, and a subcommand only if its usage documents it.
function traceOf(event) {
  if (!(ENV === process.env ? switchOf(process.env, "TRACE", "trace", true) : switchOf(ENV, "TRACE", "trace", true))) return null;
  const io = realIo();
  const project = located(event?.cwd);
  const mark = project ? short(project.storeKey ?? `root:${project.root}`, 12) : null;
  return { emit: createEmitter({ log: traceLog(stateRooms(storeBase(ENV)), io), now: io.now, project: mark }), lookup: (rel, line) => shipped(rel, line, event?.cwd) };
}

const ROOT_SPELLINGS = [PLUGIN_ROOT, PLUGIN_ROOT.replace(/\\/g, "/"), "${CLAUDE_PLUGIN_ROOT}", "$CLAUDE_PLUGIN_ROOT"];

// A relative `cli/x.mjs` is the plugin's own only when the command ran inside
// the plugin's own tree -- a project that has a cli/ of its own is not Orbit.
function shipped(rel, line, cwd) {
  const reached = ROOT_SPELLINGS.some((root) => line.includes(`${root}/${rel}`)) || (cwd && resolve(cwd) === PLUGIN_ROOT);
  const file = join(PLUGIN_ROOT, rel);
  if (!reached || !existsSync(file)) return null;
  return documented(headerOf(readFileSync(file, "utf8")), basename(rel, ".mjs"));
}

// The engineering store and source tree, bound the way cli/engineering.mjs
// binds them -- including the gates, handed in as data from architecture.
function engineeringOf(event) {
  const project = located(event?.cwd);
  if (!project) return null;
  const ctx = engineeringContext({ project, config: project.config }, ENV);
  return { ...ctx, now: () => new Date().toISOString(), gates: () => new Set(createArchitecture(ctx.store.root, ctx.io).all().filter((f) => f.kind === "invariant").flatMap((f) => f.evidence ?? [])), trace: (type, data) => traceOf(event)?.emit(type, data) };
}

// The session's working set lives with the session's PROJECT, not wherever its shell stands (1.8.7): a host that
// names its project root (CLAUDE_PROJECT_DIR) keeps one session's lines in one file, so a `cd` into a task's
// workspace -- a clone with a project of its own -- no longer splits a command's start from its end.
const sessionWorkingSet = (event) => (ENV.CLAUDE_PROJECT_DIR ? workingSetOf(ENV.CLAUDE_PROJECT_DIR) : null) ?? workingSetOf(event?.cwd);

function workingSetOf(cwd) {
  if (!(ENV === process.env ? switchOf(process.env, "WORKING_SET", "working_set", true) : switchOf(ENV, "WORKING_SET", "working_set", true))) return null;
  const project = located(cwd);
  if (!project) return null;
  const io = realIo();
  return { ...createWorkingSet(workingSetDir(project), io), roots: [...checkoutOf(project), ...spelledRoot(cwd)], host: io.host, now: io.now };
}

// Paths are kept in the source port's language -- relative to the CHECKOUT
// root, as `git ls-files --full-name` spells them -- or a scope in the working
// set could never be matched against a scope on a fact. Found by walking up to
// `.git`, never by spawning git: this runs after every tool call. Both
// spellings are returned -- the real path `.git` was found at, and the same
// directory reached through the path the project was given -- because a host
// reports paths the way IT was given them, symlinks and all.
function checkoutOf(project) {
  const real = insideRepo(project.root);
  if (!real) return [project.root];
  const given = project.dataHome === "explicit" ? resolve(project.dataRoot, "..") : project.root;
  return [real, resolve(given, relative(realpathSync(given), real))];
}

// And the checkout root as the HOST spells it (0.0.2): walked up from the directory it named, nothing resolved -- on
// Windows a host's temp checkout is C:\Users\RUNNER~1\... while git and the real path say C:\Users\runneradmin\...,
// and a file the host names through the short spelling would otherwise read as outside the repository.
const spelledRoot = (cwd) => (typeof cwd === "string" && cwd ? [lexicalRepo(resolve(cwd))].filter(Boolean) : []);

const lexicalRepo = (at) => (existsSync(join(at, ".git")) ? at : dirname(at) === at ? null : lexicalRepo(dirname(at)));

// A recording subscriber that threw leaves ONE finding in the engineering room
// -- the message scrubbed and clipped, never a stack -- and surfaces on the
// next session start. Nothing about it reaches the host's turn.
function failed(bound, name, error) {
  const ctx = bound.light();
  if (!ctx) return;
  createEngineering(ctx.store.root, ctx.io).addFinding({ kind: "subscriber-failed", subscriber: name, say: scrub(String(error?.message ?? error)).slice(0, 200) });
}

function light(cwd) {
  const found = located(cwd);
  if (!found) return null;
  return learnContext({ project: found, config: found.config }, ENV);
}

// Resolved once per hook process and directory: several subscribers ask, and
// resolving a project can cost a git call.
const projects = new Map();

function located(cwd) {
  if (!projects.has(cwd)) projects.set(cwd, attempted(cwd));
  return projects.get(cwd);
}

// A project only when the machine knows its checkout (src/project/repository.mjs knownCheckout): one existsSync on
// the binding, so a repository opened with the plugin enabled is not observed until somebody asked for Orbit there.
function attempted(cwd) {
  try {
    return known(loadProject(ENV, cwd));
  } catch {
    return null;
  }
}

const known = (project) => (knownCheckout(project) ? project : null);

main().catch(() => process.exit(0));

function finalizerOf(cwd) {
  const project = located(cwd);
  return project ? finalizerStore(join(workingSetDir(project), "finalizer"), realIo()) : null;
}

function observedHost(event) {
  if (event?.protocol !== 2) return;
  hostStore(stateRooms(storeBase(ENV)), realIo(), event.host).observe({ protocol: 2, engineVersion: engineVersion(), event: event.event });
}

function fallback(host, input, event) {
  if (event?.protocol !== 2) return null;
  if (event.event === 'session-start') return host.formatSessionStart?.('', input);
  if (event.event === 'turn-end') return host.formatStop?.();
  return null;
}
