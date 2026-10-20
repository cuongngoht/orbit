// Reading MCP: every owner at once, one managed or external server, the
// catalog, the policies and what managed servers did. Every one of these is a
// GET, so none of them connects to a server or starts a command -- a server's
// tools are what the last explicit Test Connection found, dated, or `null`.
import { consumersOf, effectiveResourcesOf, mcpCatalogAt, mcpStateOf, recentActivity, SELECTIONS, VERDICTS } from "../core.mjs";
import { entryOf, mcpNow, publicMcp } from "./view.mjs";

const OWNERS = [["managed", "orbit-managed"], ["external", "external"]];

export function listMcp(ctx) {
  const all = mcpNow(ctx);
  return { host: ctx.world.host.name, ...Object.fromEntries(OWNERS.map(([name, ownership]) => [name, all.filter((e) => e.ownership === ownership).map(publicMcp)])) };
}

export const listOwned = (ctx, ownership) => ({ servers: mcpNow(ctx).filter((e) => e.ownership === ownership).map(publicMcp) });

// One managed server, with the skills and agents that COULD use what it
// provides -- derived from the capability graph now, never stored.
export async function readManaged(ctx, id) {
  const entry = entryOf(ctx, id);
  const caps = await ctx.capabilities();
  const effective = effectiveResourcesOf({ ...ctx.world, capabilities: () => caps });
  return { ...publicMcp(entry), consumers: consumersOf({ routing: { provides: entry.provides } }, effective) };
}

export const readExternal = (ctx, id) => publicMcp(entryOf(ctx, id, "external"));

export function mcpTools(ctx, id, ownership = "orbit-managed") {
  const entry = entryOf(ctx, id, ownership);
  return { id, key: entry.key, checkedAt: entry.checkedAt, fresh: entry.checkFresh === true, tools: entry.tools ?? null };
}

// A catalog row says whether Orbit already manages it and whether the host has
// something it recognises as it -- so the page never offers to add what Orbit
// has, and says what the host has without treating it as Orbit's.
export function mcpCatalog(ctx) {
  const all = mcpNow(ctx);
  const managed = new Set(all.filter((e) => e.ownership === "orbit-managed").map((e) => e.catalog ?? e.id));
  const observed = new Set(all.filter((e) => e.ownership === "external" && e.catalog).map((e) => e.catalog));
  return { entries: mcpCatalogAt(ctx.world.pluginRoot, ctx.world.io).map((e) => ({ id: e.id, name: e.name, description: e.description, recommended: e.recommended, provides: e.provides, transport: e.definition?.transport ?? null, install: { strategy: e.install.strategy, version: e.install.version, source: e.install.source }, addable: e.recommended, added: managed.has(e.id), observedInHost: observed.has(e.id) })) };
}

export function mcpPolicies(ctx) {
  const state = mcpStateOf(ctx.world);
  const managed = mcpNow(ctx).filter((e) => e.ownership === "orbit-managed");
  return { verdicts: VERDICTS, selections: SELECTIONS, resources: managed.map((e) => ({ key: e.key, id: e.id, name: e.name, provides: e.provides, selection: e.selection, policy: publicMcp(e).policy })), workflows: state.read("policies").workflows ?? {} };
}

export const mcpActivity = (ctx) => ({ events: recentActivity(ctx.world.io, ctx.world.rooms, 100) });
