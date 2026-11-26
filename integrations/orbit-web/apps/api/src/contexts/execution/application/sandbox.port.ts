// THE SANDBOX PORT (Execution context, ADR 0061): what the execution worker asks of the infrastructure that runs an
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
import type { AttemptRuntimeSecurity, RuntimeHostProbe } from "../infrastructure/sandbox/runtime-security-wire.js";
import type { DeskCleanRequest, DeskEntry, EnforcementLevel, ProtectionEvidence, ResourceProfile, SandboxAttestation, StorageArea, StorageCapability, UsageView } from "@orbit-web/contracts";
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
  // Runtime security (ADR 0063): what this host can observe and prevent, each from a probe (absent: no allocator).
  runtimeSecurity?: RuntimeHostProbe;
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

// A person looking into an employee's desk (Governance → Employee desks): one folder's entries, the biggest first, or a
// file's first bytes, with the desk's version they were read at.
export interface DeskListing {
  deskVersion: number;
  entries: DeskEntry[];
  truncated: boolean;
  bytes: number;
  files: number;
}

export interface DeskRead {
  deskVersion: number;
  // The file's size; `data` is at most what was asked of it (`truncated` when the file holds more).
  bytes: number;
  data: Buffer;
  truncated: boolean;
  modifiedAt: string;
}

// A person's clean-up of a desk: what went (the first paths of it), what was named and not there, and the desk's
// version, which a clean does not move.
export type DeskCleanOrder = Required<DeskCleanRequest>;

export interface DeskCleaned {
  removed: number;
  paths: string[];
  missing: string[];
  cacheEmptied: boolean;
  deskVersion: number;
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
  // What the attempt is to be held to while its programs run (ADR 0063). Not said: disabled (the deployment's floor still
  // applies in the allocator).
  runtimeSecurity?: AttemptRuntimeSecurity;
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
  // What the allocator established about the attempt's runtime protection when it started it (ADR 0063).
  protection?: ProtectionEvidence | null;
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
  // Deleted (an archived employee its owner deleted): every area of the employee and its record, read back -- refused
  // (`gone: false`, said why) while a container of one of its attempts exists. Gone already is gone.
  deleteEmployee(ids: SandboxIds): Promise<{ gone: boolean; detail: string }>;
  // Current use of the employee's areas.
  measure(ids: SandboxIds): Promise<AreaState[]>;

  // The assignment's workspace (disk-backed scratch with its quota), seeded from the desk on first use; kept across the
  // attempts of one assignment (a revision continues in the same work tree) until the assignment ends.
  prepareWorkspace(ids: SandboxIds, assignmentId: string, scratchMiB: number): Promise<AreaState>;
  // On acceptance: the workspace's changes are published to the desk if the desk is still at `expectedDeskVersion`.
  // Its answer names the first changed paths (a bounded list) and how many there were (`changedTotal`).
  publishWorkspace(ids: SandboxIds, assignmentId: string, expectedDeskVersion: number): Promise<{ published: boolean; deskVersion: number; changed: string[]; changedTotal: number; reason: string | null }>;
  // When the assignment ends: its workspace is removed (verified).
  removeWorkspace(ids: SandboxIds, assignmentId: string): Promise<{ gone: boolean; detail: string }>;

  // A PERSON LOOKING INTO THE DESK (Governance → Employee desks), under the employee's lock: one folder, or a file's
  // first bytes -- never through a link, never Orbit Web's own names at its top. A path that is not one is refused
  // (bad_request), one that is not there is not_found, one through a link is bad_request.
  listDesk(ids: SandboxIds, dir: string, maxEntries: number): Promise<DeskListing>;
  readDesk(ids: SandboxIds, path: string, maxBytes: number): Promise<DeskRead>;
  // A person cleaning it up: named paths, everything but the toolbox, and/or the cache. Refused (conflict) while the
  // desk is not at `expectedDeskVersion`, or while any workspace or attempt container of the employee exists -- so no work
  // is disturbed, and no later publish of a work tree seeded before the clean puts back what went. The desk's version
  // does not move (it counts accepted results).
  cleanDesk(ids: SandboxIds, order: DeskCleanOrder, expectedDeskVersion: number): Promise<DeskCleaned>;

  // Both planes of one attempt. Idempotent by `dispatchKey`.
  startAttempt(spec: AttemptSpec): Promise<AttemptHandle>;
  // What the runtime knows of an attempt started earlier (recovery after a crash or restart); null: nothing exists.
  find(dispatchKey: string): Promise<AttemptStatus | null>;
  // The attempt's isolation and limits, checked from outside the shell (canaries, cgroup files, mounts, network).
  attest(handle: AttemptHandle, spec: AttemptSpec): Promise<AttemptEvidence>;
  // THE GATE (ADR 0063): the attempt opened for what the employee runs -- the model plane's runner made reachable, the
  // tool plane's shell allowed -- only once its required runtime protection is proven and fresh. Refused otherwise.
  open(handle: AttemptHandle): Promise<{ protection: ProtectionEvidence | null }>;
  // Starts programs in the MODEL plane (the CLI): the runtime adapter streams them like any child process.
  modelPlane(handle: AttemptHandle): ProcessPort;
  // The TOOL plane (what the employee's tools do): a command, and files in the areas of FILE_AREAS (allocator-protocol.ts)
  // and /toolbox -- /input read, never written.
  exec(handle: AttemptHandle, req: ExecRequest): Promise<ExecResult>;
  readFile(handle: AttemptHandle, path: string, maxBytes: number): Promise<Buffer | null>;
  writeFile(handle: AttemptHandle, path: string, bytes: Buffer): Promise<void>;
  list(handle: AttemptHandle, dir: string, maxEntries: number): Promise<FileEntry[]>;
  usage(handle: AttemptHandle): Promise<{ modelPlane: UsageView | null; toolPlane: UsageView | null }>;
  // Stop both planes (SIGTERM, then SIGKILL after `graceMs`); `remove` deletes them and VERIFIES they are gone.
  stop(handle: AttemptHandle, graceMs: number): Promise<void>;
  remove(handle: AttemptHandle): Promise<{ gone: boolean; detail: string }>;
}
