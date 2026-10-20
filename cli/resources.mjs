#!/usr/bin/env node
// The Effective Resource Registry from a terminal -- the same answer the prompt
// router and Orbit Control read.
//
//   node cli/resources.mjs list [--json]          skills, agents, MCP, tools, capabilities
//   node cli/resources.mjs observe [--hook]       re-read the host's MCP configuration and
//                                                 detect every catalog tool; saves the snapshots
//   node cli/resources.mjs route "<prompt>" [--json]   what the router would add to it
//
// `observe --hook` is the SessionStart observer (hooks/hooks.json, async): it
// reads the host's payload for the project directory, does nothing when the
// prompt router is switched off, prints nothing and always exits 0.
//
// Nothing here installs, adds or removes anything; that is Orbit Control's, and
// only on an explicit click. `route` keeps no trace of the prompt it is given.
// Exit 0; 2 on bad usage.
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realWorld } from "../skills/orbit-control/world.mjs";
import { projectCapabilities } from "../src/extensions/capabilities.mjs";
import { loadProject } from "../src/project/index.mjs";
import { switchOf } from "../src/project/env.mjs";
import { effectiveResourcesOf } from "../src/resources/compose.mjs";
import { FAMILIES } from "../src/resources/model.mjs";
import { observeResources } from "../src/resources/observe.mjs";
import { summarize } from "../src/resources/registry.mjs";
import { formatDecision } from "../src/routing/format.mjs";
import { route } from "../src/routing/resolve.mjs";

import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
const ENV = commandEnvironment(process.env, process.argv);
const nativeFactory = await (await import("../skills/orbit-learn/hosts/resources.mjs")).resourceFactory(ENV);

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: node cli/resources.mjs list [--json] | observe [--hook] | route \"<prompt>\" [--json]";
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes("--json");

const COMMANDS = {
  list: async () => listed(await resources(process.cwd())),
  observe: async () => (argv.includes("--hook") ? hooked() : observed(world(process.cwd()))),
  route: async () => routed(argv.includes("--task-stdin") ? readFileSync(0, "utf8").slice(0, 16384) : argv.filter((a) => !a.startsWith("--")).slice(1).join(" "), await resources(process.cwd())),
};

async function main() {
  const run = COMMANDS[argv[0]];
  if (!run) return usage();
  await run();
}

const world = (projectRoot) => realWorld({ pluginRoot: PLUGIN_ROOT, projectRoot, env: ENV, nativeFactory });

async function resources(cwd) {
  const w = world(cwd);
  const project = quietly(() => loadProject(ENV, cwd));
  const caps = project ? await projectCapabilities(project, ENV) : [];
  return effectiveResourcesOf({ ...w, capabilities: () => caps });
}

function listed(effective) {
  if (JSON_OUT) return console.log(JSON.stringify(effective, null, 2));
  for (const f of FAMILIES) familyLines(f, effective[f.family]);
  for (const p of effective.problems) console.log(`! ${p.family}: ${p.why}`);
}

function familyLines(f, items) {
  console.log(`\n${f.family} (${items.filter((r) => r.available).length} usable of ${items.length})`);
  for (const r of items) console.log(`  ${r.available ? "✓" : "○"} ${r.id.padEnd(28)} ${r.available ? r.summary : r.state}`);
}

function observed(w) {
  const said = observeResources(w);
  console.log(`mcp    ${said.mcp.ok ? `${said.mcp.count} configured server(s) seen in ${w.host.name}` : `not observed: ${said.mcp.why}`}`);
  console.log(`tools  ${said.tools.ok ? `${said.tools.count} tool(s) detected` : `not observed: ${said.tools.why}`}`);
  console.log(JSON.stringify(summarize(effectiveResourcesOf(w))));
}

// The session-start observer: quiet, bounded by its own hook timeout, and
// never able to fail the session it runs beside.
function hooked() {
  if (!switchOf(ENV, "PROMPT_ROUTER", "prompt_router", true)) return;
  const cwd = quietly(() => JSON.parse(readFileSync(0, "utf8") || "null")?.cwd) || process.cwd();
  quietly(() => observeResources(world(cwd)));
}

function routed(prompt, effective) {
  const decision = route(prompt, effective);
  if (JSON_OUT) return console.log(JSON.stringify(decision, null, 2));
  console.log(formatDecision(decision) ?? "(the router would add nothing to this prompt)");
}

function quietly(fn) {
  try { return fn(); }
  catch { return null; }
}

function usage() {
  console.error(USAGE);
  process.exit(2);
}

main().catch((e) => (argv.includes("--hook") ? (process.exitCode = 0) : fail(e)));

function fail(e) {
  console.error(e?.message ?? e);
  process.exitCode = 2;
}
