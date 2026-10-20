// ONE observation of the world outside Orbit, saved as the snapshots every
// later reader uses instead of asking again:
//
//   mcp     the host's MCP configuration, through the host port's
//           listServers() -- saved as EXTERNAL (external.json): observed, never
//           routed to, and never a reason for Orbit to own anything. Nothing is
//           connected to, so a server stays `unknown` until somebody tests it
//   tools   every catalog tool, detected (src/tools/observe.mjs)
//
// This is RECONCILIATION's input side. It runs when a session starts (an async
// hook, so nobody waits), when Orbit Control refreshes, and after Control
// changes something -- and after a plugin upgrade the next session start is
// what re-reads the host with the new plugin's catalog. It never installs,
// adds, removes or repairs anything, and each half is isolated from the other.
import { observeExternal } from "../mcp/external-store.mjs";
import { observedAs } from "../mcp/state.mjs";
import { observeTools } from "../tools/observe.mjs";
import { createToolState } from "../tools/state.mjs";
import { mcpStateOf, toolCatalogAt } from "./compose.mjs";

export function observeMcp(w) {
  const servers = w.host.listServers();
  if (w.observationScope) observeExternal(w.rooms, w.io, w.host.name, w.observationScope, servers);
  if (!w.observationScope) mcpStateOf(w).change("external", (doc) => observedAs(doc, w.host.name, servers, w.io.now()));
  return servers;
}

export function observeAllTools(w) {
  const state = createToolState(w.rooms, w.io);
  return observeTools(toolCatalogAt(w.pluginRoot, w.io), { ...w.detection, rooms: w.rooms, receipts: state.receipts(), state, now: w.io.now });
}

export function observeResources(w) {
  return { mcp: isolated(() => observeMcp(w).length), tools: isolated(() => observeAllTools(w).length) };
}

function isolated(fn) {
  try { return { ok: true, count: fn() }; }
  catch (e) { return { ok: false, why: String(e?.message ?? e).slice(0, 200) }; }
}
