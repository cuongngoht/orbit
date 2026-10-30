// The ONE binding of a declared playbook's CALLS (0.0.4; shared since 0.3.0 by the coordinator and the improvement
// engine): the resolver over the SAME effective registry the prompt router and Orbit Control build, with the project's
// own capabilities loaded first; and the doors a call goes through -- the MCP broker over the same managed state, or the
// capability pipeline with no case -- through src/work/invoke.mjs invokeBound. Nothing here runs a command line, and
// nothing here decides who provides a capability: the resolver does.
//
//   extended(env, root) -> the project's capabilities loaded, or null for a project that has none it can load
//   effectiveFor(h, caps, { pluginRoot, env, values }) -> the effective registry
//   resolvedOne(effective, capability) -> the resolver's answer
//   invokePort(h, lz, { pluginRoot, env, session }) -> { bind(resolved), call(binding, ask) }
//
// `h`: { paths: { root, storeRoot }, io } -- the checkout a composition root found. `lz`: { effective(), caps }.
import { connectionEnvFor, connectionReader } from "../orbit-requirements/bind.mjs";
import { realWorld } from "../orbit-control/world.mjs";
import { Refused } from "../../src/errors.mjs";
import { withExtensions } from "../../src/extensions/index.mjs";
import { resolved } from "../../src/knowledge/verify.mjs";
import { effectiveResourcesOf, mcpInvokeContext } from "../../src/resources/compose.mjs";
import { createContext } from "../../src/run/context.mjs";
import { fingerprintOf as bindingFingerprint, resourceOf } from "../../src/work/bind.mjs";
import { invokeBound } from "../../src/work/invoke.mjs";
import { projectSkillsOf } from "./factory.mjs";

export async function extended(env, root) {
  try { return await withExtensions(createContext({}, env, root)); }
  catch (e) { if (e instanceof Refused) return null; throw e; }
}

export const effectiveFor = (h, caps, o) => effectiveResourcesOf({ ...realWorld({ pluginRoot: o.pluginRoot, projectRoot: h.paths.root, env: o.env }), capabilities: () => caps?.capabilities?.list?.() ?? [], projectSkills: projectSkillsOf(h, o.values) });

export const resolvedOne = (effective, capability) => resolved([{ capability, proves: { subject: capability } }], effective).results[0];

const lazy = (make) => {
  let made = null;
  return () => (made ??= make());
};

// The provider the resolver picked, bound by its registry key and the fingerprint of what made it eligible -- what
// the door checks again the moment it is asked.
const boundOf = (effective, r) => ((res) => (res ? { provider: r.provider, fingerprint: bindingFingerprint(res) } : null))(resourceOf(effective, r?.provider));

// A capability that names a connection is asked in a context that holds that one credential for the moment of its call.
async function capabilityContextOf(caps, real, io, connection) {
  if (!connection || !caps) return caps;
  return { ...caps, ...(await connectionEnvFor({ providerId: connection, connections: connectionReader(real.rooms, io), secrets: real.secrets, env: real.env })) };
}

// The broker over the SAME managed state the registry read, and the project's capabilities as the step loaded them.
export function invokePort(h, lz, o) {
  const real = lazy(() => realWorld({ pluginRoot: o.pluginRoot, projectRoot: h.paths.root, env: o.env }));
  const w = { effective: () => lz.effective(), get mcp() { return mcpInvokeContext(real()); }, capabilityContext: (connection) => capabilityContextOf(lz.caps, real(), h.io, connection), host: h.io.host, session: o.session };
  return { bind: (r) => boundOf(lz.effective(), r), call: (binding, ask) => invokeBound(w, binding, ask) };
}
