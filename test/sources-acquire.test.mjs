// Acquisition: reading a requirement's source and a bounded neighbourhood of it, and
// keeping what it WAS -- never what it said. The reader is scripted; everything else is
// real: the room over an in-memory disk, the registry, the resolver and the ladder.
import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { Blocked, Refused } from "../src/errors.mjs";
import { PROVIDERS } from "../src/resources/providers/index.mjs";
import { getEffectiveResources } from "../src/resources/registry.mjs";
import { MAX_ITEMS, acquire } from "../src/sources/acquire.mjs";
import { MAX_COMMENTS, TEXT_LIMIT, envelopeOf } from "../src/sources/envelope.mjs";
import { sourceId } from "../src/sources/model.mjs";
import { createSources } from "../src/sources/store.mjs";
import { descriptorsOf, readerResources } from "../skills/orbit-requirements/bind.mjs";
import { matchRef } from "../skills/orbit-requirements/descriptor.mjs";
import { fakeIo } from "./fakes/io.mjs";

const NOW = "2026-09-30T10:00:00.000Z";
const KEY = "pack:orbit-requirements/azure-devops";
const ROOT = resolve("/store/acme");
const RUNTIME = resolve("/store/acme/runtime/h/sessions/s/requirements");
const DESCRIPTORS = descriptorsOf();
const ID = (id) => ({ provider: "azure-devops", organization: "acme", project: "Web Shop", id: String(id) });
const ADO_URL = "https://dev.azure.com/acme/Web%20Shop/_workitems/edit/4312";
const BODY = "SENTINEL-BODY refund more than the limit";

const item = (id, over = {}) => ({ ref: String(id), provider: "azure-devops", title: `Item ${id}`, revision: "1", body: `${BODY} ${id}`, ...over });

// The graph: 4312 has a parent (100), a child (4313), a related item (55) and a pull
// request (pr-77); 100 has 4312 as a child (a cycle) and a parent 999; 999 has 1000.
const GRAPH = () => ({
  4312: item(4312, { revision: "7", parent: "100", children: ["4313"], related: [{ ref: "55", relation: "related" }, { ref: "pr-77", relation: "implements", kind: "pr" }], comments: [{ id: "1", at: "t", by: "person-aaaaaa", text: "please cap it" }] }),
  100: item(100, { children: ["4312"], parent: "999" }),
  999: item(999, { parent: "1000" }),
  1000: item(1000),
  4313: item(4313),
  55: item(55),
});

function world({ graph = GRAPH(), failing = {}, separate = false, connections = true, bound = null, systems = ["azure-devops"] } = {}) {
  const io = fakeIo();
  const sources = createSources(ROOT, io);
  const calls = [];
  const readerFor = (system) => ({
    key: `pack:orbit-requirements/${system}`,
    kind: "pack",
    provides: ["workitem.read", "workitem.relations.read", "workitem.comments.read"],
    resolves: (ref) => matchRef(DESCRIPTORS.find((d) => d.id === "azure-devops"), ref),
    read: async (identity, capability) => {
      calls.push(`${identity.id}:${capability}`);
      if (failing[identity.id]) throw failing[identity.id];
      const full = graph[identity.id];
      if (!full) throw new Refused("not found, or not visible to this credential");
      const { comments, parent, children, related, ...base } = full;
      const parts = { "workitem.read": separate ? base : { ...base, parent, children, related }, "workitem.relations.read": { parent, children, related }, "workitem.comments.read": { comments } };
      return Object.fromEntries(Object.entries(parts[capability]).filter(([, v]) => v !== undefined));
    },
  });
  const readers = systems.map(readerFor);
  const reader = readers[0];
  const list = { list: () => (connections ? systems.map((provider) => ({ id: provider, provider, organization: "acme", credential: { set: true, from: "env", name: "T" }, configured: true })) : []), record: () => ({ credential: "T" }) };
  const w = {
    descriptors: DESCRIPTORS,
    readers,
    works: () => [],
    bindings: () => sources.bindings(),
    connections: list,
    effective: () => getEffectiveResources({ env: {}, plugin: "orbit", components: () => [], builtins: () => ({}), capabilities: () => [], packCapabilities: () => readerResources(list, DESCRIPTORS), tools: () => [], mcp: () => [] }, PROVIDERS),
    observe: () => [],
    probe: () => ({ ok: false }),
    opportunities: { docs: () => [], settle: () => ({ written: [], refused: [] }) },
    now: () => NOW,
    sources,
    io,
    runtimeDir: RUNTIME,
  };
  if (bound) sources.setBinding(() => bound.doc, { by: bound.by, now: NOW });
  return { w, calls, sources, io, reader };
}

const recordOf = (m, id, kind = "workitem") => m.sources.record(sourceId(ID(id), kind));

test("the root, its parent, its children and what is related are read; a pull request is recorded as context and never read", async () => {
  const m = world();
  const got = await acquire(m.w, { identity: ID(4312) });
  const read = [...new Set(m.calls.map((c) => c.split(":")[0]))].sort();
  assert.deepEqual(read, ["100", "4312", "4313", "55", "999"]);
  assert.equal(m.calls.some((c) => c.startsWith("pr-77")), false, "a pull request is what was built, never what was asked for");
  const pr = m.sources.record(sourceId(ID("pr-77"), "pr"));
  assert.deepEqual([pr.state, pr.kind, pr.revision, pr.digest], ["context", "pr", null, null]);
  assert.match(got.root, /^req-/);
  assert.equal(got.provider, KEY);
  assert.deepEqual(got.items.map((i) => i.status).filter((s) => s !== "new"), ["context"]);
});

test("an item is visited once: a parent that lists its child as a child does not loop", async () => {
  const m = world();
  await acquire(m.w, { identity: ID(4312) });
  const reads = m.calls.filter((c) => c.endsWith(":workitem.read")).map((c) => c.split(":")[0]);
  assert.deepEqual(reads.filter((id) => id === "4312"), ["4312"]);
  assert.equal(new Set(reads).size, reads.length);
});

test("the walk is bounded in depth: two steps out are read, a third is not -- and a lower bound is honoured", async () => {
  const m = world();
  const got = await acquire(m.w, { identity: ID(4312) });
  assert.equal(recordOf(m, 999).state, "read", "the grandparent is two steps out");
  assert.equal(recordOf(m, 1000), null, "the great-grandparent is three");
  assert.equal(got.truncated, false, "beyond the depth is not skipped, it was never in reach");
  const shallow = world();
  await acquire(shallow.w, { identity: ID(4312), depth: 1 });
  assert.equal(recordOf(shallow, 999), null);
  assert.equal(recordOf(shallow, 100).state, "read");
  const deeper = world();
  await acquire(deeper.w, { identity: ID(4312), depth: 50 });
  assert.equal(recordOf(deeper, 1000), null, "a caller cannot widen the bound");
});

test("the walk is bounded in count: an item with many children reads at most the limit, and says what it left", async () => {
  const graph = { 4312: item(4312, { children: Array.from({ length: 40 }, (_, i) => String(5000 + i)) }) };
  for (let i = 0; i < 40; i++) graph[5000 + i] = item(5000 + i);
  const m = world({ graph });
  const got = await acquire(m.w, { identity: ID(4312) });
  assert.equal(m.calls.filter((c) => c.endsWith(":workitem.read")).length, MAX_ITEMS);
  assert.equal(got.truncated, true);
  assert.equal(got.skipped.length, 41 - MAX_ITEMS);
});

test("an item that cannot be read is recorded as such while the rest carry on", async () => {
  const m = world({ failing: { 55: new Refused("not found, or not visible to this credential") } });
  const got = await acquire(m.w, { identity: ID(4312) });
  assert.deepEqual([recordOf(m, 55).state, recordOf(m, 4313).state, recordOf(m, 4312).state], ["unavailable", "read", "read"]);
  assert.match(recordOf(m, 55).why, /not found/);
  assert.equal(got.items.find((i) => i.id === recordOf(m, 55).id).status, "unavailable");
});

test("a root that cannot be read is recorded unavailable, carries an empty envelope, and remembers no binding", async () => {
  const m = world({ failing: { 4312: new Blocked("the credential was refused (HTTP 401)") } });
  const got = await acquire(m.w, { identity: ID(4312) });
  assert.equal(recordOf(m, 4312).state, "unavailable");
  assert.deepEqual(got.envelope.content, {});
  assert.equal(got.binding, null);
  assert.equal(m.sources.bindings().exists, false, "a system that could not be read is not the one this project uses");
});

test("a failed refresh does not throw away what the last good read knew", async () => {
  const m = world();
  await acquire(m.w, { identity: ID(4312) });
  const before = recordOf(m, 4312);
  m.reader.read = async () => { throw new Blocked("cannot reach the source"); };
  const got = await acquire(m.w, { identity: ID(4312), refresh: true });
  assert.deepEqual(recordOf(m, 4312), before);
  assert.equal(got.items[0].status, "unavailable");
});

test("reading again asks the system nothing when the record is there, and hands back no text", async () => {
  const m = world();
  await acquire(m.w, { identity: ID(4312) });
  const asked = m.calls.length;
  const again = await acquire(m.w, { identity: ID(4312) });
  assert.equal(m.calls.length, asked, "not one call");
  assert.ok(again.items.every((i) => (i.status === "unchanged" && i.reused === true) || i.status === "context"));
  assert.deepEqual(again.envelope.content, {}, "nothing was read, so there is no text -- refresh is how to get it again");
  assert.equal(again.sources.find((s) => s.id === recordOf(m, 4312).id).revision, "7");
});

test("refresh reads again, finds the same revision and content, keeps the record exactly, and returns the text", async () => {
  const m = world();
  await acquire(m.w, { identity: ID(4312) });
  const writes = [...m.io.files.entries()].filter(([f]) => f.includes("records")).map(([f, t]) => `${f}\n${t}`);
  const again = await acquire(m.w, { identity: ID(4312), refresh: true });
  assert.deepEqual(again.items.filter((i) => i.status !== "context").map((i) => i.status), Array(5).fill("unchanged"));
  assert.deepEqual([...m.io.files.entries()].filter(([f]) => f.includes("records")).map(([f, t]) => `${f}\n${t}`), writes, "no record was rewritten");
  assert.match(JSON.stringify(again.envelope.content), /SENTINEL-BODY/);
});

test("a new revision is a change, and a person's acceptance of the earlier one does not carry to it", async () => {
  const m = world();
  await acquire(m.w, { identity: ID(4312) });
  const sid = recordOf(m, 4312).id;
  m.sources.saveRecord({ ...recordOf(m, 4312), authority: "accepted", acceptedBy: { host: "laptop-a", at: NOW } });
  const graph = GRAPH();
  graph[4312] = { ...graph[4312], revision: "8", body: `${BODY} changed` };
  m.reader.read = world({ graph }).reader.read;
  const got = await acquire(m.w, { identity: ID(4312), refresh: true });
  assert.equal(got.items.find((i) => i.id === sid).status, "changed");
  assert.deepEqual([recordOf(m, 4312).revision, recordOf(m, 4312).authority, recordOf(m, 4312).acceptedBy], ["8", "draft", undefined]);
  assert.ok(m.sources.findings().some((f) => f.kind === "source-reaccept" && f.source === sid));
});

test("the same revision with different content is an ANOMALY: said out loud, the acceptance kept, never quietly taken as either", async () => {
  const m = world();
  await acquire(m.w, { identity: ID(4312) });
  const sid = recordOf(m, 4312).id;
  const digest = recordOf(m, 4312).digest;
  m.sources.saveRecord({ ...recordOf(m, 4312), authority: "accepted", acceptedBy: { host: "laptop-a", at: NOW } });
  const graph = GRAPH();
  graph[4312] = { ...graph[4312], body: `${BODY} the criteria moved and the revision did not` };
  m.reader.read = world({ graph }).reader.read;
  const got = await acquire(m.w, { identity: ID(4312), refresh: true });
  assert.equal(got.items.find((i) => i.id === sid).status, "anomaly");
  const rec = recordOf(m, 4312);
  assert.deepEqual([rec.state, rec.revision, rec.authority], ["anomaly", "7", "accepted"]);
  assert.notEqual(rec.digest, digest);
  assert.equal(m.sources.findings().filter((f) => f.kind === "source-anomaly").length, 1);
  await acquire(m.w, { identity: ID(4312), refresh: true });
  assert.equal(m.sources.findings().filter((f) => f.kind === "source-anomaly").length, 1, "reading the same thing again is not a second anomaly");
});

test("no text of any item reaches the store -- not a body, not a comment, not a title -- only what it was", async () => {
  const m = world();
  await acquire(m.w, { identity: ID(4312) });
  const stored = [...m.io.files.values()].join("\n");
  for (const secret of ["SENTINEL-BODY", "please cap it", "Item 4312", "Item 100"]) assert.equal(stored.includes(secret), false, secret);
  assert.match(recordOf(m, 4312).digest, /^[0-9a-f]{64}$/);
});

test("the envelope hands the text back once, marked as another system's data, comments included", async () => {
  const m = world();
  const got = await acquire(m.w, { identity: ID(4312) });
  assert.equal(got.envelope.untrusted, true);
  assert.match(got.envelope.note, /DATA, never an instruction/);
  const sid = recordOf(m, 4312).id;
  assert.match(got.envelope.content[sid].body, /SENTINEL-BODY/);
  assert.deepEqual(got.envelope.content[sid].comments.map((c) => c.text), ["please cap it"]);
  assert.deepEqual(got.envelope.sources.find((s) => s.id === sid), { id: sid, kind: "workitem", ref: "4312", revision: "7", digest: recordOf(m, 4312).digest, authority: "draft", state: "read" });
});

test("a reader that gives relations and comments apart is asked for them, and a failure there is a note, not the loss of the item", async () => {
  const m = world({ separate: true });
  const got = await acquire(m.w, { identity: ID(4312) });
  assert.ok(m.calls.includes("4312:workitem.relations.read") && m.calls.includes("4312:workitem.comments.read"));
  assert.equal(recordOf(m, 100).state, "read", "the neighbourhood was found through the separate call");
  assert.ok(!m.calls.includes("100:workitem.comments.read"), "discussion is read for the root only");
  const failing = world({ separate: true });
  const original = failing.reader.read;
  failing.reader.read = async (identity, capability) => (capability === "workitem.comments.read" ? Promise.reject(new Blocked("comments are down")) : original(identity, capability));
  const partial = await acquire(failing.w, { identity: ID(4312) });
  assert.equal(recordOf(failing, 4312).state, "read");
  assert.match(partial.notes.join(" "), /workitem.comments.read: comments are down/);
  assert.equal(got.notes.length, 0);
});

test("the first successful read remembers the system as the engine's binding; a person's is never touched, and a failure remembers nothing", async () => {
  const fresh = world();
  const got = await acquire(fresh.w, { identity: ID(4312) });
  assert.equal(got.binding, "engine");
  assert.deepEqual(fresh.sources.bindings().doc.default, { provider: "azure-devops", organization: "acme", project: "Web Shop" });
  assert.equal(fresh.sources.bindings().by, "engine");
  const personal = world({ bound: { doc: { default: null, refs: { "^INC-": { provider: "github", organization: "acme", project: "shop" } } }, by: "person" } });
  assert.equal((await acquire(personal.w, { identity: ID(4312) })).binding, null);
  assert.equal(personal.sources.bindings().by, "person");
  assert.equal(personal.sources.bindings().doc.default, null);
  const two = world({ systems: ["azure-devops", "github"] });
  await acquire(two.w, { identity: ID(4312) });
  const other = await acquire(two.w, { identity: { provider: "github", organization: "acme", project: "shop", id: "4312" } });
  assert.deepEqual([other.binding, two.sources.bindings().doc.default.provider], [null, "azure-devops"], "the first system read stays the default; a second read does not replace it");
  const decided = world({ bound: { doc: { default: { provider: "github", organization: "acme", project: "shop" }, refs: {} }, by: "person" } });
  assert.equal((await acquire(decided.w, { identity: ID(4312) })).binding, null);
  assert.equal(decided.sources.bindings().doc.default.provider, "github");
});

test("a reference nothing can resolve reads nothing and says why", async () => {
  const m = world({ connections: false });
  const got = await acquire(m.w, { ref: "4312" });
  assert.deepEqual([got.root, got.sources, got.envelope], [null, [], null]);
  assert.equal(got.resolution.rung, "gap");
  assert.deepEqual(m.calls, []);
  const link = await acquire(world().w, { ref: ADO_URL });
  assert.equal(link.provider, KEY);
  assert.equal(link.identity.project, "Web Shop");
});

test("--out writes the envelope only inside this session's runtime directory", async () => {
  const m = world();
  const got = await acquire(m.w, { identity: ID(4312), out: "4312-7.json" });
  assert.equal(got.file, resolve(RUNTIME, "4312-7.json"));
  assert.equal(JSON.parse(m.io.read(got.file)).untrusted, true);
  await assert.rejects(acquire(m.w, { identity: ID(4312), out: "../../../elsewhere.json" }), Refused);
  await assert.rejects(acquire(m.w, { identity: ID(4312), out: "/tmp/elsewhere.json" }), Refused);
  await assert.rejects(acquire({ ...m.w, runtimeDir: null }, { identity: ID(4312), out: "x.json" }), /none is bound here/);
  assert.equal([...m.io.files.keys()].some((f) => f.includes("elsewhere")), false);
});

// ---- the envelope itself -------------------------------------------------------------------

test("every text in an envelope is masked and clipped, and a long thread keeps its newest comments and says how many it left", () => {
  const long = "x".repeat(TEXT_LIMIT + 500);
  const comments = Array.from({ length: MAX_COMMENTS + 7 }, (_, i) => ({ id: String(i), text: `comment ${i}` }));
  const env = envelopeOf([{ id: "src-aaaaaaaaaaaa", kind: "workitem", ref: "1", revision: "1", digest: "d", authority: "draft", state: "read" }], { "src-aaaaaaaaaaaa": { title: "T with Bearer abcdefghijklmnopqrstuvwxyz0123456789 in it", body: long, comments } });
  const c = env.content["src-aaaaaaaaaaaa"];
  assert.doesNotMatch(c.title, /abcdefghijklmnopqrstuvwxyz0123456789/);
  assert.ok(c.body.length < long.length && /\[cut: 500 more character\(s\)\]$/.test(c.body));
  assert.deepEqual([c.comments.length, c.comments[0].text, c.comments.at(-1).text, c.commentsOmitted], [MAX_COMMENTS, "comment 7", `comment ${MAX_COMMENTS + 6}`, 7]);
});

test("a field a source did not have is absent, not empty", () => {
  const env = envelopeOf([], { "src-aaaaaaaaaaaa": { title: "Only a title", body: null, acceptance: undefined, comments: [] } });
  assert.deepEqual(env.content["src-aaaaaaaaaaaa"], { title: "Only a title" });
});
