// MCP, the parts that talk to a server or a host: the Claude adapter (which
// only ever READS the host's configuration), host-shaped definitions and what
// of them may be shown, and the broker -- the one protocol session every probe
// and every managed call goes through.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { join } from "node:path";
import { createClaudeMcpHost } from "../skills/orbit-learn/hosts/claude-mcp.mjs";
import { definitionProblems, publicView, redactUrl, shownArgs } from "../src/mcp/definition.mjs";
import { MCP_HOST_METHODS, mcpHost } from "../src/mcp/port.mjs";
import { createProbe } from "../src/mcp/probe.mjs";
import { openSession } from "../src/mcp/runtime/session.mjs";
import { McpStop } from "../src/mcp/runtime/stop.mjs";
import { createProcess } from "../src/process/index.mjs";
import { fakeMcpHost } from "./fakes/mcp-host.mjs";

const SECRET = "Bearer ghp_super_secret_value_123";
const HOME = "/home/u";
const PROJECT = "/work/app";

// A Claude Code home as files: every scope, a plugin, and a secret in each.
function claudeFiles() {
  return {
    [join(HOME, ".claude.json")]: JSON.stringify({
      mcpServers: { github: { type: "http", url: "https://api.githubcopilot.com/mcp/", headers: { Authorization: SECRET } }, shadowed: { command: "user-copy" } },
      projects: { [PROJECT]: { mcpServers: { shadowed: { command: "local-copy", args: ["--api-key", "sk-local-123"], env: { API_TOKEN: "tok-456" } } }, disabledMcpServers: ["github"], enabledMcpjsonServers: ["approved"] } },
    }),
    [join(PROJECT, ".mcp.json")]: JSON.stringify({ mcpServers: { approved: { type: "http", url: "https://docs.example/mcp?key=abc123" }, waiting: { command: "npx", args: ["-y", "some-mcp"] } } }),
    [join(HOME, ".claude", "settings.json")]: JSON.stringify({ enabledPlugins: { "docs@market": true, "off@market": false } }),
    [join(PROJECT, ".claude", "settings.local.json")]: JSON.stringify({ enabledPlugins: { "other@market": false } }),
    [join(HOME, ".claude", "plugins", "installed_plugins.json")]: JSON.stringify({ version: 2, plugins: { "docs@market": [{ scope: "user", installPath: "/cache/docs/1.0" }], "off@market": [{ scope: "user", installPath: "/cache/off/1.0" }] } }),
    [join("/cache/docs/1.0", ".mcp.json")]: JSON.stringify({ mcpServers: { "microsoft-learn": { type: "http", url: "https://learn.microsoft.com/api/mcp" } } }),
    [join("/cache/off/1.0", ".mcp.json")]: JSON.stringify({ mcpServers: { hidden: { command: "x" } } }),
  };
}

function claudeHost(files = claudeFiles(), env = {}) {
  const probed = [];
  const writes = [];
  const io = { read: (p) => files[p] ?? null, exists: (p) => p in files, write: (...a) => writes.push(a) };
  const host = createClaudeMcpHost({ env, home: HOME, projectRoot: PROJECT, io, probe: async (def) => (probed.push(def), { status: "connected", checkedAt: "t", reason: null, tools: [] }) });
  return { host, probed, writes };
}

test("the Claude adapter is a whole MCP host port -- and the port can only observe", () => {
  assert.deepEqual(MCP_HOST_METHODS, ["listServers", "getServer", "testServer"]);
  assert.equal(mcpHost(claudeHost().host).name, "claude");
  assert.throws(() => mcpHost({ name: "half", listServers: () => [] }), /getServer/);
  assert.equal(MCP_HOST_METHODS.every((m) => typeof fakeMcpHost()[m] === "function"), true, "the fake is a whole port too");
  for (const write of ["addServer", "updateServer", "removeServer"]) assert.equal(claudeHost().host[write], undefined, `${write}: a host's configuration is never written`);
});

test("Claude discovery reads every scope, lets local shadow user, and gives each server its host state", () => {
  const byId = Object.fromEntries(claudeHost().host.listServers().map((s) => [s.id, s]));
  assert.deepEqual(Object.keys(byId).sort(), ["approved", "github", "plugin:docs:microsoft-learn", "shadowed", "waiting"]);
  assert.equal(byId.shadowed.scope, "local");
  assert.equal(byId.shadowed.command, "local-copy");
  assert.equal(byId.github.hostEnabled, false, "switched off with /mcp for this project");
  assert.equal(byId.approved.status, "unknown", "approved, and configured is not connected");
  assert.equal(byId.waiting.status, "pending-approval");
  assert.deepEqual([byId["plugin:docs:microsoft-learn"].scope, byId["plugin:docs:microsoft-learn"].readOnly], ["plugin", true]);
  assert.equal(byId.github.transport, "http");
  assert.equal(byId.shadowed.transport, "stdio");
});

test("nothing the adapter answers carries a secret: header and env values, secret args and URL query values are gone", () => {
  const said = JSON.stringify(claudeHost().host.listServers());
  for (const secret of ["ghp_super_secret", "sk-local-123", "tok-456", "abc123"]) assert.equal(said.includes(secret), false, secret);
  const byId = Object.fromEntries(claudeHost().host.listServers().map((s) => [s.id, s]));
  assert.deepEqual(byId.github.headers, [{ name: "Authorization", configured: true }]);
  assert.deepEqual(byId.shadowed.env, [{ name: "API_TOKEN", configured: true }]);
  assert.deepEqual(byId.shadowed.args, ["--api-key", "[redacted]"]);
  assert.equal(byId.approved.url, "https://docs.example/mcp?key=…");
});

test("a CLAUDE_CONFIG_DIR relocates the config the adapter reads", () => {
  const files = { [join("/cfg", ".claude.json")]: JSON.stringify({ mcpServers: { moved: { command: "m" } } }) };
  assert.deepEqual(claudeHost(files, { CLAUDE_CONFIG_DIR: "/cfg" }).host.listServers().map((s) => s.id), ["moved"]);
});

test("testing a host server probes it AS THE HOST CONFIGURED IT, inside the adapter, and writes nothing anywhere", async () => {
  const { host, probed, writes } = claudeHost();
  assert.equal((await host.testServer("github")).status, "connected");
  assert.deepEqual([probed[0].url, probed[0].headers], ["https://api.githubcopilot.com/mcp/", [{ name: "Authorization", value: SECRET }]], "the probe needs the value; it stays in this process");
  await assert.rejects(host.testServer("nope"), /no MCP server named nope/);
  assert.deepEqual(writes, []);
});

// ---- definitions -------------------------------------------------------------------

test("custom HTTP and stdio host-shaped definitions are validated, and every problem is said at once", () => {
  assert.deepEqual(definitionProblems({ name: "docs", transport: "http", url: "https://d.example/mcp", headers: [{ name: "Authorization", value: "x" }] }), []);
  assert.deepEqual(definitionProblems({ name: "local", transport: "stdio", command: "npx", args: ["-y", "pkg"], env: [{ name: "API_KEY", value: "v" }] }), []);
  assert.equal(definitionProblems({ name: "../x", transport: "ftp", url: "nope", headers: [{ name: "bad header" }] }).length, 3, "name, transport, header -- a url is only asked of http");
  assert.match(definitionProblems({ name: "s", transport: "stdio" }).join(), /needs a command/);
  assert.match(definitionProblems({ name: "h", transport: "http", url: "file:///etc/passwd" }).join(), /http:\/\/ or https:\/\//);
  assert.deepEqual(definitionProblems(null), ["the definition is an object"]);
});

test("a definition's public view names secrets and never holds them", () => {
  const view = publicView({ name: "d", transport: "http", url: "https://u:p@d.example/mcp?token=zzz&x=1", headers: [{ name: "Authorization", value: "Bearer yyy" }, { name: "X-Empty" }] });
  assert.equal(JSON.stringify(view).includes("yyy") || JSON.stringify(view).includes("zzz") || JSON.stringify(view).includes("u:p"), false);
  assert.deepEqual(view.headers, [{ name: "Authorization", configured: true }, { name: "X-Empty", configured: false }]);
  assert.equal(redactUrl("https://u:p@d.example/mcp?token=zzz&x=1"), "https://d.example/mcp?token=…&x=…");
  assert.deepEqual(shownArgs(["--token=abc", "--api-key", "k", "plain"]), ["--token [redacted]", "--api-key", "[redacted]", "plain"]);
});

// ---- the broker, over HTTP ------------------------------------------------------------

const response = (status, body, headers = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (k) => ({ "content-type": "application/json", ...headers })[k.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), body: { cancel: async () => {}, getReader: () => reader(body) } });

function reader(text) {
  const chunks = [Buffer.from(String(text))];
  return { read: async () => (chunks.length ? { done: false, value: chunks.shift() } : { done: true }), cancel: async () => {} };
}

const probeWith = (fetch) => createProbe({ fetch, start: () => { throw new Error("no process in this test"); }, now: () => new Date("2026-09-23T10:00:00.000Z") });

test("an HTTP probe does initialize, initialized, tools/list -- JSON or an event stream -- and keeps names only", async () => {
  const sent = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    sent.push({ method: body.method, session: init.headers["mcp-session-id"], auth: init.headers.Authorization });
    if (body.method === "initialize") return response(200, { jsonrpc: "2.0", id: 1, result: {} }, { "mcp-session-id": "s-1" });
    if (!body.id) return response(202, "");
    return response(200, `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "search", description: "Search docs\nwith detail" }], secretBody: "keep-out" } })}\n\n`, { "content-type": "text/event-stream" });
  };
  const verdict = await probeWith(fetch)({ transport: "http", url: "https://d.example/mcp", headers: [{ name: "Authorization", value: "Bearer abc" }] });
  assert.deepEqual(sent.map((s) => s.method), ["initialize", "notifications/initialized", "tools/list"]);
  assert.deepEqual([sent[1].session, sent[2].session, sent[0].auth], ["s-1", "s-1", "Bearer abc"]);
  assert.deepEqual(verdict, { status: "connected", checkedAt: "2026-09-23T10:00:00.000Z", reason: null, tools: [{ name: "search", description: "Search docs" }] });
});

test("401 is needs-auth, a refusal or a dead server is failed -- with Orbit's reason, never the server's body", async () => {
  assert.equal((await probeWith(async () => response(401, "Unauthorized: token abc"))({ transport: "http", url: "https://d/mcp" })).status, "needs-auth");
  const refused = await probeWith(async () => response(200, { jsonrpc: "2.0", id: 1, error: { code: -32600, message: "secret detail" } }))({ transport: "http", url: "https://d/mcp" });
  assert.deepEqual([refused.status, refused.reason.includes("secret detail")], ["failed", false]);
  const down = await probeWith(async () => { throw new TypeError("fetch failed"); })({ transport: "http", url: "https://d/mcp" });
  assert.equal(down.status, "failed");
  assert.equal((await probeWith(async () => response(200, ""))({ transport: "sse", url: "https://d/mcp" })).status, "unknown");
});

test("a broker session calls a tool and hands back the server's result; a refused call is an rpc-error the caller types", async () => {
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    if (body.method === "initialize") return response(200, { jsonrpc: "2.0", id: body.id, result: { serverInfo: { name: "docs", version: "2.1" }, protocolVersion: "2025-06-18" } });
    if (!body.id) return response(202, "");
    if (body.method === "tools/list") return response(200, { jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "search", annotations: { readOnlyHint: true } }, { bad: 1 }] } });
    if (body.params.name === "search") return response(200, { jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: `found ${body.params.arguments.q}` }] } });
    return response(200, { jsonrpc: "2.0", id: body.id, error: { code: -32602, message: "unknown tool, also secret" } });
  };
  const session = await openSession({ transport: "http", url: "https://d/mcp", headers: {} }, { fetch, timeoutMs: 1000 });
  assert.deepEqual(session.server, { name: "docs", version: "2.1", protocolVersion: "2025-06-18" });
  assert.deepEqual((await session.tools()).map((t) => t.name), ["search"], "a tool with no name is not a tool");
  assert.deepEqual(await session.call("search", { q: "graph" }), { content: [{ type: "text", text: "found graph" }] });
  await assert.rejects(session.call("drop", {}), (e) => e instanceof McpStop && e.kind === "rpc-error" && e.method === "tools/call" && !e.message.includes("secret"));
  session.close();
});

// ---- the broker, over stdio -----------------------------------------------------------

class FakeChild extends EventEmitter {
  constructor(script) {
    super();
    this.stdout = new EventEmitter();
    this.stdout.setEncoding = () => {};
    this.killed = false;
    this.written = [];
    this.stdin = { on: () => {}, write: (line) => (this.written.push(JSON.parse(line)), script(JSON.parse(line), this)) };
  }
  kill() {
    this.killed = true;
  }
  say(message) {
    this.stdout.emit("data", `${JSON.stringify(message)}\n`);
  }
}

test("a stdio probe speaks newline-delimited JSON-RPC, with argv, and never leaves the child running", async () => {
  let child;
  let spawned;
  const start = (file, args, opts) => {
    spawned = { file, args, env: opts.env };
    child = new FakeChild((m, c) => (m.id === 1 ? c.say({ jsonrpc: "2.0", id: 1, result: {} }) : m.id === 2 ? c.say({ jsonrpc: "2.0", id: 2, result: { tools: [{ name: "echo" }] } }) : null));
    return child;
  };
  const verdict = await createProbe({ fetch: null, start, env: { PATH: "/bin" }, now: () => new Date(0) })({ transport: "stdio", command: "/usr/local/bin/my-mcp", args: ["--flag", "a;b"], env: [{ name: "API_KEY", value: "k" }] });
  assert.deepEqual([verdict.status, verdict.tools], ["connected", [{ name: "echo", description: "" }]]);
  assert.deepEqual([spawned.file, spawned.args, spawned.env.API_KEY, spawned.env.PATH], ["/usr/local/bin/my-mcp", ["--flag", "a;b"], "k", "/bin"]);
  assert.equal(child.killed, true);
});

test("a stdio server that is not there, or never answers, is failed within the deadline -- and killed", async () => {
  const missing = () => {
    const c = new FakeChild(() => {});
    queueMicrotask(() => c.emit("error", { code: "ENOENT" }));
    return c;
  };
  assert.match((await createProbe({ start: missing, now: () => new Date(0) })({ transport: "stdio", command: "nope" })).reason, /not found/);
  let silent;
  const mute = () => (silent = new FakeChild(() => {}));
  const verdict = await createProbe({ start: mute, timeoutMs: 20, now: () => new Date(0) })({ transport: "stdio", command: "mute" });
  assert.deepEqual([verdict.status, /no answer/.test(verdict.reason), silent.killed], ["failed", true, true]);
});

test("a request the SERVER sends is answered 'not supported', so it never waits; an exit mid-call ends the call", async () => {
  let child;
  const start = () => (child = new FakeChild((m, c) => {
    if (m.id === 1) return c.say({ jsonrpc: "2.0", id: 1, result: {} });
    if (m.method === "tools/list") return (c.say({ jsonrpc: "2.0", id: 99, method: "roots/list" }), c.say({ jsonrpc: "2.0", id: m.id, result: { tools: [] } }));
    if (m.method === "tools/call") queueMicrotask(() => c.emit("exit", 1));
  }));
  const session = await openSession({ transport: "stdio", command: "srv", args: [] }, { start, timeoutMs: 1000 });
  assert.deepEqual(await session.tools(), []);
  assert.deepEqual(child.written.find((m) => m.id === 99)?.error?.code, -32601);
  await assert.rejects(session.call("x", {}), (e) => e instanceof McpStop && e.kind === "unreachable" && /exited \(1\)/.test(e.message));
  session.close();
  assert.equal(child.killed, true);
});

test("the Process port starts a child with argv and shell:false, the environment it is given and nothing else", () => {
  const seen = [];
  const port = createProcess({ launch: (file, args, opts) => (seen.push({ file, args, opts }), { pid: 1 }) });
  port.start("node", ["server.js", "a;rm -rf /"], { env: { ONLY: "this" } });
  assert.deepEqual([seen[0].file, seen[0].args, seen[0].opts.shell, seen[0].opts.env, seen[0].opts.windowsHide], ["node", ["server.js", "a;rm -rf /"], false, { ONLY: "this" }, true]);
  assert.throws(() => port.start("node", "server.js"), /argv array/);
});
