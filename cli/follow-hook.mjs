#!/usr/bin/env node
// FOLLOW-THROUGH (0.5.0, B22 M3, ADR 0050): the host's SYNCHRONOUS Stop and PostToolUse(Agent) hooks, wired to the two
// subscribers that follow a session's governed work through:
//
//   Stop                 src/lifecycle/subscribers/hold.mjs -- hold the turn open, boundedly, when this session's own
//                        running workflow or goal has a step ready: `decision: "block"` with the step and its one
//                        command, or nothing. Its one write is the trail's `turn.held`
//   PostToolUse (Agent)  src/lifecycle/subscribers/returned.mjs -- one line for the parent after one of this plugin's
//                        agents returns: which owner record settles its work, and where it stands. Writes nothing
//
// A composition root of its own, beside cli/router-hook.mjs and cli/learn-hook.mjs: routing a prompt, learning from a
// session and holding a workflow to its next step are three jobs, and the hold must answer in the host's synchronous
// path -- the async Stop entry (cli/learn-hook.mjs: the trail's turn boundary, the checkpoints) is left as it is.
//
// CHEAPEST FIRST. Every Stop of every session runs this, so what it loads is staged: the host, the event, the two
// subscribers and the trail's bounded tail (src/trace/log.mjs `recent`) for every Stop; the owners' stores and folds
// (cli/governed.mjs) and the automation settings only when a subscriber's own table reaches a row that reads them -- a
// turn that ran a workflow's command, one of Orbit's agents returning. A turn that ran none answers after one bounded
// read of this machine's trail; with the trail off, or a turn already held, after none.
//
// FAIL OPEN, always: it exits 0 whatever happens, a module that does not load, a store that cannot be read or a bug here
// answers nothing, and the turn ends as the host meant it to. Wired for Claude Code alone (hooks/hooks.json): Codex's and
// Grok Build's Stop blocking is unverified, so their hooks files carry no hold (docs/hosts.md).
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { enginedDeep } from "../src/engined.mjs";

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let ENV = process.env;

// Loaded for every event: what a subscriber's cheap rows ask.
const BASE = { settings: "skills/orbit-learn/hosts/settings.mjs", hosts: "skills/orbit-learn/hosts/index.mjs", event: "src/lifecycle/event.mjs", dispatch: "src/lifecycle/dispatch.mjs", hold: "src/lifecycle/subscribers/hold.mjs", returned: "src/lifecycle/subscribers/returned.mjs", env: "src/project/env.mjs", repository: "src/project/repository.mjs", control: "src/store/control.mjs", io: "src/store/io.mjs", version: "src/version.mjs", log: "src/trace/log.mjs", turns: "src/trace/projections/turns.mjs", emit: "src/trace/emit.mjs", hash: "src/hash.mjs" };

// Loaded only when a subscriber reaches a row that reads the owners' records.
const DEEP = { governed: "cli/governed.mjs", automation: "src/automation/settings.mjs" };

// Which subscriber's table says whether an event reaches the owners, by the event it listens for.
const NEEDS = { "turn-end": (m) => m.hold.needsOwners, "post-tool": (m) => m.returned.needsOwners };

async function main() {
  const input = stdin();
  const m = await loaded(BASE);
  const host = await m.hosts.resolveHookHost(input, process.argv);
  ENV = m.settings.hostEnvironment(process.env, host);
  return answered(m, { host, input, event: quietly(() => m.event.lifecycleEvent(host, input, process.argv)) });
}

async function loaded(modules) {
  const pairs = await Promise.all(Object.entries(modules).map(async ([k, rel]) => [k, await import(new URL(`../${rel}`, import.meta.url))]));
  return Object.fromEntries(pairs);
}

// The trail is bound once, so the cheap rows asked before the owners load and the rows asked after read it once.
async function answered(m, b) {
  const bound = { ...b, rooms: quietly(() => m.control.stateRooms(m.repository.storeBase(ENV))) };
  const trail = bound.rooms ? quietly(() => trailOf(m, bound.rooms, b.event)) : null;
  const deep = quietly(() => NEEDS[b.event?.event]?.(m)?.(b.event, world(m, null, { ...bound, trail }))) ? await loaded(DEEP) : null;
  return quietly(() => m.dispatch.dispatch(b.event, world(m, deep, { ...bound, trail }), [m.hold.hold, m.returned.returned]));
}

function world(m, deep, b) {
  const governed = deep ? deep.governed.governedOf({ env: ENV, cwd: b.event?.cwd, session: b.event?.session, nowMs: Date.now() }) : null;
  return { host: b.host, input: b.input, env: ENV, plugin: m.version.engineName(), engine: PLUGIN_ROOT, nowMs: () => Date.now(), turn: () => b.trail?.turn() ?? null, held: (data) => quietly(() => b.trail?.emit("turn.held", data, { project: projectMark(m, governed) })), settings: () => (deep && b.rooms ? settingsOf(m, deep, b.rooms, governed) : null), governed: () => governed?.holding() ?? null, governedFor: (event) => governedFor(governed, event) };
}

// The mission an Orbit envelope named, else the session's own governed work.
const governedFor = (g, event) => (g ? (event?.dispatched ? g.mission(event.dispatched) : null) ?? g.owner() : null);

// The trail, bound for this one event -- only while it is switched on, which is what lets a hold count at all.
function trailOf(m, rooms, event) {
  if (!m.env.switchOf(ENV, "TRACE", "trace", true)) return null;
  const io = m.io.realIo();
  const log = m.log.traceLog(rooms, io);
  return { turn: once(() => m.turns.lastTurnOf(log.recent({ session: event?.session }), event?.session)), emit: m.emit.createEmitter({ log, now: io.now, session: event?.session ?? null }) };
}

// A short hash of the project's store key, as every other trail event names it -- never a path.
const projectMark = (m, governed) => ((key) => (key ? m.hash.short(key, 12) : null))(governed?.place()?.key ?? null);

// The automation settings a person set, machine then project, narrowed -- read, never written.
function settingsOf(m, deep, rooms, governed) {
  const io = m.io.realIo();
  const storeRoot = governed?.place()?.storeRoot ?? null;
  const docs = [{ by: "machine", content: deep.automation.readAutomation(io, join(rooms.automation, "settings.json")).content }, ...(storeRoot ? [{ by: "project", content: deep.automation.readAutomation(io, join(storeRoot, "automation", "settings.json")).content }] : [])];
  return deep.automation.effectiveOf(docs).values;
}

function once(fn) {
  const memo = {};
  return () => ("value" in memo ? memo.value : (memo.value = quietly(fn)));
}

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

function stdin() {
  try { return JSON.parse(readFileSync(0, "utf8") || "null"); }
  catch { return null; }
}

// Exit only once stdout has taken the answer: a pipe may be asynchronous, and an exit that races it would drop it.
function finish(payload) {
  const text = quietly(() => (payload == null ? null : `${JSON.stringify(enginedDeep(payload, PLUGIN_ROOT))}\n`));
  if (!text) return process.exit(0);
  process.stdout.write(text, () => process.exit(0));
}

main().then(finish, () => finish(null));
