// A Orbit-managed MCP server the real broker can reach, with nothing behind it but a function:
// the state, the policy and the activity log are the real ones over a temp directory, and the
// HTTP server on the other end is made up. `machine` hands back everything a test needs to add,
// disable or approve the server and to build the broker's own context.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFile, readCatalog } from "../../src/catalog.mjs";
import { activityLog } from "../../src/mcp/activity.mjs";
import { mcpCatalog } from "../../src/mcp/catalog.mjs";
import { baseEnv } from "../../src/process/env.mjs";
import { effectiveMcp } from "../../src/mcp/effective.mjs";
import { addCustom } from "../../src/mcp/manage.mjs";
import { envSecrets } from "../../src/secrets.mjs";
import { createMcpState } from "../../src/mcp/state.mjs";
import { stateRooms } from "../../src/store/control.mjs";
import { realIo } from "../../src/store/io.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const CATALOG = mcpCatalog(readCatalog(realIo(), catalogFile(REPO, "mcp")));
const AT = "2026-09-24T08:00:00.000Z";

const response = (body) => ({ status: 200, ok: true, headers: { get: (k) => ({ "content-type": "application/json" })[k.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), body: { cancel: async () => {} } });

// A server that lists a read-only `search` tool and answers it with `reply`, counting what it was asked.
export function fakeServer({ reply }) {
  const asked = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push(body.method);
    if (!body.id) return response("");
    if (body.method === "initialize") return response({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "tools/list") return response({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "search", annotations: { readOnlyHint: true } }] } });
    return response({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: reply }] } });
  };
  return { fetch, asked };
}

export function managedMcp(t, { server, provides = ["documentation.search"], env = { CORP_AUTH: "Bearer sk-live-e2e-0001" } }) {
  const base = mkdtempSync(join(tmpdir(), "orbit-managed-mcp-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rooms = stateRooms(base);
  const io = realIo();
  const state = createMcpState(rooms, io);
  const manage = { state, catalog: CATALOG, now: () => AT };
  addCustom(manage, { id: "corp", transport: "http", url: "https://corp.example/mcp", requiredHeaders: [{ name: "Authorization", env: "CORP_AUTH" }], provides });
  const activity = activityLog(rooms, io);
  const entries = () => effectiveMcp({ catalog: CATALOG, state: state.all(), receipts: [], secrets: envSecrets(env), now: Date.parse(AT) + 1000, platform: "linux", arch: "x64" });
  const context = () => ({ entries: entries(), records: state.read("managed").servers, connect: { secrets: envSecrets(env), rooms, receipts: [], catalog: CATALOG, exists: () => false, platform: "linux", arch: "x64", node: "/node" }, session: { fetch: server.fetch, env: baseEnv(env), timeoutMs: 1000 }, activity, now: () => Date.now() });
  return { manage, state, server, entries, context, rooms, io, activity };
}
