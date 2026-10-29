// The discovery ladder: which item, in which system, read by whom -- from the
// strongest thing already known, and never a guess between two products.
//
// Everything here is the real thing except the machine: the pack's own readers
// recognise links, a real Effective Resource Registry says who is ready, the existing
// resolver ranks them, and a gap goes through the door knowledge already keeps.
import assert from "node:assert/strict";
import { test } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { Refused } from "../src/errors.mjs";
import { effectiveMcp } from "../src/mcp/effective.mjs";
import { mcpCatalogAt } from "../src/resources/compose.mjs";
import { pluginBuiltins } from "../src/resources/plugin.mjs";
import { envSecrets } from "../src/secrets.mjs";
import { realIo } from "../src/store/io.mjs";
import { settle } from "../src/knowledge/opportunities.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { LADDER, NEED, resolveSource } from "../src/sources/resolve.mjs";
import { descriptorFor, requiresProject, serves } from "../src/sources/descriptors.mjs";
import { packReaders, descriptorsOf, readerResources } from "../skills/orbit-requirements/bind.mjs";
import { knowledgeWorld } from "./fakes/knowledge.mjs";

const NOW = "2026-09-30T10:00:00.000Z";
const REPO = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// Every .mjs and .json under a directory, the way a person's grep would see them.
const filesUnder = (dir) => (existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.name !== "node_modules").flatMap((e) => (e.isDirectory() ? filesUnder(join(dir, e.name)) : /\.(mjs|json)$/.test(e.name) ? [join(dir, e.name)] : [])) : []);
const DESCRIPTORS = descriptorsOf();
const connection = (provider, organization = "acme") => ({ id: `${provider}-${organization}`, provider, organization, host: "https://example.test", credential: { set: true, from: "env", name: "SOME_TOKEN" }, configured: true });
const ADO_URL = "https://dev.azure.com/acme/web/_workitems/edit/4312";

// A machine: which connections exist, which tools are here (by catalog id), what a
// tool answers to its configured-defaults question, and what was asked of it.
function machine({ connections = [], caps = [], mcp = [], binding = null, works = [], tools = {}, probes = {}, descriptors = DESCRIPTORS } = {}) {
  const k = knowledgeWorld();
  const list = { list: () => connections, record: () => ({ credential: "SOME_TOKEN" }) };
  const calls = { observed: [], probed: [] };
  const effective = () => getEffectiveResources({ env: {}, plugin: "orbit", components: () => [], builtins: () => ({}), capabilities: () => caps, packCapabilities: () => readerResources(list, descriptors), tools: () => [], mcp: () => mcp }, PROVIDERS);
  const w = {
    descriptors,
    readers: packReaders({ connections: list, auth: {}, fetch: null, nowMs: () => 0 }, descriptors),
    works: () => works,
    bindings: () => ({ doc: binding ?? { default: null, refs: {} } }),
    connections: list,
    effective,
    observe: (ids) => (calls.observed.push(ids), ids.map((id) => ({ id, status: tools[id] ? "ready" : "missing", path: tools[id] ?? null }))),
    probe: (bin, argv, finding) => (calls.probed.push({ bin, argv, path: finding?.path }), probes[bin] ?? { ok: false, out: "" }),
    opportunities: { docs: () => k.know.opportunities(), settle: (docs) => settle(k, docs) },
    now: () => NOW,
  };
  return { w, calls, k };
}

const ask = (ref, over) => {
  const m = machine(over);
  return { ...m, r: resolveSource(ref, m.w) };
};

const refusal = (fn) => {
  try { fn(); } catch (e) { return e; }
  return null;
};

test("the ladder is an ordered table that ends in a row that always answers", () => {
  assert.deepEqual(LADDER.map((r) => r.id), ["explicit", "work", "binding", "registry", "tool", "gap"]);
  assert.equal(NEED[0].capability, "workitem.read", "and it asks the resolver ONE thing");
});

test("a link names its own system, and that wins over what a binding says and over who is ready", () => {
  const binding = { default: { provider: "github", organization: "acme", project: "shop" }, refs: {} };
  const { r } = ask(ADO_URL, { connections: [connection("azure-devops"), connection("github")], binding });
  assert.equal(r.rung, "explicit");
  assert.deepEqual(r.identity, { provider: "azure-devops", organization: "acme", project: "web", id: "4312" });
  assert.equal(r.provider.key, "pack:orbit-requirements/azure-devops");
  assert.equal(r.gap, false);
});

test("a link no reader recognises does not become a guess: the next row gets its turn, and the end says so", () => {
  const { r } = ask("https://tracker.example.test/items/9", {});
  assert.equal(r.rung, "gap");
  assert.match(r.say, /nothing here can read a work item|no system this project knows recognises that link/);
});

test("a recognised link whose system nothing here can read is a gap with the reason, not a reader of the wrong product", () => {
  const { r } = ask(ADO_URL, { connections: [connection("github")] });
  assert.equal(r.rung, "explicit");
  assert.deepEqual([r.provider, r.gap], [null, true]);
  assert.match(r.say, /nothing ready here reads azure-devops items/);
});

test("work already started on the id knows its system; two systems with the same id are AMBIGUOUS", () => {
  const root = { provider: "github", organization: "acme", project: "shop", id: "88" };
  const { r } = ask("88", { connections: [connection("github")], works: [{ id: "w-1", root }] });
  assert.deepEqual([r.rung, r.identity, r.provider.key], ["work", root, "pack:orbit-requirements/github"]);
  const two = refusal(() => ask("88", { works: [{ id: "w-1", root }, { id: "w-2", root: { ...root, provider: "azure-devops", project: "web" } }] }));
  assert.ok(two instanceof Refused && /AMBIGUOUS: work has already started on 88 in more than one system/.test(two.message), String(two));
});

test("a project's binding beats the registry, by pattern before by default, and a person's word is used as given", () => {
  const binding = { default: { provider: "github", organization: "acme", project: "shop" }, refs: { "^INC-(?<id>\\d+)$": { provider: "azure-devops", organization: "acme", project: "web" } } };
  const readyOnlyAdo = { connections: [connection("azure-devops")], binding };
  const plain = ask("88", readyOnlyAdo).r;
  assert.deepEqual([plain.rung, plain.identity.provider, plain.gap], ["binding", "github", true], "the binding says github; nothing ready reads it, and that is said -- not quietly read from ado");
  assert.match(plain.say, /nothing ready here reads github items/);
  const patterned = ask("INC-77", readyOnlyAdo).r;
  assert.deepEqual([patterned.rung, patterned.identity], ["binding", { provider: "azure-devops", organization: "acme", project: "web", id: "77" }]);
  assert.equal(ask("88", { connections: [connection("azure-devops"), connection("github")], binding }).r.provider.key, "pack:orbit-requirements/github");
});

test("a binding for a system the pack does not know still works: an id is an id", () => {
  const binding = { default: { provider: "acme-tracker", organization: "acme" }, refs: {} };
  const { r } = ask("PROJ-12", { binding });
  assert.deepEqual([r.rung, r.identity.provider, r.identity.id], ["binding", "acme-tracker", "PROJ-12"]);
});

test("two systems that both have a reader ready are AMBIGUOUS, and the candidates are named", () => {
  const e = refusal(() => ask("4312", { connections: [connection("azure-devops"), connection("github")] }));
  assert.ok(e instanceof Refused, String(e));
  assert.match(e.message, /AMBIGUOUS: item 4312 could be in more than one system/);
  assert.match(e.message, /azure-devops; github|github; azure-devops/);
  assert.match(e.message, /bind this project's system with bind --human/);
});

test("a server the host configured is recognised and is still not a system: only a READY reader is", () => {
  const catalog = mcpCatalogAt(fileURLToPath(new URL("..", import.meta.url)), realIo());
  const external = [{ id: "ado", transport: "http", url: "https://example.test/mcp", hostEnabled: true }];
  const mcp = effectiveMcp({ catalog, state: { managed: { servers: {} }, external: { host: "claude", observedAt: NOW, servers: external } }, secrets: envSecrets({}), now: Date.parse(NOW), platform: "linux", arch: "x64" });
  const { r } = ask("4312", { mcp });
  assert.ok(r.candidates.some((c) => c.key === "external:ado" && c.selectable === false), "it is there, recognised by its catalog row, and never selectable");
  assert.deepEqual([r.rung, r.partial, r.gap], ["gap", null, true]);
});

test("one ready system with one organization is not enough for a system that names its project: it is a question for a person, and no tool of the developer's is asked", () => {
  const m = ask("4312", { connections: [connection("azure-devops")], tools: { "azure-cli": "/opt/bin/az" }, probes: { az: { ok: true, out: "Defaults\norganization = https://dev.azure.com/acme/\nproject = Web Shop\n" } } });
  assert.deepEqual([m.r.rung, m.r.gap, m.r.identity, m.r.suggest], ["gap", false, null, null]);
  assert.match(m.r.say, /it looks like azure-devops, but which project is not known here/);
  assert.deepEqual([m.calls.observed, m.calls.probed], [[], []], "the descriptor lists no tool for this system, so nothing was looked for and nothing was run: a bare id has the registry and the connection, and the link or a person's binding for the rest");
});

test("with nothing narrowed, only descriptor-listed tools are looked for -- the one a descriptor lists, and nothing else", () => {
  const m = ask("88", { tools: {} });
  assert.deepEqual(m.calls.observed, [["github-cli"]]);
  assert.deepEqual(m.calls.probed, [], "a tool that is not here is not asked anything");
  const found = ask("88", { tools: { "github-cli": "/usr/bin/gh" }, probes: { gh: { ok: true, out: "acme/shop\n" } } });
  assert.deepEqual([found.r.rung, found.r.identity], ["tool", { provider: "github", organization: "acme", project: "shop", id: "88" }]);
  assert.deepEqual(found.calls.probed.map((p) => p.bin), ["gh"]);
});

test("a tool that answers something that is not what its descriptor expects, or fails, is passed over -- and a tool no descriptor lists is never asked", () => {
  const { r, calls } = ask("88", { tools: { "github-cli": "/usr/bin/gh", "azure-cli": "/usr/bin/az" }, probes: { gh: { ok: true, out: "not an owner slash a repo at all\nreally not" }, az: { ok: true, out: "organization = https://dev.azure.com/acme\nproject = web" } } });
  assert.equal(r.rung, "gap");
  assert.deepEqual(calls.probed.map((p) => p.bin), ["gh"], "the other tool is on this machine and answers, and is still not asked: no descriptor names it");
});

// The shipped descriptors list one tool; the rule is the engine's, so a second one is made up to hold it.
const TWO = descriptorsOf([DESCRIPTORS[0], { ...DESCRIPTORS[1], tools: [{ catalog: "tracker-cli", bin: "trk", defaults: { argv: ["whoami"], parse: "^(?<organization>[^/\\s]+)/(?<project>[^/\\s]+)\\s*$" } }] }]);

test("two tools configured for two systems are AMBIGUOUS, not the first one that answered", () => {
  const e = refusal(() => ask("4312", { descriptors: TWO, tools: { "github-cli": "/usr/bin/gh", "tracker-cli": "/usr/bin/trk" }, probes: { gh: { ok: true, out: "acme/shop" }, trk: { ok: true, out: "acme/web" } } }));
  assert.ok(e instanceof Refused && /the tools here are configured for each/.test(e.message), String(e));
});

test("Azure DevOps is never asked through the developer's own CLI: its descriptor lists no tool, and nothing the engine ships spawns `az devops`", () => {
  assert.deepEqual(descriptorFor(DESCRIPTORS, "azure-devops").tools, []);
  assert.ok(descriptorFor(DESCRIPTORS, "github").tools.some((t) => t.defaults), "the mechanism stays: a descriptor's own tool may still say what a checkout is configured for");
  const files = ["src", "cli", "skills", "catalog", "hooks", "satellite", "control-server/src"].flatMap((d) => filesUnder(join(REPO, d)));
  assert.ok(files.length > 500, "the scan sees the code it guards");
  const SPAWNS = /["'`]devops["'`]|\baz\s+devops\b|["']az["']\s*,\s*["']devops["']/;
  assert.deepEqual(files.filter((f) => SPAWNS.test(readFileSync(f, "utf8"))).map((f) => relative(REPO, f)), []);
});

test("a system whose links name no project is complete with one connection's organization", () => {
  const loose = descriptorsOf([{ ...DESCRIPTORS[0], id: "github", match: { urls: ["^https://github\\.com/(?<organization>[^/]+)/issues/(?<id>\\d+)$"], bareId: "^#?(?<id>\\d+)$" } }, DESCRIPTORS[1]]);
  assert.equal(requiresProject(descriptorFor(loose, "github")), false);
  assert.equal(requiresProject(descriptorFor(loose, "azure-devops")), true);
  const { r } = ask("88", { descriptors: loose, connections: [connection("github", "acme")] });
  assert.deepEqual([r.rung, r.identity], ["registry", { provider: "github", organization: "acme", id: "88" }]);
  const two = ask("88", { descriptors: loose, connections: [connection("github", "acme"), connection("github", "other")] });
  assert.equal(two.r.rung, "gap", "two organizations under one system is not something to pick between");
});

test("no way to read a work item at all is a gap, remembered ONCE as the opportunity knowledge already keeps -- and rerunning does not raise a second", () => {
  const first = ask("4312", { tools: {} });
  assert.deepEqual([first.r.rung, first.r.gap], ["gap", true]);
  assert.match(first.r.opportunity, /^opp-[0-9a-f]{12}$/);
  assert.match(first.r.say, /nothing here can read a work item/);
  assert.equal(first.k.know.opportunities().length, 1);
  const again = resolveSource("4312", first.w);
  assert.equal(again.opportunity, first.r.opportunity);
  assert.equal(first.k.know.opportunities().length, 1);
  const doc = first.k.know.opportunities()[0];
  assert.deepEqual([doc.capability, doc.remedy, doc.state], ["workitem.read", "enable", "candidate"]);
  assert.equal(JSON.stringify(doc).includes("4312"), false, "the id of an item is not what an opportunity remembers");
});

test("a recognised link with no reader at all raises the same one opportunity; a reader for another system does not", () => {
  const none = ask(ADO_URL, {});
  assert.deepEqual([none.r.rung, none.r.provider, none.r.gap], ["explicit", null, true]);
  assert.match(none.r.opportunity, /^opp-/);
  assert.equal(none.k.know.opportunities().length, 1);
  const other = ask(ADO_URL, { connections: [connection("github")] });
  assert.deepEqual([other.r.gap, other.r.opportunity, other.k.know.opportunities().length], [true, null, 0], "github can read work items; it just is not the one this link names");
});

test("when a reader becomes ready the opportunity is moved on by the engine -- evidence moved it, and nobody was asked", () => {
  const first = ask("4312", {});
  const opportunity = first.k.know.opportunities()[0];
  assert.equal(opportunity.state, "candidate");
  const ready = machine({ connections: [connection("azure-devops")] });
  const again = resolveSource(ADO_URL, { ...ready.w, opportunities: { docs: () => first.k.know.opportunities(), settle: (docs) => settle(first.k, docs) } });
  assert.equal(again.provider.key, "pack:orbit-requirements/azure-devops");
  const moved = first.k.know.opportunities()[0];
  assert.deepEqual([moved.id, moved.state, moved.resolvedBy], [opportunity.id, "resolved", "pack:orbit-requirements/azure-devops"]);
});

test("a ready reader that only lacks an id or a project is a question for a person, and no opportunity", () => {
  const { r, k } = ask("PBI 4312", { connections: [connection("azure-devops")] });
  assert.deepEqual([r.rung, r.gap, r.opportunity], ["gap", false, null]);
  assert.match(r.say, /neither a link nor an item id/);
  assert.equal(k.know.opportunities().length, 0);
});

test("an unscoped resource reads for nobody in particular and is never guessed to read for somebody; one that names a system reads only that one", () => {
  const scoped = { detail: { connection: "azure-devops" } };
  assert.equal(serves(scoped, "azure-devops", DESCRIPTORS), true);
  assert.equal(serves(scoped, "github", DESCRIPTORS), false);
  assert.equal(serves({ detail: {} }, "github", DESCRIPTORS), true);
  assert.equal(serves({ kind: "mcp", detail: { catalog: "github" } }, "github", DESCRIPTORS), true);
  assert.equal(serves({ kind: "mcp", detail: { catalog: "github" } }, "azure-devops", DESCRIPTORS), false);
});
