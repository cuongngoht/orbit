// Every call to a Orbit-managed MCP server goes through ONE ordered table of
// gates, each with its own typed stop -- and only then is anything reached.
// What happened is one activity line: never the arguments, never the result,
// never a secret.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { activityLog, recentActivity } from "../src/mcp/activity.mjs";
import { mcpCatalog } from "../src/mcp/catalog.mjs";
import { baseEnv } from "../src/process/env.mjs";
import { effectiveMcp } from "../src/mcp/effective.mjs";
import { invokeMcp, RESULT_LIMIT } from "../src/mcp/invoke.mjs";
import { addCustom, addFromCatalog, approve, setEnabled, setPolicy, setSelection } from "../src/mcp/manage.mjs";
import { envSecrets } from "../src/secrets.mjs";
import { createMcpState, observedAs } from "../src/mcp/state.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = mcpCatalog(readCatalog(realIo(), catalogFile(REPO, "mcp")));
const AT = "2026-09-24T08:00:00.000Z";
const SECRET = "Bearer sk-live-invoke-7777";

const response = (body) => ({ status: 200, ok: true, headers: { get: (k) => ({ "content-type": "application/json" })[k.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), body: { cancel: async () => {} } });

// A server over HTTP, in memory: what it was asked, and a tool list with one
// read-only tool and one that does not vouch for itself.
function fakeServer({ callError = null, down = false, big = false } = {}) {
  const asked = [];
  const fetch = async (url, init) => {
    if (down) throw new TypeError("fetch failed");
    const body = JSON.parse(init.body);
    asked.push({ method: body.method, auth: init.headers.Authorization, params: body.params });
    if (!body.id) return response("");
    if (body.method === "initialize") return response({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "tools/list") return response({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "search", annotations: { readOnlyHint: true } }, { name: "publish" }] } });
    if (callError) return response({ jsonrpc: "2.0", id: body.id, error: { code: callError, message: "server secret detail" } });
    return response({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: big ? "x".repeat(RESULT_LIMIT + 10) : `results for ${body.params.arguments.q}` }] } });
  };
  return { fetch, asked };
}

function world(t, server = fakeServer(), env = { CORP_AUTH: SECRET }) {
  const base = mkdtempSync(join(tmpdir(), "orbit-invoke-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rooms = stateRooms(base);
  const io = realIo();
  const state = createMcpState(rooms, io);
  const manage = { state, catalog: CATALOG, now: () => AT };
  addCustom(manage, { id: "corp", transport: "http", url: "https://corp.example/mcp", requiredHeaders: [{ name: "Authorization", env: "CORP_AUTH" }], provides: ["documentation.search", "documentation.write"] });
  const activity = activityLog(rooms, io);
  const ctxOf = (over = {}) => ({ entries: effectiveMcp({ catalog: CATALOG, state: state.all(), receipts: [], secrets: envSecrets(over.env ?? env), now: Date.parse(AT) + 1000, platform: "linux", arch: "x64" }), records: state.read("managed").servers, connect: { secrets: envSecrets(over.env ?? env), rooms, receipts: [], catalog: CATALOG, exists: () => false, platform: "linux", arch: "x64", node: "/node" }, session: { fetch: server.fetch, start: over.start, env: baseEnv(over.env ?? env), timeoutMs: over.timeoutMs ?? 1000 }, activity, now: () => Date.now() });
  return { base, rooms, io, state, manage, server, activity, ctxOf, call: (ask, over) => invokeMcp(ctxOf(over), ask) };
}

const lines = (w) => recentActivity(w.io, w.rooms);

test("a call that passes every gate reaches the server once, returns its result, and leaves two activity lines with no arguments in them", async (t) => {
  const w = world(t);
  const answer = await w.call({ id: "corp", tool: "search", args: { q: "graph webhooks" }, capability: "documentation.search", workflow: "orbit-develop" });
  assert.deepEqual([answer.resource, answer.tool, answer.operation, answer.result.content[0].text], ["managed:corp", "search", "read", "results for graph webhooks"]);
  assert.deepEqual(w.server.asked.map((a) => a.method), ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
  assert.equal(w.server.asked[0].auth, SECRET, "the secret reached the server");
  assert.deepEqual(lines(w).map((l) => l.kind).sort(), ["mcp-invoked", "mcp-started"]);
  const text = readFileSync(w.activity.file, "utf8");
  for (const leak of ["graph webhooks", "sk-live-invoke", "results for"]) assert.equal(text.includes(leak), false, `${leak} reached the activity log`);
});

test("an EXTERNAL server is never called, whatever its name; an unknown one neither -- Refused, and nothing is reached", async (t) => {
  const w = world(t);
  w.state.change("external", (doc) => observedAs(doc, "claude", [{ id: "hosted", name: "hosted", host: "claude", transport: "http", hostEnabled: true, status: "unknown" }], AT));
  await assert.rejects(w.call({ id: "hosted", tool: "search" }), (e) => e instanceof Refused && /only configured in the host/.test(e.message));
  await assert.rejects(w.call({ id: "nobody", tool: "search" }), (e) => e instanceof Refused && /no Orbit-managed MCP server named nobody/.test(e.message));
  assert.deepEqual(w.server.asked, []);
  assert.deepEqual(lines(w).map((l) => [l.kind, l.outcome]), [["mcp-blocked", "resource"], ["mcp-blocked", "resource"]]);
});

test("disabled, a malformed request, a capability it does not provide: each Refused before anything is reached", async (t) => {
  const w = world(t);
  await assert.rejects(w.call({ id: "corp", tool: "search", capability: "repository.write" }), /does not provide repository\.write/);
  await assert.rejects(w.call({ id: "corp", tool: "bad tool name!" }), /name the tool/);
  await assert.rejects(w.call({ id: "corp", tool: "search", args: ["not", "an", "object"] }), /one JSON object/);
  await assert.rejects(w.call({ id: "corp", tool: "search", args: { blob: "x".repeat(300 * 1024) } }), /larger than/);
  setEnabled(w.manage, "corp", false);
  await assert.rejects(w.call({ id: "corp", tool: "search" }), (e) => e instanceof Refused && /disabled in Orbit/.test(e.message));
  assert.deepEqual(w.server.asked, []);
});

test("POLICY: deny is Refused before connecting; approval needs a person's grant from Control, which then lets it through", async (t) => {
  const w = world(t);
  setPolicy(w.manage, "corp", { capabilities: { "documentation.search": "deny" } });
  await assert.rejects(w.call({ id: "corp", tool: "search", capability: "documentation.search" }), (e) => e instanceof Refused && /policy denies corp for documentation\.search/.test(e.message));
  setPolicy(w.manage, "corp", { capabilities: { "documentation.search": "approval" } });
  await assert.rejects(w.call({ id: "corp", tool: "search", capability: "documentation.search" }), /needs a person's approval first: approve it in Orbit Control/);
  assert.deepEqual(w.server.asked, [], "nothing reached while waiting for approval");
  approve(w.manage, "corp", 30);
  assert.equal((await w.call({ id: "corp", tool: "search", args: { q: "x" }, capability: "documentation.search" })).tool, "search");
});

test("the approval SELECTION mode asks for approval whatever the policy says; a workflow exception is the most specific rule", async (t) => {
  const w = world(t);
  setSelection(w.manage, "corp", "approval");
  await assert.rejects(w.call({ id: "corp", tool: "search", capability: "documentation.search" }), /approval first/);
  setSelection(w.manage, "corp", "automatic");
  w.state.change("policies", (doc) => ({ ...doc, workflows: { "orbit-code-review": { "documentation.search": "deny" } } }));
  await assert.rejects(w.call({ id: "corp", tool: "search", capability: "documentation.search", workflow: "orbit-code-review" }), /policy denies corp for documentation\.search in orbit-code-review/);
  assert.equal((await w.call({ id: "corp", tool: "search", args: { q: "x" }, capability: "documentation.search", workflow: "orbit-develop" })).tool, "search");
});

test("a call that does not say what it is for is held to the STRICTEST verdict over everything the server provides", async (t) => {
  const w = world(t);
  setPolicy(w.manage, "corp", { capabilities: { "documentation.write": "approval" } });
  await assert.rejects(w.call({ id: "corp", tool: "search" }), /approval first/);
  assert.equal((await w.call({ id: "corp", tool: "search", args: { q: "x" }, capability: "documentation.search" })).tool, "search", "naming the capability narrows it");
});

test("OPERATION rules come from what the server says a tool IS: a tool that does not vouch for itself is a write", async (t) => {
  const w = world(t);
  setPolicy(w.manage, "corp", { operations: { write: "deny" } });
  assert.equal((await w.call({ id: "corp", tool: "search", args: { q: "x" }, capability: "documentation.search" })).operation, "read");
  await assert.rejects(w.call({ id: "corp", tool: "publish", args: {}, capability: "documentation.search" }), (e) => e instanceof Refused && /denies a write tool \(publish\)/.test(e.message));
  assert.equal(w.server.asked.filter((a) => a.method === "tools/call").length, 1, "the write was never sent");
  await assert.rejects(w.call({ id: "corp", tool: "nope", capability: "documentation.search" }), /offers no tool named nope/);
});

test("a secret that is not set is BLOCKED before connecting: the machine is not ready, nobody asked for anything wrong", async (t) => {
  const w = world(t);
  await assert.rejects(w.call({ id: "corp", tool: "search" }, { env: {} }), (e) => e instanceof Blocked && /CORP_AUTH is not set/.test(e.message));
  assert.deepEqual(w.server.asked, []);
});

test("the server refusing the call is Refused; a server that is down is Blocked -- and neither repeats the server's text", async (t) => {
  const refusing = world(t, fakeServer({ callError: -32602 }));
  await assert.rejects(refusing.call({ id: "corp", tool: "search", args: {}, capability: "documentation.search" }), (e) => e instanceof Refused && /refused tools\/call/.test(e.message) && !e.message.includes("secret detail"));
  const down = world(t, fakeServer({ down: true }));
  await assert.rejects(down.call({ id: "corp", tool: "search", capability: "documentation.search" }), (e) => e instanceof Blocked && /could not be reached/.test(e.message));
  assert.equal(lines(down).find((l) => l.kind === "mcp-failed").outcome, "blocked");
});

test("a result larger than the limit is cut, and says so", async (t) => {
  const w = world(t, fakeServer({ big: true }));
  const answer = await w.call({ id: "corp", tool: "search", args: { q: "x" }, capability: "documentation.search" });
  assert.equal(answer.result.truncated, true);
  assert.ok(JSON.stringify(answer.result).length < RESULT_LIMIT + 500);
});

test("a stdio server that never answers is Blocked within the deadline, and the child is killed", async (t) => {
  const w = world(t);
  addCustom(w.manage, { id: "local", transport: "stdio", command: "local-mcp", args: ["--stdio"], provides: ["documentation.search"] });
  let child;
  const start = (file, args, opts) => {
    child = Object.assign(new EventEmitter(), { stdout: Object.assign(new EventEmitter(), { setEncoding: () => {} }), stdin: { on: () => {}, write: () => {} }, killed: false, kill() { this.killed = true; }, file, args, env: opts.env });
    return child;
  };
  await assert.rejects(w.call({ id: "local", tool: "search" }, { start, timeoutMs: 20 }), (e) => e instanceof Blocked && /no answer within/.test(e.message));
  assert.deepEqual([child.file, child.args, child.killed], ["local-mcp", ["--stdio"], true]);
  assert.equal("CORP_AUTH" in child.env, false, "another server's secret never reaches this child");
});

test("the activity log is fail-open: a store that cannot be written costs the line, never the call", async (t) => {
  const w = world(t);
  const broken = { file: "/dev/null/nope", record: activityLog({ activity: "/dev/null/nope" }, { ...realIo(), append: () => { throw new Error("read-only"); } }).record };
  const answer = await invokeMcp({ ...w.ctxOf(), activity: broken }, { id: "corp", tool: "search", args: { q: "x" }, capability: "documentation.search" });
  assert.equal(answer.tool, "search");
});

test("from the catalog: Microsoft Learn is callable the moment it is added, with no secret and no install", async (t) => {
  const w = world(t);
  addFromCatalog(w.manage, "microsoft-learn");
  assert.equal((await w.call({ id: "microsoft-learn", tool: "search", args: { q: "graph" }, capability: "documentation.microsoft", workflow: "orbit-develop" })).resource, "managed:microsoft-learn");
});
