// Asking a provider on behalf of a need: through the MCP broker or the capability pipeline
// and nowhere else, with a receipt that keeps digests and places and never the query or the
// answer. The broker, the gates, the policy and the registry are the real ones; only the
// server on the other end of the wire is made up.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { Blocked, Refused } from "../src/errors.mjs";
import { activityLog, recentActivity } from "../src/mcp/activity.mjs";
import { mcpCatalog } from "../src/mcp/catalog.mjs";
import { baseEnv } from "../src/process/env.mjs";
import { effectiveMcp } from "../src/mcp/effective.mjs";
import { addCustom, approve, setEnabled, setPolicy } from "../src/mcp/manage.mjs";
import { envSecrets } from "../src/secrets.mjs";
import { createMcpState, observedAs } from "../src/mcp/state.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { settle } from "../src/knowledge/opportunities.mjs";
import { bindNeeds, fingerprintOf } from "../src/work/bind.mjs";
import { INVOKERS, PRINT_LIMIT, invokeNeed, printable } from "../src/work/invoke.mjs";
import { modelOf, needId } from "../src/work/model.mjs";
import { MAX_REFS, cleanUrl, refsIn } from "../src/work/refs.mjs";
import { createWorks, workOf } from "../src/work/store.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { knowledgeWorld } from "./fakes/knowledge.mjs";
import { fakeProcess } from "./fakes/process.mjs";
import { fakeTools } from "./fakes/tools.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const AT = "2026-09-30T10:00:00.000Z";
const ROOT = "req-3f9a1c0b7e21";
const WID = workOf(ROOT);
const CATALOG = mcpCatalog(readCatalog(realIo(), catalogFile(REPO, "mcp")));
const SECRET = "Bearer sk-live-work-9999";
const QUERY = "graph webhooks refund limit";

const response = (body) => ({ status: 200, ok: true, headers: { get: (k) => ({ "content-type": "application/json" })[k.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), body: { cancel: async () => {} } });

// A server over HTTP, in memory: what it was asked, and what it answers to a search.
function fakeServer({ reply = null, isError = false } = {}) {
  const asked = [];
  const answer = reply ?? JSON.stringify({ hits: [{ title: "the refund limit page", url: "https://docs.example/refunds?token=abc123#limit", body: "Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCD" }] });
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push({ method: body.method, params: body.params });
    if (!body.id) return response("");
    if (body.method === "initialize") return response({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "tools/list") return response({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "search", annotations: { readOnlyHint: true } }, { name: "publish" }] } });
    return response({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: answer }], isError } });
  };
  return { fetch, asked };
}

const ROWS = { id: "acme.rows",apiVersion: "orbit.capability/v1",  apiVersion: "orbit.capability/v1", doc: "rows", inputSchema: { q: { type: "string", esc: "text", doc: "what to look for" } }, required: ["q"], invoke: (ext, input) => ({ count: 3, asked: input.q, url: "https://tracker.example/items/3?x=1" }) };
const WRITES = { ...ROWS, id: "acme.write", mutates: true };
const BROWSES = { ...ROWS, id: "acme.browse", invoke: (ext) => ({ count: ext.browser.evaluate("1") }) };

// The whole machine: a managed server that provides documentation search, a project with two
// capabilities, a work with one need on each, and a registry that lists all of it.
function machine(t, { server = fakeServer(), env = { CORP_AUTH: SECRET } } = {}) {
  const base = mkdtempSync(join(tmpdir(), "orbit-work-invoke-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rooms = stateRooms(base);
  const io = realIo();
  const state = createMcpState(rooms, io);
  const manage = { state, catalog: CATALOG, now: () => AT };
  addCustom(manage, { id: "corp", transport: "http", url: "https://corp.example/mcp", requiredHeaders: [{ name: "Authorization", env: "CORP_AUTH" }], provides: ["documentation.search"] });
  const activity = activityLog(rooms, io);
  const mcpNow = (over = {}) => ({ entries: effectiveMcp({ catalog: CATALOG, state: state.all(), receipts: [], secrets: envSecrets(over.env ?? env), now: Date.parse(AT) + 1000, platform: "linux", arch: "x64" }), records: state.read("managed").servers, connect: { secrets: envSecrets(over.env ?? env), rooms, receipts: [], catalog: CATALOG, exists: () => false, platform: "linux", arch: "x64", node: "/node" }, session: { fetch: server.fetch, env: baseEnv(over.env ?? env), timeoutMs: 1000 }, activity, now: () => Date.now() });
  const registry = createCapabilityRegistry();
  for (const c of [ROWS, WRITES, BROWSES]) registry.register(c, "acme");
  const knowledge = knowledgeWorld();
  const works = createWorks("/store/acme", fakeIo({ now: () => AT }));
  works.create({ id: WID, objective: "Implement the refund limit", root: { id: "4312" }, at: AT });
  const w = {
    works,
    now: () => AT,
    effective: () => getEffectiveResources({ env: {}, plugin: "orbit", components: () => [], builtins: () => ({}), capabilities: () => registry.list(), packCapabilities: () => machine.pack ?? [], tools: () => [], mcp: () => mcpNow().entries }, PROVIDERS),
    opportunities: { docs: () => knowledge.know.opportunities(), settle: (docs) => settle(knowledge, docs) },
    capabilityContext: { ...fakeContext(), capabilities: registry, process: fakeProcess(), tools: fakeTools({}) },
  };
  Object.defineProperty(w, "mcp", { get: () => mcpNow(machine.over), enumerable: true });
  return { w, works, manage, state, server, activity, io, rooms, base };
}

const fold = (m) => modelOf(m.works.read(WID));
const propose = (m, capability, subject = capability) => {
  const need = { id: needId(WID, "knowledge", capability, subject), type: "knowledge", capability, subject, asks: `about ${subject}` };
  m.works.append(WID, "need", need);
  return need;
};
const bound = (m, need) => {
  bindNeeds(m.w, fold(m));
  return need;
};
const lines = (m) => recentActivity(m.io, m.rooms);
const journal = (m) => m.works.read(WID);
const receipts = (m) => journal(m).filter((r) => r.kind === "receipt");
const journalText = (m) => JSON.stringify(journal(m));

test("a need bound to a managed server is asked through the broker, for its capability and in this workflow", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "documentation.search", "limit"));
  const out = await invokeNeed(m.w, WID, need.id, { tool: "search", input: { q: QUERY } });
  assert.equal(out.receipt.outcome, "ok");
  const line = lines(m).find((l) => l.kind === "mcp-invoked");
  assert.deepEqual([line.capability, line.workflow], ["documentation.search", "orbit-requirements"]);
  assert.deepEqual(m.server.asked.map((a) => a.method), ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
});

test("the receipt keeps digests and where the answer said it came from, and never the query or the answer", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "documentation.search", "limit"));
  const { receipt } = await invokeNeed(m.w, WID, need.id, { tool: "search", input: { q: QUERY } });
  assert.match(receipt.queryDigest, /^[0-9a-f]{64}$/);
  assert.match(receipt.resultDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(receipt.sourceRefs, ["https://docs.example/refunds"], "query and fragment are gone");
  assert.deepEqual([receipt.need, receipt.provider, receipt.tool, receipt.capability], [need.id, "managed:corp", "search", "documentation.search"]);
  for (const leak of [QUERY, "the refund limit page", "abc123", "abcdefghijklmnopqrstuvwxyz0123456789ABCD"]) assert.equal(journalText(m).includes(leak), false, `${leak} reached the journal`);
});

test("what the host is shown is scrubbed, and cut where it is too long", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "documentation.search"));
  const { result } = await invokeNeed(m.w, WID, need.id, { tool: "search", input: { q: "x" } });
  assert.match(result.text, /the refund limit page/);
  assert.doesNotMatch(result.text, /abcdefghijklmnopqrstuvwxyz0123456789ABCD/);
  assert.equal(result.truncated, false);
  const long = printable({ text: "y".repeat(PRINT_LIMIT + 50) });
  assert.deepEqual([long.truncated, long.text.length], [true, PRINT_LIMIT]);
});

test("without a tool the server's tools are listed, nothing is called and nothing is receipted", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "documentation.search"));
  const out = await invokeNeed(m.w, WID, need.id, {});
  assert.deepEqual(out.listed.map((x) => [x.name, x.operation]), [["search", "read"], ["publish", "write"]]);
  assert.equal(receipts(m).length, 0);
  assert.equal(m.server.asked.filter((a) => a.method === "tools/call").length, 0);
});

test("a tool that reports an error is an error receipt, and still an answer", async (t) => {
  const m = machine(t, { server: fakeServer({ reply: "nothing found", isError: true }) });
  const need = bound(m, propose(m, "documentation.search"));
  const out = await invokeNeed(m.w, WID, need.id, { tool: "search", input: { q: "x" } });
  assert.deepEqual([out.receipt.outcome, out.receipt.why], ["error", "the tool reported an error"]);
});

test("a server that needs a person's approval is bound, refused by the broker until it is granted, then reached", async (t) => {
  const m = machine(t);
  const need = propose(m, "documentation.search");
  setPolicy(m.manage, "corp", { capabilities: { "documentation.search": "approval" } });
  bound(m, need);
  const ask = { tool: "search", input: { q: "x" } };
  await assert.rejects(invokeNeed(m.w, WID, need.id, ask), (e) => e instanceof Refused && /needs a person's approval first/.test(e.message));
  assert.equal(m.server.asked.length, 0, "nothing was reached while waiting for approval");
  approve(m.manage, "corp", 30);
  assert.equal((await invokeNeed(m.w, WID, need.id, ask)).receipt.outcome, "ok");
  assert.deepEqual(receipts(m).map((r) => r.outcome), ["refused", "ok"]);
});

test("a policy that tightens after the need was bound still stops the call at the broker, receipted as refused", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "documentation.search"));
  const before = m.w.effective();
  setPolicy(m.manage, "corp", { capabilities: { "documentation.search": "deny" } });
  const w = { ...m.w, effective: () => before };
  await assert.rejects(invokeNeed(w, WID, need.id, { tool: "search", input: { q: "x" } }), (e) => e instanceof Refused && /policy denies corp for documentation\.search/.test(e.message));
  assert.deepEqual(receipts(m).map((r) => r.outcome), ["refused"]);
  assert.equal(m.server.asked.length, 0);
});

test("resolving again after policy denies the only server that provides it leaves nothing serving the need", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "documentation.search"));
  setPolicy(m.manage, "corp", { capabilities: { "documentation.search": "deny" } });
  bindNeeds(m.w, fold(m));
  assert.equal(fold(m).bindings.get(need.id).status, "gap", "a provider it names is only one that could serve it, not one that does");
  await assert.rejects(invokeNeed(m.w, WID, need.id, { tool: "search", input: { q: "x" } }), /nothing serves documentation\.search yet/);
  assert.equal(m.server.asked.length, 0);
});

test("a server whose runtime cannot start is Blocked, receipted as blocked", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "documentation.search"));
  machine.over = { env: {} };
  t.after(() => { machine.over = undefined; });
  await assert.rejects(invokeNeed(m.w, WID, need.id, { tool: "search", input: { q: "x" } }), (e) => e instanceof Blocked);
  assert.deepEqual(receipts(m).map((r) => r.outcome), ["blocked"]);
});

test("a server disabled after it was bound is no longer what the need was bound to, and nothing is asked", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "documentation.search"));
  setEnabled(m.manage, "corp", false);
  await assert.rejects(invokeNeed(m.w, WID, need.id, { tool: "search", input: { q: "x" } }), (e) => e instanceof Refused && /work resolve again/.test(e.message));
  assert.equal(receipts(m).length, 0, "nothing was attempted, so nothing is receipted");
  assert.equal(m.server.asked.length, 0);
});

test("a binding that names a host's server is never let through to a managed one of the same name", async (t) => {
  const m = machine(t);
  const need = propose(m, "documentation.search");
  const seen = { kind: "mcp", id: "corp", key: "external:corp", ownership: "external" };
  const listed = { key: "external:corp", kind: "mcp", id: "corp", ownership: "external", enabled: true, runtimeReady: true, eligible: true, selection: "automatic", priority: 0, state: "ready", detail: {} };
  m.works.append(WID, "binding", { id: "bnd-1", need: need.id, provider: seen, fingerprint: fingerprintOf(listed), status: "provided" });
  const w = { ...m.w, effective: () => ({ mcp: [listed] }) };
  await assert.rejects(invokeNeed(w, WID, need.id, { tool: "search" }), (e) => e instanceof Refused && /never calls them/.test(e.message));
  assert.equal(m.server.asked.length, 0, "the managed server of the same name was not reached");
});

test("nothing is asked until the need can be: unknown, no capability, unresolved, or served by nothing", async (t) => {
  const m = machine(t);
  const free = { id: needId(WID, "action", null, "edit"), type: "action", subject: "edit", asks: "edit" };
  m.works.append(WID, "need", free);
  await assert.rejects(invokeNeed(m.w, WID, "nd-nothere", {}), /there is no need nd-nothere/);
  await assert.rejects(invokeNeed(m.w, WID, free.id, {}), /names no capability/);
  const cap = propose(m, "documentation.search");
  await assert.rejects(invokeNeed(m.w, WID, cap.id, {}), /work resolve first/);
  m.works.append(WID, "binding", { id: "bnd-1", need: cap.id, provider: null, fingerprint: null, status: "gap", why: "nothing here provides it" });
  await assert.rejects(invokeNeed(m.w, WID, cap.id, {}), /nothing serves documentation\.search yet: nothing here provides it/);
  assert.equal(receipts(m).length, 0);
});

test("a work nobody started is refused before anything is looked up", async (t) => {
  const m = machine(t);
  await assert.rejects(invokeNeed(m.w, "w-aaaaaaaaaaaa", "nd-x", {}), (e) => e instanceof Refused && /work start/.test(e.message));
});

test("a project's own capability is asked through the pipeline with no page, and receipted", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "acme.rows", "rows"));
  const out = await invokeNeed(m.w, WID, need.id, { input: { q: "orders" } });
  assert.deepEqual([out.receipt.outcome, out.receipt.tool, out.receipt.provider], ["ok", "acme.rows", "acme.rows"]);
  assert.deepEqual(out.receipt.sourceRefs, ["https://tracker.example/items/3"]);
  assert.match(out.result.text, /"count":3/);
});

test("a capability that changes things is refused by the same gate as everywhere, and receipted", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "acme.write", "write"));
  await assert.rejects(invokeNeed(m.w, WID, need.id, { input: { q: "x" } }), (e) => e instanceof Refused && /can change external state/.test(e.message));
  assert.deepEqual(receipts(m).map((r) => r.outcome), ["refused"]);
});

test("a capability that reaches for a browser page gets none: there is no page behind a need", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "acme.browse", "browse"));
  await assert.rejects(invokeNeed(m.w, WID, need.id, { input: { q: "x" } }), (e) => e instanceof Refused && /no page to evaluate in/.test(e.message));
  assert.deepEqual(receipts(m).map((r) => r.outcome), ["refused"]);
});

test("a capability asked for something outside its declared input is refused by its own schema", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "acme.rows", "rows"));
  await assert.rejects(invokeNeed(m.w, WID, need.id, { input: { q: "x", extra: 1 } }), /unknown key "extra"/);
});

test("part of Orbit itself, a skill or an agent is not something work invoke calls", async (t) => {
  const m = machine(t);
  const engine = propose(m, "project.context");
  const skill = propose(m, "qa.planning");
  const seen = { kind: "capability", id: "project-context", key: "orbit:project-context", ownership: "orbit" };
  m.works.append(WID, "binding", { id: "bnd-1", need: engine.id, provider: seen, fingerprint: "x", status: "provided" });
  const rows = INVOKERS.map((r) => r.name);
  assert.deepEqual(rows, ["mcp", "project", "engine", "followed"], "the table ends in a row that always answers");
  const kinds = INVOKERS.map((r) => [r.when({ kind: "capability", ownership: "orbit" }), r.when({ kind: "skill" })]);
  assert.deepEqual(kinds, [[false, false], [false, false], [true, false], [true, true]]);
  assert.ok(skill.id);
});

test("the references an answer names: only from the fields providers name them in, cleaned, bounded and deduplicated", () => {
  assert.equal(cleanUrl("https://user:pw@docs.example/a/b?token=1#frag"), "https://docs.example/a/b");
  assert.equal(cleanUrl("javascript:alert(1)"), null);
  assert.equal(cleanUrl("not a url"), null);
  const answer = { title: "https://ignored.example/x", hits: [{ url: "https://a.example/1" }, { href: "https://a.example/1?x=2" }, { link: "ftp://no.example" }, { source: "https://b.example/2" }] };
  assert.deepEqual(refsIn(answer), ["https://a.example/1", "https://b.example/2"]);
  assert.deepEqual(refsIn(Array.from({ length: 40 }, (_, i) => ({ url: `https://h.example/${i}` }))).length, MAX_REFS);
});

test("an answer in text content that is JSON is read one level in, and a cycle or a tower costs a bounded walk", () => {
  const text = JSON.stringify({ items: [{ url: "https://inner.example/1" }] });
  assert.deepEqual(refsIn({ content: [{ type: "text", text }] }), ["https://inner.example/1"]);
  assert.deepEqual(refsIn({ content: [{ type: "text", text: "url: https://prose.example/x" }] }), []);
  const cyclic = { url: "https://c.example/1" };
  cyclic.self = cyclic;
  assert.deepEqual(refsIn(cyclic), ["https://c.example/1"]);
  let tower = { url: "https://deep.example/end" };
  for (let i = 0; i < 100; i += 1) tower = { next: tower };
  assert.deepEqual(refsIn(tower), []);
});

test("the journal after all of it holds no secret and no text of any answer", async (t) => {
  const m = machine(t);
  const need = bound(m, propose(m, "documentation.search"));
  await invokeNeed(m.w, WID, need.id, { tool: "search", input: { q: QUERY } });
  assert.doesNotMatch(journalText(m), /sk-live|Bearer|the refund limit page/);
});
