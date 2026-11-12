// DOCKER, through its command line, as argument lists. Everything the evaluator creates carries its labels
// (`orbit.eval=1`, the campaign, the run and the role), and a cleanup removes only what carries them: another tool's
// containers, networks and volumes on the same daemon are never touched.
//
// A credential reaches a container by NAME only (`-e NAME`): docker fills the value from the client's environment,
// which `clientEnv` builds from the names a spec asks for and nothing else.
import { cleanEnv, must, run, runToFile } from "./proc.mjs";

export const LABEL = { mark: "orbit.eval", campaign: "orbit.eval.campaign", run: "orbit.eval.run", role: "orbit.eval.role" };

export const labelsOf = (campaign, runKey, role) => ({ [LABEL.mark]: "1", [LABEL.campaign]: campaign, [LABEL.run]: runKey, [LABEL.role]: role });

const clientEnv = (names = []) => cleanEnv(process.env, names);

export const docker = (args, o = {}) => run(["docker", ...args], { ...o, env: clientEnv(o.names) });

export const dockerMust = (args, o = {}) => must(["docker", ...args], { ...o, env: clientEnv(o.names) });

const labelArgs = (labels) => Object.entries(labels ?? {}).flatMap(([k, v]) => ["--label", `${k}=${v}`]);

export function imageId(ref) {
  const r = docker(["image", "inspect", "--format", "{{.Id}}", ref]);
  return r.ok ? r.out.trim() : null;
}

// The image, pulled through the daemon's own mirror when it is not here yet: its id, or why there is none.
export function ensureImage(ref, timeoutMs = 3600000) {
  const have = imageId(ref);
  if (have) return { ok: true, id: have, pulled: false };
  const r = docker(["pull", "--quiet", ref], { timeoutMs });
  const id = imageId(ref);
  return id ? { ok: true, id, pulled: true } : { ok: false, why: `docker pull ${ref} failed: ${String(r.err || r.out).trim().slice(-300)}` };
}

export function imageEnv(ref) {
  const r = docker(["image", "inspect", "--format", "{{json .Config.Env}}", ref]);
  return r.ok ? JSON.parse(r.out) ?? [] : [];
}

export const imagePath = (ref) => (imageEnv(ref).find((e) => e.startsWith("PATH=")) ?? "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin").slice(5);

// ---- networks -------------------------------------------------------------------------------------------------------------

export function createNetwork(name, labels, internal = true) {
  const r = docker(["network", "create", ...(internal ? ["--internal"] : []), ...labelArgs(labels), name]);
  return r.ok ? { ok: true, name } : { ok: false, why: String(r.err).trim().slice(-300) };
}

// A container keeps its labels under .Config; a network and a volume at the top.
const LABELS_AT = { container: ".Config.Labels", network: ".Labels", volume: ".Labels" };

const labelOf = (kind, name, key) => ((r) => (r.ok ? r.out.trim() : null))(docker([kind, "inspect", "--format", `{{index ${LABELS_AT[kind]} "${key}"}}`, name]));

// Removed only when its own labels say it is the evaluator's.
export function removeNetwork(name) {
  if (labelOf("network", name, LABEL.mark) !== "1") return { removed: false, why: "not the evaluator's" };
  const r = docker(["network", "rm", name]);
  return { removed: r.ok, why: r.ok ? null : String(r.err).trim().slice(-200) };
}

// ---- containers -----------------------------------------------------------------------------------------------------------

const mountArgs = (m) => ["--mount", [`type=${m.type ?? "bind"}`, `source=${m.source}`, `target=${m.target}`, ...(m.readOnly ? ["readonly"] : [])].join(",")];

const limitArgs = (l = {}) => [...(l.cpus ? ["--cpus", String(l.cpus)] : []), ...(l.memoryMb ? ["--memory", `${l.memoryMb}m`, "--memory-swap", `${l.memoryMb}m`] : []), ...(l.pids ? ["--pids-limit", String(l.pids)] : [])];

const envArgs = (spec) => [...Object.entries(spec.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]), ...(spec.envNames ?? []).flatMap((n) => ["-e", n])];

const networkArgs = (spec) => (spec.network ? ["--network", spec.network, ...(spec.alias ? ["--network-alias", spec.alias] : [])] : ["--network", "none"]);

// spec: { name, image, labels, network, alias, env, envNames, mounts, limits, argv, workdir, user, logs }
export const createArgs = (spec) => ["create", "--name", spec.name, "--init", ...labelArgs(spec.labels), ...networkArgs(spec), ...envArgs(spec), ...(spec.mounts ?? []).flatMap(mountArgs), ...limitArgs(spec.limits), ...(spec.workdir ? ["--workdir", spec.workdir] : []), ...(spec.user ? ["--user", spec.user] : []), ...(spec.logs ? [] : ["--log-driver", "none"]), ...(spec.entrypoint !== undefined ? ["--entrypoint", spec.entrypoint] : []), spec.image, ...(spec.argv ?? [])];

export function createContainer(spec) {
  const r = docker(createArgs(spec), { names: spec.envNames });
  return r.ok ? { ok: true, id: r.out.trim(), name: spec.name } : { ok: false, why: `docker create ${spec.name}: ${String(r.err).trim().slice(-300)}` };
}

export const copyIn = (src, container, dest) => docker(["cp", src, `${container}:${dest}`], { timeoutMs: 1800000 });

export const copyOut = (container, src, dest) => docker(["cp", `${container}:${src}`, dest], { timeoutMs: 1800000 });

export const startDetached = (name) => docker(["start", name]);

export const connect = (network, name) => docker(["network", "connect", network, name]);

// Started attached: its stdout into `file`, bounded, with a deadline that kills it and one-shot hooks.
export const startAttached = (name, file, o = {}) => runToFile(["docker", "start", "--attach", name], file, { ...o, env: clientEnv() });

export function stateOf(name) {
  const r = docker(["inspect", "--format", "{{json .State}}", name]);
  if (!r.ok) return null;
  const s = JSON.parse(r.out);
  return { status: s.Status, exitCode: s.ExitCode, oomKilled: s.OOMKilled === true, error: s.Error || null, startedAt: s.StartedAt, finishedAt: s.FinishedAt };
}

export const kill = (name) => docker(["kill", name]);

export const logsOf = (name) => ((r) => (r.ok ? `${r.out}${r.err}` : ""))(docker(["logs", "--tail", "2000", name]));

// Removed only when its own labels say it is the evaluator's; a container already gone is not an error.
export function removeContainer(name) {
  const mark = labelOf("container", name, LABEL.mark);
  if (mark === null) return { removed: false, gone: true };
  if (mark !== "1") return { removed: false, why: "not the evaluator's" };
  const r = docker(["rm", "-f", "-v", name]);
  return { removed: r.ok, why: r.ok ? null : String(r.err).trim().slice(-200) };
}

export function listByLabel(kind, key, value) {
  const args = kind === "network" ? ["network", "ls", "--filter", `label=${key}=${value}`, "--format", "{{.Name}}"] : ["ps", "-a", "--filter", `label=${key}=${value}`, "--format", "{{.Names}}"];
  const r = docker(args);
  return r.ok ? r.out.split("\n").map((s) => s.trim()).filter(Boolean) : [];
}

// ---- volumes --------------------------------------------------------------------------------------------------------------

export const volumeExists = (name) => docker(["volume", "inspect", name]).ok;

export const createVolume = (name, labels) => docker(["volume", "create", ...labelArgs(labels), name]);

export function removeVolume(name) {
  if (labelOf("volume", name, LABEL.mark) !== "1") return { removed: false, why: "not the evaluator's" };
  return { removed: docker(["volume", "rm", name]).ok };
}

export const version = () => ((r) => (r.ok ? r.out.trim() : null))(docker(["version", "--format", "{{.Server.Version}}"]));
