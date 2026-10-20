#!/usr/bin/env node
// Orbit-managed MCP servers from a session: the MCP BROKER's front door.
//
//   node cli/mcp.mjs list [--json]            managed · external (observe only),
//                                             and whether each is ready to use here
//   node cli/mcp.mjs tools <server> [--json]  a managed server's tools, as it declares them
//   node cli/mcp.mjs call <server> <tool> [--for=<capability>] [--workflow=<skill>]
//                         [--input='<json>' | the JSON on stdin] [--json]
//                                             one tool call, through every gate
//                                             (src/mcp/invoke.mjs): policy, approval,
//                                             runtime, a deadline; one activity line
//
// A Orbit-managed server is not in the host's own tool list -- Orbit, not the
// host, owns it -- so this is how a session reaches one. It can never be used
// to reach an EXTERNAL server (one only the host has configured): Orbit observes
// those and never calls them.
//
// Deliberately absent: add, remove, enable, install, approve, policy. Those are
// a person's, in Orbit Control behind its token, so nothing a session runs can
// provision, enable or re-police a resource for itself.
//
// Exit 0 = done · 1 = the tool answered with an error of its own (isError) ·
// 2 = REFUSED (bad usage, an unknown server, policy, approval) · 3 = BLOCKED
// (a runtime not installed, a secret not set, a server that did not answer).
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { realWorld } from "../skills/orbit-control/world.mjs";
import { invokeMcp, listManagedTools } from "../src/mcp/invoke.mjs";
import { command } from "../src/project/command.mjs";
import { mcpInvokeContext, mcpOf } from "../src/resources/compose.mjs";
import { stateText } from "../src/resources/model.mjs";
import { Refused } from "../src/errors.mjs";

import { commandEnvironment } from "../skills/orbit-learn/hosts/settings.mjs";
const ENV = commandEnvironment(process.env, process.argv);
const nativeFactory = await (await import("../skills/orbit-learn/hosts/resources.mjs")).resourceFactory(ENV);

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const USAGE = "usage: node cli/mcp.mjs list [--json] | tools <server> [--json] | call <server> <tool> [--for=<capability>] [--workflow=<skill>] [--input='<json>'] [--json]";
const argv = process.argv.slice(2);
const flags = Object.fromEntries(argv.filter((a) => a.startsWith("--")).map((a) => [a.slice(2).split("=")[0], a.includes("=") ? a.slice(a.indexOf("=") + 1) : true]));
const words = argv.filter((a) => !a.startsWith("--"));

const COMMANDS = {
  list: (w) => listed(mcpOf(w)),
  tools: async (w) => toolsListed(await listManagedTools(mcpInvokeContext(w), serverOf(1))),
  call: async (w) => answered(await invokeMcp(mcpInvokeContext(w), { id: serverOf(1), tool: serverOf(2), args: inputOf(), capability: flags.for, workflow: flags.workflow })),
};

function main() {
  const run = COMMANDS[words[0]];
  if (!run || Object.keys(flags).some((k) => !["json", "for", "workflow", "input", "host", "protocol", "session"].includes(k))) throw new Refused(USAGE);
  return run(realWorld({ pluginRoot: PLUGIN_ROOT, projectRoot: process.cwd(), env: ENV, nativeFactory }));
}

function serverOf(at) {
  if (!words[at]) throw new Refused(USAGE);
  return words[at];
}

function inputOf() {
  const text = typeof flags.input === "string" ? flags.input : stdinText();
  try { return text.trim() ? JSON.parse(text) : {}; }
  catch { throw new Refused("--input is one JSON object, e.g. --input='{\"query\":\"…\"}'"); }
}

function stdinText() {
  try { return process.stdin.isTTY ? "" : readFileSync(0, "utf8"); }
  catch { return ""; }
}

// ---- views -----------------------------------------------------------------------

const GROUPS = [["orbit-managed", "managed by Orbit"], ["external", "external -- observed in the host, never called by Orbit"], ["catalog", "in Orbit's catalog, not added -- Orbit Control adds it"]];

function listed(entries) {
  if (flags.json) return console.log(JSON.stringify(entries, null, 2));
  for (const [ownership, title] of GROUPS) groupLines(title, entries.filter((e) => e.ownership === ownership));
}

function groupLines(title, entries) {
  if (!entries.length) return;
  console.log(`\n${title} (${entries.length})`);
  for (const e of entries) console.log(`  ${e.eligible ? "✓" : "○"} ${e.id.padEnd(28)} ${e.state === "ready" ? `ready · ${e.selection} · ${e.provides.join(", ")}` : e.why ?? stateText(e.state)}`);
}

function toolsListed(tools) {
  if (flags.json) return console.log(JSON.stringify(tools, null, 2));
  for (const t of tools) console.log(`${t.name.padEnd(36)} ${t.operation.padEnd(5)} ${t.description}`);
}

// The tool's own content, as text; anything that is not text is named, not dumped.
function answered(answer) {
  if (flags.json) console.log(JSON.stringify(answer.result, null, 2));
  if (!flags.json) console.log((answer.result.content ?? []).map((c) => (c.type === "text" ? c.text : `[${c.type} content]`)).join("\n"));
  if (answer.result.isError) process.exitCode = 1;
}

command(main);
