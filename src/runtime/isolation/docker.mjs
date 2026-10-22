// DOCKER: the first isolation provider (ADR 0038), every effect a `docker` argument list through the Process port.
//
// What it creates is always LABELLED (the task, the checkout, the environment) and always told which network to
// join: an INTERNAL network of the task's own (`network create --internal`), so a container reaches the task's
// services and nothing beyond them. Nothing is pulled: an image is used only by a content-addressed reference
// already on this machine (`imageDigest`), and an image built is built only from a definition a person trusted, with
// no network unless a person's policy gave the build one.
//
// What a container is handed of an environment comes two ways, and neither can steer the docker CLIENT itself:
//
//   by NAME   `-e NAME`, which the client fills from its OWN environment (BASE_ENV, its own names and exactly the
//             names declared, read at the moment of calling). So a name handed this way is a plain upper-case name
//             and never one HANDED_NEVER lists: what the client, its loader or its runtime reads to change how it runs.
//   by VALUE  never on the command line and never in the client's environment: `NAME=value` a line, in a file of the
//             sandbox's scratch room only its owner may read (`deps.scratch`), named with `--env-file` and removed
//             when the one call ends -- whatever it answered.
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

// The client's environment for one call: BASE_ENV, the docker client's own names, and the names a container is
// handed from this machine's environment -- never a value a spec carries.
const clientEnv = (deps, env = {}) => childEnv(deps.env ?? {}, [...CLIENT_ENV, ...(env.names ?? [])]);

// ---- what a container may be handed --------------------------------------------------------------------------

export const HANDED_NAME = /^[A-Z_][A-Z0-9_]{0,63}$/;
export const VALUE_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,127}$/;
export const MAX_VALUE = 32 * 1024;

// Names never handed BY NAME, because the client reads its own environment to fill them: each row is something a
// program reads to change how IT runs. Values are untouched by these -- a value never reaches the client.
export const HANDED_NEVER = [
  { id: "STARTED_WITH", test: (n) => BASE_ENV.includes(n), why: "every process on this machine is started with it" },
  { id: "CLIENT", test: (n) => CLIENT_ENV.includes(n) || /^(DOCKER|BUILDKIT|BUILDX|COMPOSE)_/.test(n), why: "it configures the container client itself" },
  { id: "LOADER", test: (n) => /^(LD|DYLD)_/.test(n), why: "the dynamic loader reads it before the client runs" },
  { id: "RUNTIME", test: (n) => /^NODE_(?!ENV$)|^PY[A-Z]|^(GODEBUG|GOMAXPROCS|GOTRACEBACK|GOGC|GOMEMLIMIT|JAVA_TOOL_OPTIONS|JDK_JAVA_OPTIONS|_JAVA_OPTIONS|PERL5OPT|PERL5LIB|RUBYOPT|RUBYLIB)$/.test(n), why: "a language runtime reads it to change how a program runs" },
  { id: "PROXY", test: (n) => /_PROXY$/.test(n), why: "it sends the client's connections through somebody else" },
  { id: "TRUST", test: (n) => /^SSL_|CA_(BUNDLE|CERTS?|FILE|PATH|DIR)$/.test(n), why: "it changes which certificates the client trusts" },
  { id: "ELSEWHERE", test: (n) => /^(XDG|OTEL)_/.test(n), why: "it moves where the client reads its configuration, or sends what it reports" },
];

const nameProblem = (n) => (HANDED_NAME.test(String(n)) ? HANDED_NEVER.find((r) => r.test(n))?.why ?? null : "a name handed from this machine's environment is a plain upper-case name");

const UNWRITABLE = /[\r\n\u0000]/;

// What the client's env file can say of a value: one line, handed verbatim.
const VALUE_RULES = [
  { fails: ([k]) => !VALUE_NAME.test(k), why: () => "a value is handed under a name of letters, digits and underscores" },
  { fails: ([, v]) => typeof v !== "string" || UNWRITABLE.test(v) || !v.isWellFormed(), why: () => "its value is not one line of text, so it cannot be handed as one" },
  { fails: ([, v]) => v.length > MAX_VALUE, why: () => `its value is longer than ${MAX_VALUE} characters` },
];

const valueProblem = (entry) => ((row) => (row ? `${entry[0]}: ${row.why()}` : null))(VALUE_RULES.find((r) => r.fails(entry)));

// -> [sentence]: why the environment a spec names cannot be handed to a container, or nothing.
export const envProblems = (env) => [...(env?.names ?? []).map((n) => ((why) => (why ? `${n}: ${why}` : null))(nameProblem(n))), ...Object.entries(env?.values ?? {}).map(valueProblem)].filter(Boolean);

const envFileText = (values) => Object.entries(values).map(([k, v]) => `${k}=${v}\n`).join("");

const refusedEnv = (problems) => ((why) => ({ ok: false, out: "", why, error: why, refused: true }))(`the container's environment cannot be handed to it: ${problems.join("; ")}`);

const NO_SCRATCH = "no scratch room was bound to hand a container its values through, and a value never rides the command line or the client's environment";

// A call whose spec hands a container an environment: refused before anything runs when it cannot be handed, and its
// values in a scratch file for exactly the length of the call.
function handed(spec, deps, call) {
  const problems = envProblems(spec.env);
  if (problems.length) return refusedEnv(problems);
  if (!Object.keys(spec.env?.values ?? {}).length) return call(null);
  return deps.scratch ? inScratch(deps.scratch, envFileText(spec.env.values), call) : refusedEnv([NO_SCRATCH]);
}

function inScratch(scratch, text, call) {
  const file = madeOrNull(scratch, text);
  return file ? removedAfter(scratch, file, call) : refusedEnv(["the scratch file a container's values are handed through could not be made"]);
}

function madeOrNull(scratch, text) {
  try { return scratch.write(text); }
  catch { return null; }
}

// Removed when the call ends: at once for an answer, when it settles for a promise, and on a throw.
function removedAfter(scratch, file, call) {
  const answer = calledOrRemoved(scratch, file, call);
  if (typeof answer?.then === "function") return answer.finally(() => scratch.remove(file));
  scratch.remove(file);
  return answer;
}

function calledOrRemoved(scratch, file, call) {
  try { return call(file); }
  catch (e) { throw (scratch.remove(file), e); }
}

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

const envArgs = (env, file) => [...(env?.names ?? []).flatMap((n) => ["-e", n]), ...(file ? ["--env-file", file] : [])];

const hardening = (s) => [...(s.readOnly ? ["--read-only"] : []), ...(s.tmpfs ?? []).flatMap((t) => ["--tmpfs", t]), ...(s.capDrop ?? []).flatMap((c) => ["--cap-drop", c]), ...(s.noNewPrivileges ? ["--security-opt", "no-new-privileges"] : [])];

const storage = (s) => [...(s.mounts ?? []).flatMap((m) => ["--mount", mountArg(m)]), ...(s.volumes ?? []).flatMap((v) => ["--mount", volumeArg(v)])];

const flags = (s, file) => ["--name", s.name, ...networkArgs(s.network), ...labelArgs(s.labels), ...hardening(s), ...storage(s), ...limitArgs(s.limits), ...envArgs(s.env, file), ...(s.workdir ? ["-w", s.workdir] : [])];

// `file` is the scratch env file a call's values are in (null when it hands none).
// A container that is handed its input on stdin (a worker's one request) is created with stdin kept open: `start -a -i`
// attaches to a stdin only a container created with one has.
export const createArgv = (s, file = null) => ["create", ...(s.stdin === true ? ["-i"] : []), ...flags(s, file), s.image, ...(s.argv ?? [])];

export const runOnceArgv = (s, file = null) => ["run", "--rm", "-i", ...flags(s, file), s.image, ...(s.argv ?? [])];

// What a build may reach while it builds: nothing, unless a person's policy says the build needs the network.
const BUILD_NETWORK = { none: "none", default: "default" };

export const buildArgv = (spec) => ["build", "--network", BUILD_NETWORK[spec.network] ?? "none", "-f", spec.dockerfile, "-t", spec.tag, ...labelArgs(spec.labels), spec.context];

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
  const r = asked(deps, buildArgv(spec), { timeoutMs: BUILD_MS });
  return r.ok ? { ok: true, ref: imageDigest(spec.tag, deps) } : failed(r);
}

function doctor(deps) {
  const r = asked(deps, ["version", "--format", "{{json .Server.Version}}"]);
  return r.ok ? { ok: true, version: parsed(r.out) } : { ok: false, why: r.error ?? "the docker daemon did not answer" };
}

const runOnce = (spec, deps, opts = {}) => handed(spec, deps, (file) => deps.process.runObserved("docker", runOnceArgv(spec, file), { timeoutMs: opts.timeoutMs ?? QUICK_MS, env: clientEnv(deps, spec.env), input: opts.input ?? "", observe: opts.observe }));

export const docker = {
  apiVersion: ISOLATION_API,
  id: "docker",
  doc: "containers on an internal network of the task's own, labelled, limited and with only the mounts declared",
  proves: ["filesystem", "network", "credential", "limits"],
  doctor,
  imageDigest,
  imageEnv,
  envProblems,
  build,
  facts,
  network: {
    create: (spec, deps) => done(asked(deps, networkArgv(spec)), (r) => ({ id: String(r.out).trim() })),
    inspect: (name, deps) => networkFacts(firstOf(asked(deps, ["network", "inspect", name]))),
    remove: (name, deps) => done(asked(deps, ["network", "rm", name])),
  },
  container: {
    create: (spec, deps) => handed(spec, deps, (file) => done(asked(deps, createArgv(spec, file), { env: spec.env }), (r) => ({ id: String(r.out).trim() }))),
    start: (id, deps) => done(asked(deps, ["start", id])),
    startAttached: (id, deps, opts = {}) => deps.process.runObserved("docker", ["start", "-a", "-i", id], { timeoutMs: opts.timeoutMs ?? QUICK_MS, env: clientEnv(deps, opts.env), input: opts.input ?? "", observe: opts.observe }),
    inspect: (id, deps) => firstOf(asked(deps, ["inspect", id])),
    stop: (id, deps, opts = {}) => done(asked(deps, ["stop", "-t", String(opts.graceSeconds ?? STOP_GRACE_S), id], { timeoutMs: QUICK_MS + (opts.graceSeconds ?? STOP_GRACE_S) * 1000 })),
    remove: (id, deps) => done(asked(deps, ["rm", id])),
    exec: (id, argv, deps, opts = {}) => asked(deps, ["exec", ...(opts.input === undefined ? [] : ["-i"]), id, ...argv], { timeoutMs: opts.timeoutMs ?? QUICK_MS, input: opts.input }),
    runOnce,
  },
};

