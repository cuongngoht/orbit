// The ISOLATION PROFILE, and its attestation (ADR 0038): what must be TRUE of every container an isolated sandbox
// runs -- read back from what the isolation provider says it created, never assumed from how it was asked.
//
// One ordered table of rows over the generic facts a provider reports (src/runtime/isolation/contract-v1.mjs
// `facts`), each row naming the kinds of container it holds: the WORKER that runs generated tests is held to all of
// them; a service keeps the capabilities its own image starts with and is held to the rest. Then the network (it is
// INTERNAL, and it carries the task's labels), and then the one fact no inspection can show: from inside, a probe
// to an address outside fails and its name does not resolve. The profile holds only if every row holds, and it is
// attested at preparation and again before every dispatch -- a container somebody changed in between is refused.
import { probedFrom } from "./network.mjs";

const ALL = ["worker", "probe", "helper", "observer", "pod", "component", "service"];
const STRICT = ["worker", "probe", "helper", "observer", "pod"];
const WITHOUT_CAPS = [...STRICT, "component"];

const under = (path, root) => Boolean(root) && (path === root || String(path).startsWith(`${root}/`));

const forbiddenMount = (m, a) => /\.sock$|docker\.sock/.test(m.source) || a.forbidden.some((root) => under(m.source, root));

const declared = (m, node) => (node.mounts ?? []).some((d) => d.target === m.target && d.source === m.source && Boolean(d.readOnly) === m.readOnly);

const NO_NEW = /^no-new-privileges(:true|=true)?$/;

const pluginMount = (f, a) => f.mounts.find((m) => m.target === a.pluginTarget);

const onTaskNetwork = (f, a) => (f.networks.length === 1 && f.networks[0] === a.network && f.networkMode !== "host") || (Boolean(a.podId) && f.networkMode === `container:${a.podId}`);

export const PROFILE = [
  { id: "ROOT_READ_ONLY", roles: STRICT, holds: (f) => f.readOnly === true, say: "its root filesystem is read-only" },
  { id: "NO_FORBIDDEN_MOUNT", roles: ALL, holds: (f, a) => !f.mounts.some((m) => forbiddenMount(m, a)), say: "nothing of this machine's home, Orbit's store, a vault or a control socket is mounted in it" },
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

export const EGRESS = { id: "EGRESS_BLOCKED", holds: (p) => p.transport !== "REACHABLE" && p.resolution !== "RESOLVED", say: (p, a) => `from inside, ${a.egress.host}:${a.egress.port} is not reached and its name does not resolve` };

const rowsFor = (node, f, a) => PROFILE.filter((r) => r.roles.includes(node.role)).map((r) => ({ id: r.id, node: node.key, ok: Boolean(f) && r.holds(f, a, node), say: f ? r.say : "it is not there to be inspected" }));

// -> { ok, rows, failed }: pure, over the facts handed in. `containers` is [{ node: { key, role, mounts, allowedEnv },
// facts }]; `network` the network's facts; `egress` the probe's answer, null when nothing could ask (a failing row),
// or undefined when this attestation does not ask it again (a dispatch, after the preparation's own probe held).
export function attestation({ containers, network, egress, attest }) {
  const rows = [...containers.flatMap((c) => rowsFor(c.node, c.facts, attest)), ...NETWORK_PROFILE.map((r) => ({ id: r.id, node: attest.network, ok: r.holds(network, attest), say: r.say })), ...(egress === undefined ? [] : [egressRow(egress, attest)])];
  const failed = rows.filter((r) => !r.ok);
  return { ok: failed.length === 0, rows, failed };
}

const egressRow = (p, a) => (p ? { id: EGRESS.id, node: "egress", ok: EGRESS.holds(p), say: EGRESS.say(p, a) } : { id: EGRESS.id, node: "egress", ok: false, say: "nothing on the task's network could be asked to try to reach outside it (no worker image is set)" });

// The sentence a refusal is made of: the rows that did not hold, by container.
export const unattested = (result) => result.failed.map((r) => `${r.node}: not ${r.id} — ${r.say}`).join("; ");

// ---- the facts, gathered ----------------------------------------------------------------------------------------------

const nodeOf = (session, specs) => specs.find((s) => s.name === session.container.name) ?? null;

// Every running container of THIS sandbox's topology, its facts as the provider reports them now.
export function containersNow(ctx, iso, specs, deps) {
  const mine = ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).filter((s) => s.container && s.state === "RUNNING");
  return mine.map((s) => ({ node: { key: s.component, role: s.kind ?? "component", ...(nodeOf(s, specs) ?? {}) }, facts: iso.facts(iso.container.inspect(s.container.id, deps)) }));
}

// -> { ok, rows, failed, at }: what holds NOW, egress asked from a throwaway container on the task's network.
export async function attestedNow(ctx, iso, topology, place, deps) {
  const egress = await probedFrom(iso, topology, place, place.policy.isolation.egress, deps);
  const asked = place.policy.isolation.workerImage ? egress : null;
  const result = attestation({ containers: containersNow(ctx, iso, place.specs ?? [], deps), network: iso.network.inspect(topology.network.name, deps), egress: asked, attest: place.attest });
  return { ...result, at: new Date(deps.now()).toISOString() };
}
