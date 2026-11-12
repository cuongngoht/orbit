// RESEARCH AS SOURCED KNOWLEDGE (0.6.0, U5), through the doors that exist and nothing new: the version a manifest pins,
// a `knowledge` need scoped to that manifest on the session's work, the resolver binding it to a managed provider, the
// MCP broker asking it (only the server on the other end of the wire is made up), the need settled on the receipt, and
// the answer kept as a claim whose context is { technology, version } through the work's own door into knowledge.
// Then: a second session finds it answered and asks nothing; a version bump in the manifest makes the need AND the claim
// stale, `knowledge.owed` holds again, and the same need -- the same id -- is asked again. Nothing under src/knowledge/
// changed for any of it.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { seenOf } from "../src/lifecycle/advice.mjs";
import { catalogFile, readCatalog } from "../src/catalog.mjs";
import { measured } from "../src/knowledge/query.mjs";
import { mcpCatalog } from "../src/mcp/catalog.mjs";
import { effectiveMcp } from "../src/mcp/effective.mjs";
import { addCustom } from "../src/mcp/manage.mjs";
import { createMcpState } from "../src/mcp/state.mjs";
import { activityLog } from "../src/mcp/activity.mjs";
import { baseEnv } from "../src/process/env.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { observedOf } from "../src/routing/facts.mjs";
import { envSecrets } from "../src/secrets.mjs";
import { stateRooms } from "../src/store/control.mjs";
import { realIo } from "../src/store/io.mjs";
import { settle } from "../src/knowledge/opportunities.mjs";
import { addNeeds, settleNeed } from "../src/work/actions.mjs";
import { bindNeeds } from "../src/work/bind.mjs";
import { invokeNeed } from "../src/work/invoke.mjs";
import { claimCandidates, projectClaims } from "../src/work/memory.mjs";
import { modelOf, stateOf, statesOf } from "../src/work/model.mjs";
import { resume } from "../src/work/resume.mjs";
import { createWorks, workOf } from "../src/work/store.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { knowledgeWorld } from "./fakes/knowledge.mjs";
import { memorySource } from "./fakes/source.mjs";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..");
const AT = "2026-11-12T10:00:00.000Z";
const WID = workOf("req-3f9a1c0b7e21");
const CATALOG = mcpCatalog(readCatalog(realIo(), catalogFile(REPO, "mcp")));
const MANIFEST = "package.json";
const pinned = (version) => JSON.stringify({ dependencies: { "acme-sdk": version } });

const response = (body) => ({ status: 200, ok: true, headers: { get: (k) => ({ "content-type": "application/json" })[k.toLowerCase()] ?? null }, text: async () => (typeof body === "string" ? body : JSON.stringify(body)), body: { cancel: async () => {} } });

// A documentation server over HTTP, in memory: it answers a search with a page of the version asked about.
function docsServer() {
  const asked = [];
  const fetch = async (url, init) => {
    const body = JSON.parse(init.body);
    asked.push(body.method === "tools/call" ? body.params.arguments.q : body.method);
    if (!body.id) return response("");
    if (body.method === "initialize") return response({ jsonrpc: "2.0", id: body.id, result: {} });
    if (body.method === "tools/list") return response({ jsonrpc: "2.0", id: body.id, result: { tools: [{ name: "search", annotations: { readOnlyHint: true } }] } });
    return response({ jsonrpc: "2.0", id: body.id, result: { content: [{ type: "text", text: JSON.stringify({ hits: [{ title: "Retry policy", url: "https://docs.acme.example/sdk/2.1/retries" }] }) }] } });
  };
  return { fetch, asked };
}

// The machine: a managed documentation server, the project's files (a manifest pinning a version), one work, and the
// knowledge room over the SAME source tree -- so a bump in the manifest is seen by the work and by knowledge alike.
function machine(t) {
  const base = mkdtempSync(join(tmpdir(), "orbit-work-research-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const rooms = stateRooms(base);
  const io = realIo();
  const state = createMcpState(rooms, io);
  addCustom({ state, catalog: CATALOG, now: () => AT }, { id: "docs", transport: "http", url: "https://docs.example/mcp", provides: ["documentation.search"] });
  const server = docsServer();
  const source = memorySource({ [MANIFEST]: pinned("2.1.0"), "src/app/client.ts": "x" });
  const k = knowledgeWorld({ source, now: AT });
  const works = createWorks("/store/acme", fakeIo({ now: () => AT }));
  works.create({ id: WID, objective: "Add retries to the payment client", root: { id: "4312" }, at: AT });
  const mcp = () => ({ entries: effectiveMcp({ catalog: CATALOG, state: state.all(), receipts: [], secrets: envSecrets({}), now: Date.parse(AT) + 1000, platform: "linux", arch: "x64" }), records: state.read("managed").servers, connect: { secrets: envSecrets({}), rooms, receipts: [], catalog: CATALOG, exists: () => false, platform: "linux", arch: "x64", node: "/node" }, session: { fetch: server.fetch, env: baseEnv({}), timeoutMs: 1000 }, activity: activityLog(rooms, io), now: () => Date.now() });
  const session = (name) => {
    const w = { works, session: name, source, now: () => AT, snapshot: () => null, latestSnapshot: () => null, effective: () => getEffectiveResources({ env: {}, plugin: "orbit", components: () => [], builtins: () => ({}), capabilities: () => [], tools: () => [], mcp: () => mcp().entries }, PROVIDERS), opportunities: { docs: () => k.know.opportunities(), settle: (docs) => settle(k, docs) }, memory: { knowledge: k, tracked: k.tracked() } };
    Object.defineProperty(w, "mcp", { get: mcp, enumerable: true });
    return w;
  };
  return { works, source, k, server, session };
}

// The question as the playbook proposes it: the technology and the topic as its subject, never the version.
const QUESTION = { type: "knowledge", capability: "documentation.search", subject: "acme-sdk.retry-policy", asks: "How does the SDK retry a failed call?", scope: [MANIFEST] };
const versionIn = (source) => JSON.parse(source.read(MANIFEST)).dependencies["acme-sdk"];
const model = (m) => modelOf(m.works.read(WID));
const owed = (m) => observedOf(seenOf([], statesOf(model(m)))).filter((o) => o.fact === "knowledge.owed").map((o) => o.subject);

async function answered(m, w, need) {
  bindNeeds(w, model(m));
  const out = await invokeNeed(w, WID, need, { tool: "search", input: { q: `acme-sdk ${versionIn(m.source)} retry policy` }, workflow: "orbit-research" });
  settleNeed(w, WID, { need, state: "satisfied", receipt: out.receipt.id });
  const { receipt, candidates } = claimCandidates(WID, model(m), need, [{ subject: "acme-sdk.retry-policy", relation: "results-in", object: "exponential.backoff", context: { technology: "acme-sdk", version: versionIn(m.source) }, scope: [MANIFEST], because: "the official documentation of this version says so" }]);
  return { receipt, projected: projectClaims(w, receipt, candidates) };
}

test("a question is answered from a source for the version pinned, kept as a claim of that version, and not asked again while fresh", async (t) => {
  const m = machine(t);
  const one = m.session("claude:1111111111111111");
  const [need] = addNeeds(one, WID, [QUESTION]).added.map((a) => a.need);
  assert.deepEqual(owed(m), ["acme-sdk.retry-policy"], "an open knowledge need is the fact that brings research in");
  const first = await answered(m, one, need);
  assert.deepEqual([first.receipt.outcome, JSON.stringify(first.receipt.provider).includes("docs"), first.projected.projected], ["ok", true, 1], "asked through the broker of the managed server the resolver bound, and kept");
  assert.deepEqual(m.server.asked.filter((q) => q.startsWith("acme-sdk")), ["acme-sdk 2.1.0 retry policy"], "the provider was asked about the pinned version");
  const [claim] = m.k.know.all();
  assert.deepEqual([claim.context, claim.source, claim.strength], [{ technology: "acme-sdk", version: "2.1.0" }, "work-receipt", "observed"]);
  assert.deepEqual(owed(m), [], "answered: nothing is owed");

  const two = m.session("claude:2222222222222222");
  const again = addNeeds(two, WID, [QUESTION]);
  assert.deepEqual([again.added, again.existing.map((e) => e.need)], [[], [need]], "the same question in a second session is the same need, never a second one");
  assert.deepEqual(resume(two, WID).stale, [], "nothing moved");
  assert.equal(stateOf(model(m).needs.get(need), model(m)), "satisfied");
  assert.deepEqual(Object.values(measured(m.k, m.k.know.all())), ["fresh"], "and the claim is recalled as current");
  assert.equal(m.server.asked.filter((q) => q.startsWith("acme-sdk")).length, 1, "never asked twice while fresh");
});

test("a version bump in the manifest makes the need and the claim stale, knowledge is owed again, and the same need is asked again", async (t) => {
  const m = machine(t);
  const one = m.session("claude:1111111111111111");
  const [need] = addNeeds(one, WID, [QUESTION]).added.map((a) => a.need);
  await answered(m, one, need);
  m.source.write(MANIFEST, pinned("3.0.0"));
  const two = m.session("claude:2222222222222222");
  assert.deepEqual(resume(two, WID).stale.map((s) => [s.need, s.because]), [[need, "scope"]], "the manifest it rests on moved");
  assert.equal(stateOf(model(m).needs.get(need), model(m)), "stale");
  assert.deepEqual(Object.values(measured(m.k, m.k.know.all())), ["stale"], "what was learned for 2.1.0 is no longer current");
  assert.deepEqual(owed(m), ["acme-sdk.retry-policy"], "knowledge.owed holds again: the fact that brings research back");
  const second = await answered(m, two, need);
  assert.equal(second.receipt.need, need, "the SAME need, asked again");
  assert.deepEqual(m.server.asked.filter((q) => q.startsWith("acme-sdk")), ["acme-sdk 2.1.0 retry policy", "acme-sdk 3.0.0 retry policy"]);
  assert.equal(stateOf(model(m).needs.get(need), model(m)), "satisfied");
  assert.deepEqual(m.k.know.all().map((c) => c.context.version).sort(), ["2.1.0", "3.0.0"], "each version's answer is its own claim, in its own context");
  assert.deepEqual(owed(m), []);
});
