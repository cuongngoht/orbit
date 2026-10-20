// MCP over the streamable HTTP transport: every message is a POST, an answer
// is JSON or an event stream, and a stream is read only until the one message
// asked for (or READ_LIMIT). The session id a server hands out on `initialize`
// rides on every later request.
//
// `fetch` is handed in -- the suite drives this with no network -- and every
// request has its own deadline. Header VALUES (a secret, often) are sent and
// never repeated: no reason here quotes a header, a body or a server's text.
import { scrub } from "../../scrub.mjs";
import { stopped } from "./stop.mjs";

export const READ_LIMIT = 2 * 1024 * 1024;

// spec: { url, headers: { name: value } }   deps: { fetch, timeoutMs }
export function httpTransport(spec, deps) {
  const at = { session: null };
  const headers = () => ({ "content-type": "application/json", accept: "application/json, text/event-stream", ...(spec.headers ?? {}), ...(at.session ? { "mcp-session-id": at.session } : {}) });
  return { request: (message) => requested(spec.url, headers(), message, deps, at), notify: (message) => notified(spec.url, headers(), message, deps), close: () => {} };
}

async function requested(url, headers, message, deps, at) {
  const res = await posted(url, headers, message, deps);
  at.session = at.session ?? res.headers.get("mcp-session-id");
  return messageOf(res, message.id);
}

async function notified(url, headers, message, deps) {
  const res = await posted(url, headers, message, deps);
  await res.body?.cancel?.().catch(() => {});
}

async function posted(url, headers, message, deps) {
  const res = await reached(() => deps.fetch(url, { method: "POST", headers, body: JSON.stringify(message), signal: AbortSignal.timeout(deps.timeoutMs) }), deps);
  if (res.status === 401 || res.status === 403) throw stopped("needs-auth", `the server answered ${res.status}: it needs credentials, or the ones configured were refused`);
  if (!res.ok) throw stopped("unreachable", `the server answered HTTP ${res.status}`);
  return res;
}

async function reached(send, deps) {
  try { return await send(); }
  catch (e) { throw stopped("unreachable", /abort|timeout/i.test(String(e?.name)) ? `no answer within ${Math.round(deps.timeoutMs / 1000)}s` : `the server could not be reached (${scrub(e?.name ?? "error")})`); }
}

async function messageOf(res, id) {
  if (String(res.headers.get("content-type") ?? "").includes("text/event-stream")) return streamed(res.body.getReader(), new TextDecoder(), "", id);
  return oneOf(parsed(await res.text()), id);
}

const oneOf = (value, id) => [value].flat().find((m) => m?.id === id) ?? null;

async function streamed(reader, decoder, seen, id) {
  const { done, value } = await reader.read();
  const text = seen + (value ? decoder.decode(value, { stream: true }) : "");
  const found = inEvents(text, id);
  if (found || done || text.length > READ_LIMIT) return closed(reader, found);
  return streamed(reader, decoder, text, id);
}

async function closed(reader, found) {
  await reader.cancel().catch(() => {});
  return found;
}

const inEvents = (text, id) => text.split(/\r?\n/).filter((l) => l.startsWith("data:")).map((l) => oneOf(parsed(l.slice(5).trim()), id)).find(Boolean) ?? null;

function parsed(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}
