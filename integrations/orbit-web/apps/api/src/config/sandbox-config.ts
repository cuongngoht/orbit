// THE SANDBOX'S CONFIGURATION (ADR 0061): how an employee's attempt is run, read once from the environment at start by
// BOTH processes that take part -- Orbit Web (which provider, how to reach the allocator, what may be admitted) and the
// allocator (the only holder of the container runtime's socket: which images, networks and volumes it uses). Nothing
// here comes from a request: an image, a network, a volume or a mount is the operator's choice, never a caller's.
//
//   ORBIT_WEB_SANDBOX                     container | process   (default: container when an allocator is named, else
//                                                               process -- development only, never isolated)
//   ORBIT_WEB_ALLOCATOR_URL               http://orbit-allocator:7171 (Orbit Web's side)
//   ORBIT_WEB_ALLOCATOR_SECRET_FILE       the shared secret both sides read (at least 32 characters)
//   ORBIT_WEB_ALLOCATOR_BIND / _PORT      where the allocator listens (0.0.0.0, 7171): a private network, never published
//   ORBIT_WEB_DOCKER_SOCKET               the container runtime's socket (the allocator's alone)
//   ORBIT_WEB_ALLOCATOR_STATE_DIR         the allocator's own records (its last probe)
//   ORBIT_WEB_SANDBOX_IMAGE_WORKSTATION   the tool plane's image (Dockerfile target `workstation`)
//   ORBIT_WEB_SANDBOX_IMAGE_MODEL_PLANE   the model plane's image (target `model-plane`)
//   ORBIT_WEB_SANDBOX_IMAGE_STORAGE_HELPER the storage helper's image (target `storage-helper`)
//   ORBIT_WEB_SANDBOX_IMAGE_SESSION       a chat's or research run's own sandbox (the Orbit Web image itself)
//   ORBIT_WEB_SESSION_SANDBOX_CPU / _MEMORY / _PIDS  one such sandbox's limits (default 1 vCPU, 2g, 1024)
//   ORBIT_WEB_SESSION_SANDBOX_MAX         how many run at once (default 4): a run beyond waits for one to end
//   ORBIT_WEB_SANDBOX_PREFIX              the prefix of every container and volume the allocator names
//   ORBIT_WEB_CONTROL_CONTAINER           Orbit Web's container (default orbit-web; "none": no container to connect):
//                                         the allocator connects it to every attempt's own two internal networks, the
//                                         only other member of each -- the egress proxies and the tool endpoint
//   ORBIT_WEB_SANDBOX_HOST                the name an attempt reaches Orbit Web by on those networks (default orbit-web)
//   ORBIT_WEB_ATTEMPT_SUBNETS             IPv4 ranges (CIDR, comma-separated) the attempts' networks are cut from, /28
//                                         each; unset: the container runtime's own address pools (a few dozen networks
//                                         on a default Docker -- two per running attempt)
//   ORBIT_WEB_DATA_VOLUME                 Orbit Web's data volume, whose connections room holds each connection's home
//   ORBIT_WEB_WORKFORCE_VOLUME / _STORE_VOLUME  the workforce areas, and (pool mechanisms) the pool's image file
//   ORBIT_WEB_WORKFORCE_POOL_SIZE         the size of a loop-backed pool (default 20g), preallocated unless
//   ORBIT_WEB_WORKFORCE_POOL_PREALLOCATE=0
//   ORBIT_WEB_ACCEPT_SOFT_STORAGE=1       the operator accepts SOFT_MONITORED areas -- only while the host's disk is HARD
//                                         protected (7.3)
//   ORBIT_WEB_CAPACITY_CPU / _MEMORY / _STORAGE          what employee containers may use, instead of what is detected
//   ORBIT_WEB_CONTROL_PLANE_LIMITS        the control plane's fixed limits, "name:cpus:memory,..." (the compose files
//                                         pass their own knobs here)
//   ORBIT_WEB_CAPACITY_RESERVE_CPU / _MEMORY / _STORAGE  the OS and container runtime's reserve: an amount ("1",
//                                         "2g") or a share of the total ("10%", the default)
//   ORBIT_WEB_MODEL_PLANE_<RUNTIME>_CPU / _MEMORY        what one attempt's model plane reserves beside the employee's
//                                         own limits (starting values below; the recorded peaks say when to tune them)
import { isAbsolute, resolve } from "node:path";
import { RUNTIME_KINDS, type RuntimeKind } from "@orbit-web/contracts";

export class SandboxConfigError extends Error {}

export type SandboxProviderKind = "container" | "process";

export interface Amount {
  cpuMillis: number;
  memoryMiB: number;
}

// An amount, or a share of what is there.
export type Reserve = { kind: "amount"; value: number } | { kind: "share"; percent: number };

export interface SandboxConfig {
  provider: SandboxProviderKind;
  // Orbit Web's side: how to reach the allocator (container provider).
  allocator: { url: string; secretFile: string } | null;
  // The allocator's side.
  allocatorServer: { bind: string; port: number; secretFile: string; dockerSocket: string; stateDir: string };
  images: { workstation: string; modelPlane: string; storageHelper: string; session: string };
  names: { prefix: string; dataVolume: string; workforceVolume: string; workforceStoreVolume: string };
  // Each attempt's two networks hold its plane and Orbit Web's container (under `alias`), nothing else.
  control: { container: string | null; alias: string };
  attemptSubnets: string[];
  pool: { sizeMiB: number; preallocate: boolean };
  acceptSoftStorage: boolean;
  // The operator's figures, used instead of what the runtime reports (null: detected).
  capacity: { cpuMillis: number | null; memoryMiB: number | null; storageMiB: number | null };
  headroom: {
    controlPlane: { name: string; cpuMillis: number; memoryMiB: number }[];
    reserve: { cpu: Reserve; memory: Reserve; storage: Reserve };
  };
  modelPlane: Record<RuntimeKind, Amount>;
  // A chat's or a research session's run in a sandbox of its own: its limits, and how many at once.
  session: { cpuMillis: number; memoryMiB: number; pids: number; max: number };
}

// Starting values of one model plane, per runtime: the CLI and its bridge, idle most of the time (it waits on the
// model). Claude Code and Antigravity are Node programs; Codex is a native binary. The per-run peaks read from the model
// plane's cgroup show an operator when to change them.
export const MODEL_PLANE_DEFAULTS: Record<RuntimeKind, Amount> = {
  claude: { cpuMillis: 500, memoryMiB: 1024 },
  codex: { cpuMillis: 500, memoryMiB: 512 },
  agy: { cpuMillis: 500, memoryMiB: 1024 },
};

// The default reserve for the OS and the container runtime: a share of the host, never a sample machine's numbers.
export const DEFAULT_RESERVE_PERCENT = 10;

export const DEFAULT_IMAGES = {
  workstation: "ghcr.io/cuongngoht/orbit-web-workstation:0.8.0",
  modelPlane: "ghcr.io/cuongngoht/orbit-web-model-plane:0.8.0",
  storageHelper: "ghcr.io/cuongngoht/orbit-web-storage-helper:0.8.0",
  session: "ghcr.io/cuongngoht/orbit-web:0.8.0",
} as const;

export const SESSION_DEFAULTS = { cpuMillis: 1000, memoryMiB: 2048, pids: 1024, max: 4 } as const;

type Env = Readonly<Record<string, string | undefined>>;

const given = (raw: string | undefined): raw is string => raw !== undefined && raw.trim() !== "";

// Binary units: 512, 512m, 20g, 1t (MiB when no unit).
export function parseMiB(raw: string, name: string): number {
  const m = /^(\d+(?:\.\d+)?)\s*([kmgt]i?b?)?$/i.exec(raw.trim());
  if (m === null) throw new SandboxConfigError(`${name} must be a size such as 512m, 20g or 1t`);
  const n = Number(m[1]);
  const unit = (m[2] ?? "m").charAt(0).toLowerCase();
  const mib = unit === "k" ? n / 1024 : unit === "g" ? n * 1024 : unit === "t" ? n * 1024 * 1024 : n;
  if (!Number.isFinite(mib) || mib < 1) throw new SandboxConfigError(`${name} must be at least 1 MiB`);
  return Math.floor(mib);
}

// vCPUs ("2", "1.5") or millicores ("500m").
export function parseCpuMillis(raw: string, name: string): number {
  const v = raw.trim();
  const m = /^(\d+)m$/.exec(v);
  const millis = m !== null ? Number(m[1]) : /^\d+(\.\d+)?$/.test(v) ? Math.round(Number(v) * 1000) : NaN;
  if (!Number.isInteger(millis) || millis < 1) throw new SandboxConfigError(`${name} must be a number of vCPUs (1.5) or millicores (500m)`);
  return millis;
}

function parseReserve(raw: string | undefined, name: string, amount: (v: string, n: string) => number): Reserve {
  if (!given(raw)) return { kind: "share", percent: DEFAULT_RESERVE_PERCENT };
  const share = /^(\d+(?:\.\d+)?)%$/.exec(raw.trim());
  if (share !== null) {
    const percent = Number(share[1]);
    if (percent < 0 || percent >= 100) throw new SandboxConfigError(`${name} must be a share from 0% to 99%`);
    return { kind: "share", percent };
  }
  return { kind: "amount", value: amount(raw, name) };
}

// "orbit-web:1.0:2g,postgres:0.5:768m,allocator:0.25:256m"
export function parseControlPlane(raw: string | undefined): { name: string; cpuMillis: number; memoryMiB: number }[] {
  if (!given(raw)) return [];
  return raw.split(",").map((part) => {
    const [name, cpu, memory, ...rest] = part.trim().split(":");
    if (!name || !/^[a-z0-9][a-z0-9-]{0,40}$/.test(name) || cpu === undefined || memory === undefined || rest.length > 0) {
      throw new SandboxConfigError("ORBIT_WEB_CONTROL_PLANE_LIMITS must be name:cpus:memory entries, separated by commas");
    }
    return { name, cpuMillis: parseCpuMillis(cpu, `ORBIT_WEB_CONTROL_PLANE_LIMITS (${name} cpus)`), memoryMiB: parseMiB(memory, `ORBIT_WEB_CONTROL_PLANE_LIMITS (${name} memory)`) };
  });
}

const absolute = (raw: string | undefined, fallback: string, name: string): string => {
  const v = given(raw) ? raw : fallback;
  if (!isAbsolute(v)) throw new SandboxConfigError(`${name} must be an absolute path`);
  return resolve(v);
};

const port = (raw: string | undefined, fallback: number, name: string): number => {
  if (!given(raw)) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0 || n > 65535) throw new SandboxConfigError(`${name} must be a port number`);
  return n;
};

// A Docker object name: what the runtime itself accepts for a container, a volume or a network.
const DOCKER_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/;

const dockerName = (raw: string | undefined, fallback: string, name: string): string => {
  const v = given(raw) ? raw.trim() : fallback;
  if (!DOCKER_NAME.test(v)) throw new SandboxConfigError(`${name} must be a container runtime name (letters, digits, '_', '.', '-')`);
  return v;
};

// An image reference: a name with an optional tag and digest, no whitespace or option.
const IMAGE = /^[a-z0-9][a-z0-9._/:-]{0,200}(@sha256:[a-f0-9]{64})?$/;

const image = (raw: string | undefined, fallback: string, name: string): string => {
  const v = given(raw) ? raw.trim() : fallback;
  if (!IMAGE.test(v)) throw new SandboxConfigError(`${name} must be an image reference`);
  return v;
};

const hostName = (raw: string | undefined, fallback: string, name: string): string => {
  const v = given(raw) ? raw.trim() : fallback;
  if (!/^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,61}[A-Za-z0-9])?$/.test(v)) throw new SandboxConfigError(`${name} must be a host name`);
  return v;
};

// "10.231.0.0/16,172.16.0.0/20": IPv4 ranges at least a /28 wide, each cut into /28 networks.
export function parseSubnets(raw: string | undefined): string[] {
  if (!given(raw)) return [];
  return raw.split(",").map((c) => {
    const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d{1,2})$/.exec(c.trim());
    const octets = m === null ? [] : m.slice(1, 5).map(Number);
    const bits = m === null ? NaN : Number(m[5]);
    if (m === null || octets.some((o) => o > 255) || !(bits >= 8 && bits <= 28)) throw new SandboxConfigError("ORBIT_WEB_ATTEMPT_SUBNETS must be IPv4 ranges from /8 to /28, comma-separated");
    return c.trim();
  });
}

function allocatorUrl(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new SandboxConfigError("ORBIT_WEB_ALLOCATOR_URL must be an http:// URL");
  }
  if (u.protocol !== "http:" || u.username !== "" || u.password !== "" || (u.pathname !== "/" && u.pathname !== "")) throw new SandboxConfigError("ORBIT_WEB_ALLOCATOR_URL must be an http:// origin (the allocator is reached on a private network)");
  return u.origin;
}

function providerOf(env: Env): SandboxProviderKind {
  const raw = env.ORBIT_WEB_SANDBOX;
  if (!given(raw)) return given(env.ORBIT_WEB_ALLOCATOR_URL) ? "container" : "process";
  if (raw !== "container" && raw !== "process") throw new SandboxConfigError("ORBIT_WEB_SANDBOX must be container or process");
  return raw;
}

function modelPlane(env: Env): Record<RuntimeKind, Amount> {
  const out = {} as Record<RuntimeKind, Amount>;
  for (const runtime of RUNTIME_KINDS) {
    const key = `ORBIT_WEB_MODEL_PLANE_${runtime.toUpperCase()}`;
    const cpu = env[`${key}_CPU`];
    const memory = env[`${key}_MEMORY`];
    out[runtime] = {
      cpuMillis: given(cpu) ? parseCpuMillis(cpu, `${key}_CPU`) : MODEL_PLANE_DEFAULTS[runtime].cpuMillis,
      memoryMiB: given(memory) ? parseMiB(memory, `${key}_MEMORY`) : MODEL_PLANE_DEFAULTS[runtime].memoryMiB,
    };
  }
  return out;
}

export function loadSandboxConfig(env: Env): SandboxConfig {
  const provider = providerOf(env);
  const secretFile = absolute(env.ORBIT_WEB_ALLOCATOR_SECRET_FILE, "/run/secrets/orbit-allocator", "ORBIT_WEB_ALLOCATOR_SECRET_FILE");
  if (provider === "container" && !given(env.ORBIT_WEB_ALLOCATOR_URL)) throw new SandboxConfigError("ORBIT_WEB_SANDBOX=container needs ORBIT_WEB_ALLOCATOR_URL (the allocator, on the control network)");
  const prefix = dockerName(env.ORBIT_WEB_SANDBOX_PREFIX, "orbit-web", "ORBIT_WEB_SANDBOX_PREFIX");
  const cpu = env.ORBIT_WEB_CAPACITY_CPU;
  const memory = env.ORBIT_WEB_CAPACITY_MEMORY;
  const storage = env.ORBIT_WEB_CAPACITY_STORAGE;
  return {
    provider,
    allocator: provider === "container" && given(env.ORBIT_WEB_ALLOCATOR_URL) ? { url: allocatorUrl(env.ORBIT_WEB_ALLOCATOR_URL), secretFile } : null,
    allocatorServer: {
      bind: given(env.ORBIT_WEB_ALLOCATOR_BIND) ? env.ORBIT_WEB_ALLOCATOR_BIND.trim() : "0.0.0.0",
      port: port(env.ORBIT_WEB_ALLOCATOR_PORT, 7171, "ORBIT_WEB_ALLOCATOR_PORT"),
      secretFile,
      dockerSocket: absolute(env.ORBIT_WEB_DOCKER_SOCKET, "/var/run/docker.sock", "ORBIT_WEB_DOCKER_SOCKET"),
      stateDir: absolute(env.ORBIT_WEB_ALLOCATOR_STATE_DIR, "/var/lib/orbit-allocator", "ORBIT_WEB_ALLOCATOR_STATE_DIR"),
    },
    images: {
      workstation: image(env.ORBIT_WEB_SANDBOX_IMAGE_WORKSTATION, DEFAULT_IMAGES.workstation, "ORBIT_WEB_SANDBOX_IMAGE_WORKSTATION"),
      modelPlane: image(env.ORBIT_WEB_SANDBOX_IMAGE_MODEL_PLANE, DEFAULT_IMAGES.modelPlane, "ORBIT_WEB_SANDBOX_IMAGE_MODEL_PLANE"),
      storageHelper: image(env.ORBIT_WEB_SANDBOX_IMAGE_STORAGE_HELPER, DEFAULT_IMAGES.storageHelper, "ORBIT_WEB_SANDBOX_IMAGE_STORAGE_HELPER"),
      session: image(env.ORBIT_WEB_SANDBOX_IMAGE_SESSION, DEFAULT_IMAGES.session, "ORBIT_WEB_SANDBOX_IMAGE_SESSION"),
    },
    names: {
      prefix,
      dataVolume: dockerName(env.ORBIT_WEB_DATA_VOLUME, "orbit-web_orbit-web-data", "ORBIT_WEB_DATA_VOLUME"),
      workforceVolume: dockerName(env.ORBIT_WEB_WORKFORCE_VOLUME, `${prefix}-workforce`, "ORBIT_WEB_WORKFORCE_VOLUME"),
      workforceStoreVolume: dockerName(env.ORBIT_WEB_WORKFORCE_STORE_VOLUME, `${prefix}-workforce-store`, "ORBIT_WEB_WORKFORCE_STORE_VOLUME"),
    },
    control: {
      container: env.ORBIT_WEB_CONTROL_CONTAINER?.trim() === "none" ? null : dockerName(env.ORBIT_WEB_CONTROL_CONTAINER, "orbit-web", "ORBIT_WEB_CONTROL_CONTAINER"),
      alias: hostName(env.ORBIT_WEB_SANDBOX_HOST, "orbit-web", "ORBIT_WEB_SANDBOX_HOST"),
    },
    attemptSubnets: parseSubnets(env.ORBIT_WEB_ATTEMPT_SUBNETS),
    pool: {
      sizeMiB: given(env.ORBIT_WEB_WORKFORCE_POOL_SIZE) ? parseMiB(env.ORBIT_WEB_WORKFORCE_POOL_SIZE, "ORBIT_WEB_WORKFORCE_POOL_SIZE") : 20 * 1024,
      preallocate: env.ORBIT_WEB_WORKFORCE_POOL_PREALLOCATE !== "0",
    },
    acceptSoftStorage: env.ORBIT_WEB_ACCEPT_SOFT_STORAGE === "1",
    capacity: {
      cpuMillis: given(cpu) ? parseCpuMillis(cpu, "ORBIT_WEB_CAPACITY_CPU") : null,
      memoryMiB: given(memory) ? parseMiB(memory, "ORBIT_WEB_CAPACITY_MEMORY") : null,
      storageMiB: given(storage) ? parseMiB(storage, "ORBIT_WEB_CAPACITY_STORAGE") : null,
    },
    headroom: {
      controlPlane: parseControlPlane(env.ORBIT_WEB_CONTROL_PLANE_LIMITS),
      reserve: {
        cpu: parseReserve(env.ORBIT_WEB_CAPACITY_RESERVE_CPU, "ORBIT_WEB_CAPACITY_RESERVE_CPU", parseCpuMillis),
        memory: parseReserve(env.ORBIT_WEB_CAPACITY_RESERVE_MEMORY, "ORBIT_WEB_CAPACITY_RESERVE_MEMORY", parseMiB),
        storage: parseReserve(env.ORBIT_WEB_CAPACITY_RESERVE_STORAGE, "ORBIT_WEB_CAPACITY_RESERVE_STORAGE", parseMiB),
      },
    },
    modelPlane: modelPlane(env),
    session: sessionLimits(env),
  };
}

function wholeIn(raw: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (!given(raw)) return fallback;
  const n = Number(raw.trim());
  if (!Number.isInteger(n) || n < min || n > max) throw new SandboxConfigError(`${name} must be a whole number from ${min} to ${max}`);
  return n;
}

function sessionLimits(env: Env): SandboxConfig["session"] {
  return {
    cpuMillis: given(env.ORBIT_WEB_SESSION_SANDBOX_CPU) ? parseCpuMillis(env.ORBIT_WEB_SESSION_SANDBOX_CPU, "ORBIT_WEB_SESSION_SANDBOX_CPU") : SESSION_DEFAULTS.cpuMillis,
    memoryMiB: given(env.ORBIT_WEB_SESSION_SANDBOX_MEMORY) ? parseMiB(env.ORBIT_WEB_SESSION_SANDBOX_MEMORY, "ORBIT_WEB_SESSION_SANDBOX_MEMORY") : SESSION_DEFAULTS.memoryMiB,
    pids: wholeIn(env.ORBIT_WEB_SESSION_SANDBOX_PIDS, SESSION_DEFAULTS.pids, 64, 65_536, "ORBIT_WEB_SESSION_SANDBOX_PIDS"),
    max: wholeIn(env.ORBIT_WEB_SESSION_SANDBOX_MAX, SESSION_DEFAULTS.max, 1, 256, "ORBIT_WEB_SESSION_SANDBOX_MAX"),
  };
}
