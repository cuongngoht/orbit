// The ISOLATION PROFILE, and its attestation (ADR 0038): what must be TRUE of every container an isolated sandbox
// runs -- read back from what the isolation provider says it created, never assumed from how it was asked.
//
// One ordered table of rows over the generic facts a provider reports (src/runtime/isolation/contract-v1.mjs
// `facts`), each row naming the kinds of container it holds: the WORKER that runs generated tests is held to all of
// them; a service keeps the capabilities its own image starts with and is held to the rest. Then the network (it is
// INTERNAL, and it carries the task's labels), and then the one fact no inspection can show: from inside, the egress
// name does not resolve and the egress address is not reached -- each on POSITIVE evidence, a probe that ran and said
// so, because a probe that did not run, did not answer or said anything else proves nothing. The profile holds only if
// every row holds, and it is attested at preparation and again before every dispatch -- a container somebody changed
// in between is refused.
import { outsideAddress } from "./policy.mjs";
import { LOOKUP_PROBE_MS, probedFrom } from "./network.mjs";

const ALL = ["worker", "probe", "helper", "observer", "pod", "component", "service"];
const STRICT = ["worker", "probe", "helper", "observer", "pod"];
const WITHOUT_CAPS = [...STRICT, "component"];

const under = (path, root) => Boolean(root) && (path === root || String(path).startsWith(`${root}/`));

const SOCKET = /\.sock$|docker\.sock/;

const declared = (m, node) => (node.mounts ?? []).some((d) => d.target === m.target && d.source === m.source && Boolean(d.readOnly) === m.readOnly);

// A mount from under this machine's home, Orbit's store or the primary checkout is refused unless it is one the
// ENGINE declared for this container -- the task's workspace, the plugin, a run's own rooms, each strictly below the
// root it sits in. A socket, or a forbidden root itself, never is.
const forbiddenMount = (m, a, node) => SOCKET.test(m.source) || a.forbidden.includes(m.source) || (a.forbidden.some((root) => under(m.source, root)) && !declared(m, node));

const NO_NEW = /^no-new-privileges(:true|=true)?$/;

const pluginMount = (f, a) => f.mounts.find((m) => m.target === a.pluginTarget);

const onTaskNetwork = (f, a) => (f.networks.length === 1 && f.networks[0] === a.network && f.networkMode !== "host") || (Boolean(a.podId) && f.networkMode === `container:${a.podId}`);

export const PROFILE = [
  { id: "ROOT_READ_ONLY", roles: STRICT, holds: (f) => f.readOnly === true, say: "its root filesystem is read-only" },
  { id: "NO_FORBIDDEN_MOUNT", roles: ALL, holds: (f, a, node) => !f.mounts.some((m) => forbiddenMount(m, a, node)), say: "nothing of this machine's home, Orbit's store, a vault or a control socket is mounted in it beyond what the engine declared" },
  { id: "ONLY_DECLARED_MOUNTS", roles: ALL, holds: (f, a, node) => f.mounts.filter((m) => m.type === "bind").every((m) => declared(m, node)), say: "it holds exactly the mounts its spec declared, and no other" },
  { id: "PLUGIN_READ_ONLY", roles: ["worker"], holds: (f, a) => pluginMount(f, a)?.readOnly === true, say: "the plugin is mounted, read-only" },
  { id: "ONLY_TASK_NETWORK", roles: ALL, holds: (f, a) => onTaskNetwork(f, a), say: "it is attached to the task's internal network (or its pod) and to nothing else" },
  { id: "NO_PUBLISHED_PORTS", roles: ALL, holds: (f) => f.published.length === 0, say: "it publishes no port on this machine" },
  { id: "NOT_PRIVILEGED", roles: ALL, holds: (f) => !f.privileged && f.devices === 0 && f.hostNamespaces === 0, say: "it is not privileged, holds no device and shares no namespace with this machine" },
  { id: "CAPABILITIES_DROPPED", roles: WITHOUT_CAPS, holds: (f) => f.capDrop.includes("ALL") && f.capAdd.length === 0, say: "every capability is dropped and none is added" },
  { id: "NO_NEW_PRIVILEGES", roles: ALL, holds: (f) => f.securityOpt.some((o) => NO_NEW.test(o)), say: "nothing in it can gain privileges" },
  { id: "LIMITED", roles: ALL, holds: (f) => f.limits.cpus > 0 && f.limits.memory > 0 && f.limits.pids > 0, say: "its cpu, memory and process count are limited" },
  { id: "ENV_ALLOWED", roles: ALL, holds: (f, a, node) => f.env.every((n) => (node.allowedEnv ?? []).includes(n)), say: "it holds only the environment names its image sets and its spec declared" },
  { id: "LABELLED", roles: ALL, holds: (f, a) => Object.entries(a.labels).every(([k, v]) => f.labels?.[k] === v), say: "it carries the task's labels" },
];

export const NETWORK_PROFILE = [
  { id: "NETWORK_INTERNAL", holds: (n) => n.exists && n.internal === true, say: "the task's network is internal: nothing on it reaches beyond it" },
  { id: "NETWORK_LABELLED", holds: (n, a) => n.exists && Object.entries(a.labels).every(([k, v]) => n.labels?.[k] === v), say: "the task's network carries the task's labels" },
];

// ---- EGRESS: positive evidence only -----------------------------------------------------------------------------------

// The egress evidence is { target: { host, port, address }, byName, byAddress }: one probe asked the egress NAME,
// one asked the egress ADDRESS -- a literal, so no resolver stands between the probe and the connection it tries.
// It holds only when the first ran and its resolver answered no (FAILED), and the second ran and its connection was
// tried and did not get through (RESOLVED UNREACHABLE). Anything else -- a probe that did not run, a lookup that never
// answered (UNKNOWN), a connection never attempted, an address nobody could name -- is no evidence, and the row fails.
const nameRefused = (e) => e?.byName?.ran === true && e.byName.resolution === "FAILED";

const addressRefused = (e) => e?.byAddress?.ran === true && e.byAddress.resolution === "RESOLVED" && e.byAddress.transport === "UNREACHABLE";

// Ordered: the first that matches says why the row does or does not hold; only the last is a holding row.
const EGRESS_SAID = [
  { when: (e) => !e?.target, say: () => "nothing could be asked from inside the task's network" },
  { when: (e) => e.byName?.ran !== true, say: (e) => `${e.target.host} could not be looked up from inside: ${e.byName?.because ?? "no probe answered"}` },
  { when: (e) => e.byName.resolution === "RESOLVED", say: (e) => `${e.target.host} resolves from inside the task's network` },
  { when: (e) => !nameRefused(e), say: (e) => `the lookup of ${e.target.host} gave no answer from inside, which proves nothing` },
  { when: (e) => e.byAddress?.ran !== true, say: (e) => `nothing outside was tried from inside: ${e.byAddress?.because ?? "no probe answered"}` },
  { when: (e) => e.byAddress.transport === "REACHABLE", say: (e) => `${e.target.address}:${e.target.port} is reached from inside the task's network` },
  { when: (e) => !addressRefused(e), say: (e) => `a connection to ${e.target.address}:${e.target.port} was not attempted from inside (${e.byAddress.resolution} ${e.byAddress.transport}), which proves nothing` },
  { when: () => true, say: (e) => `from inside, ${e.target.host} does not resolve and ${e.target.address}:${e.target.port} is not reached` },
];

export const EGRESS = { id: "EGRESS_BLOCKED", holds: (e) => nameRefused(e) && addressRefused(e), say: (e) => EGRESS_SAID.find((r) => r.when(e)).say(e) };

// What a dispatch hands INSTEAD of asking again: the preparation's own egress row held -- the dispatch gate reads the
// sandbox's record to be sure -- and the network the worker is on is inspected again by NETWORK_PROFILE. Nothing else
// leaves the row out: null, undefined and anything malformed are asked as evidence, and fail.
export const PREPARED_EGRESS = Object.freeze({ prepared: true });

const egressRow = (e) => ({ id: EGRESS.id, node: "egress", ok: EGRESS.holds(e), say: EGRESS.say(e) });

const rowsFor = (node, f, a) => PROFILE.filter((r) => r.roles.includes(node.role)).map((r) => ({ id: r.id, node: node.key, ok: Boolean(f) && r.holds(f, a, node), say: f ? r.say : "it is not there to be inspected" }));

// -> { ok, rows, failed }: pure, over the facts handed in. `containers` is [{ node: { key, role, mounts, allowedEnv },
// facts }]; `network` the network's facts; `egress` the egress evidence (above), or PREPARED_EGRESS for a dispatch.
export function attestation({ containers, network, egress, attest }) {
  const rows = [...containers.flatMap((c) => rowsFor(c.node, c.facts, attest)), ...NETWORK_PROFILE.map((r) => ({ id: r.id, node: attest.network, ok: r.holds(network, attest), say: r.say })), ...(egress === PREPARED_EGRESS ? [] : [egressRow(egress)])];
  const failed = rows.filter((r) => !r.ok);
  return { ok: failed.length === 0, rows, failed };
}

// The sentence a refusal is made of: the rows that did not hold, by container.
export const unattested = (result) => result.failed.map((r) => `${r.node}: not ${r.id} — ${r.say}`).join("; ");

// ---- the facts, gathered ----------------------------------------------------------------------------------------------

const nodeOf = (session, specs) => specs.find((s) => s.name === session.container.name) ?? null;

// Every running container of THIS sandbox's topology, its facts as the provider reports them now.
export function containersNow(ctx, iso, specs, deps) {
  const mine = ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).filter((s) => s.container && s.state === "RUNNING");
  return mine.map((s) => ({ node: { key: s.component, role: s.kind ?? "component", ...(nodeOf(s, specs) ?? {}) }, facts: iso.facts(iso.container.inspect(s.container.id, deps)) }));
}

const NO_ADDRESS = (host) => `no address outside could be named to try: this machine did not resolve ${host} to one, and no person set sandbox.isolation.egress.address`;

// The address the second probe tries: a person's literal, else what THIS machine resolves the egress name to -- and
// never one that says nothing about leaving a network (a loopback, the unspecified address, a link-local one).
async function addressOf(reach, egress) {
  if ((egress.address ?? null) !== null) return outsideAddress(egress.address) ? egress.address : null;
  const named = reach ? await reach.resolve(egress.host) : null;
  return named?.ok && outsideAddress(named.address) ? named.address : null;
}

// -> the egress evidence: both probes asked from a throwaway container on the task's network (or in its pod).
export async function egressFrom(iso, topology, place, deps) {
  const egress = place.policy.isolation.egress;
  const address = await addressOf(deps.reach, egress);
  const byName = await probedFrom(iso, topology, place, { host: egress.host, port: egress.port, timeoutMs: LOOKUP_PROBE_MS }, deps);
  const byAddress = address ? await probedFrom(iso, topology, place, { host: address, port: egress.port }, deps) : { ran: false, because: NO_ADDRESS(egress.host) };
  return { target: { host: egress.host, port: egress.port, address }, byName, byAddress };
}

// -> { ok, rows, failed, at, egress }: what holds NOW.
export async function attestedNow(ctx, iso, topology, place, deps) {
  const egress = await egressFrom(iso, topology, place, deps);
  const result = attestation({ containers: containersNow(ctx, iso, place.specs ?? [], deps), network: iso.network.inspect(topology.network.name, deps), egress, attest: place.attest });
  return { ...result, at: new Date(deps.now()).toISOString(), egress: { held: EGRESS.holds(egress), host: egress.target.host, port: egress.target.port, address: egress.target.address } };
}
