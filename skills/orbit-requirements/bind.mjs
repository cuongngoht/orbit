// The REAL binding of the requirements pack, done once for the composition roots
// that use it -- cli/requirements.mjs, cli/work.mjs, Orbit Control and the router's
// hook -- so none of them can wire a different set of readers or a different way to
// hand a credential to a command.
//
// Binding reads the pack's own descriptors and asks the connection store which
// connections exist. It opens no connection and reads no credential: a credential is
// read by a reader at the moment a request is made, and by `connectionEnvFor` for
// the one provider a capability declared, immediately before that capability runs.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectionStore } from "../../src/connections/store.mjs";
import { publicConnection } from "../../src/connections/model.mjs";
import { invocation } from "../../src/process/shim.mjs";
import { invokeMcp } from "../../src/mcp/invoke.mjs";
import { baseEnv } from "../../src/process/env.mjs";
import { effectiveResourcesOf, mcpInvokeContext, toolCatalogAt } from "../../src/resources/compose.mjs";
import { resource } from "../../src/resources/model.mjs";
import { everyResource } from "../../src/resources/registry.mjs";
import { ACQUISITION_IDS, authorityBearing } from "../../src/sources/contract-v1.mjs";
import { capabilityReader } from "../../src/sources/readers/capability.mjs";
import { mcpReader } from "../../src/sources/readers/mcp.mjs";
import { createToolState } from "../../src/tools/state.mjs";
import { observeSome } from "../../src/tools/observe.mjs";
import { descriptorProblems } from "./descriptor.mjs";
import { PACK, readerKey, usable } from "./sources/common.mjs";
import { azureDevOpsReader } from "./sources/azure-devops.mjs";
import { githubReader } from "./sources/github.mjs";

export const PACK_DIR = dirname(fileURLToPath(import.meta.url));

// A provider is a descriptor row and a reader; this is the line that joins them.
export const READERS = { github: githubReader, "azure-devops": azureDevOpsReader };

export const providersFile = () => JSON.parse(readFileSync(join(PACK_DIR, "providers.json"), "utf8"));

export const descriptorFindings = (rows = providersFile().providers) => rows.flatMap((d) => descriptorProblems(d));

// The descriptors that hold AND have a reader. One that does not is left out, not
// half-used: a mapping nobody checked must not be able to build a reader.
export const descriptorsOf = (rows = providersFile().providers) => rows.filter((d) => descriptorProblems(d).length === 0 && READERS[d.id]);

// The connections as a READER needs them and nothing more: which exist (the public
// view, which says only whether a credential is set) and the REFERENCE a connection
// holds -- never a value. A composition root that only lists and reads has no use for
// the operations that create, change or delete one, so it is not given them.
export function connectionReader(rooms, io) {
  const store = connectionStore(rooms, io);
  return { list: () => store.list().map(publicConnection), record: (id) => store.get(id) ?? { credential: null } };
}

// deps: { connections, secrets, fetch, nowMs, sleep?, limits? }
export const packReaders = (deps, descriptors = descriptorsOf()) => descriptors.map((descriptor) => READERS[descriptor.id]({ ...deps, descriptor }));

// The readers as REGISTRY ROWS: the one Effective Resource Registry lists them beside
// everything else that can provide a capability. Ready means a connection with a
// credential exists for the provider; nothing is read to say so.
export function readerResources(connections, descriptors = descriptorsOf()) {
  return descriptors.map((d) => readerRow(d, usable(d, connections).length > 0));
}

const readerRow = (d, ready) => resource("capability", { id: `${d.id}.workitem`, key: readerKey(d), source: `pack:${PACK}`, ownership: "plugin", enabled: true, runtimeReady: ready, available: ready, state: ready ? "ready" : "needs-attention", why: ready ? null : `no ${d.label} connection with a credential is set up here — add one in Orbit Control (Connections)`, summary: `reads a ${d.label} work item through a connection`, provides: d.provides, detail: { pack: PACK, connection: d.connection } });

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// The credential of ONE provider's connection, read now, as the context an adapter
// is invoked in: `connections.has` and `connectionEnv`, which src/capability/invoke.mjs
// and src/extensions/context-v1.mjs consult. Extension invocation is synchronous, so
// the value is read here, just before the call, and lives only in the returned
// closure -- on top of the few variables a child needs to start, under the name the
// provider's tool expects. Nothing is read for any other provider.
export async function connectionEnvFor({ providerId, organization, descriptors = descriptorsOf(), connections, secrets, env }) {
  const d = descriptors.find((x) => x.connection === providerId);
  const value = d ? await credentialOf(d, organization, connections, secrets) : null;
  const table = value ? { [providerId]: { ...baseEnv(env), [d.credentialEnv]: value } } : {};
  return { connections: { has: (p) => p in table }, connectionEnv: (p) => table[p] };
}

// Which connection, and what it holds: one read, of one credential, or none.
async function credentialOf(d, organization, connections, secrets) {
  const chosen = usable(d, connections).find((c) => !organization || same(c.organization, organization));
  return chosen ? secrets.read(connections.record(chosen.id).credential) : null;
}

// ---- the world the discovery ladder and acquisition run in -------------------------------------

const REF = /^source:(src-[0-9a-f]{12})@(.+)$/;

const readable = (rec) => Boolean(rec) && ["read", "anomaly"].includes(rec.state);

// What requirement intelligence may ask of the sources this project has read, and nothing
// else: whether a citation names something read here (and whether that may bear a
// requirement), and what a source is now. It reads records; it fetches nothing.
export function requirementWorld(sources) {
  const recordOf = (sid) => (/^src-[0-9a-f]{12}$/.test(String(sid)) ? sources.record(sid) : null);
  return {
    resolves: (ref) => {
      const m = REF.exec(String(ref));
      const rec = m && recordOf(m[1]);
      return readable(rec) ? { sid: rec.id, cited: m[2], revision: rec.revision, digest: rec.digest, kind: rec.kind, authorityBearing: authorityBearing(rec.kind) } : null;
    },
    source: (sid) => {
      const rec = recordOf(sid);
      return rec ? { kind: rec.kind, authority: rec.authority, revision: rec.revision, digest: rec.digest } : null;
    },
  };
}

const answersAcquisition = (cap) => [cap.id, ...(cap.provides ?? [])].some((p) => ACQUISITION_IDS.includes(p));

// A project's own adapter, as a reader. What it needs a connection for is read just
// before it runs -- for the one provider it named and the one owner it is asked about --
// because an extension runs synchronously and a credential may come from an OS store.
function boundAdapter(w, cap) {
  const bind = async (identity) => connectionEnvFor({ providerId: cap.connection, organization: identity.organization, connections: w.connections, secrets: w.secrets, env: w.env });
  return { ...capabilityReader(w.ctx, cap), read: async (identity, capability) => capabilityReader({ ...w.ctx, ...(await bind(identity)) }, cap).read(identity, capability) };
}

export const adapterReaders = (w) => w.capabilities.filter(answersAcquisition).map((cap) => boundAdapter(w, cap));

// A Orbit-managed server the catalog has a mapping for is a reader; one it has not is not.
export function mcpReaders(w) {
  const managed = everyResource(w.effective).filter((r) => r.kind === "mcp" && r.ownership === "orbit-managed");
  return managed.flatMap((r) => (w.descriptors.some((d) => d.mcp?.catalog && d.mcp.catalog === r.detail?.catalog) ? [mcpReader(w.invoke, w.descriptors.find((d) => d.mcp?.catalog === r.detail.catalog).mcp, r.key)] : []));
}

// How a tool is asked what it is configured for: its own argv, no shell, the few
// variables a child needs to start, and a deadline.
export function toolProbe({ env, process: proc }) {
  return (bin, argv, finding) => {
    const call = invocation(finding?.path ?? bin, env);
    const got = proc.run(call.file, [...call.prefix, ...argv], { timeoutMs: 15000, env: baseEnv(env) });
    return { ok: got.ok === true, out: String(got.out ?? "") };
  };
}

// Only the tools a concrete need asked about are looked for.
export function toolObserver({ pluginRoot, rooms, io, detection }) {
  return (ids) => {
    const state = createToolState(rooms, io);
    return observeSome(toolCatalogAt(pluginRoot, io), ids, { ...detection, rooms, receipts: state.receipts(), state, now: io.now });
  };
}

const effectiveOf = (d) => () => effectiveResourcesOf({ ...d.real, capabilities: () => d.base.capabilities.list() });

// Every way a work item can be read here: the pack's own readers, the project's adapters
// and the Orbit-managed servers the catalog has a mapping for. The registry decides which
// is used; this only says which exist.
function readersOf(d, descriptors, connections) {
  const wired = { effective: effectiveOf(d)(), descriptors, connections, secrets: d.real.secrets, env: d.real.env, ctx: d.base, capabilities: d.base.capabilities.list(), invoke: (ask) => invokeMcp(mcpInvokeContext(d.real), ask) };
  return [...packReaders({ connections, secrets: d.real.secrets, fetch: d.fetch ?? globalThis.fetch, nowMs: d.nowMs ?? Date.now }, descriptors), ...adapterReaders(wired), ...mcpReaders(wired)];
}

// d: { base (the run context, with the project's capabilities), real (skills/orbit-control/
//      world.mjs realWorld), sources (the room), io, opportunities ({ docs(), settle(docs) },
//      the knowledge room's one opportunity per capability), works?, runtimeDir?,
//      fetch? and nowMs? (the network and the clock, for a test to replace) }
export function sourceWorld(d) {
  const descriptors = descriptorsOf();
  const connections = connectionReader(d.real.rooms, d.io);
  return { descriptors, readers: readersOf(d, descriptors, connections), works: d.works ?? (() => []), bindings: () => d.sources.bindings(), connections, effective: effectiveOf(d), observe: toolObserver({ ...d.real, io: d.io }), probe: toolProbe({ env: d.real.env, process: d.base.process }), opportunities: d.opportunities, now: () => new Date().toISOString(), sources: d.sources, io: d.io, runtimeDir: d.runtimeDir ?? null };
}
