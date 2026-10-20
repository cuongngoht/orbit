// The ONE recipe for "what is usable here", shared by both composition roots
// that ask it -- cli/router-hook.mjs on every prompt, and Orbit Control on every
// page -- so the two can never be built two ways.
//
// Everything that touches the world is handed in (`deps`): the plugin root its
// catalogs ship in, the store rooms (src/store/control.mjs), an io, the env
// (whose secret NAMES are asked, never values), the platform, the capability
// registry's list, the installers. The difference between the two callers is
// ONE argument: Control passes `liveMcp`, a fresh read of the host's
// configuration for its External page, where the router reads the saved
// snapshot and asks the host nothing -- and the host's servers are external to
// the router either way.
import { externalObservations, qualifiedServers } from "../mcp/external-store.mjs";
import { activityLog } from "../mcp/activity.mjs";
import { mcpCatalog } from "../mcp/catalog.mjs";
import { effectiveMcp } from "../mcp/effective.mjs";
import { envSecrets } from "../secrets.mjs";
import { createMcpState } from "../mcp/state.mjs";
import { toolCatalog } from "../tools/catalog.mjs";
import { effectiveTools } from "../tools/effective.mjs";
import { createToolState } from "../tools/state.mjs";
import { catalogFile, readCatalog } from "../catalog.mjs";
import { pluginBuiltins, pluginComponents } from "./plugin.mjs";
import { PROVIDERS } from "./providers/index.mjs";
import { getEffectiveResources } from "./registry.mjs";

export const effectiveResourcesOf = (deps) => getEffectiveResources(resourceContext(deps), PROVIDERS);

export function resourceContext(deps) {
  return { componentReady: deps.componentReady, env: deps.env, plugin: deps.plugin, components: () => pluginComponents(deps.pluginRoot, deps.io), builtins: () => pluginBuiltins(deps.pluginRoot, deps.io), capabilities: deps.capabilities ?? (() => []), projectSkills: deps.projectSkills ?? (() => []), packCapabilities: deps.packCapabilities ?? (() => []), mcp: () => mcpOf(deps), tools: () => toolsOf(deps) };
}

// A catalog that cannot be read is an EMPTY catalog: what Orbit manages and
// what a person installed are still known without it.
export const mcpCatalogAt = (pluginRoot, io) => orNone(() => mcpCatalog(readCatalog(io, catalogFile(pluginRoot, "mcp"))));
export const toolCatalogAt = (pluginRoot, io) => orNone(() => toolCatalog(readCatalog(io, catalogFile(pluginRoot, "tools"))));

function orNone(fn) {
  try { return fn(); }
  catch { return []; }
}

export const mcpStateOf = (deps) => createMcpState(deps.rooms, deps.io);

export function mcpOf(deps) {
  const catalog = mcpCatalogAt(deps.pluginRoot, deps.io);
  const state = mcpStateOf(deps);
  const docs = deps.liveMcp ? { ...state.all(), external: { ...state.read("external"), ...deps.liveMcp() } } : state.all();
  return effectiveMcp({ catalog, state: withObservations(docs, deps), receipts: state.receipts(), secrets: envSecrets(deps.env ?? {}), now: deps.io.nowMs(), platform: deps.platform, arch: deps.arch, exists: (p) => deps.io.exists(p), rooms: deps.rooms, installers: deps.mcpInstallers ?? {} });
}

export function toolsOf(deps) {
  const state = createToolState(deps.rooms, deps.io);
  return effectiveTools({ catalog: toolCatalogAt(deps.pluginRoot, deps.io), desired: state.read("desired"), observed: state.read("observed"), receipts: state.receipts(), now: deps.io.nowMs(), platform: deps.platform, arch: deps.arch, installers: deps.installers ?? {} });
}

// Everything the invocation gate (src/mcp/invoke.mjs) needs, from the same
// state the registry reads -- so what a call is allowed to do is judged on
// exactly what the router and Control see. `deps.session` carries the broker's
// effects (fetch, the Process port's start, BASE_ENV) bound by a composition root.
export function mcpInvokeContext(deps) {
  const catalog = mcpCatalogAt(deps.pluginRoot, deps.io);
  const state = mcpStateOf(deps);
  const secrets = envSecrets(deps.env ?? {});
  return { entries: mcpOf(deps), records: state.read("managed").servers ?? {}, connect: { secrets, rooms: deps.rooms, receipts: state.receipts(), catalog, exists: (p) => deps.io.exists(p), platform: deps.platform, arch: deps.arch, node: deps.node, now: () => deps.io.now() }, session: deps.session, activity: activityLog(deps.rooms, deps.io), now: () => deps.io.nowMs() };
}

function withObservations(docs, deps) {
  const more = qualifiedServers(externalObservations(deps.rooms, deps.io));
  return more.length ? { ...docs, external: { ...docs.external, servers: [...(docs.external?.servers ?? []), ...more] } } : docs;
}
