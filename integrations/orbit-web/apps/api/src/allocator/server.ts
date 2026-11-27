// THE ALLOCATOR ON THE NETWORK: one route per typed operation (`POST /v1/<operation>`, a JSON body of its arguments),
// on a private network Orbit Web alone shares with it, never published. Every request must be signed with the shared
// secret (allocator-protocol.ts: method, path, time, a single-use nonce, the body's digest) or it is refused before its
// body is even parsed. Bytes travel as base64. `GET /healthz` says only that the process answers.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { AllocatorError, NonceCache, OPERATIONS, toAllocatorError, verifySigned, type AllocatorApi, type Operation } from "../contexts/execution/infrastructure/sandbox/allocator-protocol.js";

// A 64 MiB file as base64, and the JSON around it.
export const MAX_BODY_BYTES = 96 * 1024 * 1024;
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

function bytesOf(v: unknown, name: string): Buffer {
  if (typeof v !== "string" || v.length % 4 !== 0 || !BASE64.test(v)) throw new AllocatorError("bad_request", `${name} must be base64`);
  return Buffer.from(v, "base64");
}

// The arguments of each operation, from the body; the allocator checks their values itself.
async function dispatch(api: AllocatorApi, op: Operation, a: Record<string, unknown>): Promise<unknown> {
  const s = (k: string) => a[k] as string;
  const n = (k: string) => a[k] as number;
  switch (op) {
    case "probe":
      return api.probe(a.force === true);
    case "provisionEmployee":
      return api.provisionEmployee(a.ids as never, a.quotas as never);
    case "archiveEmployee":
      await api.archiveEmployee(a.ids as never);
      return null;
    case "deleteEmployee":
      return api.deleteEmployee(a.ids as never);
    case "measure":
      return api.measure(a.ids as never);
    case "prepareWorkspace":
      return api.prepareWorkspace(a.ids as never, s("assignmentId"), n("scratchMiB"));
    case "publishWorkspace":
      return api.publishWorkspace(a.ids as never, s("assignmentId"), n("expectedDeskVersion"));
    case "removeWorkspace":
      return api.removeWorkspace(a.ids as never, s("assignmentId"));
    case "listDesk":
      return api.listDesk(a.ids as never, s("dir"), n("maxEntries"));
    case "readDesk": {
      const r = await api.readDesk(a.ids as never, s("path"), n("maxBytes"));
      return { deskVersion: r.deskVersion, bytes: r.bytes, base64: r.data.toString("base64"), truncated: r.truncated, modifiedAt: r.modifiedAt };
    }
    case "cleanDesk":
      return api.cleanDesk(a.ids as never, a.order as never, n("expectedDeskVersion"));
    case "startAttempt":
      return api.startAttempt(a.spec as never);
    case "openAttempt":
      return api.openAttempt(s("dispatchKey"));
    case "findAttempt":
      return api.findAttempt(s("dispatchKey"));
    case "attest":
      return api.attest(s("dispatchKey"), a.request as never);
    case "exec":
      return api.exec(s("dispatchKey"), a.req as never);
    case "readFile": {
      const bytes = await api.readFile(s("dispatchKey"), s("path"), n("maxBytes"));
      return bytes === null ? null : { base64: bytes.toString("base64") };
    }
    case "writeFile":
      await api.writeFile(s("dispatchKey"), s("path"), bytesOf(a.base64, "base64"));
      return null;
    case "list":
      return api.list(s("dispatchKey"), s("dir"), n("maxEntries"));
    case "usage":
      return api.usage(s("dispatchKey"));
    case "stop":
      await api.stop(s("dispatchKey"), n("graceMs"));
      return null;
    case "remove":
      return api.remove(s("dispatchKey"));
    case "startSession":
      return api.startSession(a.spec as never);
    case "removeSession":
      return api.removeSession(s("dispatchKey"));
    case "sweepSessions":
      return api.sweepSessions();
    case "runtimeSecurityPull":
      return api.runtimeSecurityPull(a.cursor as never, n("max"));
  }
}

function reply(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text), "cache-control": "no-store" });
  res.end(text);
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) {
        resolve(null);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

export function allocatorServer(api: AllocatorApi, secret: string, log: (line: string) => void = () => undefined): Server {
  const nonces = new NonceCache();
  const handle = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const url = req.url ?? "";
    if (req.method === "GET" && url === "/healthz") return reply(res, 200, { ok: true });
    const m = /^\/v1\/([A-Za-z]{1,40})$/.exec(url);
    if (req.method !== "POST" || m === null || !(OPERATIONS as readonly string[]).includes(m[1] as string)) return reply(res, 404, { error: { code: "not_found", message: "no such operation" } });
    const body = await readBody(req);
    if (body === null) return reply(res, 413, { error: { code: "bad_request", message: "the request is too large" } });
    const why = verifySigned(secret, "POST", url, req.headers, body, nonces);
    if (why !== null) {
      log(`refused ${url}: ${why}`);
      return reply(res, 401, { error: { code: "unauthorized", message: why } });
    }
    let args: unknown;
    try {
      args = JSON.parse(body.toString("utf8"));
    } catch {
      return reply(res, 400, { error: { code: "bad_request", message: "the body must be JSON" } });
    }
    if (!isRecord(args)) return reply(res, 400, { error: { code: "bad_request", message: "the body must be a JSON object" } });
    try {
      reply(res, 200, { result: await dispatch(api, m[1] as Operation, args) });
    } catch (err) {
      const e = toAllocatorError(err);
      if (e.code === "internal") log(`${m[1]} failed: ${e.message}`);
      reply(res, e.status, { error: { code: e.code, message: e.message } });
    }
  };
  const server = createServer((req, res) => {
    handle(req, res).catch((err: unknown) => {
      if (!res.headersSent) reply(res, 500, { error: { code: "internal", message: err instanceof Error ? err.message : String(err) } });
    });
  });
  server.requestTimeout = 0;
  server.headersTimeout = 30_000;
  return server;
}
