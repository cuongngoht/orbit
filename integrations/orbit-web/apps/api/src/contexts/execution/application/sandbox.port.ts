// THE SANDBOX PORT (Execution context, ADR 0067): what the execution worker asks of the infrastructure that runs an
// employee's attempt. One port, two providers:
//
//   container  the standard runtime. A trusted ALLOCATOR (the only holder of the container runtime's socket) creates,
//              for each attempt, TWO containers from fixed images and a fixed mount list worked out from the ids below --
//              never from a path, an image or a privilege a caller names:
//                model plane  the AI CLI, the connection's config home (its login) and the tool bridge; read-only root,
//                             no desk/scratch/team mounts, network only to the runtime's provider hosts and the bridge
//                tool plane   the employee's sandbox: /work (the assignment's disk-backed scratch, seeded from the desk),
//                             /output, /input (read-only), /cache, /team, a small tmpfs /tmp; holds NO credential;
//                             network only through Orbit's egress proxy (the run's token decides each connection)
//              Limits (CPU, memory, PIDs, storage, time) come from the employee's pinned resource revision and are read
//              back as evidence; nothing is "enforced" because a value was stored.
//   process    development only (no container runtime). Directories under the data volume, the CLI as a local child.
//              It is NOT isolated: it never grants a shell, and says so.
//
// Every operation is idempotent by the ids it is given (a retry after a crash finds what the first call made), and a
// stop or a removal is VERIFIED (read back from the runtime) before the worker releases what the attempt held.
import type { EnforcementLevel, ResourceProfile, SandboxAttestation, StorageArea, StorageCapability, UsageView } from "@orbit-web/contracts";
import type { ProcessPort } from "../../../infra/process/process.port.js";

export const SANDBOX_PROVIDER = Symbol("SANDBOX_PROVIDER");

export type ProviderKind = "container" | "process";

// What this host can do, found by trying (a probe), with the evidence.
export interface HostCapabilities {
  provider: ProviderKind;
  // The container runtime answers (container provider), and its version.
  runtime: { reachable: boolean; version: string | null; cgroup: "v1" | "v2" | null; detail: string };
  // Whether CPU, memory and PID limits are applied by the kernel here.
  limits: { cpu: EnforcementLevel; memory: EnforcementLevel; pids: EnforcementLevel; evidence: string };
  storage: StorageCapability;
  // What the host has, for the capacity (null: not known).
  host: { cpuMillis: number | null; memoryMiB: number | null; storageMiB: number | null };
  // Whether this provider can ever grant an attempt a shell (process: never).
  shellPossible: boolean;
  probedAt: string;
}

export interface SandboxIds {
  orbitId: string;
  employeeId: string;
  sandboxId: string;
}

export interface AreaState {
  area: StorageArea;
  quotaMiB: number;
  level: EnforcementLevel;
  // How the level was established: the over-quota write that was refused, the measurement, or why nothing enforces it.
  evidence: string;
  usedMiB: number | null;
}

export interface ProvisionResult {
  state: "READY" | "FAILED";
  areas: AreaState[];
  reason: string | null;
}

// One attempt: everything the allocator needs, as ids and values -- never a host path a request supplied.
export interface AttemptSpec extends SandboxIds {
  runId: string;
  // Idempotency: a second start with the same key returns the attempt the first made.
  dispatchKey: string;
  fence: number;
  assignmentId: string;
  // The tool plane's limits: the employee's resource revision pinned at admission.
  resources: ResourceProfile;
  // The model plane: its own limits, the connection whose config home it mounts (resolved by the provider from the
  // connections room), and the CLI's environment (from the adapter's allow-list; secrets only for an api_key method).
  modelPlane: { cpuMillis: number; memoryMiB: number; connectionHome: string; env: Record<string, string> };
  // The tool plane's way out: Orbit's egress proxy, with the run's token as its credential.
  egress: { proxyHost: string; proxyPort: number; runToken: string };
  // The bridge's way to Orbit's tool endpoint (the model plane only).
  bridge: { url: string; runToken: string };
  // Read-only inputs, materialized from pinned research revisions: name -> bytes' location in Orbit's own store.
  inputs: { name: string; storePath: string }[];
  // The mission's team room, when the assignment belongs to a team.
  teamRoom: { id: string; quotaMiB: number } | null;
}

export interface AttemptHandle {
  runId: string;
  dispatchKey: string;
  // The runtime's ids (container ids), or the directory (process provider).
  toolPlane: string;
  modelPlane: string | null;
  provider: ProviderKind;
  createdAt: string;
  // How the model plane sees what the runtime adapter needs: the connection's config home (container: its mount point;
  // process: the directory itself), an empty working directory for the CLI, and the command that starts the Orbit tool
  // bridge there (the bridge's own environment -- ORBIT_TOOL_URL, ORBIT_RUN_TOKEN -- is given by the adapter in the MCP config).
  modelPlaneHome: string;
  modelPlaneCwd: string;
  bridgeCommand: { command: string; args: string[] };
}

export interface ExecRequest {
  argv: string[];
  // Relative to /work; never absolute, never above it.
  cwd?: string;
  env?: Record<string, string>;
  stdin?: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface ExecResult {
  code: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  truncated: boolean;
}

export interface FileEntry {
  // Relative to the area's root.
  path: string;
  type: "file" | "dir" | "symlink" | "other";
  size: number;
}

// What the attestation of an attempt observed, kept apart from what was requested and applied.
export interface AttemptEvidence {
  attestation: SandboxAttestation;
  applied: { cpuMillis: number | null; memoryMiB: number | null; pidsLimit: number | null; readBackAt: string } | null;
  observed: { cpuQuota: string | null; memoryLimit: string | null; pidsMax: string | null; storage: { area: StorageArea; level: EnforcementLevel; evidence: string }[]; at: string } | null;
}

export interface AttemptStatus {
  handle: AttemptHandle;
  // Whether each plane's container (or process) is alive now.
  toolPlaneRunning: boolean;
  modelPlaneRunning: boolean;
  // Set when the runtime says a container was killed for memory.
  oomKilled: { modelPlane: boolean; toolPlane: boolean };
}

export interface SandboxProvider {
  readonly kind: ProviderKind;

  probe(force?: boolean): Promise<HostCapabilities>;

  // The Personal Sandbox: desk (with the toolbox) and cache volumes with their quotas. Idempotent; READY only when every
  // area exists, was written to and its enforcement level is recorded with evidence. Starts no container that stays.
  provisionEmployee(ids: SandboxIds, quotas: { deskMiB: number; cacheMiB: number }): Promise<ProvisionResult>;
  // Frozen read-only (the employee was archived); nothing is deleted.
  archiveEmployee(ids: SandboxIds): Promise<void>;
  // Current use of the employee's areas.
  measure(ids: SandboxIds): Promise<AreaState[]>;

  // The assignment's workspace (disk-backed scratch with its quota), seeded from the desk on first use; kept across the
  // attempts of one assignment (a revision continues in the same work tree) until the assignment ends.
  prepareWorkspace(ids: SandboxIds, assignmentId: string, scratchMiB: number): Promise<AreaState>;
  // On acceptance: the workspace's changes are published to the desk if the desk is still at `expectedDeskVersion`.
  publishWorkspace(ids: SandboxIds, assignmentId: string, expectedDeskVersion: number): Promise<{ published: boolean; deskVersion: number; changed: string[]; reason: string | null }>;
  // When the assignment ends: its workspace is removed (verified).
  removeWorkspace(ids: SandboxIds, assignmentId: string): Promise<{ gone: boolean; detail: string }>;

  // Both planes of one attempt. Idempotent by `dispatchKey`.
  startAttempt(spec: AttemptSpec): Promise<AttemptHandle>;
  // What the runtime knows of an attempt started earlier (recovery after a crash or restart); null: nothing exists.
  find(dispatchKey: string): Promise<AttemptStatus | null>;
  // The attempt's isolation and limits, checked from outside the shell (canaries, cgroup files, mounts, network).
  attest(handle: AttemptHandle, spec: AttemptSpec): Promise<AttemptEvidence>;
  // Starts programs in the MODEL plane (the CLI): the runtime adapter streams them like any child process.
  modelPlane(handle: AttemptHandle): ProcessPort;
  // The TOOL plane (what the employee's tools do): a command, and files under /work, /output, /team, /toolbox.
  exec(handle: AttemptHandle, req: ExecRequest): Promise<ExecResult>;
  readFile(handle: AttemptHandle, path: string, maxBytes: number): Promise<Buffer | null>;
  writeFile(handle: AttemptHandle, path: string, bytes: Buffer): Promise<void>;
  list(handle: AttemptHandle, dir: string, maxEntries: number): Promise<FileEntry[]>;
  usage(handle: AttemptHandle): Promise<{ modelPlane: UsageView | null; toolPlane: UsageView | null }>;
  // Stop both planes (SIGTERM, then SIGKILL after `graceMs`); `remove` deletes them and VERIFIES they are gone.
  stop(handle: AttemptHandle, graceMs: number): Promise<void>;
  remove(handle: AttemptHandle): Promise<{ gone: boolean; detail: string }>;
}
