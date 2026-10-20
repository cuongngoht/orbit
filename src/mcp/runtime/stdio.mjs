// MCP over stdio: start the server as a child -- through the Process port's
// `start` (src/process/index.mjs), argv and never a shell, so an argument that
// contains `;` is an argument -- and speak newline-delimited JSON-RPC on its
// stdin and stdout.
//
// Every request has its own deadline. Whatever ends the conversation first --
// an answer, an exit, a spawn error, the deadline, `close()` -- settles every
// request still waiting, exactly once, and `close()` always kills the child: a
// session never leaves a process behind. A request the SERVER sends (roots,
// sampling) is answered "not supported" so it is never left waiting either.
import { invocation } from "../../process/shim.mjs";
import { READ_LIMIT } from "./http.mjs";
import { stopped } from "./stop.mjs";

// spec: { command, args, env: { name: value } }   deps: { start, env, timeoutMs }
export function stdioTransport(spec, deps) {
  const call = invocation(spec.command, deps.env);
  const child = deps.start(call.file, [...call.prefix, ...(spec.args ?? [])], { env: { ...deps.env, ...(spec.env ?? {}) } });
  const wire = { pending: new Map(), failure: null };
  listened(child, spec, wire);
  return { request: (message) => awaited(child, wire, message, deps.timeoutMs), notify: async (message) => send(child, message), close: () => ended(child, wire) };
}

function listened(child, spec, wire) {
  child.on?.("error", (e) => failAll(wire, stopped("unreachable", e?.code === "ENOENT" ? `${spec.command} was not found on this machine` : `${spec.command} could not be started (${e?.code ?? "error"})`)));
  child.on?.("exit", (code) => failAll(wire, stopped("unreachable", `${spec.command} exited (${code}) before it answered`)));
  child.stdin?.on?.("error", () => {});
  lines(child.stdout, (message) => heard(child, wire, message));
}

function awaited(child, wire, message, timeoutMs) {
  if (wire.failure) return Promise.reject(wire.failure);
  const answer = new Promise((resolve, reject) => wire.pending.set(message.id, deadlined(wire, message.id, { resolve, reject }, timeoutMs)));
  send(child, message);
  return answer;
}

function deadlined(wire, id, settle, ms) {
  const timer = setTimeout(() => settled(wire, id, (p) => p.reject(stopped("unreachable", `no answer within ${Math.round(ms / 1000)}s`))), ms);
  return { resolve: (m) => (clearTimeout(timer), settle.resolve(m)), reject: (e) => (clearTimeout(timer), settle.reject(e)) };
}

function settled(wire, id, fn) {
  const waiting = wire.pending.get(id);
  if (!waiting) return;
  wire.pending.delete(id);
  fn(waiting);
}

function heard(child, wire, message) {
  if (message.method !== undefined && message.id !== undefined) return send(child, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "not supported by this client" } });
  if (message.id !== undefined) settled(wire, message.id, (p) => p.resolve(message));
}

function failAll(wire, failure) {
  wire.failure = wire.failure ?? failure;
  for (const id of [...wire.pending.keys()]) settled(wire, id, (p) => p.reject(wire.failure));
}

function ended(child, wire) {
  failAll(wire, stopped("unreachable", "the session was closed"));
  child.kill?.();
}

function send(child, message) {
  child.stdin?.write?.(`${JSON.stringify(message)}\n`);
}

function lines(stream, each) {
  let buffer = "";
  stream?.setEncoding?.("utf8");
  stream?.on?.("data", (chunk) => { buffer = flushed(buffer + chunk, each); });
}

function flushed(text, each) {
  const parts = text.split("\n");
  parts.slice(0, -1).map((l) => parsed(l.trim())).filter((m) => m && typeof m === "object").forEach(each);
  return parts.at(-1).slice(-READ_LIMIT);
}

function parsed(text) {
  try { return JSON.parse(text); }
  catch { return null; }
}
