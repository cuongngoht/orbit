#!/usr/bin/env node
// WORK: what is being done about a requirement, kept so that a different session -- another
// day, another model -- picks it up exactly where it stopped. A work holds what it NEEDS as
// capabilities (something to find out, to prove, to do), never a provider; which provider
// serves a need today is a binding, written when the work resolves and replaced when the
// machine changes. Nothing here reads a requirement's words or asks a system for a work item.
//
//   node work.mjs start "<objective>" --ref=<item id | req-… | rs-…> [--snapshot=<rs-…>] [--json]
//                                          the one work a requirement has: started, or found. Adopting
//                                          a snapshot says which state of the requirement it rests on
//   node work.mjs show <work | --ref=<item id>> [--json]
//                                          its needs, what each has come to, and where to pick it up
//   node work.mjs list [--json]            every work kept here, and which are waiting on a requirement
//   node work.mjs need <work> [<file>]     needs, one JSON object per line (stdin when no file): what
//                                          has to be found out, proved or done, by capability. All or nothing
//   node work.mjs resolve <work> [--json]  bind each need to whoever can serve it now, through the same
//                                          resolver everything else uses. A gap is an opportunity
//   node work.mjs invoke <work> <need> [--tool=<name>] [--input='{…}'] [--workflow=<skill>] [--json]
//                                          ask the provider a need is bound to, through the MCP broker or
//                                          the capability gates. Without --tool, its tools are listed
//   node work.mjs settle <work> <need> --state=<satisfied|blocked|not-applicable> [--receipt=<rct-n>]
//                                          [--evidence="…"] [--why="…"]
//                                          a need came to something, on evidence, and the journal says why
//   node work.mjs claim <work> <need> [<file>] [--receipt=<rct-n>]
//                                          what an answer means, as project knowledge: claims, one JSON
//                                          object per line, resting on the receipt and never on a word typed in
//   node work.mjs checkpoint <work> [--why="…"] [--json]
//                                          look again at what moved, then mark the frontier
//   node work.mjs resume <work | --ref=<item id>> [--json]
//                                          pick a work up: what moved is found, what must be bound is bound,
//                                          the frontier is printed. Nothing is re-read or re-asked otherwise
//   node work.mjs recall --for="<task>" [--json]
//                                          the work already in progress that a task is about (project context)
//   node work.mjs where                    where the rooms are kept
//
// This file is the one COMPOSITION ROOT: the work room, a read-only look at the requirements
// room, the project's files, the resource registry, the MCP broker, the project's capabilities,
// the knowledge room and the session trail are bound HERE, so nothing under src/work/ names a
// provider, a host or another memory.
//
// What an answer says is DATA from another system: it is printed, scrubbed and bounded, once,
// and never stored -- a receipt keeps digests and where the answer said it came from. Nothing
// is written into a repository, and no credential is ever an argument or an output.
//
// Exit 0 = done (a gap is an opportunity, never a failure) · 2 = REFUSED (bad usage, an unknown
// work or need, a gate that said no, a refused batch) · 3 = BLOCKED (a provider could not be
// reached, nowhere to keep anything). Never 1.
import { readFileSync } from "node:fs";
import { hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realWorld } from "../skills/orbit-control/world.mjs";
import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
import { connectionEnvFor, connectionReader } from "../skills/orbit-requirements/bind.mjs";
import { scanRoots } from "../src/architecture/context.mjs";
import { trackedSet } from "../src/engineering/record.mjs";
import { Refused } from "../src/errors.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { short } from "../src/hash.mjs";
import { knowledgeContext } from "../src/knowledge/context.mjs";
import { settle } from "../src/knowledge/opportunities.mjs";
import { createKnowledge } from "../src/knowledge/store.mjs";
import { taskArguments } from "../src/process/task-input.mjs";
import { command } from "../src/project/command.mjs";
import { switchOf } from "../src/project/env.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { requirementsContext } from "../src/requirements/context.mjs";
import { effectiveResourcesOf, mcpInvokeContext } from "../src/resources/compose.mjs";
import { createContext } from "../src/run/context.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { createEmitter } from "../src/trace/emit.mjs";
import { traceLog } from "../src/trace/log.mjs";
import { WORKFLOW } from "../src/work/bind.mjs";
import { COMMANDS } from "../src/work/index.mjs";
import { latestIn, snapshotIn } from "../src/work/requirement.mjs";
import { createWorks } from "../src/work/store.mjs";

const ENV = commandEnvironment(process.env, process.argv);
const nativeFactory = await (await import("../skills/orbit-learn/hosts/resources.mjs")).resourceFactory(ENV);

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = taskArguments(process.argv.slice(2), () => readFileSync(0, "utf8"));
const now = () => new Date().toISOString();

async function main() {
  const entry = COMMANDS[cmd];
  if (!entry) return help();
  const ctx = await ready(entry.needs);
  printed(entry, ctx, await entry.run(ctx, args));
}

function printed(entry, ctx, result) {
  console.log(args.includes("--json") ? JSON.stringify(result, null, 2) : entry.say(result));
  emitted(ctx, result);
}

// What each command's `needs` column asks the root to bind.
const BIND = { store: (base) => stored(base), resources: (base) => resourced(base) };

async function ready(needs) {
  const base = needs === "resources" ? await withExtensions(createContext({}, ENV)) : createContext({}, ENV);
  return BIND[needs](base);
}

// The project's files, asked only when something needs a hash of them.
function lazySource(base) {
  let tree = null;
  const of = () => (tree ??= createSourceTree(scanRoots(base)));
  return { fingerprints: (paths) => of().fingerprints(paths), files: () => of().files() };
}

// The work room, and a read-only look at the requirements it rests on.
function stored(base) {
  const req = requirementsContext(base, ENV);
  const works = createWorks(req.store.root, req.io);
  const ctx = { ...base, requirements: req.requirements, store: req.store, io: req.io, works, now, read: readInput, session: ENV.ORBIT_SESSION ?? null, by: "session", source: lazySource(base) };
  return { ...ctx, snapshot: (id, root) => snapshotIn(ctx, id, root), latestSnapshot: (root) => latestIn(ctx, root) };
}

// Everything asking a provider needs: the registry the resolver ranks in, the broker, the
// project's capabilities (with the one credential a connection-bound adapter names, for the
// moment of its call), and the knowledge a claim is kept in.
function resourced(base) {
  const ctx = stored(base);
  const real = realWorld({ pluginRoot: PLUGIN_ROOT, projectRoot: process.cwd(), env: ENV, nativeFactory });
  return { ...ctx, workflow: WORKFLOW, ...providersOf(base, ctx, real), get mcp() { return mcpInvokeContext(real); }, get memory() { return memoryOf(base, ctx.source); } };
}

function providersOf(base, ctx, real) {
  const know = createKnowledge(ctx.store.root, ctx.io);
  const connections = connectionReader(real.rooms, ctx.io);
  const registry = { ...real, capabilities: () => base.capabilities.list() };
  return { effective: () => effectiveResourcesOf(registry), capabilityContext: (connection) => capabilityContextOf(base, real, connections, connection), opportunities: { docs: () => know.opportunities(), settle: (docs) => settle({ know }, docs) } };
}

async function capabilityContextOf(base, real, connections, connection) {
  if (!connection) return base;
  return { ...base, ...(await connectionEnvFor({ providerId: connection, connections, secrets: real.secrets, env: real.env })) };
}

function memoryOf(base, source) {
  const knowledge = knowledgeContext(base, ENV, { source });
  return { knowledge: { ...knowledge, now }, tracked: trackedSet(source.files() ?? []) };
}

function readInput(path) {
  try { return readFileSync(path ?? 0, "utf8"); }
  catch (e) { throw new Refused(`cannot read ${path ?? "stdin"}: ${e.message}`); }
}

// ---- the session trail: counts and ids, never a need's sentence, an answer or a claim ---------

const EVENTS = {
  start: (r) => (r.created ? ["work.started", { work: r.work, snapshot: r.adopted }] : null),
  checkpoint: (r) => ["work.checkpoint", { work: r.work, frontier: r.frontier.length, stale: r.stale.length }],
  resume: (r) => ["work.resumed", { work: r.work, revalidated: r.checked, stale: r.stale.length }],
  settle: (r) => ["work.need.settled", { work: r.work, need: r.need, state: r.state }],
};

function emitted(ctx, result) {
  const event = EVENTS[cmd]?.(result);
  if (event && switchOf(ENV, "TRACE", "trace", true)) quietly(() => emitterFor(ctx.project)(...event));
}

function emitterFor(project) {
  const io = realIo();
  const emit = createEmitter({ log: traceLog(stateRooms(storeBase(process.env)), io), now: io.now, session: ENV.ORBIT_SESSION ?? null, meta: ENV.ORBIT_HOST_PROTOCOL === "2" ? { v: 2, agentHost: ENV.ORBIT_HOST } : {}, project: short(project?.storeKey ?? `root:${project?.root ?? "?"}`, 12) });
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
