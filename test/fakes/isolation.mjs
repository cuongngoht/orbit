// An ISOLATION PROVIDER over a scripted container world (src/runtime/isolation/contract-v1.mjs): networks,
// containers and images held in memory, and every call recorded -- so a test proves what a sandbox CREATED, in what
// order, and what it read back, with nothing started and no daemon asked.
//
// A container's record IS the generic facts the PROFILE reads (`facts` hands back a copy), made from the spec it
// was created with the way a real provider honours one: so a test that wants a container somebody changed, or a
// provider that ignored half its flags, edits `state.containers.get(id)` -- or passes `world.honour(spec, facts)`,
// which may rewrite what creation produced. What the world says of the network a probe stands on is `world.probe`
// (host, port, spec) -> the one line the probe prints, or a whole runObserved answer; by default a name the world
// does not hold FAILS to resolve, a literal address is UNREACHABLE, and a running container's alias -- or localhost in
// a pod -- is REACHABLE. A dispatched worker's run is `world.attached(container, opts)` -> runObserved's answer.
import { envProblems } from "../../src/runtime/isolation/docker.mjs";
import { ISOLATION_API } from "../../src/runtime/isolation/contract-v1.mjs";

const PINNED = /(^sha256:[0-9a-f]{64}$)|(@sha256:[0-9a-f]{64}$)/;
const LITERAL = /^(\d{1,3}(\.\d{1,3}){3}|[0-9a-f:]*:[0-9a-f:]*)$/i;

export const digestOf = (n) => `sha256:${String(n).padStart(64, "0").slice(-64)}`;

export function fakeIsolation(world = {}) {
  const state = { networks: new Map(), containers: new Map(), images: new Map(Object.entries(world.images ?? {})), next: 1, calls: [], removed: [], stopped: [], probes: [], builds: [], clock: world.clock ?? (() => "2026-10-21T10:00:00.000Z") };
  const record = (kind, detail) => state.calls.push({ kind, ...detail });
  return { apiVersion: ISOLATION_API, id: world.id ?? "fake", doc: "a scripted container world", proves: ["filesystem", "network", "credential", "limits"], state, ...top(state, world, record), network: networks(state, world, record), container: containers(state, world, record) };
}

const top = (state, world, record) => ({
  doctor: () => (record("doctor", {}), world.doctor ?? { ok: true, version: "fake-1" }),
  imageDigest: (ref) => (PINNED.test(String(ref)) ? String(ref) : (state.images.get(ref) ?? null)),
  imageEnv: (ref) => world.imageEnv?.[ref] ?? ["PATH"],
  envProblems: (env) => envProblems(env),
  build: (spec) => built(state, world, record, spec),
  facts: (raw) => (raw ? structuredClone(raw) : null),
});

function built(state, world, record, spec) {
  record("build", { spec });
  state.builds.push(spec);
  if (world.buildFails) return { ok: false, why: world.buildFails };
  const ref = digestOf(`b${state.builds.length}`);
  state.images.set(spec.tag, ref);
  return { ok: true, ref };
}

const networks = (state, world, record) => ({
  create: (spec) => (record("network.create", { spec }), state.networks.set(spec.name, { exists: true, id: `net-${state.next++}`, internal: world.internalIgnored ? false : true, labels: { ...spec.labels }, containers: [] }), { ok: true, id: state.networks.get(spec.name).id }),
  inspect: (name) => (record("network.inspect", { name }), state.networks.has(name) ? attachedTo(state, state.networks.get(name), name) : { exists: false }),
  remove: (name) => (record("network.remove", { name }), state.networks.delete(name), { ok: true }),
});

const attachedTo = (state, net, name) => ({ ...structuredClone(net), containers: [...state.containers.values()].filter((c) => c.networks.includes(name)).map((c) => c.id) });

const containers = (state, world, record) => ({
  create: (spec, deps) => created(state, world, record, spec, deps),
  start: (id) => started(state, world, record, id),
  startAttached: async (id, deps, opts = {}) => attached(state, world, record, id, opts),
  inspect: (idOrName) => (record("inspect", { id: idOrName }), ((c) => (c ? structuredClone(c) : null))(found(state, idOrName))),
  stop: (id) => stopped(state, record, id),
  remove: (id) => (record("remove", { id }), state.removed.push(id), state.containers.delete(id), { ok: true }),
  exec: (id, argv) => (record("exec", { id, argv }), { ok: true, out: "" }),
  runOnce: async (spec, deps, opts = {}) => probed(state, world, record, spec, deps, opts),
});

const found = (state, idOrName) => state.containers.get(idOrName) ?? [...state.containers.values()].find((c) => c.name === idOrName) ?? null;

// The facts a real provider would report of a container made from `spec`, before anything changed them.
function factsFrom(state, world, spec, deps, id) {
  const pod = spec.network?.mode === "container" ? found(state, spec.network.container) : null;
  const handed = (spec.env?.names ?? []).filter((n) => typeof deps?.env?.[n] === "string");
  return { id, name: spec.name, running: false, startedAt: null, image: spec.image, labels: { ...spec.labels }, readOnly: Boolean(spec.readOnly), mounts: (spec.mounts ?? []).map((m) => ({ type: "bind", source: m.source, target: m.target, readOnly: Boolean(m.readOnly) })), networks: spec.network?.mode === "network" ? [spec.network.name] : [], networkMode: pod ? `container:${pod.id}` : (spec.network?.name ?? "none"), published: [], privileged: false, devices: 0, hostNamespaces: 0, capDrop: [...(spec.capDrop ?? [])], capAdd: [], securityOpt: spec.noNewPrivileges ? ["no-new-privileges"] : [], limits: { cpus: (spec.limits?.cpus ?? 0) * 1e9, memory: (spec.limits?.memoryMb ?? 0) * 1048576, pids: spec.limits?.pids ?? 0 }, env: [...new Set([...(world.imageEnv?.[spec.image] ?? ["PATH"]), ...handed, ...Object.keys(spec.env?.values ?? {})])], aliases: spec.network?.alias ? [spec.network.alias] : [] };
}

// A value is handed only through a scratch room, as the contract says: a spec with values and no `deps.scratch` is
// refused, and the file a real provider would read is recorded, never kept.
function created(state, world, record, spec, deps) {
  const problems = envProblems(spec.env);
  if (problems.length || (Object.keys(spec.env?.values ?? {}).length && !deps?.scratch)) return (record("create.refused", { spec, problems }), { ok: false, why: problems.join("; ") || "no scratch room" });
  if (world.createFails?.(spec)) return (record("create.failed", { spec }), { ok: false, why: world.createFails(spec) });
  const id = `c${String(state.next++).padStart(11, "0")}`;
  const facts = factsFrom(state, world, spec, deps, id);
  return (state.containers.set(id, world.honour ? world.honour(spec, facts) : facts), record("create", { spec, id }), { ok: true, id });
}

function started(state, world, record, id) {
  const c = state.containers.get(id);
  record("start", { id });
  if (!c || world.startFails?.(c)) return { ok: false, why: "it would not start" };
  return (Object.assign(c, { running: !world.exits?.(c), startedAt: state.clock() }), { ok: true });
}

function stopped(state, record, id) {
  record("stop", { id });
  state.stopped.push(id);
  const c = state.containers.get(id);
  return c ? (Object.assign(c, { running: false }), { ok: true }) : { ok: false, why: "no such container" };
}

async function attached(state, world, record, id, opts) {
  const c = state.containers.get(id);
  record("startAttached", { id, input: opts.input });
  if (!c) return { ok: false, out: "", error: "no such container" };
  Object.assign(c, { running: true, startedAt: state.clock() });
  return finishedAttached(c, await (world.attached?.(c, opts) ?? { ok: true, status: 0, out: "" }), opts);
}

function finishedAttached(c, answer, opts) {
  for (const [stream, text] of answer.chunks ?? [["out", answer.out ?? ""]]) if (text) opts.observe?.(stream, Buffer.from(String(text)));
  if (!answer.timedOut) c.running = false;
  return answer;
}

const aliveAliases = (state) => [...state.containers.values()].filter((c) => c.running).flatMap((c) => c.aliases);

// What the network a probe stands on answers, by default: see the header.
const defaultLine = (state, host, spec) => (host === "localhost" && spec.network?.mode === "container" ? "RESOLVED REACHABLE" : aliveAliases(state).includes(host) ? "RESOLVED REACHABLE" : LITERAL.test(host) ? "RESOLVED UNREACHABLE" : "FAILED NOT_ATTEMPTED");

async function probed(state, world, record, spec, deps, opts) {
  const [host, port] = (spec.argv ?? []).slice(-3);
  record("runOnce", { spec, host, port });
  state.probes.push({ host, port, spec });
  const said = world.probe ? await world.probe(host, port, spec, state) : defaultLine(state, host, spec);
  return typeof said === "string" ? { ok: true, status: 0, out: `${said}\n` } : said;
}
