// The MCP BROKER's one job: hold a protocol session with one server.
//
//   openSession(spec, deps)  start or reach it, `initialize`, `initialized`
//     .tools()               tools/list -- names, descriptions, input schemas,
//                            annotations, as the server declared them
//     .call(name, args)      tools/call -- the server's result, untouched
//     .close()               end it; a stdio child is killed
//
// A spec is RESOLVED: every secret already a value, every command already a
// path (src/mcp/connect.mjs does that for a managed server, a host adapter for
// its own). This file chooses nothing: no resource, no workflow, no policy --
// src/mcp/invoke.mjs decides whether a call may happen at all, and this only
// carries it. Every failure is an McpStop in Orbit's own words.
import { httpTransport } from "./http.mjs";
import { stdioTransport } from "./stdio.mjs";
import { stopped } from "./stop.mjs";

export const PROTOCOL_VERSION = "2025-06-18";
export const SESSION_TIMEOUT_MS = 15000;
const CLIENT = { name: "orbit", version: "1" };
const TRANSPORTS = { http: httpTransport, stdio: stdioTransport };

// deps: { fetch, start (the Process port's), env, timeoutMs }
export async function openSession(spec, deps) {
  const bound = { timeoutMs: SESSION_TIMEOUT_MS, env: {}, ...deps };
  const make = TRANSPORTS[spec?.transport];
  if (!make) throw stopped("unsupported", `a ${spec?.transport ?? "?"} server cannot be reached from here`);
  return initialised(make(spec, bound), counter());
}

async function initialised(transport, ids) {
  try { return sessionOf(transport, ids, await handshake(transport, ids)); }
  catch (e) { throw closedWith(transport, e); }
}

async function handshake(transport, ids) {
  const init = await asked(transport, ids(), "initialize", { protocolVersion: PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT });
  await transport.notify({ jsonrpc: "2.0", method: "notifications/initialized" });
  return init;
}

function closedWith(transport, error) {
  transport.close();
  return error;
}

const sessionOf = (transport, ids, init) => ({ server: serverOf(init), tools: async () => toolsIn(await asked(transport, ids(), "tools/list", {})), call: (name, args) => asked(transport, ids(), "tools/call", { name, arguments: args ?? {} }), close: () => transport.close() });

async function asked(transport, id, method, params) {
  const message = await transport.request({ jsonrpc: "2.0", id, method, params });
  if (!message) throw stopped("unreachable", `the server gave no answer to ${method}`);
  if (message.error) throw stopped("rpc-error", `the server refused ${method} (JSON-RPC error ${Number(message.error.code) || "?"})`, { code: Number(message.error.code) || null, method });
  return message.result ?? {};
}

const toolsIn = (result) => (Array.isArray(result?.tools) ? result.tools.filter((t) => t && typeof t.name === "string") : []);

const serverOf = (init) => ({ name: String(init?.serverInfo?.name ?? "").slice(0, 128), version: String(init?.serverInfo?.version ?? "").slice(0, 64), protocolVersion: typeof init?.protocolVersion === "string" ? init.protocolVersion : null });

function counter() {
  let n = 0;
  return () => ++n;
}
