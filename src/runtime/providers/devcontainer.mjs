// DEVCONTAINER: run a component inside a dev container defined for the checkout.
//
// The optional way, and never the only one: a dev container exists for
// reproducibility, for an environment that is the same on every machine, and for
// isolating what an agent does -- and a checkout that can run natively needs none
// of that. Nothing here is reached unless the resolver chose it or a person did.
//
// What it will not do is pretend. A classic framework cannot run in a Linux
// container however the container is built; a Windows image cannot be started
// where Linux containers are what there is; and an environment that was generated
// is not an environment that was built -- so an adopted definition is not a ready
// one until `validate` has actually brought it up. Compatibility says all of that
// before anything is asked of Docker, and every answer names the thing a person
// would have to do about it.
//
// Host tooling (the container runtime, the Dev Containers CLI) is a requirement of
// the HOST: a person is told what is missing and Orbit installs none of it. What
// the container provides (runtimes, features) is the ENVIRONMENT's, and is never
// installed on the host because a container wants it.
//
// Every effect goes through `deps.process`. A container this starts is labelled
// with the checkout and the environment it belongs to, and those labels -- never a
// name, never a guess -- are how it is recognised as Orbit's later.
import { childEnv, namedEnv } from "../../process/env.mjs";
import { primitiveArgv, requirement as row } from "../catalog.mjs";
import { RESOLUTIONS, TRANSPORTS } from "../connectivity/states.mjs";
import { isAddress } from "../connectivity/targets.mjs";
import { windowsImage } from "../environment/devcontainer.mjs";
import { bindingOf, folded } from "../resolve/compat.mjs";
import { native } from "./native.mjs";

// What the container host needs, as tool ids in the tool catalog.
export const HOST_TOOLS = [{ id: "docker", what: "the Docker command", fix: "install Docker" }, { id: "docker-daemon", what: "a running Docker daemon", fix: "start Docker" }, { id: "devcontainer", what: "the Dev Containers CLI", fix: "install the Dev Containers CLI" }];

export const LONG_RUN_MS = 20 * 60 * 1000;

export const devcontainer = {
  apiVersion: "orbit.runtime-provider/v1",
  id: "devcontainer",
  doc: "runs a component inside a dev container defined for the checkout",
  compatibility: (component, world) => compatibility(component, world),
  doctor: (world) => doctor(world),
  prepare: (world, deps, opts = {}) => (opts.apply ? validated(world, deps) : preparation(world)),
  validate: (world, deps) => validated(world, deps),
  hostLacks: (world) => hostLacks(world),
  ready: (world, deps) => environmentUp(world, deps),
  down: (world, deps) => brought(world, deps),
  start: (component, command, world, deps) => started(command, world, deps),
  status: (session, deps) => observed(session, deps),
  stop: async (session, deps) => ended(session, deps, await native.stop(session, deps)),
  unreached: "if it is up inside, note that a server in a container is reached through a published port only when it listens on all of the container's interfaces (0.0.0.0): one bound to the container's own loopback runs and answers nobody here — start it with a command that listens on all of them",
  reach: (target, world, deps) => reachedInside(target, world, deps),
};

const answer = (state, because, extra = {}) => ({ state, because, ...extra });

// ---- is it possible here? ------------------------------------------------------------------

function hostChecks(world) {
  return HOST_TOOLS.map((t) => ({ ...t, tool: world.machine.tools[t.id] ?? { state: "UNKNOWN" } }));
}

// What this machine lacks to bring an environment up AT ALL, as sentences -- only what was asked and
// is not there. A tool nobody asked about is not held against it: the attempt will say. A missing tool
// is the machine's condition and not the environment's failure, so asking comes before anything is
// recorded about the environment.
const hostLacks = (world) => hostChecks(world).filter((c) => c.tool.state === "UNAVAILABLE").map((c) => `${c.what} is not available — ${c.fix}`);

function hostAnswer(world) {
  const checks = hostChecks(world);
  const missing = checks.filter((c) => c.tool.state === "UNAVAILABLE");
  if (missing.length) return answer("needs-host", missing.map((c) => `${c.what} is not available${c.tool.reason ? ` (${c.tool.reason})` : ""}`).join("; "), { blocking: missing.map((c) => c.fix) });
  const unknown = checks.filter((c) => c.tool.state === "UNKNOWN");
  return unknown.length ? answer("unknown", `${unknown.map((c) => c.what).join(", ")} could not be asked about`) : answer("compatible", "a container runtime and the Dev Containers CLI are here");
}

// A local container runtime runs the containers of the platform it is on --
// Linux containers, on a machine that is not Windows. An image that says it is a
// Windows one cannot be started there, and nothing makes it start.
function containerAnswer(world) {
  const windows = world.view.definitions.flatMap((d) => d.definition.images ?? []).filter(windowsImage);
  if (!windows.length) return answer("compatible", "the images do not name a Windows base");
  if (world.machine.platform !== "win32") return answer("incompatible", `an image (${windows[0]}) is a Windows one, and a local container runtime on ${world.machine.platform} runs Linux containers`);
  return answer("unknown", "an image is a Windows one, and which kind of container this machine's runtime is set to run is not read");
}

// What a Linux dev container can provide, by the catalog's own rows.
function inside(req, component, world) {
  const entry = row(world.catalog, req.requirement);
  if (!entry) return answer("unknown", `no catalog row says whether a dev container provides ${req.requirement}`);
  if (!entry.container) return answer("incompatible", `${entry.name} is not something a Linux dev container provides${entry.doc ? ` — ${entry.doc}` : ""}`);
  const brought = broughtBy(entry, world);
  return entry.feature || brought ? answer("compatible", brought ? `${entry.name} comes with ${brought}, which the container can be given` : `${entry.name} can be provided by the container`) : answer("unknown", `no catalog feature says how a dev container provides ${entry.name}`);
}

// What a requirement comes WITH (npm with Node.js), when a container can be given that -- whether or not
// the component names it too: an app that says only that it uses npm runs on the Node.js npm came with.
const broughtBy = (entry, world) => (entry.with && row(world.catalog, entry.with)?.feature ? row(world.catalog, entry.with).name : null);

function compatibility(component, world) {
  const { bound, notes } = bindingOf(component, world.view.shared);
  const requirements = bound.map((r) => ({ requirement: r.requirement, ...inside(r, component, world) }));
  const verdict = folded([containerAnswer(world), hostAnswer(world), ...requirements]);
  return { ...environmental(verdict, world), requirements, notes: notes.map((n) => `${n.requirement} may also be needed (${n.stage === "run" ? n.source : "to develop and test it"}), which is not held against starting it`) };
}

// Possible in principle is not ready: an environment that was written is not one
// that was built. Only a VALIDATED one can start anything.
function environmental(verdict, world) {
  if (verdict.state !== "compatible") return verdict;
  const instance = world.instances.find((i) => i.provider === "devcontainer");
  if (instance?.state === "VALIDATED") return verdict;
  const why = instance ? `the environment is ${instance.state}, and has not been validated` : "no environment has been adopted for it";
  return answer("needs-environment", `${verdict.because}; ${why}`, { blocking: [instance ? "validate the environment" : "design and adopt a dev container"] });
}

function doctor(world) {
  const checks = [...hostChecks(world).map((c) => ({ what: c.what, state: c.tool.state, because: c.tool.reason ?? c.tool.version ?? null })), { what: "the images are Linux ones", ...containerAnswer(world) }];
  return { provider: "devcontainer", checks, instance: world.instances.find((i) => i.provider === "devcontainer") ?? null };
}

function preparation(world) {
  const host = hostChecks(world).filter((c) => c.tool.state !== "AVAILABLE").map((c) => ({ say: c.tool.state === "UNKNOWN" ? `${c.what} could not be asked about` : c.fix }));
  const instance = world.instances.find((i) => i.provider === "devcontainer");
  const built = instance?.state === "VALIDATED";
  return { provider: "devcontainer", host, environment: built ? [] : [{ step: "build", needed: true, say: "build the image and create the container, then start it" }], repository: "no changes" };
}

// ---- doing it ------------------------------------------------------------------------------

// The labels that FIND a container, and so the only way anything is ever stopped: the checkout and the
// environment, and -- for a task's sandbox -- the task and its workspace too, which no person's container
// carries (`world.labels`, src/runtime/lifecycle/world.mjs). Never a container's name.
export const labelsOf = (world) => ["--id-label", `orbit.checkout=${world.checkout}`, "--id-label", `orbit.env=${world.envId}`, ...(world.labels ?? []).flatMap(([name, value]) => ["--id-label", `${name}=${value}`])];

const BASE = (world, deps) => ["--workspace-folder", deps.root, ...labelsOf(world)];

// `devcontainer up`: bring the environment up, which builds it. The one slow
// thing here, so it has its own deadline and answers a receipt: when, with what,
// and whether it came up -- never the output. Its log is left at the CLI's own
// level: it accepts info, debug or trace and nothing quieter, and an argument it
// refuses makes it print its usage and build nothing.
function validated(world, deps) {
  const r = deps.process.run("devcontainer", ["up", ...BASE(world, deps), ...(world.rebuild ? ["--remove-existing-container"] : [])], { timeoutMs: LONG_RUN_MS, cwd: deps.root, env: childEnv(deps.env ?? {}, []) });
  return { ok: r.ok === true, because: r.ok ? "the environment came up" : failureOf(r), receipt: { at: deps.now(), tool: "devcontainer", ok: r.ok === true, status: r.status ?? null } };
}

// What the Dev Containers CLI said went wrong: the message of the JSON result it
// prints on stdout, else the LAST line it wrote -- its first is a log line, or the
// head of its usage when it refused an argument, and says nothing about why.
function failureOf(r) {
  const said = resultOf(r.out)?.message;
  return typeof said === "string" && said ? said : (lastLine(r.err) ?? r.error);
}

const lastLine = (text) => String(text ?? "").trim().split("\n").map((l) => l.trim()).filter(Boolean).at(-1) ?? null;

function resultOf(text) {
  try {
    return JSON.parse(lastLine(text) ?? "");
  } catch {
    return null;
  }
}

// `exec` with a FIXED wrapper: the component's own argument list rides after it
// as positional parameters, so no value of it is ever read as script. The wrapper
// only changes into the component's directory (relative to the workspace) first.
// What it starts carries the session's MARKER in its environment, and so does
// every process that starts in turn: inside the container, that is how a stop
// finds exactly what this session started.
export const SESSION_MARKER = "ORBIT_RUNTIME_SESSION";

function started(command, world, deps) {
  const wrap = ["sh", "-c", HANDED_OVER, "sh", command.cwd, ...command.argv];
  const marker = deps.session ? ["--remote-env", `${SESSION_MARKER}=${deps.session}`] : [];
  const handed = handedOver(deps);
  const launched = deps.process.launch("devcontainer", ["exec", ...BASE(world, deps), ...marker, "--", ...wrap], { cwd: deps.root, env: childEnv(deps.env ?? {}, []), out: deps.logs.out, err: deps.logs.err, ...(handed.input ? { input: handed.input } : {}) });
  return handed.withheld.length ? { ...launched, withheld: handed.withheld } : launched;
}

// The variables a person listed for a component by NAME reach it on STDIN -- `NAME=VALUE` a line,
// then an empty line -- and are exported before the declared command starts, each value one quoted
// word: never on a command line (the exec client's, or the `docker exec` under it, where a process
// list shows it), and never read as shell. The marker is a session id, and rides `--remote-env`.
export const HANDED_OVER = 'while IFS= read -r kv && [ -n "$kv" ]; do export "$kv"; done; cd "$1" && shift && exec "$@"';

// -> { input, withheld }. A value with a line break cannot travel in a line: it is WITHHELD, and the
// start says which name, rather than handing the component half of it.
function handedOver(deps) {
  const named = Object.entries(namedEnv(deps.env ?? {}, deps.envNames ?? []));
  const lines = named.filter(([, value]) => !BREAK.test(value)).map(([name, value]) => `${name}=${value}`);
  return { input: lines.length ? `${lines.join("\n")}\n\n` : null, withheld: named.filter(([, value]) => BREAK.test(value)).map(([name]) => name) };
}

// Read from this machine's environment at the moment of starting -- the contract the native provider
// keeps -- never kept (a receipt holds the component's command only), never printed, and a name that
// is not set is simply absent. The exec client's OWN environment stays the base one.
const BREAK = /[\r\n]/;

// The exec client is Orbit's process on THIS machine; what it started runs inside the
// container and outlives it. So a stop that ended the client ends, in every container
// carrying this environment's label, the processes carrying this session's marker, and
// nothing else in there: TERM, a grace period, KILL, then a count of what is left --
// asked of the container, never assumed. The session is `rs-` and twelve hex digits,
// handed to the fixed script as a positional parameter and never spliced into it. The
// script runs through `devcontainer exec` again, as the user the component was started
// as: the container's root may not read another user's processes, and a match is the
// WHOLE variable, so no session's id is mistaken for a longer one. Plain POSIX tools
// only: a slim image has no `ps`.
export const MARKED = [
  'pids=""',
  `for p in /proc/[0-9]*; do if { tr '\\0' '\\n' < "$p/environ"; } 2>/dev/null | grep -qxF "${SESSION_MARKER}=$1"; then pids="$pids \${p#/proc/}"; fi; done`,
  'left() { n=0; for q in $pids; do if [ -d "/proc/$q" ] && ! grep -q "^State:[[:space:]]*Z" "/proc/$q/status" 2>/dev/null; then n=$((n+1)); fi; done; echo "$n"; }',
  'if [ -n "$pids" ]; then kill -TERM $pids 2>/dev/null; fi',
  'i=0; while [ "$i" -lt 10 ] && [ "$(left)" -gt 0 ]; do sleep 1; i=$((i+1)); done',
  'if [ "$(left)" -gt 0 ]; then kill -KILL $pids 2>/dev/null; sleep 1; fi',
  'set -- $pids; echo "$# $(left)"',
].join("\n");

function ended(session, deps, client) {
  if (!client.ok) return client;
  const inside = insideEnded(session, deps);
  return { ...client, inside: inside.ended ?? null, residual: inside.ok ? null : `the process inside the container may continue (${inside.because}); \`runtime stop --environment\` stops the container, which is labelled as Orbit's` };
}

// No container carrying the environment's label is running: nothing it started can be either.
function insideEnded(session, deps) {
  const found = deps.process.run("docker", ["ps", "-q", "--filter", `label=orbit.env=${session.env}`], { timeoutMs: 15000 });
  if (!found.ok) return { ok: false, because: found.error };
  return String(found.out).trim() ? endedIn(session, deps) : { ok: true, ended: 0 };
}

// -> { ok, ended }: how many processes carried the marker, and not ok when the container did not
// answer or one of them is still there after the KILL.
function endedIn(session, deps) {
  const r = deps.process.run("devcontainer", ["exec", ...BASE({ checkout: session.checkout, envId: session.env }, deps), "--", "sh", "-c", MARKED, "sh", session.id], { timeoutMs: 60000, cwd: deps.root, env: childEnv(deps.env ?? {}, []) });
  const [ended, left] = String(lastLine(r.out) ?? "").split(/\s+/).map(Number);
  if (!r.ok || !Number.isInteger(left)) return { ok: false, because: r.ok ? "the container did not say what it ended" : failureOf(r) };
  return left === 0 ? { ok: true, ended } : { ok: false, because: `${left} of the ${ended} process(es) it started are still running there` };
}

// Whether the exec client is there, and which container carries this
// environment's label -- the only way a container is called Orbit's.
function observed(session, deps) {
  const found = deps.process.run("docker", ["ps", "-q", "--filter", `label=orbit.env=${session.env}`], { timeoutMs: 15000 });
  const containers = found.ok ? String(found.out).split(/\s+/).filter(Boolean) : null;
  return { alive: deps.process.alive(session.pid), startedAt: deps.process.startedAtOf(session.pid), containers };
}

const labelled = (world) => ["--filter", `label=orbit.env=${world.envId}`, "--filter", `label=orbit.checkout=${world.checkout}`];

// The environment is up when a container that carries THIS environment's labels is
// running -- the labels, never a name. Without one, nothing is launched: there is
// nowhere to launch into, and the answer says what to do.
function environmentUp(world, deps) {
  const found = deps.process.run("docker", ["ps", "-q", ...labelled(world)], { timeoutMs: 15000 });
  if (!found.ok) return { ok: false, because: `the container runtime could not be asked (${found.error})` };
  return String(found.out).trim() ? { ok: true, because: "the environment's container is running" } : { ok: false, because: notUp(world) };
}

// Why it is not up, and the ONE step that comes next -- by how far the environment has come. Ordered,
// the last always answers.
const NOT_UP = [
  { when: (env) => !env, says: "no environment has been adopted for this checkout: `runtime design` checks what one needs -- a definition already in the repository is checked, not replaced -- and `runtime adopt <id> --human` keeps it" },
  { when: (env) => env.state !== "VALIDATED", says: "the environment was adopted and has not been brought up: `runtime validate --human` does" },
  { when: () => true, says: "the environment is not up: `runtime prepare --apply --human` brings it up" },
];

const notUp = (world) => NOT_UP.find((row) => row.when((world.instances ?? []).find((i) => i.provider === "devcontainer"))).says;

// Stop the containers that are Orbit's -- carrying this checkout's AND this
// environment's labels -- and nothing else. A container with the right name and
// no labels is somebody's, and is not touched.
function brought(world, deps) {
  const found = deps.process.run("docker", ["ps", "-q", ...labelled(world)], { timeoutMs: 15000 });
  const ids = found.ok ? String(found.out).split(/\s+/).filter(Boolean) : [];
  const beside = ids.length ? besideOf(ids, deps) : null;
  const stopped = ids.map((id) => deps.process.run("docker", ["stop", id], { timeoutMs: 60000 }));
  return { ok: found.ok && stopped.every((s) => s.ok), stopped: ids.length, left: beside?.names ?? [], because: found.ok ? `${ids.length} container(s) carrying this environment's labels were stopped${leftSaid(beside)}` : found.error };
}

// What came up WITH the environment's container and carries none of Orbit's labels: the other
// services of its compose project, a database beside the application. Named, never stopped -- a
// compose project's name is a name, and the same project may be a person's own `compose up`.
// Asked before anything is stopped, while the environment's container still says its project.
function besideOf(ids, deps) {
  const said = deps.process.run("docker", ["inspect", "--format", '{{index .Config.Labels "com.docker.compose.project"}}', ids[0]], { timeoutMs: 15000 });
  const project = said.ok ? String(said.out).trim() : "";
  if (!/^[a-z0-9][a-z0-9_-]*$/.test(project)) return null;
  const others = deps.process.run("docker", ["ps", "--format", "{{.ID}} {{.Names}}", "--filter", `label=com.docker.compose.project=${project}`], { timeoutMs: 15000 });
  return { project, names: others.ok ? String(others.out).split("\n").map((l) => l.trim().split(/\s+/)).filter(([id, name]) => name && !ids.includes(id)).map(([, name]) => name) : [] };
}

const leftSaid = (beside) => (beside?.names.length ? `; ${beside.names.join(", ")} came up with it (compose project ${beside.project}) and ${beside.names.length === 1 ? "carries no Orbit label, so it is" : "carry no Orbit label, so they are"} left running — \`docker compose -p ${beside.project} stop\` stops ${beside.names.length === 1 ? "it" : "them"}` : "");

// ---- can a server be reached from INSIDE the container? --------------------------------------

// What `devcontainer exec` itself costs on top of an attempt's own deadline.
export const EXEC_OVERHEAD_MS = 5000;

// The container's own network, which is not this machine's: a VPN, a resolver, a route the host
// has is not the container's to assume. So the question is asked in there -- and only of a
// container that carries this environment's labels and is up. One that is not is BLOCKED, and asking
// again would learn nothing until a person brings it up.
async function reachedInside(target, world, deps) {
  const there = environmentUp(world, deps);
  if (!there.ok) return { resolution: "NOT_ATTEMPTED", transport: "NOT_ATTEMPTED", blocked: true, because: there.because };
  return askedInside(world.catalog.connectivity?.primitives ?? [], target, world, deps);
}

// The catalog's tools in order, each a FIXED script with the host, the port and the deadline as
// arguments of their own; the first one the image has answers. Nothing is installed to make one.
function askedInside(primitives, target, world, deps, tried = []) {
  if (!primitives.length) return nobodyAsked(tried);
  const t = askedWith(primitives[0], target, world, deps);
  return t.answer ?? askedInside(primitives.slice(1), target, world, deps, [...tried, t]);
}

function askedWith(primitive, target, world, deps) {
  const argv = primitiveArgv(primitive, { "${HOST}": target.host, "${PORT}": target.port, "${TIMEOUT_MS}": deps.timeoutMs });
  const r = deps.process.run("devcontainer", ["exec", ...BASE(world, deps), "--", ...argv], { timeoutMs: deps.timeoutMs + EXEC_OVERHEAD_MS, cwd: deps.root, env: childEnv(deps.env ?? {}, []) });
  const said = lineOf(r.out);
  return said ? { tool: primitive.tool, answer: { ...said, because: saidInside(said, target) } } : { tool: primitive.tool, missing: missingTool(r), noClient: noClient(r), because: failureOf(r) };
}

// The Dev Containers CLI on THIS machine could not be started at all -- news about this machine, never
// about the container, which was not reached.
const noClient = (r) => /could not be started/i.test(String(r.error ?? "")) && /ENOENT/.test(String(r.error ?? ""));

// The one line a script prints: `<resolution> <transport>`, in the words of states.mjs.
function lineOf(out) {
  const [resolution, transport] = String(lastLine(out) ?? "").split(/\s+/);
  return RESOLUTIONS.includes(resolution) && TRANSPORTS.includes(transport) ? { resolution, transport } : null;
}

// A tool the image does not have: the shell's 127, or the runtime saying it found no such file.
const missingTool = (r) => r.status === 127 || /not found|no such file/i.test(`${r.error ?? ""}\n${r.err ?? ""}`);

const SAID = {
  "RESOLVED REACHABLE": (t) => `${t.host}:${t.port} accepts a connection from inside the container`,
  "RESOLVED UNREACHABLE": (t) => `${isAddress(t.host) ? "" : `${t.host} resolves inside the container, and `}${t.host}:${t.port} did not accept a connection from ${isAddress(t.host) ? "inside the container" : "there"} (refused, or nothing answered in time)`,
  "UNKNOWN UNREACHABLE": (t) => `${t.host}:${t.port} did not accept a connection from inside the container (whether the name resolves there could not be asked)`,
  "FAILED NOT_ATTEMPTED": (t) => `${t.host} does not resolve inside the container`,
  "UNKNOWN NOT_ATTEMPTED": (t) => `the container's lookup of ${t.host} did not answer within the deadline`,
};

const saidInside = (said, target) => SAID[`${said.resolution} ${said.transport}`]?.(target) ?? `the container answered ${said.resolution} ${said.transport} for ${target.host}:${target.port}`;

// No tool answered: either none is there, or one is and did not answer the question -- said apart,
// because "install nothing, it cannot be asked" and "it broke" are different news.
function nobodyAsked(tried) {
  if (tried.some((t) => t.noClient)) return { resolution: "UNKNOWN", transport: "NOT_ATTEMPTED", because: "the Dev Containers CLI could not be started on this machine (it is not on the PATH Orbit was given), and the container is asked through it: `runtime doctor` says whether it answers" };
  const broken = tried.find((t) => !t.missing);
  return { resolution: "UNKNOWN", transport: "NOT_ATTEMPTED", because: broken ? `the container did not answer the check (${broken.because})` : `no tool in the container can ask (none of ${tried.map((t) => t.tool).join(", ") || "the catalog's tools"} is there) — Orbit installs nothing` };
}
