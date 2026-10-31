// CONTAINERS of a benchmark run, through Orbit's own Docker provider (src/runtime/isolation/docker.mjs): the same
// argument lists, the same environment rules (a name is filled by the docker client from this process's own
// environment, a value rides a private env file for one call and never the command line), the same internal networks
// created and removed only when their labels say they are this run's, and the same isolation PROFILE rows read back
// from what docker says it created (src/runtime/sandbox/isolation.mjs) -- held before anything in the container runs.
//
// A container is created, attested, started attached with a deadline, stopped if the deadline passed, inspected for
// how it ended (its exit code and whether memory ended it, never what it printed about itself) and removed. Every one
// carries the run's labels; cleanup removes only what carries them.
//
//   labelsOf(runId, role)  specFor(role, run, o) -> spec   argvOf(spec, file) -> argv   attestRows(raw, spec, a)
//   ranContainer(spec, deps, o) -> { exit, oom, timedOut, held, out, err, truncated, attested, refused? }
//     o.held() -- asked every o.heldEveryMs while the container runs: true (a person paused or cancelled the run) stops
//     it there, so a held run leaves nothing of its own running until its deadline
//   leftovers(runId, deps) -> { containers, networks }      cleaned(runId, deps) -> { removed, refused }
import { createArgv, CLIENT_ENV, docker, envProblems, labelArgs } from "../../../src/runtime/isolation/docker.mjs";
import { PROFILE } from "../../../src/runtime/sandbox/isolation.mjs";
import { removedNetwork } from "../../../src/runtime/sandbox/network.mjs";
import { childEnv } from "../../../src/process/env.mjs";
import { short } from "../../../src/hash.mjs";

export const LABEL = "orbit.benchmark.run";
export const ROLE_LABEL = "orbit.benchmark.role";

export const labelsOf = (runId, role) => ({ [LABEL]: runId, [ROLE_LABEL]: role });

export const networkOf = (runId) => ({ name: `orbit-bench-${short(runId, 12)}`, labels: { [LABEL]: runId } });

export const containerName = (runId, role, n) => `orbit-bench-${short(runId, 10)}-${role}-${n}`.slice(0, 63);

// `exec` on /tmp on purpose: docker's tmpfs is noexec by default, and the repository's own tests run small programs
// they write there -- a check that cannot run here is not a check of the source.
const HARDENED = (tmpMb) => ({ readOnly: true, tmpfs: [`/tmp:rw,exec,nosuid,nodev,size=${tmpMb}m`], capDrop: ["ALL"], noNewPrivileges: true });

// Every container speaks one locale, so nothing a subject sorts or prints depends on the machine it ran on.
const LOCALE = { LANG: "C.UTF-8", LC_ALL: "C.UTF-8" };

const envWith = (env) => ({ names: env?.names ?? [], values: { ...LOCALE, ...(env?.values ?? {}) } });

// One container's spec: o = { n, image, user, argv, mounts, tmpfs, env, limits, cpuset, network, workdir, tmpMb,
// attestRole, logs }.
export const specFor = (role, run, o) => ({ name: containerName(run.id, role, o.n ?? 1), image: o.image, labels: labelsOf(run.id, role), ...HARDENED(o.tmpMb ?? 512), tmpfs: [...HARDENED(o.tmpMb ?? 512).tmpfs, ...(o.tmpfs ?? [])], network: o.network ?? null, mounts: o.mounts ?? [], env: envWith(o.env), limits: o.limits, cpuset: o.cpuset ?? null, workdir: o.workdir ?? null, argv: o.argv ?? [], stdin: true, user: o.user, role, attestRole: o.attestRole ?? "probe", logs: o.logs === true });

// The provider's own argument list, with what a benchmark container adds: the user it runs as, an init that reaps
// and forwards signals, the cpus a test runner may size its workers by, and no log kept by the daemon unless the
// container runs in the background (output is otherwise read while attached).
const logArgs = (spec) => (spec.logs ? ["--log-opt", "max-size=1m", "--log-opt", "max-file=1"] : ["--log-driver", "none"]);

export const argvOf = (spec, file) => ["create", "--user", spec.user, "--init", ...(spec.cpuset ? ["--cpuset-cpus", spec.cpuset] : []), ...logArgs(spec), ...createArgv(spec, file).slice(1)];

const clientEnvOf = (deps, spec) => childEnv(deps.env ?? {}, [...CLIENT_ENV, ...(spec.env?.names ?? [])]);

// What a docker command that hands a container nothing is run with: the client's own names, never this environment.
export const dockerClientEnv = (env) => childEnv(env ?? {}, CLIENT_ENV);

const envText = (values) => Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join("");

// ---- what docker says it created, held to the profile ----------------------------------------------------------------

const BENCH_ROWS = [
  { id: "RUNS_AS_DECLARED", holds: (raw, spec) => String(raw?.Config?.User ?? "") === spec.user, say: "it runs as the user the run declared (the controller's own, so a bind mount is written as its owner wrote it)" },
  { id: "IMAGE_PINNED", holds: (raw, spec) => raw?.Image === spec.image || raw?.Config?.Image === spec.image, say: "it runs exactly the image id the run froze" },
];

// a: { network: the one network it may be on ("none" for a verifier), forbidden: [roots], pluginTarget }
export function attestRows(raw, spec, a) {
  const f = docker.facts(raw);
  const node = { key: spec.name, role: spec.attestRole, mounts: spec.mounts, allowedEnv: [...(a.imageEnv ?? []), ...(spec.env?.names ?? []), ...Object.keys(spec.env?.values ?? {})] };
  const rows = PROFILE.filter((r) => r.roles.includes(node.role) && !(a.skip ?? []).includes(r.id)).map((r) => ({ id: r.id, ok: Boolean(f) && r.holds(f, { ...a, labels: spec.labels }, node), say: r.say }));
  return [...rows, ...BENCH_ROWS.map((r) => ({ id: r.id, ok: r.holds(raw, spec), say: r.say }))];
}

// ---- one container, from creation to removal ---------------------------------------------------------------------------

// Refused before anything runs when the environment cannot be handed as the provider's rules say; the values ride a
// private file of the run's scratch room for exactly this one call.
function created(spec, deps) {
  const problems = envProblems(spec.env);
  return problems.length ? { why: `its environment cannot be handed to it: ${problems.join("; ")}` } : createdWith(spec, deps);
}

function createdWith(spec, deps) {
  const file = deps.scratch.write(envText(spec.env.values));
  const r = deps.process.run("docker", argvOf(spec, file), { timeoutMs: 60000, env: clientEnvOf(deps, spec) });
  deps.scratch.remove(file);
  return r.ok ? { id: String(r.out).trim() } : { why: r.error ?? r.err ?? `docker create exited ${r.status}` };
}

const bounded = (limit) => {
  const kept = { out: [], err: [], size: { out: 0, err: 0 }, cut: false };
  return { kept, observe: (stream, bytes) => (kept.size[stream] + bytes.length > limit ? (kept.cut = true) : (kept[stream].push(Buffer.from(bytes)), (kept.size[stream] += bytes.length))) };
};

const textOf = (chunks) => Buffer.concat(chunks).toString("utf8");

const endOf = (raw) => ({ exit: Number.isInteger(raw?.State?.ExitCode) ? raw.State.ExitCode : null, oom: raw?.State?.OOMKilled === true, finishedAt: raw?.State?.FinishedAt ?? null });

// How often a running container asks whether a person held its run.
export const HELD_EVERY_MS = 15000;

// A person's pause or cancel, noticed while a container runs: asked on a timer, and the container stopped the moment
// it is held. Stopping it ends the attached run, whatever is running inside.
function watched(id, deps, o) {
  const state = { held: false };
  const timer = o.held ? setInterval(() => (!state.held && o.held() ? ((state.held = true), docker.container.stop(id, deps, { graceSeconds: 5 })) : null), o.heldEveryMs ?? HELD_EVERY_MS) : null;
  return { held: () => state.held, stop: () => (timer ? clearInterval(timer) : null) };
}

async function attached(id, spec, deps, o) {
  const b = bounded(o.outputBytes ?? 16 * 1024 * 1024);
  const watch = watched(id, deps, o);
  const r = await docker.container.startAttached(id, { ...deps, env: deps.env }, { input: o.input ?? "", timeoutMs: o.timeoutMs, observe: b.observe, env: spec.env }).finally(watch.stop);
  const stopped = r.timedOut || r.overflow ? docker.container.stop(id, deps, { graceSeconds: 5 }) : null;
  return { timedOut: Boolean(r.timedOut), held: watch.held(), overflow: Boolean(r.overflow), stopped: stopped?.ok ?? null, out: textOf(b.kept.out), err: textOf(b.kept.err), truncated: b.kept.cut, ...endOf(docker.container.inspect(id, deps)) };
}

// Created, attested -- a container that does not hold to its rows is removed before it ever starts -- run, removed.
export async function ranContainer(spec, deps, o) {
  const c = created(spec, deps);
  if (!c.id) return { refused: `the ${spec.role} container could not be created: ${c.why}`, attested: [] };
  const rows = attestRows(docker.container.inspect(c.id, deps), spec, o.attest);
  const ran = rows.every((r) => r.ok) ? await attached(c.id, spec, deps, o) : { refused: `the ${spec.role} container did not hold to its isolation rows: ${rows.filter((r) => !r.ok).map((r) => r.id).join(", ")}` };
  return { ...ran, attested: rows, removed: docker.container.remove(c.id, deps).ok };
}

// ---- a container left running in the background (the egress proxy), and the run's network ----------------------------

export async function startedBackground(spec, deps, o) {
  const c = created(spec, deps);
  if (!c.id) return { refused: `the ${spec.role} container could not be created: ${c.why}` };
  const rows = attestRows(docker.container.inspect(c.id, deps), spec, o.attest);
  const joined = rows.every((r) => r.ok) ? (o.alsoOn ?? []).every((net) => deps.process.run("docker", ["network", "connect", net, c.id], { timeoutMs: 30000, env: clientEnvOf(deps, spec) }).ok) : false;
  return joined && docker.container.start(c.id, deps).ok ? { id: c.id, attested: rows } : { refused: `the ${spec.role} container did not start as declared`, attested: rows, removed: docker.container.remove(c.id, deps).ok };
}

export const stoppedBackground = (id, deps) => ({ stopped: docker.container.stop(id, deps, { graceSeconds: 3 }).ok, removed: docker.container.remove(id, deps).ok });

// The run's own INTERNAL network: reused when it is already this run's (a resume), refused when a network of that
// name is somebody else's, created otherwise -- and internal, so nothing on it reaches past it but through the proxy.
export function ensuredRunNetwork(runId, deps) {
  const n = networkOf(runId);
  const seen = docker.network.inspect(n.name, deps);
  if (seen.exists) return seen.internal && seen.labels?.[LABEL] === runId ? { ok: true, name: n.name } : { ok: false, why: `a network named ${n.name} exists and is not this run's` };
  return docker.network.create(n, deps).ok ? { ok: true, name: n.name } : { ok: false, why: "the run's internal network could not be created" };
}

// ---- what a run left, and removing exactly that ------------------------------------------------------------------------

const lines = (text) => String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean);

const listed = (deps, args) => ((r) => (r.ok ? lines(r.out) : []))(deps.process.run("docker", args, { timeoutMs: 30000, env: childEnv(deps.env ?? {}, CLIENT_ENV) }));

export const leftovers = (runId, deps) => ({ containers: listed(deps, ["ps", "-a", "--filter", `label=${LABEL}=${runId}`, "--format", "{{.ID}}"]), networks: listed(deps, ["network", "ls", "--filter", `label=${LABEL}=${runId}`, "--format", "{{.Name}}"]) });

// A container is removed only when docker says, again, that it carries this run's label -- a filter answer is not
// taken as proof on its own.
const oursNow = (id, runId, deps) => docker.container.inspect(id, deps)?.Config?.Labels?.[LABEL] === runId;

const removedContainer = (id, runId, deps) => (oursNow(id, runId, deps) ? (docker.container.stop(id, deps, { graceSeconds: 3 }), docker.container.remove(id, deps).ok) : false);

export function cleaned(runId, deps) {
  const left = leftovers(runId, deps);
  const containers = left.containers.map((id) => ({ id, removed: removedContainer(id, runId, deps) }));
  const networks = left.networks.map((name) => ({ name, ...removedNetwork(docker, { name, labels: { [LABEL]: runId } }, deps) }));
  return { containers, networks, clean: containers.every((c) => c.removed) && networks.every((n) => n.ok) };
}

export const labelFilterArgs = (runId) => labelArgs({ [LABEL]: runId });
