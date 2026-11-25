// HOW ORBIT WEB ASKS A REMOTE MCP SERVER: Streamable HTTP, by the server itself (never a shell, never an agent's
// sandbox). Each ask is a session of its own -- initialize, the initialized notification, then the ask under the
// session's id and the protocol version agreed -- with the server's credential on every request and nowhere else. An
// answer is read as JSON or out of an event stream (anything else the server says there is read past), bounded in size
// and in time. Before the connection the address is held to the policy: by default the public internet, or a range the
// installation named (ORBIT_WEB_EGRESS_PRIVATE_ALLOW) -- never this host, loopback or the cloud metadata service -- and
// the connection is made to the very address checked, so a name that answers otherwise the next time reaches nothing.
// A redirect is never followed. No error says the credential.
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { networkInterfaces } from "node:os";
import { ORBIT_WEB_VERSION } from "@orbit-web/contracts";
import { allowedPrivate, forbiddenAddress } from "../../infra/egress/proxy.js";
import { redactSecrets } from "../../infra/security/redact.js";

export interface McpAddressPolicy {
  allows(address: string, port: number): boolean;
}

export const MCP_ADDRESS_POLICY = Symbol("MCP_ADDRESS_POLICY");

const ownAddresses = (): Set<string> => new Set(Object.values(networkInterfaces()).flatMap((list) => (list ?? []).map((i) => (i.address.startsWith("::ffff:") ? i.address.slice(7) : i.address))));

// The default: the public internet on any port, and the internal ranges the installation named.
export const mcpAddressPolicy = (privateAllow: readonly string[]): McpAddressPolicy => {
  const own = ownAddresses();
  const allowed = privateAllow.length > 0 ? allowedPrivate(privateAllow) : null;
  return { allows: (address) => !forbiddenAddress(address, own, allowed) };
};

export class McpError extends Error {}

export interface McpTarget {
  url: string;
  // The header the server's credential travels in, and its value (null: none).
  credential: { header: string; value: string } | null;
}

export interface McpOptions {
  policy: McpAddressPolicy;
  // For the whole ask: the session and its answer.
  timeoutMs: number;
  // For one answer.
  maxBytes: number;
  resolve?: (host: string) => Promise<string[]>;
}

export interface McpToolInfo {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // What the server says of it (annotations.readOnlyHint); null: it did not say.
  readOnly: boolean | null;
}

export interface McpCallResult {
  content: unknown[];
  structuredContent?: unknown;
  isError: boolean;
}

const PROTOCOL_VERSION = "2025-06-18";
const MAX_PAGES = 20;
const MAX_TOOLS = 200;
const MAX_SCHEMA = 32 * 1024;
// eslint-disable-next-line no-control-regex -- control characters are what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;

type Json = Record<string, unknown>;
const isRecord = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);

// Where the connection goes: the one checked address, and its port.
async function target(url: URL, o: McpOptions): Promise<{ address: string; family: 4 | 6; port: number }> {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const port = url.port === "" ? (url.protocol === "https:" ? 443 : 80) : Number(url.port);
  let addresses: string[];
  try {
    addresses = isIP(host) !== 0 ? [host] : await (o.resolve ?? (async (h: string) => (await lookup(h, { all: true, verbatim: true })).map((a) => a.address)))(host);
  } catch {
    throw new McpError(`${host} does not resolve.`);
  }
  if (addresses.length === 0) throw new McpError(`${host} does not resolve.`);
  const refused = addresses.find((a) => !o.policy.allows(a, port));
  if (refused !== undefined) throw new McpError(`${host}:${port} resolves to ${refused}, which is not on the public internet (nor a range the installation named): Orbit Web never connects to it.`);
  const address = addresses[0] as string;
  return { address, family: isIP(address) === 6 ? 6 : 4, port };
}

const pinned =
  (address: string, family: 4 | 6): LookupFunction =>
  (_host, options, callback) => {
    if ((options as { all?: boolean }).all === true) (callback as (err: null, a: { address: string; family: number }[]) => void)(null, [{ address, family }]);
    else (callback as (err: null, a: string, f: number) => void)(null, address, family);
  };

interface Session {
  id: string | null;
  version: string | null;
}

// One request: its answer's head, by the deadline.
async function post(t: McpTarget, o: McpOptions, session: Session, message: Json, deadline: number): Promise<IncomingMessage> {
  const url = new URL(t.url);
  const to = await target(url, o);
  const body = JSON.stringify(message);
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    "accept-encoding": "identity",
    "user-agent": `OrbitWeb/${ORBIT_WEB_VERSION}`,
    "content-length": String(Buffer.byteLength(body)),
    ...(session.id === null ? {} : { "mcp-session-id": session.id }),
    ...(session.version === null ? {} : { "mcp-protocol-version": session.version }),
    ...(t.credential === null ? {} : { [t.credential.header]: t.credential.value }),
  };
  return new Promise((resolve, reject) => {
    const request = url.protocol === "https:" ? httpsRequest : httpRequest;
    const req = request({ protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ""), port: to.port, path: `${url.pathname}${url.search}`, method: "POST", agent: false, lookup: pinned(to.address, to.family), headers }, resolve);
    const timer = setTimeout(() => req.destroy(new McpError("The server took too long to answer.")), Math.max(1, deadline - Date.now()));
    req.on("response", () => clearTimeout(timer));
    req.on("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof McpError ? err : new McpError(`The server could not be reached (${(err as { code?: string }).code ?? err.message}).`));
    });
    req.end(body);
  });
}

// The answer's body, whole, within the bound and the deadline.
function read(res: IncomingMessage, o: McpOptions, deadline: number, enough: (sofar: string) => boolean = () => false): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => res.destroy(new McpError("The server took too long to answer.")), Math.max(1, deadline - Date.now()));
    const done = () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString("utf8"));
    };
    res.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > o.maxBytes) {
        res.destroy(new McpError(`The server's answer is larger than Orbit Web reads (${Math.round(o.maxBytes / 1024)} KiB).`));
        return;
      }
      chunks.push(chunk);
      if (enough(Buffer.concat(chunks).toString("utf8"))) {
        res.destroy();
        done();
      }
    });
    res.on("end", done);
    res.on("error", (err) => {
      clearTimeout(timer);
      reject(err instanceof McpError ? err : new McpError("The server's answer was cut off."));
    });
  });
}

// The JSON-RPC messages an event stream carried (each event's data lines, joined).
const events = (text: string): unknown[] =>
  text
    .split(/\r?\n\r?\n/)
    .map((e) =>
      e
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).replace(/^ /, ""))
        .join("\n"),
    )
    .filter((d) => d.trim() !== "")
    .flatMap((d) => {
      try {
        return [JSON.parse(d) as unknown];
      } catch {
        return [];
      }
    });

const STATUS: Record<number, string> = {
  401: "The server refused Orbit Web's sign-in (HTTP 401): check the token.",
  403: "The server refused Orbit Web's sign-in (HTTP 403): check the token and what it may reach.",
  404: "The server has no MCP endpoint at this URL (HTTP 404).",
  405: "The server does not take MCP requests at this URL (HTTP 405): it may speak only the older HTTP+SSE transport, which Orbit Web does not.",
  406: "The server is not a Streamable HTTP MCP server (HTTP 406).",
  415: "The server is not a Streamable HTTP MCP server (HTTP 415).",
};

function refusal(res: IncomingMessage): McpError {
  const status = res.statusCode ?? 0;
  res.resume();
  if (status >= 300 && status < 400) return new McpError(`The server redirected (HTTP ${status}) to ${String(res.headers.location ?? "elsewhere").slice(0, 200)}: Orbit Web never follows a redirect -- give the address it ends at.`);
  return new McpError(STATUS[status] ?? `The server answered HTTP ${status}.`);
}

// What a message's id answered: its result, or the error it said.
function resultOf(messages: unknown[], id: number): unknown {
  const reply = messages.find((m) => isRecord(m) && m.id === id && ("result" in m || "error" in m));
  if (!isRecord(reply)) throw new McpError("The server's answer held no reply to Orbit Web's request.");
  if (isRecord(reply.error)) throw new McpError(`The server said: ${String(reply.error.message ?? "an error").slice(0, 300)}`);
  return reply.result;
}

const repliesTo =
  (id: number) =>
  (text: string): boolean =>
    events(text).some((m) => isRecord(m) && m.id === id && ("result" in m || "error" in m));

// One request and its reply (a notification: none).
async function exchange(t: McpTarget, o: McpOptions, session: Session, message: Json, deadline: number): Promise<{ result: unknown; sessionId: string | null }> {
  const res = await post(t, o, session, message, deadline);
  const status = res.statusCode ?? 0;
  if (status < 200 || status > 299) throw refusal(res);
  const sessionId = typeof res.headers["mcp-session-id"] === "string" ? res.headers["mcp-session-id"] : null;
  if (typeof message.id !== "number") {
    res.resume();
    return { result: null, sessionId };
  }
  const type = String(res.headers["content-type"] ?? "").toLowerCase();
  if (type.startsWith("text/event-stream")) return { result: resultOf(events(await read(res, o, deadline, repliesTo(message.id))), message.id), sessionId };
  if (!type.startsWith("application/json")) {
    res.resume();
    throw new McpError(`The server answered ${type || "without a type"}, not an MCP reply.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await read(res, o, deadline));
  } catch (err) {
    if (err instanceof McpError) throw err;
    throw new McpError("The server's reply is not JSON.");
  }
  return { result: resultOf(Array.isArray(parsed) ? parsed : [parsed], message.id), sessionId };
}

// A session's asks: initialized, then whatever the caller asks under its id.
async function inSession<T>(t: McpTarget, o: McpOptions, work: (ask: (method: string, params: Json) => Promise<unknown>) => Promise<T>): Promise<T> {
  const deadline = Date.now() + o.timeoutMs;
  const session: Session = { id: null, version: null };
  let next = 1;
  try {
    const init = await exchange(t, o, session, { jsonrpc: "2.0", id: next++, method: "initialize", params: { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "orbit-web", version: ORBIT_WEB_VERSION } } }, deadline);
    session.id = init.sessionId;
    session.version = isRecord(init.result) && typeof init.result.protocolVersion === "string" ? init.result.protocolVersion : PROTOCOL_VERSION;
    await exchange(t, o, session, { jsonrpc: "2.0", method: "notifications/initialized" }, deadline);
    return await work(async (method, params) => (await exchange(t, o, session, { jsonrpc: "2.0", id: next++, method, params }, deadline)).result);
  } catch (err) {
    if (!(err instanceof McpError)) throw err;
    // Nothing a server says is let carry the credential back out.
    const secret = t.credential?.value ?? "";
    throw new McpError(redactSecrets(secret === "" ? err.message : err.message.split(secret).join("***")));
  }
}

const schemaOf = (v: unknown): Record<string, unknown> => (isRecord(v) && JSON.stringify(v).length <= MAX_SCHEMA ? v : { type: "object" });

function toolOf(v: unknown): McpToolInfo | null {
  if (!isRecord(v) || typeof v.name !== "string" || v.name === "" || v.name.length > 128 || CONTROL.test(v.name)) return null;
  const hint = isRecord(v.annotations) ? v.annotations.readOnlyHint : undefined;
  return { name: v.name, description: typeof v.description === "string" ? v.description.slice(0, 2000) : "", inputSchema: schemaOf(v.inputSchema), readOnly: typeof hint === "boolean" ? hint : null };
}

// The server's tools, every page of them (at most MAX_TOOLS).
export async function listMcpTools(t: McpTarget, o: McpOptions): Promise<McpToolInfo[]> {
  return inSession(t, o, async (ask) => {
    const tools: McpToolInfo[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES && tools.length < MAX_TOOLS; page += 1) {
      const result = await ask("tools/list", cursor === undefined ? {} : { cursor });
      const list = isRecord(result) && Array.isArray(result.tools) ? result.tools : [];
      tools.push(...list.map(toolOf).filter((x): x is McpToolInfo => x !== null));
      cursor = isRecord(result) && typeof result.nextCursor === "string" && result.nextCursor !== "" ? result.nextCursor : undefined;
      if (cursor === undefined) break;
    }
    return tools.slice(0, MAX_TOOLS);
  });
}

export async function callMcpTool(t: McpTarget, name: string, args: Json, o: McpOptions): Promise<McpCallResult> {
  return inSession(t, o, async (ask) => {
    const result = await ask("tools/call", { name, arguments: args });
    if (!isRecord(result)) throw new McpError("The server's reply to the call is not a tool's result.");
    return { content: Array.isArray(result.content) ? result.content : [], ...("structuredContent" in result ? { structuredContent: result.structuredContent } : {}), isError: result.isError === true };
  });
}
