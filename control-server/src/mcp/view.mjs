// What of an MCP server the page may see, and the one way a request finds one.
//
// The effective list is src/mcp/effective.mjs's, over Orbit's own records and a
// LIVE read of the host's configuration (its files: no network, no process) --
// so the External tab shows what the host has now, while the prompt router
// reads the saved snapshot. Either way a host's server is external: observed,
// never routed to, and never written.
//
// What leaves this server is an ALLOW-LIST per owner (`PUBLIC`), for the reason
// a report masks by allow-list too: a field added to an effective entry next
// year must not reach a browser because nobody remembered to hide it. No header
// value, environment value or URL query value is in any field on it -- a
// managed definition names its secrets, and says only whether each is set.
import { Blocked, mcpCatalogAt, mcpOf, mcpStateOf, Refused } from "../core.mjs";
import { conflict, invalid, missing, unavailable } from "../errors.mjs";

export const MCP_ID = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const EXTERNAL_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,160}$/;

const COMMON = ["key", "id", "name", "description", "ownership", "transport", "provides", "signals", "requiresSignal", "enabled", "runtimeReady", "available", "eligible", "selection", "state", "why", "status", "checkedAt", "lastStatus", "checkFresh", "reason", "toolCount", "catalog"];
const PUBLIC = {
  "orbit-managed": [...COMMON, "origin", "priority", "definition", "secrets", "runtime", "install", "policy", "approval", "createdAt", "updatedAt"],
  external: [...COMMON, "host", "scope", "url", "command", "args", "headers", "env", "hostEnabled", "observed", "stale", "readOnly"],
  catalog: COMMON,
};

export function publicMcp(e) {
  const shown = Object.fromEntries((PUBLIC[e.ownership] ?? COMMON).filter((k) => e[k] !== undefined).map((k) => [k, e[k]]));
  return e.policy ? { ...shown, policy: { default: e.policy.default, capabilities: e.policy.capabilities, operations: e.policy.operations } } : shown;
}

// A host whose configuration cannot be read costs the External tab its live
// view, never the page: the last snapshot answers instead.
export const mcpNow = (ctx) => mcpOf({ ...ctx.world, liveMcp: () => liveHost(ctx) });

function liveHost(ctx) {
  try { return { host: ctx.world.host.name, observedAt: ctx.world.io.now(), servers: ctx.world.host.listServers() }; }
  catch { return {}; }
}

export function entryOf(ctx, id, ownership = "orbit-managed") {
  if (typeof id !== "string" || !(ownership === "external" ? EXTERNAL_ID : MCP_ID).test(id)) throw invalid("INVALID_MCP_ID", "an MCP server id is letters, digits and . _ - only");
  const found = mcpNow(ctx).find((e) => e.ownership === ownership && e.id === id);
  if (!found) throw missing("MCP_NOT_FOUND", `${ownership === "orbit-managed" ? "Orbit manages" : ownership === "external" ? "the host has" : "Orbit keeps"} no MCP server named ${id}`);
  return found;
}

// What src/mcp/manage.mjs operates on: the state port, the catalog, a clock.
export const manageCtx = (ctx) => ({ state: mcpStateOf(ctx.world), catalog: mcpCatalogAt(ctx.world.pluginRoot, ctx.world.io), now: () => ctx.world.io.now() });

// A refusal from an operation, in HTTP's words: already there is 409, not
// there is 404, a definition with problems is 400 with every problem listed.
export async function operated(code, fn) {
  try { return await fn(); }
  catch (e) { throw translated(code, e); }
}

function translated(code, e) {
  if (e?.conflict) return conflict(code, e.message);
  if (e?.missing) return missing(code, e.message);
  if (e instanceof Blocked) return unavailable(code, e.message);
  return e instanceof Refused ? invalid(code, e.message, e.problems) : e;
}
