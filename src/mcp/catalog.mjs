// The plugin's MCP CATALOG (catalog/mcp.json), read as data. A catalog row is a
// PRODUCT Orbit knows about -- never proof that anything is installed, enabled or
// ready on this machine: known, installed, enabled, ready and eligible are five
// different answers, and only the machine store and the disk give the others.
//
// A row does two jobs. It DESCRIBES what can be added to Orbit: a `recommended`
// row with a `definition` (src/mcp/managed.mjs -- a URL, or a runtime Orbit
// installs, never a secret) becomes a Orbit-managed resource when a person adds
// it. And it RECOGNISES: a server a host has configured is matched by id, url
// or command, and gains the row's `provides` and routing signals for display --
// it stays external, observed and never routed, all the same.
//
// `install` says how the runtime a definition needs gets onto this machine:
// `remote-http` (nothing to install -- a URL is connected to on demand),
// `archive` (a release PINNED here, SHA-256 per platform, into
// <storeBase>/runtimes/mcp/), or `manual`. Nothing here branches on a row's id.
import { rowsOf } from "../catalog.mjs";
import { DECLARED_KINDS } from "../protected/boundaries.mjs";
import { pinnedArchive } from "../store/archive.mjs";
import { definitionOf, managedProblems } from "./managed.mjs";

export const mcpPlatformKey = (platform, arch) => `${platform}-${arch}`;

export function mcpCatalog(data) {
  return rowsOf(data?.servers).map(entryOf);
}

function entryOf(row) {
  const definition = row.definition && !managedProblems({ ...row.definition, id: row.id }).length ? definitionOf(row.definition) : null;
  return { id: row.id, name: String(row.name ?? row.id), description: String(row.description ?? ""), recommended: row.recommended === true && definition !== null, definition, install: installOf(row.install ?? {}, definition), match: matchOf(row), provides: list(row.provides), signals: list(row.routing?.signals), requiresSignal: row.routing?.requiresSignal === true, protected: protectedOf(row.protected) };
}

// Which of the server's tools ARE a protected action (0.2.0): tool name -> a kind src/protected/ knows (a push, a
// deploy, a migration, a destructive data operation). Data the catalog ships about that server's own tools; an entry
// naming anything else is dropped, so a typo can only ever leave a tool unprotected-by-name, never widen anything.
const TOOL_NAME = /^[A-Za-z0-9_.:/-]{1,128}$/;

const protectedOf = (map) => Object.fromEntries(Object.entries(map && typeof map === "object" && !Array.isArray(map) ? map : {}).filter(([tool, kind]) => TOOL_NAME.test(tool) && DECLARED_KINDS.includes(kind)));

const installOf = (i, def) => ({ strategy: typeof i.strategy === "string" ? i.strategy : def?.transport === "http" ? "remote-http" : "manual", version: typeof i.version === "string" ? i.version : null, source: typeof i.source === "string" ? i.source : null, instructions: typeof i.instructions === "string" ? i.instructions : null, launch: i.launch === "node" ? "node" : "direct", assets: assetsOf(i.assets) });

// A pin that is not well formed is dropped, so a typo in the catalog can make a
// platform uninstallable but never makes an unverified download installable.
const assetsOf = (assets) => Object.fromEntries(Object.entries(assets && typeof assets === "object" ? assets : {}).filter(([, a]) => pinnedArchive(a, "entrypoint")));

export const mcpAssetFor = (entry, platform, arch) => entry.install.assets[mcpPlatformKey(platform, arch)] ?? null;

const matchOf = (row) => ({ ids: list(row.match?.ids).map(lower).concat(lower(row.id)), urls: list(row.match?.urls).map(lower), commands: list(row.match?.commands).map(lower) });

const list = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string" && x) : []);
const lower = (s) => String(s).toLowerCase();

// The catalog row a configured server IS, or null. A plugin-scoped server is
// named `plugin:<plugin>:<server>` by the host, so the last segment is its name.
export function recognised(entries, server) {
  const name = lower(String(server.id ?? "").split(":").pop());
  const url = lower(server.url ?? "");
  const cmd = lower([server.command, ...(server.args ?? [])].join(" "));
  return entries.find((e) => e.match.ids.includes(name) || e.match.urls.some((u) => url.includes(u)) || e.match.commands.some((c) => cmd.includes(c))) ?? null;
}
