// THE CONTAINER PROVIDER (ADR 0061): the standard runtime of an employee's attempt. Everything is asked of the
// allocator -- the only holder of the container runtime's socket -- through its typed operations (an AllocatorClient
// in Orbit Web; the allocator itself, in process, in a test). The model plane's CLI is started through that plane's
// runner on the model network, with the attempt's own runner token (derived from the shared secret and the dispatch
// key: it opens no other attempt's runner).
import { lookup } from "node:dns/promises";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UsageView } from "@orbit-web/contracts";
import { contained } from "../../../../common/workspace-path.js";
import type { SandboxConfig } from "../../../../config/sandbox-config.js";
import type { ProcessPort } from "../../../../infra/process/process.port.js";
import { RunnerProcessPort } from "../../../../infra/process/runner-port.js";
import type { AreaState, AttemptEvidence, AttemptHandle, AttemptSpec, AttemptStatus, DeskCleaned, DeskCleanOrder, DeskListing, DeskRead, ExecRequest, ExecResult, FileEntry, HostCapabilities, ProvisionResult, SandboxIds, SandboxProvider } from "../../application/sandbox.port.js";
import { AllocatorClient } from "./allocator-client.js";
import { readSecret, type AllocatorApi, type AttemptRecord, type AttestProbes } from "./allocator-protocol.js";
import { planeNames, runnerToken } from "./ids.js";
import { MODEL_PLANE } from "./layout.js";

// An address on the internet (no name to resolve) and a name every public resolver answers: both must fail from a tool
// plane.
export const EGRESS_PROBE = { host: "1.1.1.1", port: 443 };
export const DNS_PROBE = "example.com";

export interface ContainerProviderOptions {
  // The shared secret (the runner tokens are derived from it).
  secret: string;
  prefix: string;
  // How Orbit Web reaches a model plane's runner: by its container name on the model network (deployed), or by its
  // address (a process on the host, which cannot resolve the runtime's names: the tests).
  modelPlaneAddress: "name" | "ip";
  // An input's bytes, from Orbit's own store (the allocator never reaches that store).
  readInput: (storePath: string) => Promise<Buffer>;
  // What the attestation tries from the tool plane.
  probes: AttestProbes;
  acceptSoftStorage: boolean;
}

export class ContainerSandboxProvider implements SandboxProvider {
  readonly kind = "container" as const;
  private readonly endpoints = new Map<string, { name: string; ip: string | null; port: number }>();

  constructor(
    private readonly allocator: AllocatorApi,
    private readonly o: ContainerProviderOptions,
  ) {}

  probe(force = false): Promise<HostCapabilities> {
    return this.allocator.probe(force);
  }

  provisionEmployee(ids: SandboxIds, quotas: { deskMiB: number; cacheMiB: number }): Promise<ProvisionResult> {
    return this.allocator.provisionEmployee(ids, quotas);
  }

  archiveEmployee(ids: SandboxIds): Promise<void> {
    return this.allocator.archiveEmployee(ids);
  }

  deleteEmployee(ids: SandboxIds): Promise<{ gone: boolean; detail: string }> {
    return this.allocator.deleteEmployee(ids);
  }

  measure(ids: SandboxIds): Promise<AreaState[]> {
    return this.allocator.measure(ids);
  }

  prepareWorkspace(ids: SandboxIds, assignmentId: string, scratchMiB: number): Promise<AreaState> {
    return this.allocator.prepareWorkspace(ids, assignmentId, scratchMiB);
  }

  publishWorkspace(ids: SandboxIds, assignmentId: string, expectedDeskVersion: number) {
    return this.allocator.publishWorkspace(ids, assignmentId, expectedDeskVersion);
  }

  removeWorkspace(ids: SandboxIds, assignmentId: string): Promise<{ gone: boolean; detail: string }> {
    return this.allocator.removeWorkspace(ids, assignmentId);
  }

  listDesk(ids: SandboxIds, dir: string, maxEntries: number): Promise<DeskListing> {
    return this.allocator.listDesk(ids, dir, maxEntries);
  }

  readDesk(ids: SandboxIds, path: string, maxBytes: number): Promise<DeskRead> {
    return this.allocator.readDesk(ids, path, maxBytes);
  }

  cleanDesk(ids: SandboxIds, order: DeskCleanOrder, expectedDeskVersion: number): Promise<DeskCleaned> {
    return this.allocator.cleanDesk(ids, order, expectedDeskVersion);
  }

  private handleOf(r: AttemptRecord): AttemptHandle {
    if (r.modelPlane !== null) this.endpoints.set(r.dispatchKey, { name: r.modelPlane.name, ip: r.modelPlane.ip, port: r.modelPlane.port });
    return {
      runId: r.runId,
      dispatchKey: r.dispatchKey,
      toolPlane: r.toolPlane?.id ?? "",
      modelPlane: r.modelPlane?.id ?? null,
      provider: "container",
      createdAt: r.createdAt,
      modelPlaneHome: r.modelPlaneHome,
      modelPlaneCwd: r.modelPlaneCwd,
      bridgeCommand: { command: r.bridgeCommand.command, args: [...r.bridgeCommand.args] },
    };
  }

  async startAttempt(spec: AttemptSpec): Promise<AttemptHandle> {
    const inputs = await Promise.all(spec.inputs.map(async (i) => ({ name: i.name, base64: (await this.o.readInput(i.storePath)).toString("base64") })));
    return this.handleOf(await this.allocator.startAttempt({ ...spec, inputs }));
  }

  async find(dispatchKey: string): Promise<AttemptStatus | null> {
    const r = await this.allocator.findAttempt(dispatchKey);
    if (r === null) return null;
    return { handle: this.handleOf(r), toolPlaneRunning: r.toolPlaneRunning, modelPlaneRunning: r.modelPlaneRunning, oomKilled: r.oomKilled };
  }

  attest(handle: AttemptHandle, spec: AttemptSpec): Promise<AttemptEvidence> {
    const { inputs: _inputs, ...rest } = spec;
    return this.allocator.attest(handle.dispatchKey, { spec: rest, probes: this.o.probes, acceptSoftStorage: this.o.acceptSoftStorage });
  }

  modelPlane(handle: AttemptHandle): ProcessPort {
    const known = this.endpoints.get(handle.dispatchKey);
    const host = this.o.modelPlaneAddress === "ip" ? (known?.ip ?? null) : (known?.name ?? planeNames(this.o.prefix, handle.dispatchKey).model);
    if (host === null) throw new Error("the model plane's address is not known to this process yet: find the attempt first");
    return new RunnerProcessPort(host, known?.port ?? MODEL_PLANE.runnerPort, runnerToken(this.o.secret, handle.dispatchKey));
  }

  exec(handle: AttemptHandle, req: ExecRequest): Promise<ExecResult> {
    return this.allocator.exec(handle.dispatchKey, req);
  }

  readFile(handle: AttemptHandle, path: string, maxBytes: number): Promise<Buffer | null> {
    return this.allocator.readFile(handle.dispatchKey, path, maxBytes);
  }

  writeFile(handle: AttemptHandle, path: string, bytes: Buffer): Promise<void> {
    return this.allocator.writeFile(handle.dispatchKey, path, bytes);
  }

  list(handle: AttemptHandle, dir: string, maxEntries: number): Promise<FileEntry[]> {
    return this.allocator.list(handle.dispatchKey, dir, maxEntries);
  }

  usage(handle: AttemptHandle): Promise<{ modelPlane: UsageView | null; toolPlane: UsageView | null }> {
    return this.allocator.usage(handle.dispatchKey);
  }

  stop(handle: AttemptHandle, graceMs: number): Promise<void> {
    return this.allocator.stop(handle.dispatchKey, graceMs);
  }

  async remove(handle: AttemptHandle): Promise<{ gone: boolean; detail: string }> {
    const r = await this.allocator.remove(handle.dispatchKey);
    if (r.gone) this.endpoints.delete(handle.dispatchKey);
    return r;
  }
}

// Where the attestation tries the database from a tool plane: its address as Orbit Web resolves it (a name a tool
// plane cannot resolve would make the check pass for the wrong reason), and its port. A database on a local socket names
// nothing to try: null, and the check fails.
export async function databaseProbe(url: string): Promise<{ host: string; port: number } | null> {
  const u = new URL(url);
  const host = u.hostname.replace(/^\[(.*)\]$/, "$1");
  if (host === "") return null;
  const port = u.port === "" ? 5432 : Number(u.port);
  try {
    return { host: (await lookup(host, { family: 4 })).address, port };
  } catch {
    return { host, port };
  }
}

// An input named by its place in Orbit's own store: a path inside `root`, never outside it.
export const storeReader =
  (root: string) =>
  async (storePath: string): Promise<Buffer> => {
    const p = join(root, storePath);
    if (!contained(root, p)) throw new Error(`the input ${storePath} is not inside Orbit's store`);
    return readFile(p);
  };

// The provider Orbit Web runs in a deployment: the allocator over its control network, the secret from its file.
// `readInput`: how an input's bytes are read from Orbit's own store (a research mission's sources), or `inputsRoot`, a
// directory they are read from.
export async function containerProviderFrom(config: SandboxConfig, o: { databaseUrl: string; readInput?: (storePath: string) => Promise<Buffer>; inputsRoot?: string }): Promise<ContainerSandboxProvider> {
  if (config.allocator === null) throw new Error("the container provider needs ORBIT_WEB_ALLOCATOR_URL");
  const secret = readSecret(config.allocator.secretFile);
  return new ContainerSandboxProvider(new AllocatorClient(config.allocator.url, secret), {
    secret,
    prefix: config.names.prefix,
    modelPlaneAddress: "name",
    readInput: o.readInput ?? storeReader(o.inputsRoot ?? "/nonexistent"),
    probes: { egress: EGRESS_PROBE, dnsName: DNS_PROBE, database: await databaseProbe(o.databaseUrl) },
    acceptSoftStorage: config.acceptSoftStorage,
  });
}
