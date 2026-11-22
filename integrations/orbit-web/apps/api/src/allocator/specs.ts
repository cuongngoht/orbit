// THE CONTAINERS THE ALLOCATOR MAKES, as the container runtime's create bodies -- worked out from ids, the employee's
// pinned resource revision and the operator's configuration, never from a caller's image, path, mount or privilege.
// Pure functions: the tests hold every hardening flag here.
//
//   tool plane      the employee's sandbox: workstation image, the employee's uid, read-only root, no capability,
//                   no-new-privileges, its scratch / cache / team areas, a small tmpfs /tmp, the internal sandbox network
//                   (out only through Orbit's egress proxy, whose credential is the run's token), no public DNS
//   model plane     the CLI: model-plane image, uid 10001, read-only root, no capability, the connection's config home
//                   only, small tmpfs, the internal model network, the runner (which wants this attempt's token)
//   run sandbox     a chat's or a research session's run: the Orbit Web image's runner, uid 10001, read-only root, no
//                   capability, that run's own places of Orbit Web's data volume (at the paths Orbit Web uses), tmpfs
//                   HOME and /tmp, a network of its own (Orbit Web's container its only other member)
//   storage helper  privileged, network none: the only container that sees the whole workforce volume (the
//                   allocator's privileges, never an employee's)
//   storage worker  an employee's own data moved (seed, publish, inputs), as that employee, with nothing else mounted
import type { ResourceProfile } from "@orbit-web/contracts";
import { LABELS, SCRATCH_DIRS, type ContainerRole, type SessionMount } from "../contexts/execution/infrastructure/sandbox/ids.js";
import { MODEL_PLANE, SESSION_PLANE, TOOL_PLANE, TOOL_PLANE_ENV } from "../contexts/execution/infrastructure/sandbox/layout.js";
import { tmpSizeMiB } from "../contexts/execution/infrastructure/sandbox/storage-policy.js";

export const MiB = 1024 * 1024;

export interface VolumeMount {
  volume: string;
  subpath: string | null;
  target: string;
  readOnly: boolean;
}

const mountOf = (m: VolumeMount) => ({ Type: "volume", Source: m.volume, Target: m.target, ReadOnly: m.readOnly, VolumeOptions: { NoCopy: true, ...(m.subpath !== null ? { Subpath: m.subpath } : {}) } });

// Bounded logs: what a container prints is kept to one megabyte (one file, so nothing to compress: the local driver
// refuses compression with a single file).
export const LOGS = { Type: "local", Config: { "max-size": "1m", "max-file": "1", compress: "false" } } as const;

// Every container an employee's work runs in.
const HARDENED = {
  Init: true,
  ReadonlyRootfs: true,
  Privileged: false,
  CapDrop: ["ALL"],
  CapAdd: [] as string[],
  SecurityOpt: ["no-new-privileges:true"],
  IpcMode: "private",
  RestartPolicy: { Name: "no" },
  LogConfig: LOGS,
};

export const roleLabels = (prefix: string, role: ContainerRole): Record<string, string> => ({ [LABELS.managed]: "1", [LABELS.prefix]: prefix, [LABELS.role]: role });

const limits = (cpuMillis: number, memoryMiB: number, pids: number) => ({ NanoCpus: cpuMillis * 1_000_000, Memory: memoryMiB * MiB, MemorySwap: memoryMiB * MiB, PidsLimit: pids });

export interface ToolAreas {
  scratch: string;
  cache: string | null;
  team: string | null;
}

export function toolPlaneMounts(workforce: string, areas: ToolAreas): VolumeMount[] {
  const scratch = (dir: (typeof SCRATCH_DIRS)[number], target: string, readOnly: boolean): VolumeMount => ({ volume: workforce, subpath: `${areas.scratch}/${dir}`, target, readOnly });
  return [
    scratch("work", TOOL_PLANE.work, false),
    scratch("output", TOOL_PLANE.output, false),
    scratch("input", TOOL_PLANE.input, true),
    scratch("home", TOOL_PLANE.home, false),
    ...(areas.cache !== null ? [{ volume: workforce, subpath: areas.cache, target: TOOL_PLANE.cache, readOnly: false }] : []),
    ...(areas.team !== null ? [{ volume: workforce, subpath: areas.team, target: TOOL_PLANE.team, readOnly: false }] : []),
  ];
}

// The proxy, with the run's token as its credential (`run:<token>`, what Orbit's egress proxy reads).
export function proxyEnv(egress: { proxyHost: string; proxyPort: number; runToken: string }): string[] {
  const url = `http://run:${encodeURIComponent(egress.runToken)}@${egress.proxyHost}:${egress.proxyPort}`;
  return [`HTTP_PROXY=${url}`, `HTTPS_PROXY=${url}`, `http_proxy=${url}`, `https_proxy=${url}`, "NO_PROXY=localhost,127.0.0.1", "no_proxy=localhost,127.0.0.1"];
}

export interface ToolPlaneInput {
  image: string;
  network: string;
  workforceVolume: string;
  labels: Record<string, string>;
  areas: ToolAreas;
  resources: ResourceProfile;
  egress: { proxyHost: string; proxyPort: number; runToken: string };
}

export function toolPlaneBody(i: ToolPlaneInput) {
  const env = Object.entries(TOOL_PLANE_ENV)
    .filter(([k]) => i.areas.cache !== null || !(k === "PIP_CACHE_DIR" || k === "npm_config_cache" || k === "XDG_CACHE_HOME"))
    .map(([k, v]) => `${k}=${v}`);
  return {
    Image: i.image,
    Hostname: "workstation",
    User: `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}`,
    WorkingDir: TOOL_PLANE.work,
    Cmd: ["sleep", "infinity"],
    Env: [...env, ...proxyEnv(i.egress)],
    Labels: i.labels,
    StopSignal: "SIGTERM",
    StopTimeout: 10,
    HostConfig: {
      ...HARDENED,
      ...limits(i.resources.cpuMillis, i.resources.memoryMiB, i.resources.pidsLimit),
      Tmpfs: { [TOOL_PLANE.tmp]: `rw,nosuid,nodev,size=${tmpSizeMiB(i.resources.memoryMiB)}m,mode=1777` },
      Mounts: toolPlaneMounts(i.workforceVolume, i.areas).map(mountOf),
      NetworkMode: i.network,
      // The runtime's own resolver still answers the names of this network (the proxy's); a public name goes nowhere.
      Dns: ["127.0.0.1"],
      OomScoreAdj: 500,
      ShmSize: 64 * MiB,
    },
    NetworkingConfig: { EndpointsConfig: { [i.network]: {} } },
  };
}

export const MODEL_PLANE_PIDS = 512;
export const modelPlaneTmpMiB = (memoryMiB: number): number => Math.max(16, Math.min(256, Math.floor(memoryMiB / 4)));

export interface ModelPlaneInput {
  image: string;
  network: string;
  dataVolume: string;
  connectionSubpath: string;
  labels: Record<string, string>;
  cpuMillis: number;
  memoryMiB: number;
  runnerToken: string;
  // The CLI's environment from the adapter (an API key only for an api_key connection): the container's, passed by the
  // runner to what it starts.
  env: Record<string, string>;
}

export function modelPlaneMounts(i: { dataVolume: string; connectionSubpath: string }): VolumeMount[] {
  return [{ volume: i.dataVolume, subpath: i.connectionSubpath, target: MODEL_PLANE.home, readOnly: false }];
}

export const MODEL_PLANE_TMPFS = (memoryMiB: number): Record<string, string> => ({
  "/tmp": `rw,nosuid,nodev,size=${modelPlaneTmpMiB(memoryMiB)}m,mode=1777`,
  [MODEL_PLANE.cwd]: `rw,nosuid,nodev,size=64m,mode=0700,uid=${MODEL_PLANE.uid},gid=${MODEL_PLANE.gid}`,
  [MODEL_PLANE.userHome]: `rw,nosuid,nodev,size=64m,mode=0700,uid=${MODEL_PLANE.uid},gid=${MODEL_PLANE.gid}`,
});

export function modelPlaneBody(i: ModelPlaneInput) {
  const pass = ["PATH", ...Object.keys(i.env)];
  return {
    Image: i.image,
    Hostname: "model-plane",
    User: `${MODEL_PLANE.uid}:${MODEL_PLANE.gid}`,
    WorkingDir: MODEL_PLANE.cwd,
    Cmd: ["/usr/local/bin/node", "--disable-warning=ExperimentalWarning", MODEL_PLANE.runnerMain],
    Env: [
      `ORBIT_WEB_RUNNER_TOKEN=${i.runnerToken}`,
      `ORBIT_WEB_RUNNER_PORT=${MODEL_PLANE.runnerPort}`,
      `ORBIT_WEB_RUNNER_PASS_ENV=${pass.join(",")}`,
      `ORBIT_WEB_CONFIG_HOME=${MODEL_PLANE.home}`,
      `HOME=${MODEL_PLANE.userHome}`,
      ...Object.entries(i.env).map(([k, v]) => `${k}=${v}`),
    ],
    Labels: i.labels,
    StopSignal: "SIGTERM",
    StopTimeout: 10,
    HostConfig: {
      ...HARDENED,
      ...limits(i.cpuMillis, i.memoryMiB, MODEL_PLANE_PIDS),
      Tmpfs: MODEL_PLANE_TMPFS(i.memoryMiB),
      Mounts: modelPlaneMounts(i).map(mountOf),
      NetworkMode: i.network,
      Dns: ["127.0.0.1"],
      OomScoreAdj: 300,
    },
    NetworkingConfig: { EndpointsConfig: { [i.network]: {} } },
  };
}

export interface SessionPlaneInput {
  image: string;
  network: string;
  dataVolume: string;
  mounts: SessionMount[];
  labels: Record<string, string>;
  cpuMillis: number;
  memoryMiB: number;
  pids: number;
  runnerToken: string;
}

export const sessionTmpMiB = (memoryMiB: number): number => Math.max(64, Math.min(1024, Math.floor(memoryMiB / 2)));

// A chat's or a research session's run: the runner (under Docker's init -- the image's own entry point, tini then the
// API, is reset), as Orbit Web's user, with that run's places only. Its programs get their environment from each
// spawn (the runner passes PATH through); nothing of the run is in the container's own environment but the runner's.
export function sessionPlaneBody(i: SessionPlaneInput) {
  return {
    Image: i.image,
    Hostname: "sandbox",
    User: `${SESSION_PLANE.uid}:${SESSION_PLANE.gid}`,
    WorkingDir: SESSION_PLANE.home,
    Entrypoint: [""],
    Cmd: [SESSION_PLANE.node, "--disable-warning=ExperimentalWarning", SESSION_PLANE.runnerMain],
    Env: [`ORBIT_WEB_RUNNER_TOKEN=${i.runnerToken}`, `ORBIT_WEB_RUNNER_PORT=${SESSION_PLANE.runnerPort}`, "ORBIT_WEB_RUNNER_PASS_ENV=PATH", `HOME=${SESSION_PLANE.home}`],
    Labels: i.labels,
    StopSignal: "SIGTERM",
    StopTimeout: 10,
    HostConfig: {
      ...HARDENED,
      ...limits(i.cpuMillis, i.memoryMiB, i.pids),
      Tmpfs: {
        "/tmp": `rw,nosuid,nodev,size=${sessionTmpMiB(i.memoryMiB)}m,mode=1777`,
        [SESSION_PLANE.home]: `rw,nosuid,nodev,size=${sessionTmpMiB(i.memoryMiB)}m,mode=0700,uid=${SESSION_PLANE.uid},gid=${SESSION_PLANE.gid}`,
      },
      Mounts: i.mounts.map((m) => mountOf({ volume: i.dataVolume, subpath: m.subpath, target: m.target, readOnly: m.readOnly })),
      NetworkMode: i.network,
      OomScoreAdj: 300,
    },
    NetworkingConfig: { EndpointsConfig: { [i.network]: {} } },
  };
}

// The storage helper: privileged (loop devices, filesystems, quotas), no network, and the allocator's alone.
export function storageHelperBody(i: { image: string; prefix: string; mounts: VolumeMount[]; role?: ContainerRole; seconds?: number }) {
  return {
    Image: i.image,
    Hostname: "storage-helper",
    User: "0:0",
    Cmd: ["sleep", i.seconds === undefined ? "infinity" : String(i.seconds)],
    Labels: roleLabels(i.prefix, i.role ?? "storage-helper"),
    HostConfig: {
      Init: true,
      Privileged: true,
      ReadonlyRootfs: true,
      NetworkMode: "none",
      Mounts: i.mounts.map(mountOf),
      Tmpfs: { "/tmp": "rw,nosuid,nodev,size=64m" },
      RestartPolicy: { Name: "no" },
      LogConfig: LOGS,
      Memory: 512 * MiB,
      PidsLimit: 512,
    },
  };
}

// An employee's own data moved, as that employee: no network, no capability, only the places named.
export function storageWorkerBody(i: { image: string; prefix: string; mounts: VolumeMount[]; role?: ContainerRole }) {
  return {
    Image: i.image,
    Hostname: "storage-worker",
    User: `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}`,
    WorkingDir: "/",
    Cmd: ["sleep", "900"],
    Labels: roleLabels(i.prefix, i.role ?? "storage-worker"),
    HostConfig: {
      ...HARDENED,
      ...limits(1000, 512, 256),
      NetworkMode: "none",
      Mounts: i.mounts.map(mountOf),
      Tmpfs: { "/tmp": "rw,nosuid,nodev,size=64m,mode=1777" },
    },
  };
}

// The limits probe: the workstation image with small limits, to read back what the kernel applies.
export const PROBE_LIMITS = { cpuMillis: 500, memoryMiB: 96, pidsLimit: 64 } as const;

export function limitsProbeBody(i: { image: string; prefix: string }) {
  return {
    Image: i.image,
    Hostname: "limits-probe",
    User: `${TOOL_PLANE.uid}:${TOOL_PLANE.gid}`,
    Cmd: ["sleep", "120"],
    Labels: roleLabels(i.prefix, "probe"),
    HostConfig: { ...HARDENED, ...limits(PROBE_LIMITS.cpuMillis, PROBE_LIMITS.memoryMiB, PROBE_LIMITS.pidsLimit), NetworkMode: "none", Tmpfs: { "/tmp": "rw,nosuid,nodev,size=16m,mode=1777" } },
  };
}
