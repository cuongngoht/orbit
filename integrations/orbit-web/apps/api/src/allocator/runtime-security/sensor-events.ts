// THE SENSOR'S EVENTS, READ (ADR 0063): one line of Tetragon's JSON export at a time, turned into the few facts the
// security plane uses -- which container, which program and its parent, which namespace, how it ended, which policy's hook
// matched and what that hook said -- and nothing else. Every line is untrusted until it is parsed here: a line that is not
// JSON, is too long or is of a kind nobody asked for is dropped whole, and every value is bounded. A process's ARGUMENTS
// never survive this function (the sensor is told not to export them; this is the second wall), nor its environment,
// working directory or anything it read.
export const SENSOR_LINE_MAX = 64 * 1024;
const FIELD_MAX = 1024;

export type SensorAction = "override" | "sigkill" | "post" | "other";

export interface SensorEvent {
  kind: "exec" | "exit" | "hook";
  time: string;
  // The container id as the sensor derived it from the cgroup (its first 31 hex characters), null for a process in no
  // container -- or runc's own exec into one, before the cgroup is joined.
  dockerPrefix: string | null;
  execId: string | null;
  parentExecId: string | null;
  binary: string | null;
  parentBinary: string | null;
  pid: number | null;
  uid: number | null;
  mntNs: string | null;
  hostNs: boolean;
  exitCode: number | null;
  signal: string | null;
  // A hook: which policy matched, which hook, what the rule's action was (NOT whether it was carried out: monitor mode
  // still names OVERRIDE), and the path of the file about to be executed.
  policy: string | null;
  hook: string | null;
  action: SensorAction | null;
  path: string | null;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown, max = FIELD_MAX): string | null => (typeof v === "string" && v !== "" ? v.slice(0, max) : null);
const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);
const DOCKER = /^[0-9a-f]{12,64}$/;
const ACTIONS: Record<string, SensorAction> = { KPROBE_ACTION_OVERRIDE: "override", KPROBE_ACTION_SIGKILL: "sigkill", KPROBE_ACTION_POST: "post" };

function processFacts(p: Record<string, unknown>) {
  const ns = isRecord(p.ns) && isRecord(p.ns.mnt) ? p.ns.mnt : null;
  const docker = str(p.docker, 64);
  return {
    dockerPrefix: docker !== null && DOCKER.test(docker) ? docker : null,
    execId: str(p.exec_id, 128),
    parentExecId: str(p.parent_exec_id, 128),
    binary: str(p.binary),
    pid: int(p.pid),
    uid: int(p.uid),
    mntNs: ns !== null && int(ns.inum) !== null ? String(ns.inum) : null,
    hostNs: ns !== null && ns.is_host === true,
  };
}

function hookPath(args: unknown): string | null {
  if (!Array.isArray(args) || !isRecord(args[0])) return null;
  const a = args[0];
  const binprm = isRecord(a.linux_binprm_arg) ? a.linux_binprm_arg : isRecord(a.file_arg) ? a.file_arg : null;
  return binprm === null ? null : str(binprm.path);
}

export function parseSensorLine(line: string): SensorEvent | null {
  if (line.length > SENSOR_LINE_MAX) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(line);
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;
  const type = ["process_exec", "process_exit", "process_lsm", "process_kprobe"].find((k) => isRecord(raw[k]));
  if (type === undefined) return null;
  const body = raw[type] as Record<string, unknown>;
  if (!isRecord(body.process)) return null;
  const facts = processFacts(body.process);
  const parent = isRecord(body.parent) ? str(body.parent.binary) : null;
  const time = str(raw.time, 40) ?? "";
  const none = { exitCode: null, signal: null, policy: null, hook: null, action: null, path: null };
  if (type === "process_exec") return { kind: "exec", time, ...facts, parentBinary: parent, ...none };
  if (type === "process_exit") return { kind: "exit", time, ...facts, parentBinary: parent, ...none, exitCode: int(body.status), signal: str(body.signal, 32) };
  const action = typeof body.action === "string" ? (ACTIONS[body.action] ?? "other") : null;
  return { kind: "hook", time, ...facts, parentBinary: parent, exitCode: null, signal: null, policy: str(body.policy_name, 253), hook: str(body.function_name, 128), action, path: hookPath(body.args) };
}
