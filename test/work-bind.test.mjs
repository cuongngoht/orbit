// Binding a need to a provider, and knowing when that binding -- or the requirement, or the
// files -- moved under it. Everything here is the real thing except the machine: the real
// Effective Resource Registry, the real resolver, the real opportunity door.
import assert from "node:assert/strict";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { settle } from "../src/knowledge/opportunities.mjs";
import { asNeed, bindNeeds, fingerprintOf, revalidate } from "../src/work/bind.mjs";
import { changedFacts, invalidated } from "../src/work/freshness.mjs";
import { resource } from "../src/resources/model.mjs";
import { everyResource } from "../src/resources/registry.mjs";
import { frontierOf, modelOf, needId, stateOf } from "../src/work/model.mjs";
import { load, refreshed, resume, standing } from "../src/work/resume.mjs";
import { createWorks, workOf } from "../src/work/store.mjs";
import { fakeIo } from "./fakes/io.mjs";
import { knowledgeWorld, registryOf } from "./fakes/knowledge.mjs";

const NOW = "2026-09-30T10:00:00.000Z";
const ROOT = "req-3f9a1c0b7e21";
const WID = workOf(ROOT);

const server = (over = {}) => ({ id: "docs", key: "managed:docs", name: "docs", ownership: "orbit-managed", enabled: true, runtimeReady: true, available: true, eligible: true, selection: "automatic", priority: 0, state: "ready", provides: ["documentation.search"], signals: [], requiresSignal: false, ...over });

const snap = (id, facts) => ({ id, facts: facts.map(([fid, revision, status = "stated"]) => ({ id: fid, revision, status, digest: `d${revision}` })) });

// A machine the test can change under the work: what the registry lists, which snapshot is
// newest, what the files hash to.
function world(opts = {}) {
  const k = knowledgeWorld();
  const state = { mcp: opts.mcp ?? [server()], caps: opts.caps ?? [], docs: opts.docs ?? {}, latest: opts.latest ?? null, hashes: opts.hashes ?? {} };
  const works = createWorks("/store/acme", fakeIo({ now: () => NOW }));
  const source = { fingerprints: (scopes) => Object.fromEntries(scopes.map((s) => [s, { hash: state.hashes[s] ?? null, dirty: 0, files: 1 }])) };
  const w = { works, effective: () => registryOf(state.caps, { mcp: state.mcp }), snapshot: (id) => state.docs[id] ?? null, latestSnapshot: () => state.latest, opportunities: { docs: () => k.know.opportunities(), settle: (docs) => settle(k, docs) }, now: () => NOW, session: "s1", source };
  works.create({ id: WID, objective: "Implement the refund limit", root: { id: "4312" }, at: NOW });
  return { w, works, state, k };
}

const adopt = ({ works, state }, doc) => {
  state.docs[doc.id] = doc;
  works.append(WID, "snapshot", { id: `snp-${works.read(WID).filter((r) => r.kind === "snapshot").length + 1}`, snapshot: doc.id, digest: "x", clarity: "complete", authority: "draft" });
};

const propose = ({ works }, type, subject, extra = {}) => {
  const n = { id: needId(WID, type, extra.capability ?? null, subject), type, subject, asks: `about ${subject}`, ...extra };
  works.append(WID, "need", n);
  return n;
};

const fold = ({ works }) => modelOf(works.read(WID));
const stateNow = (m, n) => stateOf(n, fold(m));

test("a need is asked of the resolver as a derived requirement, in words about the work", () => {
  const ask = asNeed({ type: "knowledge", capability: "documentation.search", subject: "limit" });
  assert.deepEqual([ask.capability, ask.proves.subject, ask.conditional, ask.by], ["documentation.search", "limit", false, "work"]);
  assert.match(ask.because[0], /find out limit/);
});

test("binding is deterministic: the same registry twice adds no second line", () => {
  const m = world();
  const n = propose(m, "knowledge", "limit", { capability: "documentation.search" });
  const first = bindNeeds(m.w, fold(m));
  const again = bindNeeds(m.w, fold(m));
  assert.equal(first.bound.length, 1);
  assert.equal(again.bound.length, 0);
  const binding = fold(m).bindings.get(n.id);
  assert.deepEqual([binding.provider.key, binding.status], ["managed:docs", "provided"]);
});

test("a need with no capability is never bound, and a settled one is left alone", () => {
  const m = world();
  propose(m, "action", "edit the form");
  const done = propose(m, "knowledge", "limit", { capability: "documentation.search" });
  m.works.append(WID, "settled", { id: "stl-1", need: done.id, state: "satisfied", evidence: ["rct-1"] });
  assert.equal(bindNeeds(m.w, fold(m)).checked, 0);
});

test("the binding holds a key and a fingerprint; the need still holds only the capability", () => {
  const m = world();
  const n = propose(m, "knowledge", "limit", { capability: "documentation.search" });
  bindNeeds(m.w, fold(m));
  assert.deepEqual(Object.keys(fold(m).needs.get(n.id)).filter((k) => /provider|key|server/.test(k)), []);
  assert.match(fold(m).bindings.get(n.id).fingerprint, /^[0-9a-f]{16}$/);
});

test("a fingerprint follows what makes a provider eligible and nothing that only describes it", () => {
  const rows = (over) => everyResource(registryOf([], { mcp: [server(over)] })).find((r) => r.key === "managed:docs");
  const base = fingerprintOf(rows());
  assert.notEqual(base, fingerprintOf(rows({ enabled: false, eligible: false, available: false, runtimeReady: false })));
  assert.notEqual(base, fingerprintOf(rows({ priority: 5 })));
  assert.notEqual(base, fingerprintOf(rows({ state: "unknown" })));
  assert.equal(base, fingerprintOf(rows({ description: "reworded" })));
});

test("revalidate says current, moved or gone", () => {
  const m = world();
  const n = propose(m, "knowledge", "limit", { capability: "documentation.search" });
  bindNeeds(m.w, fold(m));
  const binding = fold(m).bindings.get(n.id);
  assert.equal(revalidate(binding, m.w.effective()), "current");
  m.state.mcp = [server({ priority: 9 })];
  assert.equal(revalidate(binding, m.w.effective()), "moved");
  m.state.mcp = [];
  assert.equal(revalidate(binding, m.w.effective()), "gone");
});

test("a provider that disappears stales only the need bound to it, and rebinding picks what is there", () => {
  const m = world();
  const bound = propose(m, "knowledge", "limit", { capability: "documentation.search" });
  const other = propose(m, "action", "edit");
  bindNeeds(m.w, fold(m));
  const before = fold(m).bindings.get(bound.id).provider.key;
  m.state.mcp = [];
  m.state.caps = [{ id: "documentation.search", doc: "a project's own reader" }];
  const done = refreshed(m.w, WID);
  assert.deepEqual(done.stale.map((s) => [s.need, s.because]), [[bound.id, "binding"]]);
  assert.equal(stateNow(m, bound), "pending", "resolved again, so it waits to be worked on");
  assert.notEqual(fold(m).bindings.get(bound.id).provider.key, before);
  assert.equal(stateNow(m, other), "pending");
});

test("with nothing left to provide it, the need is blocked and the gap is remembered once", () => {
  const m = world();
  const n = propose(m, "knowledge", "limit", { capability: "documentation.search" });
  m.state.mcp = [];
  resume(m.w, WID);
  resume(m.w, WID);
  assert.equal(stateNow(m, n), "blocked");
  assert.equal(fold(m).bindings.get(n.id).status, "gap");
  assert.equal(m.k.know.opportunities().length, 1, "one opportunity per capability, however many times it was looked at");
});

test("a settled need whose provider moved is stale until resolved again, then satisfied as before", () => {
  const m = world();
  const n = propose(m, "knowledge", "limit", { capability: "documentation.search" });
  bindNeeds(m.w, fold(m));
  m.works.append(WID, "settled", { id: "stl-1", need: n.id, state: "satisfied", evidence: ["rct-1"] });
  m.state.mcp = [server({ priority: 9 })];
  invalidated(m.w, fold(m));
  assert.equal(stateNow(m, n), "stale");
  bindNeeds(m.w, fold(m));
  assert.equal(stateNow(m, n), "satisfied");
});

test("only a change to a fact the need depends on stales it", () => {
  const m = world();
  adopt(m, snap("rs-1", [["rf-a", 1], ["rf-b", 1]]));
  const onA = propose(m, "action", "uses a", { dependsOn: ["rf-a"] });
  const onB = propose(m, "action", "uses b", { dependsOn: ["rf-b"] });
  const free = propose(m, "action", "uses none");
  m.state.latest = snap("rs-2", [["rf-a", 2, "decided"], ["rf-b", 1]]);
  invalidated(m.w, fold(m));
  assert.deepEqual([stateNow(m, onA), stateNow(m, onB), stateNow(m, free)], ["stale", "pending", "pending"]);
  assert.equal(fold(m).stale.get(onA.id)[0].from, "rf-a@2/decided");
});

test("a fact that went away counts as moved, and one that appeared touches nobody", () => {
  const changed = changedFacts(snap("rs-1", [["rf-a", 1]]), snap("rs-2", [["rf-b", 1]]));
  assert.deepEqual([...changed.keys()].sort(), ["rf-a", "rf-b"]);
  assert.equal(changedFacts(snap("rs-1", [["rf-a", 1]]), snap("rs-1", [["rf-a", 1]])).size, 0);
  assert.equal(changedFacts(null, snap("rs-2", [])).size, 0, "nothing to compare, nothing to say");
});

test("settling again and finding the same fact at the same revision does not stale it a second time", () => {
  const m = world();
  adopt(m, snap("rs-1", [["rf-a", 1]]));
  const n = propose(m, "action", "uses a", { dependsOn: ["rf-a"] });
  m.state.latest = snap("rs-2", [["rf-a", 2]]);
  invalidated(m.w, fold(m));
  m.works.append(WID, "settled", { id: "stl-1", need: n.id, state: "satisfied", evidence: ["rct-1"] });
  assert.equal(invalidated(m.w, fold(m)).length, 0);
  assert.equal(stateNow(m, n), "satisfied");
  m.state.latest = snap("rs-3", [["rf-a", 3]]);
  assert.equal(invalidated(m.w, fold(m)).length, 1, "a fact that moves AGAIN is a new reason");
});

test("a need that turned out not to be needed is never staled", () => {
  const m = world();
  adopt(m, snap("rs-1", [["rf-a", 1]]));
  const n = propose(m, "action", "uses a", { dependsOn: ["rf-a"] });
  m.works.append(WID, "settled", { id: "stl-1", need: n.id, state: "not-applicable" });
  m.state.latest = snap("rs-2", [["rf-a", 2]]);
  assert.equal(invalidated(m.w, fold(m)).length, 0);
});

test("files moving stale only the settled need that is about them", () => {
  const m = world({ hashes: { "src/a.ts": "h1", "src/b.ts": "h1" } });
  const a = propose(m, "action", "a", { scope: ["src/a.ts"] });
  const b = propose(m, "action", "b", { scope: ["src/b.ts"] });
  const pending = propose(m, "action", "c", { scope: ["src/a.ts"] });
  for (const [i, n] of [a, b].entries()) m.works.append(WID, "settled", { id: `stl-${i + 1}`, need: n.id, state: "satisfied", evidence: ["e"], scopes: { [n.scope[0]]: "h1" } });
  assert.equal(invalidated(m.w, fold(m)).length, 0, "nothing moved");
  m.state.hashes["src/a.ts"] = "h2";
  assert.deepEqual(invalidated(m.w, fold(m)).map((s) => [s.need, s.because]), [[a.id, "scope"]]);
  assert.deepEqual([stateNow(m, b), stateNow(m, pending)], ["satisfied", "pending"], "an unrelated need, and one with no result to go stale");
});

test("a scope nothing recorded a baseline for is unknown, never stale", () => {
  const m = world({ hashes: { "src/a.ts": "h9" } });
  const n = propose(m, "action", "a", { scope: ["src/a.ts"] });
  m.works.append(WID, "settled", { id: "stl-1", need: n.id, state: "satisfied", evidence: ["e"] });
  assert.equal(invalidated(m.w, fold(m)).length, 0);
});

test("resume writes a session line and reports the exact frontier, newer snapshot included", () => {
  const m = world();
  adopt(m, snap("rs-1", [["rf-a", 1]]));
  const done = propose(m, "knowledge", "limit", { capability: "documentation.search" });
  const waits = propose(m, "action", "then", { dependsOn: [done.id] });
  const free = propose(m, "action", "free");
  m.works.append(WID, "settled", { id: "stl-1", need: done.id, state: "satisfied", evidence: ["rct-1"] });
  m.state.latest = snap("rs-2", [["rf-a", 1]]);
  const out = resume(m.w, WID);
  assert.deepEqual(out.frontier.map((f) => f.need).sort(), [waits.id, free.id].sort());
  assert.equal(out.newer, "rs-2");
  assert.deepEqual(fold(m).resumed.map((r) => r.session), ["s1"]);
  assert.equal(standing(m.w, WID).snapshot, "rs-1", "resuming never adopts a newer snapshot by itself");
});

test("resuming a work nobody started is refused, in words about what to do", () => {
  const m = world();
  assert.throws(() => resume(m.w, "w-aaaaaaaaaaaa"), (e) => e instanceof Refused && /work start/.test(e.message));
  assert.throws(() => load(m.w, "w-aaaaaaaaaaaa"), Refused);
});

test("the frontier ignores a need waiting on a fact the adopted snapshot does not settle", () => {
  const m = world();
  adopt(m, snap("rs-1", [["rf-a", 1, "unknown"]]));
  propose(m, "action", "needs a", { dependsOn: ["rf-a"] });
  assert.equal(frontierOf(fold(m), m.state.docs["rs-1"]).length, 0);
});

test("a need already stale is not staled again for its files; the reason it already has stands", () => {
  const m = world({ hashes: { "src/a.ts": "h1" } });
  adopt(m, snap("rs-1", [["rf-a", 1]]));
  const n = propose(m, "action", "a", { scope: ["src/a.ts"], dependsOn: ["rf-a"] });
  m.works.append(WID, "settled", { id: "stl-1", need: n.id, state: "satisfied", evidence: ["e"], scopes: { "src/a.ts": "h1" } });
  m.state.latest = snap("rs-2", [["rf-a", 2]]);
  assert.deepEqual(invalidated(m.w, fold(m)).map((s) => s.because), ["fact"]);
  m.state.hashes["src/a.ts"] = "h2";
  assert.equal(invalidated(m.w, fold(m)).length, 0);
  assert.equal(stateNow(m, n), "stale");
});

test("when a fact and the files move together, both reasons are written", () => {
  const m = world({ hashes: { "src/a.ts": "h1" } });
  adopt(m, snap("rs-1", [["rf-a", 1]]));
  const n = propose(m, "action", "a", { scope: ["src/a.ts"], dependsOn: ["rf-a"] });
  m.works.append(WID, "settled", { id: "stl-1", need: n.id, state: "satisfied", evidence: ["e"], scopes: { "src/a.ts": "h1" } });
  m.state.latest = snap("rs-2", [["rf-a", 2]]);
  m.state.hashes["src/a.ts"] = "h2";
  assert.deepEqual(invalidated(m.w, fold(m)).map((s) => s.because).sort(), ["fact", "scope"]);
});

test("a skill and an agent that share a key are two providers: the binding follows the one that was chosen", () => {
  const m = world();
  const row = (over = {}) => ({ id: "same", key: "same", source: "plugin", ownership: "plugin", enabled: true, runtimeReady: true, available: true, state: "ready", ...over });
  let agentPriority = 7;
  let skillPriority = 0;
  m.w.effective = () => ({ skills: [resource("skill", row({ provides: ["some.capability"], priority: skillPriority }))], agents: [resource("agent", row({ priority: agentPriority }))] });
  const n = propose(m, "knowledge", "thing", { capability: "some.capability" });
  bindNeeds(m.w, fold(m));
  const binding = fold(m).bindings.get(n.id);
  const skill = everyResource(m.w.effective()).find((r) => r.kind === "skill");
  assert.deepEqual([binding.provider.kind, binding.fingerprint], ["skill", fingerprintOf(skill)], "the fingerprint is the skill's, not the agent's that shares its key");
  assert.equal(revalidate(binding, m.w.effective()), "current");
  agentPriority = 9;
  assert.equal(revalidate(binding, m.w.effective()), "current", "the other family's resource moving is not this binding's business");
  skillPriority = 3;
  assert.equal(revalidate(binding, m.w.effective()), "moved");
  const agent = everyResource(m.w.effective()).find((r) => r.kind === "agent");
  assert.equal(revalidate({ provider: { kind: "agent", key: "same" }, fingerprint: fingerprintOf(agent) }, m.w.effective()), "current", "and an agent's binding is checked against the agent, though a skill of that key is listed first");
});
