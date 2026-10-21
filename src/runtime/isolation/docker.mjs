// DOCKER: the first isolation provider (ADR 0038), every effect a `docker` argument list through the Process port.
//
// What it creates is always LABELLED (the task, the checkout, the environment) and always told which network to
// join: an INTERNAL network of the task's own (`network create --internal`), so a container reaches the task's
// services and nothing beyond them. Nothing is pulled: an image is used only by a content-addressed reference
// already on this machine (`imageDigest`), and an image built is built only from a definition a person trusted.
// A value never rides a command line: an environment variable is named (`-e NAME`) and its value travels in the
// docker client's own environment, which is BASE_ENV plus exactly the names declared.
//
// It decides nothing about whether what it created is isolated enough: `facts` turns what `inspect` says into
// the generic facts src/runtime/sandbox/isolation.mjs holds to the PROFILE, and only that verdict counts.
import { BASE_ENV, childEnv } from "../../process/env.mjs";
import { ISOLATION_API } from "./contract-v1.mjs";

// The docker client's OWN environment: which daemon, which context, which configuration -- names, read at the
// moment of calling, never kept.
export const CLIENT_ENV = ["DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CONFIG", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];

export const QUICK_MS = 30000;
export const BUILD_MS = 20 * 60 * 1000;
export const STOP_GRACE_S = 10;

// A reference that cannot move under a tag: `name@sha256:<64>` or an image id `sha256:<64>`.
export const PINNED = /(^sha256:[0-9a-f]{64}$)|(@sha256:[0-9a-f]{64}$)/;

// The client's environment for one call: BASE_ENV, the docker client's own names, the names a container is handed
// from this machine's environment, and the literal values its definition named -- so `-e NAME` on the command line
// carries a name and never a value.
const clientEnv = (deps, env = {}) => ({ ...childEnv(deps.env ?? {}, [...CLIENT_ENV, ...(env.names ?? [])]), ...carried(env) });

// A value whose name the docker client itself needs (HOME, PATH, its own) cannot travel in the client's environment
// without changing the client: it rides the command line instead, which only a FIXED, non-secret value ever does --
// a scratch HOME, a store directory inside the container.
const RESERVED = new Set([...BASE_ENV, ...CLIENT_ENV]);

const carried = (env) => Object.fromEntries(Object.entries(env.values ?? {}).filter(([k]) => !RESERVED.has(k)));

const asked = (deps, args, opts = {}) => deps.process.run("docker", args, { timeoutMs: opts.timeoutMs ?? QUICK_MS, env: clientEnv(deps, opts.env), ...(opts.input === undefined ? {} : { input: opts.input }) });

const parsed = (text) => {
  try { return JSON.parse(String(text ?? "")); }
  catch { return null; }
};

const firstOf = (r) => (r.ok ? (parsed(r.out) ?? [])[0] ?? null : null);

const failed = (r) => ({ ok: false, why: r.error ?? `docker exited ${r.status ?? "?"}` });

const done = (r, extra = () => ({})) => (r.ok ? { ok: true, ...extra(r) } : failed(r));

// ---- argument lists, pure ------------------------------------------------------------------------------------

export const labelArgs = (labels) => Object.entries(labels ?? {}).flatMap(([k, v]) => ["--label", `${k}=${v}`]);

const NETWORK_ARGS = {
  network: (n) => ["--network", n.name, ...(n.alias ? ["--network-alias", n.alias] : [])],
  container: (n) => ["--network", `container:${n.container}`],
};

const networkArgs = (n) => NETWORK_ARGS[n?.mode]?.(n) ?? ["--network", "none"];

const mountArg = (m) => `type=bind,source=${m.source},target=${m.target}${m.readOnly ? ",readonly" : ""}`;

const volumeArg = (v) => `type=volume,source=${v.name},target=${v.target}`;

const limitArgs = (l) => ["--cpus", String(l.cpus), "--memory", `${l.memoryMb}m`, "--pids-limit", String(l.pids)];

const envArgs = (env) => [...(env?.names ?? []), ...Object.keys(env?.values ?? {}).filter((k) => !RESERVED.has(k))].flatMap((n) => ["-e", n]).concat(Object.entries(env?.values ?? {}).filter(([k]) => RESERVED.has(k)).flatMap(([k, v]) => ["-e", `${k}=${v}`]));

const hardening = (s) => [...(s.readOnly ? ["--read-only"] : []), ...(s.tmpfs ?? []).flatMap((t) => ["--tmpfs", t]), ...(s.capDrop ?? []).flatMap((c) => ["--cap-drop", c]), ...(s.noNewPrivileges ? ["--security-opt", "no-new-privileges"] : [])];

const storage = (s) => [...(s.mounts ?? []).flatMap((m) => ["--mount", mountArg(m)]), ...(s.volumes ?? []).flatMap((v) => ["--mount", volumeArg(v)])];

const flags = (s) => ["--name", s.name, ...networkArgs(s.network), ...labelArgs(s.labels), ...hardening(s), ...storage(s), ...limitArgs(s.limits), ...envArgs(s.env), ...(s.workdir ? ["-w", s.workdir] : [])];

export const createArgv = (s) => ["create", ...flags(s), s.image, ...(s.argv ?? [])];

export const runOnceArgv = (s) => ["run", "--rm", "-i", ...flags(s), s.image, ...(s.argv ?? [])];

export const networkArgv = (n) => ["network", "create", "--internal", ...labelArgs(n.labels), n.name];

// ---- what docker said, as the facts the PROFILE reads -------------------------------------------------------

const NEVER = /^0001-01-01/;

const startedOf = (state) => (state?.StartedAt && !NEVER.test(state.StartedAt) ? state.StartedAt : null);

const mountsOf = (raw) => (raw?.Mounts ?? []).map((m) => ({ type: m.Type ?? null, source: String(m.Source ?? m.Name ?? ""), target: String(m.Destination ?? ""), readOnly: m.RW === false }));

const publishedOf = (raw) => Object.entries(raw?.HostConfig?.PortBindings ?? {}).filter(([, b]) => Array.isArray(b) && b.length).map(([p]) => p);

const hostShared = (h) => [h?.PidMode, h?.IpcMode, h?.UTSMode, h?.UsernsMode].filter((m) => m === "host").length;

const securityOf = (h) => ({ privileged: h?.Privileged === true, devices: (h?.Devices ?? []).length, hostNamespaces: hostShared(h), capDrop: h?.CapDrop ?? [], capAdd: h?.CapAdd ?? [], securityOpt: h?.SecurityOpt ?? [] });

const limitsOf = (h) => ({ cpus: h?.NanoCpus ?? 0, memory: h?.Memory ?? 0, pids: h?.PidsLimit ?? 0 });

const identityOf = (raw) => ({ id: raw?.Id ?? null, name: String(raw?.Name ?? "").replace(/^\//, ""), running: raw?.State?.Running === true, startedAt: startedOf(raw?.State), image: raw?.Image ?? null, labels: raw?.Config?.Labels ?? {} });

export const facts = (raw) => (raw ? { ...identityOf(raw), readOnly: raw.HostConfig?.ReadonlyRootfs === true, mounts: mountsOf(raw), networks: Object.keys(raw.NetworkSettings?.Networks ?? {}), networkMode: raw.HostConfig?.NetworkMode ?? null, published: publishedOf(raw), ...securityOf(raw.HostConfig), limits: limitsOf(raw.HostConfig), env: (raw.Config?.Env ?? []).map((e) => String(e).split("=")[0]) } : null);

const networkFacts = (raw) => (raw ? { exists: true, id: raw.Id ?? null, internal: raw.Internal === true, labels: raw.Labels ?? {}, containers: Object.keys(raw.Containers ?? {}) } : { exists: false });

// ---- images: only what is already here ----------------------------------------------------------------------

const imageOf = (ref, deps) => firstOf(asked(deps, ["image", "inspect", ref]));

const pinnedOf = (img) => (img ? (img.RepoDigests ?? [])[0] ?? img.Id ?? null : null);

function imageDigest(ref, deps) {
  if (PINNED.test(String(ref))) return String(ref);
  return pinnedOf(imageOf(ref, deps));
}

const imageEnv = (ref, deps) => (imageOf(ref, deps)?.Config?.Env ?? []).map((e) => String(e).split("=")[0]);

function build(spec, deps) {
  const r = asked(deps, ["build", "-f", spec.dockerfile, "-t", spec.tag, ...labelArgs(spec.labels), spec.context], { timeoutMs: BUILD_MS });
  return r.ok ? { ok: true, ref: imageDigest(spec.tag, deps) } : failed(r);
}

function doctor(deps) {
  const r = asked(deps, ["version", "--format", "{{json .Server.Version}}"]);
  return r.ok ? { ok: true, version: parsed(r.out) } : { ok: false, why: r.error ?? "the docker daemon did not answer" };
}

const runOnce = (spec, deps, opts = {}) => deps.process.runObserved("docker", runOnceArgv(spec), { timeoutMs: opts.timeoutMs ?? QUICK_MS, env: clientEnv(deps, spec.env), input: opts.input ?? "", observe: opts.observe });

export const docker = {
  apiVersion: ISOLATION_API,
  id: "docker",
  doc: "containers on an internal network of the task's own, labelled, limited and with only the mounts declared",
  proves: ["filesystem", "network", "credential", "limits"],
  doctor,
  imageDigest,
  imageEnv,
  build,
  facts,
  network: {
    create: (spec, deps) => done(asked(deps, networkArgv(spec)), (r) => ({ id: String(r.out).trim() })),
    inspect: (name, deps) => networkFacts(firstOf(asked(deps, ["network", "inspect", name]))),
    remove: (name, deps) => done(asked(deps, ["network", "rm", name])),
  },
  container: {
    create: (spec, deps) => done(asked(deps, createArgv(spec), { env: spec.env }), (r) => ({ id: String(r.out).trim() })),
    start: (id, deps) => done(asked(deps, ["start", id])),
    startAttached: (id, deps, opts = {}) => deps.process.runObserved("docker", ["start", "-a", "-i", id], { timeoutMs: opts.timeoutMs ?? QUICK_MS, env: clientEnv(deps, opts.env), input: opts.input ?? "", observe: opts.observe }),
    inspect: (id, deps) => firstOf(asked(deps, ["inspect", id])),
    stop: (id, deps, opts = {}) => done(asked(deps, ["stop", "-t", String(opts.graceSeconds ?? STOP_GRACE_S), id], { timeoutMs: QUICK_MS + (opts.graceSeconds ?? STOP_GRACE_S) * 1000 })),
    remove: (id, deps) => done(asked(deps, ["rm", id])),
    exec: (id, argv, deps, opts = {}) => asked(deps, ["exec", ...(opts.input === undefined ? [] : ["-i"]), id, ...argv], { timeoutMs: opts.timeoutMs ?? QUICK_MS, input: opts.input }),
    runOnce,
  },
};

