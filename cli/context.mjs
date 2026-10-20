#!/usr/bin/env node
// PROJECT CONTEXT for one task -- the engine's built-in `project.context`,
// which orbit-develop asks for before it reads any source.
//
//   node cli/context.mjs --for="<the task, in one sentence>" [--json]
//
// Memory first and bounded to the task: architecture, technology and
// engineering are each asked of their own memory-first command (a CURRENT
// answer costs a few git calls; only a scope the task touches that moved is
// re-read), the working set is counted, and the resolver says which resources
// the task needs (src/context/sections.mjs). Each section is clipped; one that
// cannot answer says UNKNOWN. Nothing here scans the whole repository, installs
// or enables anything, or keeps the task text.
//
// Every command runs through the Process port: argv, never a shell, so a task
// that contains `;` is part of an argument and never a second command.
//
// It opens with STATUS (1.8.9, src/context/status.mjs): one word for how much of
// this context rests on evidence -- NOT_INITIALIZED · BLOCKED · BOOTSTRAPPED ·
// STALE · PARTIAL · READY -- read off what is kept and which sections had
// anything to stand on, never off how many sections came back. `--json` carries
// it as `status`, which a workflow's context step reports as it is.
//
// Exit 0 = printed (a section may still say UNKNOWN) · 2 = bad usage.
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realWorld } from "../skills/orbit-control/world.mjs";
import { createArchitecture } from "../src/architecture/store.mjs";
import { SECTIONS, sectionOf, taskOf, workingSetSection } from "../src/context/sections.mjs";
import { blockedOf, statusOf } from "../src/context/status.mjs";
import { Refused } from "../src/errors.mjs";
import { projectCapabilities } from "../src/extensions/capabilities.mjs";
import { createProcess } from "../src/process/index.mjs";
import { command } from "../src/project/command.mjs";
import { loadProject } from "../src/project/index.mjs";
import { knownCheckout } from "../src/project/repository.mjs";
import { workingSetDir } from "../src/project/runtime.mjs";
import { effectiveResourcesOf } from "../src/resources/compose.mjs";
import { formatDecision } from "../src/routing/format.mjs";
import { route } from "../src/routing/resolve.mjs";
import { createWorkingSet } from "../src/engineering/working-set/store.mjs";
import { fold } from "../src/engineering/working-set/fold.mjs";
import { machineContext } from "../src/store/context.mjs";
import { realIo } from "../src/store/io.mjs";

import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
const ENV = commandEnvironment(process.env, process.argv);
const nativeFactory = await (await import("../skills/orbit-learn/hosts/resources.mjs")).resourceFactory(ENV);

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const TASK = taskOf(argv.includes("--for-stdin") ? readFileSync(0, "utf8") : argv.find((a) => a.startsWith("--for="))?.slice(6));
const SECTION_TIMEOUT_MS = 180_000;

async function main() {
  if (!TASK) throw new Refused('usage: node cli/context.mjs --for="<the task, in one sentence>" [--json]');
  const project = quietly(() => loadProject(ENV, process.cwd()));
  const sections = preflight(project);
  const decision = route(TASK, await resources(project));
  return shown(statusFor(project, sections), sections, decision);
}

// What the context amounts to, asked AFTER every section ran: `architecture ensure` may just have learned what there
// was to learn, and a word taken before it would describe a project that no longer exists.
const statusFor = (project, sections) => statusOf({ bound: knownCheckout(project), sections: sections.map(({ id, known }) => ({ id, known })), architecture: architectureCounts(project), blocked: blockedOf(sections) });

function architectureCounts(project) {
  const arch = project ? quietly(() => createArchitecture(machineContext({ project, config: project.config }, ENV).store.root, realIo())) : null;
  const all = quietly(() => arch?.all()) ?? [];
  return { total: all.length, stale: all.filter((f) => f.status === "stale").length, scanned: Boolean(quietly(() => arch?.model().model)) };
}

const processes = createProcess({ timeoutMs: SECTION_TIMEOUT_MS });

const asked = (s) => sectionOf(s, processes.run(process.execPath, [join(PLUGIN_ROOT, s.argv(TASK)[0]), ...s.argv("").slice(1).filter((a) => !a.startsWith("--for=")), "--for-stdin"], { input: TASK, env: ENV }));

function workingSet(project) {
  if (!project) return workingSetSection(null, 0);
  const ws = createWorkingSet(workingSetDir(project), realIo());
  return workingSetSection(fold(currentLines(ws)), realIo().list(ws.dir).filter((n) => n.endsWith(".jsonl")).length);
}

async function resources(project) {
  const caps = project ? await quietlyAsync(() => projectCapabilities(project, ENV)) : [];
  return effectiveResourcesOf({ ...realWorld({ pluginRoot: PLUGIN_ROOT, projectRoot: process.cwd(), env: ENV, nativeFactory }), capabilities: () => caps ?? [] });
}

function shown(status, sections, decision) {
  if (argv.includes("--json")) return console.log(JSON.stringify({ status, sections, decision }, null, 2));
  console.log(`STATUS  ${status.word} -- ${status.because}\n\nPROJECT CONTEXT  memory first, bounded to the task\n`);
  for (const s of sections) console.log(`== ${s.title} ==\n${s.lines.join("\n")}\n`);
  console.log(`== RESOURCES ==\n${formatDecision(decision, { callVia: `node ${join(PLUGIN_ROOT, "cli", "mcp.mjs")} call` }) ?? "nothing beyond what this session already has"}`);
  unknowns(sections);
}

function unknowns(sections) {
  const gaps = sections.filter((s) => !s.known);
  if (gaps.length) console.log(`\nUNKNOWN\n${gaps.map((s) => `  ${s.id} -- a gap, not permission to guess`).join("\n")}`);
}

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

async function quietlyAsync(fn) {
  try { return await fn(); }
  catch { return null; }
}

command(main);

function currentLines(ws) { return ENV.ORBIT_SESSION ? ws.read(ENV.ORBIT_SESSION) : ENV.ORBIT_HOST_PROTOCOL === "2" ? [] : ws.latest(); }

function preflight(project) {
  if (project?.isolated) processes.run(process.execPath, [join(PLUGIN_ROOT, 'cli/finalize.mjs')], { env: ENV, timeoutMs: 15000 });
  return [...SECTIONS.map(asked), workingSet(project)];
}
