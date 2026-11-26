// ORBIT WEB'S SIDE OF THE ALLOCATOR: each typed operation as a signed request on the private control network
// (allocator-protocol.ts). node:http, never through a proxy. An allocator that cannot be reached is `unavailable` --
// the worker treats it as an outage, never as an answer.
import type { OpenedAttempt, RuntimePull } from "./runtime-security-wire.js";
import { request } from "node:http";
import type { UsageView } from "@orbit-web/contracts";
import type { AreaState, AttemptEvidence, DeskCleaned, DeskCleanOrder, DeskListing, DeskRead, ExecRequest, ExecResult, FileEntry, HostCapabilities, ProvisionResult, SandboxIds } from "../../application/sandbox.port.js";
import { AllocatorError, ERROR_STATUS, signedHeaders, type AllocatorApi, type AllocatorAttemptSpec, type AllocatorErrorCode, type AttemptRecord, type AttemptStatusRecord, type AttestRequest, type SessionRecord, type SessionSpec, type Operation, type PublishResult } from "./allocator-protocol.js";

const DEFAULT_TIMEOUT_MS = 15 * 60_000;
const DESK_TIMEOUT_MS = 3 * 60_000;

export class AllocatorClient implements AllocatorApi {
  private readonly url: URL;

  constructor(
    origin: string,
    private readonly secret: string,
  ) {
    this.url = new URL(origin);
  }

  private call<T>(op: Operation, args: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<T> {
    const path = `/v1/${op}`;
    const body = Buffer.from(JSON.stringify(args), "utf8");
    return new Promise<T>((resolve, reject) => {
      const req = request(
        { host: this.url.hostname, port: this.url.port === "" ? 80 : Number(this.url.port), method: "POST", path, headers: { "content-type": "application/json", "content-length": body.length, ...signedHeaders(this.secret, "POST", path, body) } },
        (res) => {
          const chunks: Buffer[] = [];
          res.on("data", (c: Buffer) => chunks.push(c));
          res.on("error", (err) => reject(new AllocatorError("unavailable", `the allocator's answer to ${op} broke off: ${err.message}`)));
          res.on("end", () => {
            let parsed: { result?: T; error?: { code?: string; message?: string } };
            try {
              parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as typeof parsed;
            } catch {
              reject(new AllocatorError("internal", `the allocator answered ${op} with something that is not JSON (HTTP ${res.statusCode})`));
              return;
            }
            if (res.statusCode === 200 && "result" in parsed) {
              resolve(parsed.result as T);
              return;
            }
            const code = (parsed.error?.code ?? "internal") as AllocatorErrorCode;
            reject(new AllocatorError(code in ERROR_STATUS ? code : "internal", parsed.error?.message ?? `HTTP ${res.statusCode}`));
          });
        },
      );
      req.setTimeout(timeoutMs, () => req.destroy(new Error(`no answer within ${timeoutMs} ms`)));
      req.on("error", (err) => reject(new AllocatorError("unavailable", `the allocator could not be reached for ${op}: ${err.message}`)));
      req.end(body);
    });
  }

  probe(force: boolean): Promise<HostCapabilities> {
    return this.call("probe", { force });
  }

  provisionEmployee(ids: SandboxIds, quotas: { deskMiB: number; cacheMiB: number }): Promise<ProvisionResult> {
    return this.call("provisionEmployee", { ids, quotas });
  }

  async archiveEmployee(ids: SandboxIds): Promise<void> {
    await this.call("archiveEmployee", { ids });
  }

  deleteEmployee(ids: SandboxIds): Promise<{ gone: boolean; detail: string }> {
    return this.call("deleteEmployee", { ids });
  }

  measure(ids: SandboxIds): Promise<AreaState[]> {
    return this.call("measure", { ids });
  }

  prepareWorkspace(ids: SandboxIds, assignmentId: string, scratchMiB: number): Promise<AreaState> {
    return this.call("prepareWorkspace", { ids, assignmentId, scratchMiB });
  }

  publishWorkspace(ids: SandboxIds, assignmentId: string, expectedDeskVersion: number): Promise<PublishResult> {
    return this.call("publishWorkspace", { ids, assignmentId, expectedDeskVersion });
  }

  removeWorkspace(ids: SandboxIds, assignmentId: string): Promise<{ gone: boolean; detail: string }> {
    return this.call("removeWorkspace", { ids, assignmentId });
  }

  // A person's look into a desk, and its clean-up: one storage worker each (bounded by the allocator's own timeout).
  listDesk(ids: SandboxIds, dir: string, maxEntries: number): Promise<DeskListing> {
    return this.call("listDesk", { ids, dir, maxEntries }, DESK_TIMEOUT_MS);
  }

  async readDesk(ids: SandboxIds, path: string, maxBytes: number): Promise<DeskRead> {
    const r = await this.call<Omit<DeskRead, "data"> & { base64: string }>("readDesk", { ids, path, maxBytes }, DESK_TIMEOUT_MS);
    return { deskVersion: r.deskVersion, bytes: r.bytes, data: Buffer.from(r.base64, "base64"), truncated: r.truncated, modifiedAt: r.modifiedAt };
  }

  cleanDesk(ids: SandboxIds, order: DeskCleanOrder, expectedDeskVersion: number): Promise<DeskCleaned> {
    return this.call("cleanDesk", { ids, order, expectedDeskVersion }, DESK_TIMEOUT_MS);
  }

  startAttempt(spec: AllocatorAttemptSpec): Promise<AttemptRecord> {
    return this.call("startAttempt", { spec });
  }

  openAttempt(dispatchKey: string): Promise<OpenedAttempt> {
    return this.call("openAttempt", { dispatchKey });
  }

  findAttempt(dispatchKey: string): Promise<AttemptStatusRecord | null> {
    return this.call("findAttempt", { dispatchKey });
  }

  runtimeSecurityPull(cursor: { epoch: string | null; seq: number }, max: number): Promise<RuntimePull> {
    return this.call("runtimeSecurityPull", { cursor, max });
  }

  attest(dispatchKey: string, request: AttestRequest): Promise<AttemptEvidence> {
    return this.call("attest", { dispatchKey, request });
  }

  exec(dispatchKey: string, req: ExecRequest): Promise<ExecResult> {
    return this.call("exec", { dispatchKey, req }, req.timeoutMs + 120_000);
  }

  async readFile(dispatchKey: string, path: string, maxBytes: number): Promise<Buffer | null> {
    const r = await this.call<{ base64: string } | null>("readFile", { dispatchKey, path, maxBytes });
    return r === null ? null : Buffer.from(r.base64, "base64");
  }

  async writeFile(dispatchKey: string, path: string, bytes: Buffer): Promise<void> {
    await this.call("writeFile", { dispatchKey, path, base64: bytes.toString("base64") });
  }

  list(dispatchKey: string, dir: string, maxEntries: number): Promise<FileEntry[]> {
    return this.call("list", { dispatchKey, dir, maxEntries });
  }

  usage(dispatchKey: string): Promise<{ modelPlane: UsageView | null; toolPlane: UsageView | null }> {
    return this.call("usage", { dispatchKey });
  }

  async stop(dispatchKey: string, graceMs: number): Promise<void> {
    await this.call("stop", { dispatchKey, graceMs }, graceMs + 120_000);
  }

  remove(dispatchKey: string): Promise<{ gone: boolean; detail: string }> {
    return this.call("remove", { dispatchKey });
  }

  startSession(spec: SessionSpec): Promise<SessionRecord> {
    return this.call("startSession", { spec });
  }

  removeSession(dispatchKey: string): Promise<{ gone: boolean; detail: string }> {
    return this.call("removeSession", { dispatchKey });
  }

  sweepSessions(): Promise<{ removed: number }> {
    return this.call("sweepSessions", {});
  }
}
