// Claude Code's MCP configuration, behind src/mcp/port.mjs -- concrete host
// knowledge, so it lives here beside the lifecycle adapter and not in src/.
//
// READ from the files Claude Code keeps, because reading needs no network and
// no child process, and `claude mcp list` health-checks every server it lists:
//
//   user      <config>/.claude.json  mcpServers
//   local     <config>/.claude.json  projects[<project root>].mcpServers
//             (disabledMcpServers there is what /mcp switched off)
//   project   <project root>/.mcp.json  mcpServers -- enabled only once approved:
//             enabledMcpjsonServers, or enableAllProjectMcpServers in a settings
//             file; otherwise `pending-approval`
//   plugin    every ENABLED plugin's <installPath>/.mcp.json, read-only here
//             (a plugin's server goes when the plugin does), id plugin:<p>:<name>
//
// <config> is CLAUDE_CONFIG_DIR when it is set, the home directory otherwise.
// The first scope to define a name wins, local > project > user, as the host
// resolves it. Nothing read here leaves this file with a secret in it: header
// and variable VALUES stay inside, a page gets names (src/mcp/definition.mjs).
//
// NEVER written. A server the host has is EXTERNAL to Orbit: observed, and
// testable on request, and that is all -- a server Orbit is to use is added to
// Orbit, in the machine store, not to this file. The one thing read here that is
// secret -- a header or variable value -- is used only inside a probe in this
// process (`definitionOf`), and never leaves the adapter.
import { join } from "node:path";
import { namesOf, redactUrl, shownArgs } from "../../../src/mcp/definition.mjs";

export const name = "claude";

export function createClaudeMcpHost(deps) {
  const at = paths(deps);
  const raw = () => rawServers(at, deps);
  return { name, listServers: () => raw().map(normalised), getServer: (id) => { const found = raw().find((s) => s.id === id); return found ? normalised(found) : null; }, testServer: async (id) => deps.probe(definitionOf(rawOf(raw(), id))) };
}

// Where Claude Code keeps its main configuration: CLAUDE_CONFIG_DIR when it is
// set, the home directory otherwise. Asked by every Claude adapter here.
export const claudeConfigFile = (env, home) => join(env.CLAUDE_CONFIG_DIR || home, ".claude.json");

const paths = (deps) => ({ config: claudeConfigFile(deps.env, deps.home), settings: deps.env.CLAUDE_CONFIG_DIR || join(deps.home, ".claude"), project: deps.projectRoot });

// ---- reading ------------------------------------------------------------------

function rawServers(at, deps) {
  const config = json(deps.io.read(at.config)) ?? {};
  const local = config.projects?.[at.project] ?? {};
  const rows = [...scoped(local.mcpServers, "local", local), ...projectServers(at, deps, local), ...scoped(config.mcpServers, "user", local), ...pluginServers(at, deps, local)];
  return rows.filter((s, i) => rows.findIndex((x) => x.id === s.id) === i);
}

const scoped = (servers, scope, local) => Object.entries(isMap(servers) ? servers : {}).map(([id, def]) => ({ id, scope, def: isMap(def) ? def : {}, hostEnabled: !(local.disabledMcpServers ?? []).includes(id), status: "unknown" }));

function projectServers(at, deps, local) {
  const defined = json(deps.io.read(join(at.project, ".mcp.json")))?.mcpServers;
  const all = settingsOf(at, deps).enableAllProjectMcpServers === true;
  return scoped(defined, "project", local).map((s) => approval(s, local, all));
}

function approval(server, local, all) {
  if ((local.disabledMcpjsonServers ?? []).includes(server.id)) return { ...server, hostEnabled: false };
  return all || (local.enabledMcpjsonServers ?? []).includes(server.id) ? server : { ...server, status: "pending-approval" };
}

// user settings, then the project's shared and local settings: later wins, KEY
// by key -- a project that switches one plugin off has not switched off the
// user's others.
function settingsOf(at, deps) {
  const docs = [join(at.settings, "settings.json"), join(at.project, ".claude", "settings.json"), join(at.project, ".claude", "settings.local.json")].map((f) => json(deps.io.read(f)) ?? {});
  return { ...Object.assign({}, ...docs), enabledPlugins: Object.assign({}, ...docs.map((d) => (isMap(d.enabledPlugins) ? d.enabledPlugins : {}))) };
}

function pluginServers(at, deps, local) {
  const enabled = settingsOf(at, deps).enabledPlugins;
  const installed = json(deps.io.read(join(at.settings, "plugins", "installed_plugins.json")))?.plugins ?? {};
  return Object.entries(installed).filter(([key]) => enabled[key] === true).flatMap(([key, installs]) => fromPlugin(key, installFor(installs, at.project), deps, local));
}

const installFor = (installs, project) => [installs].flat().find((i) => i?.projectPath === project) ?? [installs].flat().find((i) => i?.scope === "user") ?? null;

function fromPlugin(key, install, deps, local) {
  if (!install?.installPath) return [];
  const plugin = key.split("@")[0];
  const servers = json(deps.io.read(join(install.installPath, ".mcp.json")))?.mcpServers;
  return scoped(servers, "plugin", {}).map((s) => ({ ...s, id: `plugin:${plugin}:${s.id}`, hostEnabled: !(local.disabledMcpServers ?? []).includes(`plugin:${plugin}:${s.id}`) }));
}

function rawOf(servers, id) {
  const found = servers.find((s) => s.id === id);
  if (!found) throw new Error(`the host has no MCP server named ${id}`);
  return found;
}

const transportOf = (def) => (def.type ?? (def.command ? "stdio" : "http"));

const entriesOf = (map) => Object.entries(isMap(map) ? map : {}).map(([key, value]) => ({ name: key, value: String(value ?? "") }));

const normalised = (s) => ({ id: s.id, name: s.id.split(":").pop(), host: name, scope: s.scope, transport: transportOf(s.def), url: redactUrl(s.def.url), command: typeof s.def.command === "string" ? s.def.command : null, args: shownArgs(s.def.args), headers: namesOf(entriesOf(s.def.headers)), env: namesOf(entriesOf(s.def.env)), hostEnabled: s.hostEnabled, status: s.status, readOnly: s.scope === "plugin" });

// The WHOLE definition, secrets included -- for a probe in this process, and
// never returned from the adapter.
const definitionOf = (s) => ({ name: s.id, transport: transportOf(s.def), scope: s.scope, url: s.def.url, command: s.def.command, args: Array.isArray(s.def.args) ? s.def.args.map(String) : [], headers: entriesOf(s.def.headers), env: entriesOf(s.def.env) });

// ---- small ----------------------------------------------------------------------

function json(text) {
  try { return text ? JSON.parse(text) : null; }
  catch { return null; }
}

const isMap = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
