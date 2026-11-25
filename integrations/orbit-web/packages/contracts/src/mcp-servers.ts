// THE ACCOUNT'S MCP SERVERS: knowledge bases and other remote MCP servers (Streamable HTTP) an account adds, which its
// employees may use -- each turned on per employee on its Access page. Orbit Web is the one that connects, with the
// server's credential kept on its own side: nothing of it enters an employee's sandbox. Only the tools a person allowed
// are offered: one its server marks read-only is allowed when the server is added, any other only once a person checks
// it, and a tool the server adds later only then.
import type { Checked } from "./validate.js";

export const MCP_AUTH_KINDS = ["none", "bearer", "header"] as const;
// none: no credential; bearer: `Authorization: Bearer <token>`; header: the token in a header a person names.
export type McpAuthKind = (typeof MCP_AUTH_KINDS)[number];
export const MCP_AUTH_LABELS: Record<McpAuthKind, string> = { none: "No sign-in", bearer: "Bearer token", header: "Token in a header" };
export const MAX_MCP_SERVERS = 20;
export const MAX_MCP_TOOLS = 200;

export interface McpServerTool {
  name: string;
  description: string;
  // What the server says of it (its readOnlyHint); null: it did not say.
  readOnly: boolean | null;
  allowed: boolean;
  // The name an employee calls it by.
  employeeName: string;
}

export interface McpServerView {
  id: string;
  name: string;
  url: string;
  auth: { kind: McpAuthKind; header: string | null; hasToken: boolean };
  tools: McpServerTool[];
  // When its tools were last read from it, and why that last read failed (null: it did not).
  readAt: string | null;
  readError: string | null;
  createdAt: string;
}

export interface McpServerList {
  servers: McpServerView[];
}

export interface McpAuthInput {
  kind: McpAuthKind;
  header?: string;
  token?: string;
}

export interface AddMcpServerRequest {
  name: string;
  url: string;
  auth: McpAuthInput;
}

export interface UpdateMcpServerRequest {
  name?: string;
  // The tools employees may use (by the server's names); every other one is not offered.
  allowedTools?: string[];
  // A new credential (and how it is sent).
  auth?: McpAuthInput;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
// eslint-disable-next-line no-control-regex -- control characters are what is refused
const CONTROL = /[\u0000-\u001f\u007f]/;
const HEADER = /^[A-Za-z0-9-]{1,64}$/;
// Headers Orbit Web writes itself, or that would change how the request is carried: never a credential's.
const OWN_HEADERS = new Set(["host", "content-type", "content-length", "accept", "accept-encoding", "connection", "transfer-encoding", "te", "upgrade", "cookie", "proxy-authorization", "mcp-session-id", "mcp-protocol-version", "last-event-id"]);

const nameOf = (v: unknown, errors: string[]): string => {
  const name = typeof v === "string" ? v.trim() : "";
  if (name === "" || name.length > 60 || CONTROL.test(name)) errors.push("name must be 1 to 60 characters on one line");
  return name;
};

// What this package reads of a URL (the runtime's own URL, which its type library here does not declare).
interface ParsedUrl {
  protocol: string;
  username: string;
  password: string;
  hash: string;
}
const parseUrl = (raw: string): ParsedUrl => new (globalThis as unknown as { URL: new (input: string) => ParsedUrl }).URL(raw);

const tryParse = (v: unknown): ParsedUrl | null => {
  try {
    return typeof v === "string" && v.length <= 2048 ? parseUrl(v) : null;
  } catch {
    return null;
  }
};

const urlOf = (v: unknown, errors: string[]): ParsedUrl | null => {
  const url = tryParse(v);
  if (url === null || (url.protocol !== "https:" && url.protocol !== "http:")) errors.push("url must be an http or https URL");
  else if (url.username !== "" || url.password !== "") errors.push("url must not carry a user name or password: give the credential as the sign-in");
  else if (url.hash !== "") errors.push("url must not carry a fragment (#)");
  return url;
};

function authOf(v: unknown, errors: string[]): McpAuthInput {
  if (!isRecord(v) || !(MCP_AUTH_KINDS as readonly unknown[]).includes(v.kind)) {
    errors.push(`auth.kind must be one of ${MCP_AUTH_KINDS.join(", ")}`);
    return { kind: "none" };
  }
  const kind = v.kind as McpAuthKind;
  const fields = kind === "none" ? ["kind"] : kind === "bearer" ? ["kind", "token"] : ["kind", "header", "token"];
  for (const k of Object.keys(v)) if (!fields.includes(k)) errors.push(`auth.${k} is not a field of the ${kind} sign-in`);
  if (kind === "none") return { kind };
  const token = v.token;
  if (typeof token !== "string" || token.trim() === "" || token.length > 8192 || CONTROL.test(token)) errors.push("auth.token must be the credential, on one line");
  if (kind === "bearer") return { kind, token: token as string };
  const header = v.header;
  if (typeof header !== "string" || !HEADER.test(header) || OWN_HEADERS.has(header.toLowerCase())) errors.push("auth.header must be a header's name (letters, digits and -) that Orbit Web does not set itself");
  return { kind, header: header as string, token: token as string };
}

// A credential is never sent in the clear.
export const CREDENTIAL_IN_CLEAR = "a server with a credential must be reached over https";
const clearProblem = (url: ParsedUrl | null, auth: McpAuthInput): string | null => (url?.protocol === "http:" && auth.kind !== "none" ? CREDENTIAL_IN_CLEAR : null);

export function checkAddMcpServer(body: unknown): Checked<AddMcpServerRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = Object.keys(body).filter((k) => !["name", "url", "auth"].includes(k)).map((k) => `${k} is not a field of this request`);
  const name = nameOf(body.name, errors);
  const url = urlOf(body.url, errors);
  const auth = authOf(body.auth, errors);
  const clear = clearProblem(url, auth);
  if (clear !== null) errors.push(clear);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { name, url: body.url as string, auth } };
}

export function checkUpdateMcpServer(body: unknown): Checked<UpdateMcpServerRequest> {
  if (!isRecord(body)) return { ok: false, errors: ["the body must be a JSON object"] };
  const errors = Object.keys(body).filter((k) => !["name", "allowedTools", "auth"].includes(k)).map((k) => `${k} is not a field of this request`);
  if (Object.keys(body).length === 0) errors.push("a change names the name, the tools allowed or a new sign-in");
  const value: UpdateMcpServerRequest = {};
  if (body.name !== undefined) value.name = nameOf(body.name, errors);
  if (body.auth !== undefined) value.auth = authOf(body.auth, errors);
  if (body.allowedTools !== undefined) {
    const list = body.allowedTools;
    const fine = Array.isArray(list) && list.length <= MAX_MCP_TOOLS && list.every((t) => typeof t === "string" && t.length > 0 && t.length <= 128 && !CONTROL.test(t)) && new Set(list).size === list.length;
    if (!fine) errors.push(`allowedTools must be a list of at most ${MAX_MCP_TOOLS} tool names, each named once`);
    else value.allowedTools = list as string[];
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value };
}
