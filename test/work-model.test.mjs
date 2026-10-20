// A work is a journal and a fold over it. Nothing is stored beside the journal, so the state
// of a need, the frontier and what is stale can never disagree with what was written.
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test, { after } from "node:test";
import { Blocked, Refused } from "../src/errors.mjs";
import { realIo } from "../src/store/io.mjs";
import { DIR, createWorks, workOf } from "../src/work/store.mjs";
import { NEED_TYPE_NAMES, PREFIX, WORK_SCHEMA, rankOf } from "../src/work/vocab.mjs";
import { frontierOf, modelOf, needId, nextId, stateOf, statesOf } from "../src/work/model.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = "req-3f9a1c0b7e21";
const WID = workOf(ROOT);
const AT = "2026-09-30T10:00:00.000Z";

const room = (opts) => {
  const io = fakeIo(opts);
  return { io, works: createWorks("/store/acme", io) };
};

const started = (works) => works.create({ id: WID, objective: "Implement the refund limit", root: { id: "4312" }, snapshot: "rs-aaaaaaaaaaaa", by: "person", at: AT });

const need = (type, subject, extra = {}) => ({ id: needId(WID, type, extra.capability ?? null, subject), type, subject, asks: `about ${subject}`, ...extra });

const fold = (works) => modelOf(works.read(WID));

test("a work's id is the requirement's, spelled for work", () => {
  assert.equal(WID, "w-3f9a1c0b7e21");
  assert.equal(needId(WID, "action", "x.y", "s"), needId(WID, "action", "x.y", "s"));
  assert.notEqual(needId(WID, "action", "x.y", "s"), needId(WID, "proof", "x.y", "s"));
});

test("reading a work nobody started creates nothing and says so", () => {
  const { io, works } = room();
  assert.equal(works.read(WID), null);
  assert.equal(works.exists(WID), false);
  assert.equal(works.byRoot(ROOT), null);
  assert.equal(io.files.size, 0);
  assert.equal(io.dirs.size, 0);
});

test("starting a work twice is refused; the second start finds the first", () => {
  const { works } = room();
  started(works);
  assert.throws(() => started(works), Refused);
  assert.equal(works.byRoot(ROOT), WID);
});

test("an id that is not a work id never reaches a path", () => {
  const { works } = room();
  for (const bad of ["../x", "w-zz", "inv-1", "w-3f9a1c0b7e2"]) assert.throws(() => works.read(bad));
});

test("a record keeps only what its kind declares, scrubbed", () => {
  const { io, works } = room();
  started(works);
  works.append(WID, "need", { ...need("action", "s"), password: "hunter2", asks: "call with Bearer abcdefghijklmnopqrstuvwxyz0123456789ABCD" });
  const text = io.files.get(join(resolve("/store/acme"), DIR, WID, "journal.jsonl"));
  assert.doesNotMatch(text, /hunter2|abcdefghijklmnopqrstuvwxyz0123456789ABCD/);
  assert.throws(() => works.append(WID, "verdict", {}), Refused);
});

test("a torn last line is ended, so the next record survives", () => {
  const { io, works } = room();
  started(works);
  const file = join(resolve("/store/acme"), DIR, WID, "journal.jsonl");
  io.files.set(file, `${io.files.get(file)}{"kind":"need","id":"nd-tor`);
  works.append(WID, "need", need("action", "after"));
  assert.deepEqual(works.read(WID).map((r) => r.kind), ["created", "need"]);
});

test("a journal from a newer engine is refused, never guessed at", () => {
  const { works } = room();
  works.create({ id: WID, objective: "x", schema: WORK_SCHEMA + 1 });
  assert.throws(() => fold(works), Refused);
});

test("the same need proposed twice is one need", () => {
  const { works } = room();
  started(works);
  works.append(WID, "need", need("action", "s"));
  works.append(WID, "need", need("action", "s", { asks: "reworded" }));
  assert.equal(fold(works).needs.size, 1);
});

test("a need is pending, then satisfied by a settling, then stale when something it rests on moves", () => {
  const { works } = room();
  started(works);
  const n = need("knowledge", "limit", { capability: "documentation.search" });
  works.append(WID, "need", n);
  assert.equal(stateOf(n, fold(works)), "pending");
  works.append(WID, "settled", { id: "stl-1", need: n.id, state: "satisfied", evidence: ["rct-1"] });
  assert.equal(stateOf(n, fold(works)), "satisfied");
  works.append(WID, "stale", { id: "sta-1", need: n.id, because: "fact", from: "rf-1" });
  assert.equal(stateOf(n, fold(works)), "stale");
  works.append(WID, "settled", { id: "stl-2", need: n.id, state: "satisfied" });
  assert.equal(stateOf(n, fold(works)), "satisfied");
});

test("every state row is reachable, and the table ends in one that always answers", () => {
  const { works } = room();
  started(works);
  const [a, b, c, d] = ["a", "b", "c", "d"].map((s) => need("action", s, { capability: "x.y" }));
  for (const n of [a, b, c, d]) works.append(WID, "need", n);
  works.append(WID, "settled", { id: "stl-1", need: a.id, state: "not-applicable" });
  works.append(WID, "settled", { id: "stl-2", need: b.id, state: "blocked", why: "waiting" });
  works.append(WID, "binding", { id: "bnd-1", need: c.id, provider: { key: "k" }, status: "gap" });
  const states = Object.fromEntries(statesOf(fold(works)).map((s) => [s.need, s.state]));
  assert.deepEqual([states[a.id], states[b.id], states[c.id], states[d.id]], ["not-applicable", "blocked", "blocked", "pending"]);
});

test("a stale need caused by a moved provider is cleared by binding again; one caused by a fact is not", () => {
  const { works } = room();
  started(works);
  const moved = need("action", "moved", { capability: "x.y" });
  const fact = need("action", "fact", { capability: "x.y" });
  for (const n of [moved, fact]) works.append(WID, "need", n);
  works.append(WID, "stale", { id: "sta-1", need: moved.id, because: "binding" });
  works.append(WID, "stale", { id: "sta-2", need: fact.id, because: "fact" });
  works.append(WID, "binding", { id: "bnd-1", need: moved.id, provider: { key: "k" }, status: "provided" });
  works.append(WID, "binding", { id: "bnd-2", need: fact.id, provider: { key: "k" }, status: "provided" });
  const model = fold(works);
  assert.deepEqual([stateOf(moved, model), stateOf(fact, model)], ["pending", "stale"]);
});

test("the frontier is the pending needs whose dependencies are met, proof before knowledge before action", () => {
  const { works } = room();
  started(works);
  const proof = need("proof", "p");
  const know = need("knowledge", "k");
  const act = need("action", "a");
  const waits = need("action", "waits", { dependsOn: [act.id] });
  const onFact = need("action", "onfact", { dependsOn: ["rf-1"] });
  const onMissing = need("action", "onmissing", { dependsOn: ["rf-2"] });
  for (const n of [act, waits, know, onFact, onMissing, proof]) works.append(WID, "need", n);
  const snapshot = { facts: [{ id: "rf-1", status: "stated" }, { id: "rf-2", status: "unknown" }] };
  const ids = (m) => frontierOf(m, snapshot).map((n) => n.id);
  assert.deepEqual(ids(fold(works)), [proof.id, know.id, ...[act.id, onFact.id].sort()]);
  works.append(WID, "settled", { id: "stl-1", need: act.id, state: "satisfied" });
  assert.ok(ids(fold(works)).includes(waits.id));
  assert.ok(!ids(fold(works)).includes(onMissing.id));
});

test("a need settled as not applicable also frees what waited on it", () => {
  const { works } = room();
  started(works);
  const first = need("action", "first");
  const then = need("action", "then", { dependsOn: [first.id] });
  for (const n of [first, then]) works.append(WID, "need", n);
  works.append(WID, "settled", { id: "stl-1", need: first.id, state: "not-applicable" });
  assert.deepEqual(frontierOf(fold(works), null).map((n) => n.id), [then.id]);
});

test("ids are counted per kind, and the model reports the last adopted snapshot", () => {
  const { works } = room();
  started(works);
  works.append(WID, "snapshot", { id: "snp-1", snapshot: "rs-aaaaaaaaaaaa", digest: "d1", clarity: "partial", authority: "draft" });
  works.append(WID, "snapshot", { id: "snp-2", snapshot: "rs-bbbbbbbbbbbb", digest: "d2", clarity: "complete", authority: "draft" });
  const model = fold(works);
  assert.equal(nextId(model, "snapshot"), `${PREFIX.snapshot}-3`);
  assert.equal(model.snapshot.snapshot, "rs-bbbbbbbbbbbb");
  assert.equal(model.position, 3);
});

test("need types are a table with a rank, and an unknown type ranks last", () => {
  assert.deepEqual(NEED_TYPE_NAMES, ["proof", "knowledge", "action"]);
  assert.ok(rankOf("proof") < rankOf("knowledge") && rankOf("knowledge") < rankOf("action") && rankOf("action") < rankOf("nonsense"));
});

test("a journal record never carries a field called kind of its own", () => {
  const { works } = room();
  started(works);
  works.append(WID, "need", { ...need("action", "s"), kind: "hijack" });
  assert.equal(works.read(WID).at(-1).kind, "need");
});

test("listing the works on a real disk finds the ones started, and only those", () => {
  const dir = mkdtempSync(join(tmpdir(), "work-list-"));
  after(() => rmSync(dir, { recursive: true, force: true }));
  const works = createWorks(dir, realIo({ host: "h" }));
  works.create({ id: WID, objective: "x" });
  assert.deepEqual(works.list(), [WID]);
  assert.ok(readdirSync(join(dir, DIR)).includes(WID));
});

test("a second writer that cannot get the lock is told in words about its work", () => {
  const { io, works } = room({ mkdirFails: 99, backoff: [1] });
  assert.throws(() => works.transact(WID, () => 1), (e) => e instanceof Blocked && /work/.test(e.message));
  assert.ok(io.state.slept >= 0);
});
