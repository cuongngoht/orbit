// THE ORBIT TOOL BRIDGE: the one MCP server an employee's model plane is given (`orbit_tools`). It speaks MCP over stdio
// (newline-delimited JSON-RPC 2.0) to the AI CLI, and forwards `tools/list` and `tools/call` to Orbit Web's tool
// endpoint with the run's own token -- where each tool runs in the attempt's sandbox (the tool plane). It reads and
// writes nothing itself, holds nothing but the run's token, and carries no tool of its own.
//
//   ORBIT_TOOL_URL    the tool endpoint (http://<orbit-web>/api/runtime/tools)
//   ORBIT_RUN_TOKEN   the run's token (sent as x-orbit-run-token)
import { createInterface } from "node:readline";

const RUN_TOKEN_HEADER = "x-orbit-run-token";
const PROTOCOL = "2025-06-18";

type Json = Record<string, unknown>;

const url = process.env.ORBIT_TOOL_URL ?? "";
const token = process.env.ORBIT_RUN_TOKEN ?? "";

function send(message: Json): void {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

async function post(path: string, body: unknown): Promise<{ status: number; body: Json }> {
  const res = await fetch(`${url}/${path}`, { method: "POST", headers: { "content-type": "application/json", [RUN_TOKEN_HEADER]: token, "x-orbit-web": "1" }, body: JSON.stringify(body) });
  const text = await res.text();
  let parsed: Json = {};
  try {
    parsed = text.length > 0 ? (JSON.parse(text) as Json) : {};
  } catch {
    parsed = { error: { message: text.slice(0, 500) } };
  }
  return { status: res.status, body: parsed };
}

async function handle(m: Json): Promise<Json | null> {
  const id = m.id;
  const method = typeof m.method === "string" ? m.method : "";
  if (id === undefined) return null;
  if (method === "initialize") return { jsonrpc: "2.0", id, result: { protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: { name: "orbit_tools", version: "0.8.0" } } };
  if (method === "ping") return { jsonrpc: "2.0", id, result: {} };
  if (method === "tools/list") {
    const r = await post("list", {});
    if (r.status !== 200) return { jsonrpc: "2.0", id, error: { code: -32000, message: `Orbit Web refused the tool list (${r.status})` } };
    return { jsonrpc: "2.0", id, result: { tools: r.body.tools ?? [] } };
  }
  if (method === "tools/call") {
    const params = (m.params ?? {}) as Json;
    const r = await post("call", { name: params.name, arguments: params.arguments ?? {} });
    if (r.status !== 200) {
      const err = (r.body.error ?? {}) as Json;
      return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(err.message ?? `refused (${r.status})`) }], isError: true } };
    }
    return { jsonrpc: "2.0", id, result: { content: [{ type: "text", text: String(r.body.text ?? "") }], isError: r.body.isError === true } };
  }
  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (line.trim().length === 0) return;
  let message: Json;
  try {
    message = JSON.parse(line) as Json;
  } catch {
    return;
  }
  void handle(message)
    .then((reply) => reply !== null && send(reply))
    .catch((err: unknown) => send({ jsonrpc: "2.0", id: message.id ?? null, error: { code: -32603, message: err instanceof Error ? err.message : String(err) } }));
});
lines.on("close", () => process.exit(0));
