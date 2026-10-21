// The RUNTIME side of an isolated topology (ADR 0039): the task's internal network, and every container of it --
// created from argv, labelled, receipted BEFORE it exists, and stopped only when its own receipt, its id, its start
// time and its labels all agree it is Orbit's.
//
// A plan (src/runtime/sandbox/topology.mjs) says what the containers are; this makes them, and remembers each one
// exactly the way a started process is remembered (src/runtime/sessions.mjs): a session document per container,
// `provider: "isolated"`, its kind (service, component, worker, pod, probe, observer, helper), the container's name,
// labels and -- once it exists -- id and start time. That is what lets the ordinary stop and release judge a
// container by the same table they judge a process by (src/runtime/ownership.mjs), and never by a name.
//
// The network is the task's: created `--internal` with the task's labels, reused only when its labels say it is
// this sandbox's, and removed only when they do AND nothing else is attached to it. A network carrying anybody
// else's labels -- or none -- is never touched.
import { join } from "node:path";
import { short } from "../../hash.mjs";
import { primitiveArgv } from "../catalog.mjs";
import { judge, mayStop } from "../ownership.mjs";
import { commandFingerprint, sessionId } from "../sessions.mjs";
import { slugOf } from "./topology.mjs";

export const START_WAIT_MS = 60000;
export const PROBE_INTERVAL_MS = 1000;
export const PROBE_TIMEOUT_MS = 3000;

// What each kind of container is held to. The WORKER runs generated tests, and is the strictest: a read-only root,
// a scratch /tmp, every capability dropped. A service keeps the capabilities its own image starts with (a database
// changes owners as it starts) and is still on the task's network only, unprivileged, limited and without new
// privileges. A component is the project's own code.
export const ROLE_HARDENING = {
  worker: { readOnly: true, tmpfs: ["/tmp:rw,nosuid,nodev,size=256m"], capDrop: ["ALL"], noNewPrivileges: true },
  probe: { readOnly: true, tmpfs: ["/tmp:rw,nosuid,nodev,size=16m"], capDrop: ["ALL"], noNewPrivileges: true },
  helper: { readOnly: true, tmpfs: ["/tmp:rw,nosuid,nodev,size=64m"], capDrop: ["ALL"], noNewPrivileges: true },
  observer: { readOnly: true, tmpfs: ["/tmp:rw,nosuid,nodev,size=64m"], capDrop: ["ALL"], noNewPrivileges: true },
  pod: { readOnly: true, tmpfs: [], capDrop: ["ALL"], noNewPrivileges: true },
  component: { readOnly: false, tmpfs: ["/tmp:rw,nosuid,nodev,size=256m"], capDrop: ["ALL"], noNewPrivileges: true },
  service: { readOnly: false, tmpfs: [], capDrop: [], noNewPrivileges: true },
};

export const containerNameOf = (envId, key) => `orbit-${short(envId, 10)}-${slugOf(key)}`.slice(0, 63);

export const podNameOf = (envId) => containerNameOf(envId, "pod");

// Where a node is on the network: its alias on the task's network, or -- in a pod -- the pod's own namespace.
const placeOf = (node, topology, envId) => (topology.mode === "pod" && node.role !== "pod" ? { mode: "container", container: podNameOf(envId) } : { mode: "network", name: topology.network.name, alias: node.alias });

const mountsOf = (node, place) => (node.mountsWorkspace ? [{ source: place.paths.workspace, target: place.catalog.isolation.appMount ?? "/work/app", readOnly: false }] : []);

// The provider's spec for one node (src/runtime/isolation/contract-v1.mjs container.create).
export const specOf = (node, topology, place) => ({ name: containerNameOf(place.names.envId, node.key), image: node.image.pinned ?? node.image.built ?? null, network: placeOf(node, topology, place.names.envId), labels: { ...topology.network.labels, "orbit.node": node.key, "orbit.role": node.role }, ...ROLE_HARDENING[node.role], mounts: mountsOf(node, place), env: node.env ?? { names: [], values: {} }, limits: place.policy.isolation.limits, workdir: node.workdir ?? null, argv: node.argv ?? [] });

// ---- receipts -------------------------------------------------------------------------------------------------------

export const receiptOf = (ctx, node, spec, { iso, kind, tree }) => ((requestedAt) => ({ id: sessionId({ env: ctx.envId, component: node.key, requestedAt }), env: ctx.envId, owner: ctx.owner, component: node.key, kind, provider: "isolated", executionProvider: "isolated", state: "STARTING", pid: null, requestedAt, startedAt: null, pidStartedAt: null, host: ctx.host, checkout: ctx.checkout, command: { declaredAs: kind, argv: spec.argv, cwd: "." }, commandFingerprint: commandFingerprint(spec.argv, "."), ports: [], sourceTree: tree ?? null, container: { provider: iso.id, name: spec.name, labels: spec.labels, image: spec.image, network: spec.network, id: null } }))(new Date(ctx.clock()).toISOString());

// What the provider says of a container a receipt names, in the words ownership is judged by.
export function observedOf(iso, session, deps) {
  const seen = iso.facts(iso.container.inspect(session.container.id ?? session.container.name, deps));
  return seen ? { alive: seen.running, startedAt: seen.startedAt, container: { id: seen.id, labels: seen.labels } } : { alive: false };
}

const judged = (iso, session, deps) => judge(session, observedOf(iso, session, deps));

const nodeSessions = (ctx, key) => ctx.sessions.list({ env: ctx.envId, owner: ctx.owner }).filter((s) => s.component === key && s.container && ["RUNNING", "STARTING"].includes(s.state));

// The running, owned session of a node, if there is one: a node is never started twice.
export const runningOf = (ctx, iso, key, deps) => nodeSessions(ctx, key).find((s) => mayStop(judged(iso, s, deps))) ?? null;

// ---- the network ------------------------------------------------------------------------------------------------------

const labelled = (labels, want) => Object.entries(want).every(([k, v]) => labels?.[k] === v);

const NOT_OURS = (name) => `a network named ${name} exists and does not carry this sandbox's labels, so it is not Orbit's to use or to touch — a person removes or renames it`;

// -> { ok, created?, because? }. Reused when its labels are this sandbox's; refused when a stranger holds the name.
export function ensuredNetwork(iso, topology, deps) {
  const seen = iso.network.inspect(topology.network.name, deps);
  if (seen.exists) return labelled(seen.labels, topology.network.labels) && seen.internal ? { ok: true, created: false } : { ok: false, because: seen.internal ? NOT_OURS(topology.network.name) : `${NOT_OURS(topology.network.name)} (and it is not internal)` };
  const made = iso.network.create(topology.network, deps);
  return made.ok ? internalAfter(iso, topology, deps) : { ok: false, because: `the task's network could not be created: ${made.why}` };
}

function internalAfter(iso, topology, deps) {
  const seen = iso.network.inspect(topology.network.name, deps);
  return seen.exists && seen.internal && labelled(seen.labels, topology.network.labels) ? { ok: true, created: true } : { ok: false, because: "the network was created but is not internal, or does not carry the labels it was given — nothing is started on it" };
}

// Removed only when it is provably this sandbox's AND nothing else is attached.
export function removedNetwork(iso, network, deps) {
  const seen = iso.network.inspect(network.name, deps);
  if (!seen.exists) return { ok: true, gone: true };
  if (!labelled(seen.labels, network.labels)) return { ok: false, because: NOT_OURS(network.name) };
  return seen.containers.length ? { ok: false, because: `${seen.containers.length} container(s) are still attached to ${network.name}, so it is left as it is` } : removedNow(iso, network, deps);
}

const removedNow = (iso, network, deps) => ((r) => (r.ok ? { ok: true, gone: false } : { ok: false, because: r.why }))(iso.network.remove(network.name, deps));

// ---- one node ---------------------------------------------------------------------------------------------------------

// An image a node is BUILT from: built under a trust a person gave the topology's fingerprint, tagged for this sandbox.
export function builtImage(iso, node, place, deps) {
  if (!node.image.build) return { ok: true, node };
  const tag = `${containerNameOf(place.names.envId, node.key)}:${short(`${place.fingerprint}\u0000${place.tree ?? ""}`, 12)}`;
  const already = iso.imageDigest(tag, deps);
  return already ? { ok: true, node: { ...node, image: { ...node.image, built: already } } } : builtNow(iso, node, place, tag, deps);
}

function builtNow(iso, node, place, tag, deps) {
  const b = iso.build({ context: join(place.paths.workspace, node.image.build.context), dockerfile: join(place.paths.workspace, posixJoin(node.image.build.context, node.image.build.dockerfile ?? "Dockerfile")), tag, labels: { "orbit.env": place.names.envId } }, deps);
  return b.ok && b.ref ? { ok: true, node: { ...node, image: { ...node.image, built: b.ref } } } : { ok: false, because: `${node.key}: its image could not be built (${b.why ?? "no image came of it"})` };
}

const posixJoin = (a, b) => (a === "." ? b : `${a}/${b}`);

// -> { ok, session, reused? , because? }: the receipt is written BEFORE the container is created.
export function startedNode(ctx, iso, node, spec, opts, deps) {
  const running = runningOf(ctx, iso, node.key, deps);
  if (running) return { ok: true, session: running, reused: true };
  const receipt = receiptOf(ctx, node, spec, { iso, kind: opts.kind ?? node.role, tree: opts.tree });
  ctx.sessions.write(receipt);
  return settled(ctx, iso, receipt, created(iso, spec, deps), deps);
}

function created(iso, spec, deps) {
  const made = iso.container.create(spec, deps);
  if (!made.ok) return { ok: false, why: made.why };
  const run = iso.container.start(made.id, deps);
  return run.ok ? { ok: true, id: made.id } : { ok: false, id: made.id, why: run.why };
}

function settled(ctx, iso, receipt, made, deps) {
  const seen = made.id ? iso.facts(iso.container.inspect(made.id, deps)) : null;
  const next = made.ok && seen?.running ? { ...receipt, state: "RUNNING", startedAt: seen.startedAt, pidStartedAt: seen.startedAt, container: { ...receipt.container, id: seen.id } } : { ...receipt, state: "LOST", why: made.why ?? "the container did not stay running", container: { ...receipt.container, id: made.id ?? null } };
  ctx.sessions.write(next);
  return next.state === "RUNNING" ? { ok: true, session: next } : { ok: false, session: next, because: `${receipt.component}: ${next.why}` };
}

// Stop and remove one container whose ownership is PROVEN; anything else is said and left.
export function stoppedNode(ctx, iso, session, deps) {
  const judgement = judged(iso, session, deps);
  if (!mayStop(judgement)) return closedUnless(ctx, session, judgement);
  const stop = iso.container.stop(session.container.id, deps);
  const rm = stop.ok ? iso.container.remove(session.container.id, deps) : { ok: false };
  return stop.ok ? closed(ctx, session, "STOPPED", rm.ok ? "stopped and removed" : "stopped") : { ok: false, session: session.id, because: `it would not stop: ${stop.why}` };
}

const closed = (ctx, session, state, how) => (ctx.sessions.write({ ...session, state, stoppedAt: new Date(ctx.clock()).toISOString(), stoppedHow: how }), { ok: true, session: session.id, how });

// A container that is gone is closed; one that cannot be proven Orbit's is never stopped.
const closedUnless = (ctx, session, judgement) => (judgement.rule === "GONE" ? closed(ctx, session, "STOPPED", "it was already gone") : { ok: false, session: session.id, because: judgement.why, unproven: true });

// ---- asking from inside ----------------------------------------------------------------------------------------------

const primitiveOf = (catalog) => (catalog.connectivity?.primitives ?? []).find((p) => p.tool === catalog.isolation?.probe) ?? null;

const lineOf = (out) => String(out ?? "").trim().split("\n").map((l) => l.trim()).filter(Boolean).at(-1)?.split(/\s+/) ?? [];

// One probe, from a throwaway container of the worker image placed on the task's network (or in its pod): a FIXED
// script from the catalog with the host and the port as arguments of their own. -> { resolution, transport }
export async function probedFrom(iso, topology, place, target, deps) {
  const primitive = primitiveOf(place.catalog);
  if (!primitive || !place.policy.isolation.workerImage) return { resolution: "UNKNOWN", transport: "NOT_ATTEMPTED", because: !primitive ? "the catalog names no probe the worker image answers" : "no worker image is set, so nothing on the task's network can be asked" };
  const spec = probeSpec(primitive, topology, place, target);
  return answeredProbe(await iso.container.runOnce({ ...spec, name: `${spec.name}-${short(String(deps.now?.() ?? Date.now()), 4)}` }, deps, { timeoutMs: PROBE_TIMEOUT_MS + 15000 }));
}

const probeSpec = (primitive, topology, place, target) => specOf({ key: `probe-${short(String(target.host) + target.port, 6)}`, role: "probe", alias: null, argv: primitiveArgv(primitive, { "${HOST}": target.host, "${PORT}": target.port, "${TIMEOUT_MS}": PROBE_TIMEOUT_MS }), env: { names: [], values: {} }, image: { pinned: place.policy.isolation.workerImage } }, topology, place);

const answeredProbe = (r) => ((said) => (said.length === 2 ? { resolution: said[0], transport: said[1] } : { resolution: "UNKNOWN", transport: "NOT_ATTEMPTED", because: r.error ?? "the probe said nothing" }))(lineOf(r.out));

// Where a node is asked FROM inside: its alias on the network, or localhost in a pod.
export const hostOf = (node, topology) => (topology.mode === "pod" ? "localhost" : node.alias);

const READY_KINDS = {
  tcp: async (node, ctx) => ((p) => ({ ok: p.transport === "REACHABLE", because: p.transport === "REACHABLE" ? `${hostOf(node, ctx.topology)}:${node.readiness.port} accepts a connection on the task's network` : (p.because ?? `${hostOf(node, ctx.topology)}:${node.readiness.port} did not accept a connection yet (${p.resolution} ${p.transport})`) }))(await probedFrom(ctx.iso, ctx.topology, ctx.place, { host: hostOf(node, ctx.topology), port: node.readiness.port }, ctx.deps)),
  http: async (node, ctx) => READY_KINDS.tcp(node, ctx),
  running: async (node, ctx) => ((s) => ({ ok: Boolean(s), because: s ? "it is running; nothing says how to tell it is ready" : "it is not running" }))(runningOf(ctx.ctx, ctx.iso, node.key, ctx.deps)),
};

// Asked until it answers or the wait is spent; READY is never PASS.
export async function readyNode(node, c, waitMs = START_WAIT_MS) {
  const until = c.deps.now() + waitMs;
  let last = await READY_KINDS[node.readiness.kind]?.(node, c) ?? { ok: false, because: `a readiness of kind ${node.readiness.kind} is not one this knows how to ask` };
  while (!last.ok && c.deps.now() < until) last = await readyAgain(node, c);
  return { key: node.key, state: last.ok ? "READY" : "NOT_READY", because: last.because };
}

async function readyAgain(node, c) {
  await c.deps.sleep(PROBE_INTERVAL_MS);
  return READY_KINDS[node.readiness.kind](node, c);
}
