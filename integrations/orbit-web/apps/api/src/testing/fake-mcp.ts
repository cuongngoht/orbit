// A REMOTE MCP SERVER FOR TESTS: Streamable HTTP on this machine -- initialize, the initialized notification,
// tools/list (in pages when asked) and tools/call -- answering as JSON or as an event stream, wanting a session id after
// initialize and, when told, a credential on every request; and keeping what it was asked, headers and all.
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export interface FakeMcpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
  annotations?: Record<string, unknown>;
}

export type FakeMcpAnswer = { content: unknown[]; isError?: boolean; structuredContent?: unknown } | { error: { code: number; message: string } };

export interface FakeMcpOptions {
  tools: FakeMcpTool[];
  // What a call answers (default: its arguments, as text).
  call?: (name: string, args: Record<string, unknown>) => FakeMcpAnswer;
  // Answer as an event stream, a log notification before each answer (default: JSON).
  stream?: boolean;
  // The credential the server wants on every request (default: none).
  credential?: { header: string; value: string };
  // tools/list in pages of this many (default: all at once).
  page?: number;
  // A request to this path is sent elsewhere (HTTP 307) instead.
  redirect?: string;
}

export interface FakeMcpAsk {
  method: string;
  headers: IncomingHttpHeaders;
  params: Record<string, unknown>;
}

export interface FakeMcp {
  url: string;
  port: number;
  asked: FakeMcpAsk[];
  options: FakeMcpOptions;
  close(): Promise<void>;
}

const SESSION = "s-fake-1";

const listed = (o: FakeMcpOptions, cursor: unknown): Record<string, unknown> => {
  const from = typeof cursor === "string" ? Number(cursor) : 0;
  const size = o.page ?? o.tools.length;
  const next = from + size < o.tools.length ? String(from + size) : undefined;
  return { tools: o.tools.slice(from, from + size), ...(next === undefined ? {} : { nextCursor: next }) };
};

function answerOf(o: FakeMcpOptions, method: string, params: Record<string, unknown>): Record<string, unknown> {
  if (method === "initialize") return { result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake-kb", version: "1.0.0" } } };
  if (method === "tools/list") return { result: listed(o, params.cursor) };
  if (method !== "tools/call") return { error: { code: -32601, message: `no method ${method}` } };
  const args = (params.arguments ?? {}) as Record<string, unknown>;
  const said = o.call?.(String(params.name), args) ?? { content: [{ type: "text", text: JSON.stringify(args) }] };
  return "error" in said ? { error: said.error } : { result: said };
}

export async function startFakeMcp(options: FakeMcpOptions): Promise<FakeMcp> {
  const asked: FakeMcpAsk[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", (): void => {
      if (options.redirect !== undefined) return void res.writeHead(307, { location: options.redirect }).end();
      if (req.method !== "POST" || req.url !== "/mcp") return void res.writeHead(404).end();
      const message = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { id?: number; method?: string; params?: Record<string, unknown> };
      const method = String(message.method ?? "");
      asked.push({ method, headers: req.headers, params: message.params ?? {} });
      const credential = options.credential;
      if (credential !== undefined && req.headers[credential.header.toLowerCase()] !== credential.value) return void res.writeHead(401, { "content-type": "application/json" }).end('{"error":"unauthorized"}');
      if (method !== "initialize" && req.headers["mcp-session-id"] !== SESSION) return void res.writeHead(400, { "content-type": "application/json" }).end('{"error":"no session"}');
      if (message.id === undefined) return void res.writeHead(202).end();
      const body = { jsonrpc: "2.0", id: message.id, ...answerOf(options, method, message.params ?? {}) };
      const head = method === "initialize" ? { "mcp-session-id": SESSION } : {};
      if (options.stream !== true) return void res.writeHead(200, { "content-type": "application/json", ...head }).end(JSON.stringify(body));
      res.writeHead(200, { "content-type": "text/event-stream", ...head });
      res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "notifications/message", params: { level: "info", data: "working" } })}\n\n`);
      res.end(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as AddressInfo).port;
  return { url: `http://127.0.0.1:${port}/mcp`, port, asked, options, close: () => new Promise<void>((r) => server.close(() => r())) };
}
