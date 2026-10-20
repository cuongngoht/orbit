#!/usr/bin/env node
// PROJECT KNOWLEDGE: what this project's concepts have to do with one another,
// in which context, on what evidence -- and what it would take to prove a change.
//
//   node knowledge.mjs claims [--for="…"] [--subject=a,b] [--context=k=v,…] [--json]
//                                          the few answers a task touches, settled per subject and
//                                          relation in that context, each with its authority
//   node knowledge.mjs why <claim-id>       one claim: evidence, authority, freshness now, rivals
//   node knowledge.mjs record [<file>] [--human] [--dry]
//                                          candidate claims, one JSON object per line (stdin when
//                                          no file), validated all or nothing, then RECONCILED
//   node knowledge.mjs vocabulary           which relations mean what here, who said so, what was refused
//   node knowledge.mjs verify [--for="…" | --subject=a,b] [--context=k=v] [--changed]
//                             [--purpose=development|verification] [--workflow=<slug>] [--dry] [--json]
//                                          proof needs → the resolver → provided · gaps → capability
//                                          opportunities, surfaced by policy. A gap never fails anything
//   node knowledge.mjs opportunities [--all] [--json]
//                                          what nothing here can prove yet, and why it is or is not asked
//   node knowledge.mjs decide <opp-id> defer|accept|ignore|reopen --human [--reason="…"]
//                                          a PERSON's decision, relayed — never an agent's own
//   node knowledge.mjs where                where every room is kept
//   node knowledge.mjs locate --hook        (async SessionStart) remember where the host keeps its
//                                          memory for this checkout; prints nothing, always exits 0
//
// This file is the one COMPOSITION ROOT: the source tree (asked once, by
// src/architecture/context.mjs `scanRoots`), the gates architecture's facts
// cite, the tracked listing, the working set, the cases, the resource registry,
// the project's extensions, Orbit's own vocabulary and an organisation's room,
// the host's memory and the session trail are bound HERE -- so nothing under
// src/knowledge/ imports another subsystem or names a host.
//
// The store lives OUTSIDE every repository, in the same machine store as every
// other memory; nothing here writes into a working tree, and a host's memory is
// read for one invocation and never kept.
//
// Exit 0 = done (a capability gap is an opportunity, never a failure) ·
// 2 = REFUSED (bad usage, an unknown id, a refused batch) · 3 = BLOCKED (no
// readable checkout to cite, nowhere to keep anything). Never 1.
import { taskArguments } from "../src/process/task-input.mjs";
import { readFileSync as readTaskStdin } from "node:fs";
import { readFileSync } from "node:fs";
import { homedir, hostname } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClaudeMemory } from "../skills/orbit-learn/hosts/claude-memory.mjs";
import { resolveHookHost } from "../skills/orbit-learn/hosts/index.mjs";
import { refreshDue } from "../skills/orbit-learn/native.mjs";
import { realWorld } from "../skills/orbit-control/world.mjs";
import { scanRoots } from "../src/architecture/context.mjs";
import { createArchitecture } from "../src/architecture/store.mjs";
import { loadCases } from "../src/dsl/load.mjs";
import { trackedSet } from "../src/engineering/record.mjs";
import { fold } from "../src/engineering/working-set/fold.mjs";
import { createWorkingSet } from "../src/engineering/working-set/store.mjs";
import { Refused } from "../src/errors.mjs";
import { withExtensions } from "../src/extensions/index.mjs";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { short } from "../src/hash.mjs";
import { knowledgeContext } from "../src/knowledge/context.mjs";
import { declaredClaims } from "../src/knowledge/declared.mjs";
import { COMMANDS, runKnowledge } from "../src/knowledge/index.mjs";
import { organizationPaths } from "../src/knowledge/store.mjs";
import { catalogLayer, offerLayers, roomLayers } from "../src/knowledge/vocabulary.mjs";
import { command } from "../src/project/command.mjs";
import { switchOf } from "../src/project/env.mjs";
import { loadProject } from "../src/project/index.mjs";
import { storeBase } from "../src/project/repository.mjs";
import { hostMemoryFile, workingSetDir } from "../src/project/runtime.mjs";
import { effectiveResourcesOf } from "../src/resources/compose.mjs";
import { createContext } from "../src/run/context.mjs";
import { writeAtomic } from "../src/store/atomic.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { createEmitter } from "../src/trace/emit.mjs";
import { traceLog } from "../src/trace/log.mjs";

import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
const ENV = commandEnvironment(process.env, process.argv);
const nativeFactory = await (await import("../skills/orbit-learn/hosts/resources.mjs")).resourceFactory(ENV);

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const [cmd, ...args] = taskArguments(process.argv.slice(2), () => readTaskStdin(0, "utf8"));
const now = () => new Date().toISOString();

async function main() {
  if (cmd === "locate") return located();
  if (!COMMANDS[cmd]) return help();
  runKnowledge(await ready(COMMANDS[cmd].needs), cmd, args);
}

// What each command's `needs` column asks the root to bind (src/knowledge/index.mjs).
const BIND = { store: (base) => stored(base), vocabulary: (base) => taught(base), resources: (base) => resourced(base) };

async function ready(needs) {
  const base = needs === "store" ? createContext({}, ENV) : await withExtensions(createContext({}, ENV));
  return BIND[needs](base);
}

function stored(base) {
  const ctx = knowledgeContext(base, ENV, { source: createSourceTree(scanRoots(base)) });
  const organization = organizationPaths(storeBase(process.env));
  return { ...ctx, parts: base.knowledge, now, read: readInput, organization, seenBy: ENV.ORBIT_SESSION ? { host: ctx.io.host, at: now(), session: ENV.ORBIT_SESSION } : undefined, hostMemory: () => providersFor(base.project), demanded: () => demandedBy(base.project), emit: emitterFor(base.project) };
}

// The relation vocabulary, offered in its one order: the project's extensions
// registered while they loaded, then Orbit's catalog, the organisation's room,
// the project's own.
function taught(base) {
  const ctx = stored(base);
  const layers = offerLayers(ctx.parts, [catalogLayer(PLUGIN_ROOT, ctx.io), ...roomLayers(ctx.io, ctx.organization.vocabulary, "organization"), ...roomLayers(ctx.io, ctx.know.paths.vocabulary, "project")]);
  return { ...ctx, vocabularyLayers: layers, tracked: () => trackedSet(ctx.source.files() ?? []), readable: () => ctx.source.files() !== null, gates: () => gatesOf(ctx), declared: () => declaredClaims(ctx.io, ctx.organization.claims, "organization"), near: () => sessionOf(base).scopes, changed: () => sessionOf(base).changed };
}

// The SAME recipe cli/context.mjs and the prompt router build the registry with,
// so what knowledge calls provided is what they call usable.
const resourced = (base) => ({ ...taught(base), effective: () => effectiveResourcesOf({ ...realWorld({ pluginRoot: PLUGIN_ROOT, projectRoot: process.cwd(), env: ENV, nativeFactory }), capabilities: () => base.capabilities.list() }) });

const gatesOf = (ctx) => new Set(createArchitecture(ctx.store.root, ctx.io).all().filter((f) => f.kind === "invariant").flatMap((f) => f.evidence ?? []));

// The session a shell command is working in, as far as anything can tell: the
// working set written most recently in this checkout. Only ever used to rank
// and to start a walk from what changed.
let session = null;
const sessionOf = (base) => (session ??= fold(currentLines(createWorkingSet(workingSetDir(base.project), realIo()))));

// How many cases already `call` each capability -- demand, counted, never read further.
function demandedBy(project) {
  const calls = loadCases(project.screensDir).flatMap((c) => (Array.isArray(c.steps) ? c.steps : [])).filter((s) => s?.do === "call" && typeof s.capability === "string");
  return calls.reduce((m, s) => m.set(s.capability.toLowerCase(), (m.get(s.capability.toLowerCase()) ?? 0) + 1), new Map());
}

// The host's memory, as providers. Claude Code's is the one this plugin ships;
// the location is what the async SessionStart hook recorded.
const providersFor = (project) => (switchOf(ENV, "HOST_MEMORY", "host_memory", true) ? [createClaudeMemory({ project, env: ENV, io: realIo(), home: homedir(), host: hostname() })] : []);

// The session trail, for what this command decides that a person should see in
// a turn's path. A shell has no host session, so its events carry the project
// and the moment, and the trace joins them to the turn open at that moment.
function emitterFor(project) {
  if (!switchOf(ENV, "TRACE", "trace", true)) return () => null;
  const io = realIo();
  const emit = createEmitter({ log: traceLog(stateRooms(storeBase(process.env)), io), now: io.now, session: ENV.ORBIT_SESSION ?? null, meta: ENV.ORBIT_HOST_PROTOCOL === "2" ? { v: 2, agentHost: ENV.ORBIT_HOST } : {}, project: short(project.storeKey ?? `root:${project.root}`, 12) });
  return (type, data) => quietly(() => emit(type, data));
}

function readInput(path) {
  try { return readFileSync(path ?? 0, "utf8"); }
  catch (e) { throw new Refused(`cannot read ${path ?? "stdin"}: ${e.message}`); }
}

// `locate --hook`: the async SessionStart entry. It records WHERE the host keeps
// its memory for this checkout -- the location, never a byte of the memory --
// and only when it changed or is due a refresh. Silent, and exit 0 whatever
// happens: a hook that remembers must never be able to stop a session.
async function located() {
  await rememberedSafely();
  process.exitCode = 0;
}

async function remembered(input) {
  if (!input || !switchOf(ENV, "HOST_MEMORY", "host_memory", true)) return;
  const project = loadProject(ENV, input.cwd ?? process.cwd());
  const record = (await resolveHookHost(input, process.argv)).memoryLocation?.(input, { env: ENV, home: homedir(), read: readText, now, host: hostname(), cwd: input.cwd });
  if (record?.dir) kept(hostMemoryFile(project), record);
}

function kept(file, record) {
  const io = realIo();
  const was = parsed(io.read(file));
  if (was && was.dir === record.dir && !refreshDue(was, Date.now())) return;
  writeAtomic(file, `${JSON.stringify(record)}\n`, io, false);
}

function readText(path) {
  try { return readFileSync(path, "utf8"); }
  catch { return null; }
}

function parsed(text) {
  try { return text ? JSON.parse(text) : null; }
  catch { return null; }
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

async function rememberedSafely() {
  try { await remembered(JSON.parse(readFileSync(0, "utf8") || "null")); }
  catch { /* optional native hint location */ }
}

function currentLines(ws) { return ENV.ORBIT_SESSION ? ws.read(ENV.ORBIT_SESSION) : ENV.ORBIT_HOST_PROTOCOL === "2" ? [] : ws.latest(); }
