// The REAL binding of the requirements pack, done once for the composition roots
// that use it -- cli/requirements.mjs, cli/work.mjs, Orbit Control and the router's
// hook -- so none of them can wire a different set of readers or a different way to
// hand a credential to a command.
//
// Binding reads the pack's own descriptors and asks the connection store which
// connections exist. It opens no connection, reads no credential and starts no sign-in:
// how a request is AUTHORIZED is a RequestAuth's (src/connections/auth.mjs), bound ONCE
// for every reader of a world and asked at the moment a request is made; the one place
// that hands a credential to a child is `connectionEnvFor`, for the one provider a
// capability declared, immediately before that capability runs -- and a connection that
// signs in hands it nothing at all.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { connectionStore } from "../../src/connections/store.mjs";
import { publicConnection, strategyOf } from "../../src/connections/model.mjs";
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
import { authFor } from "../orbit-report/auth/index.mjs";
import { providers as connectionProviders } from "../orbit-report/pack.mjs";
import { descriptorProblems } from "./descriptor.mjs";
import { PACK, configured, readerKey } from "./sources/common.mjs";
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
// view, which says whether a credential is set and whether the connection can be used
// at all -- drawn with its provider's descriptor, so nobody downstream needs one) and
// the REFERENCE a connection holds -- never a value. A composition root that only lists
// and reads has no use for the operations that create, change or delete one, so it is
// not given them. Listing reads the connection store and the plugin's own descriptors,
// and nothing else: no process, no credential, no network.
export function connectionReader(rooms, io, known = connectionProviders()) {
  const store = connectionStore(rooms, io);
  return { list: () => store.list().map((rec) => publicConnection(rec, known.find((p) => p.id === rec.provider))), record: (id) => store.get(id) ?? { credential: null } };
}

// deps: { connections, auth (createAuth), interactive?, notify?, fetch, nowMs, sleep?, limits? }
export const packReaders = (deps, descriptors = descriptorsOf()) => descriptors.map((descriptor) => READERS[descriptor.id]({ ...deps, descriptor }));

// The readers as REGISTRY ROWS: the one Effective Resource Registry lists them beside
// everything else that can provide a capability. Ready means a connection that can be
// used exists for the provider -- one with a credential, or one that signs in, which
// needs nothing until it is read; nothing is read or started to say so.
export function readerResources(connections, descriptors = descriptorsOf()) {
  return descriptors.map((d) => readerRow(d, configured(d, connections).length > 0));
}

const readerRow = (d, ready) => resource("capability", { id: `${d.id}.workitem`, key: readerKey(d), source: `pack:${PACK}`, ownership: "plugin", enabled: true, runtimeReady: ready, available: ready, state: ready ? "ready" : "needs-attention", why: ready ? null : `no ${d.label} connection is set up here — add one in Orbit Control (Connections)`, summary: `reads a ${d.label} work item through a connection`, provides: d.provides, detail: { pack: PACK, connection: d.connection } });

const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

// The environment of ONE provider's connection, as the context an adapter is invoked
// in: `connections.has` and `connectionEnv`, which src/capability/invoke.mjs and
// src/extensions/context-v1.mjs consult. Extension invocation is synchronous, so a
// credential is read here, just before the call, and lives only in the returned closure
// -- on top of the few variables a child needs to start, under the name the provider's
// tool expects. A connection that SIGNS IN has no credential to hand over: its child gets
// the few variables it needs to start and nothing more, because a token is only ever an
// answer, never an argument or a variable. Nothing is read for any other provider.
// w: { providerId, organization?, descriptors?, connections, secrets, env, known? (the connection providers) }
export async function connectionEnvFor(w) {
  const d = (w.descriptors ?? descriptorsOf()).find((x) => x.connection === w.providerId);
  const child = d ? await childEnvOf(d, { ...w, known: w.known ?? connectionProviders() }) : null;
  const table = child ? { [w.providerId]: child } : {};
  return { connections: { has: (p) => p in table }, connectionEnv: (p) => table[p] };
}

// Which connection, and what its child is given: one credential read, or nothing at all, or none bound.
async function childEnvOf(d, w) {
  const chosen = configured(d, w.connections).find((c) => !w.organization || same(c.organization, w.organization));
  if (!chosen) return null;
  if (strategyOf(chosen, w.known.find((p) => p.id === chosen.provider)).kind !== "credential") return baseEnv(w.env);
  const value = await w.secrets.read(w.connections.record(chosen.id).credential);
  return value ? { ...baseEnv(w.env), [d.credentialEnv]: value } : null;
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
  const bind = async (identity) => connectionEnvFor({ providerId: cap.connection, organization: identity.organization, connections: w.connections, secrets: w.secrets, env: w.env, known: w.known });
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
// w: { descriptors, connections, auth (createAuth), known (the connection providers) }
function readersOf(d, w) {
  const wired = { effective: effectiveOf(d)(), descriptors: w.descriptors, connections: w.connections, known: w.known, secrets: d.real.secrets, env: d.real.env, ctx: d.base, capabilities: d.base.capabilities.list(), invoke: (ask) => invokeMcp(mcpInvokeContext(d.real), ask) };
  const pack = { connections: w.connections, auth: w.auth, interactive: d.interactive, notify: d.notify, fetch: d.fetch ?? globalThis.fetch, nowMs: d.nowMs ?? Date.now };
  return [...packReaders(pack, w.descriptors), ...adapterReaders(wired), ...mcpReaders(wired)];
}

// The auth every reader of a world asks, bound ONCE from what the world already holds, so no reader can wire a
// different tool, profile or adapter than the report's. A root that has one of its own hands it in. (Never from
// skills/orbit-control/world.mjs: that module imports this one.)
const authOver = (d, known) => d.auth ?? authFor({ pluginRoot: d.real.pluginRoot, env: d.real.env, rooms: d.real.rooms, io: d.io, process: d.real.process, secrets: d.real.secrets, providers: known, log: d.real.log });

// d: { base (the run context, with the project's capabilities), real (skills/orbit-control/
//      world.mjs realWorld), sources (the room), io, opportunities ({ docs(), settle(docs) },
//      the knowledge room's one opportunity per capability), works?, runtimeDir?,
//      fetch? and nowMs? (the network and the clock, for a test to replace),
//      auth? (one already bound), interactive? and notify? (what a read may ask of a person who
//      must sign in: "when-required" by default, and where the prompt is shown) }
export function sourceWorld(d) {
  const descriptors = descriptorsOf();
  const known = connectionProviders();
  const connections = connectionReader(d.real.rooms, d.io, known);
  const auth = authOver(d, known);
  return { descriptors, readers: readersOf(d, { descriptors, connections, auth, known }), works: d.works ?? (() => []), bindings: () => d.sources.bindings(), connections, effective: effectiveOf(d), observe: toolObserver({ ...d.real, io: d.io }), probe: toolProbe({ env: d.real.env, process: d.base.process }), opportunities: d.opportunities, now: () => new Date().toISOString(), sources: d.sources, io: d.io, runtimeDir: d.runtimeDir ?? null };
}
