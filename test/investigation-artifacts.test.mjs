// What a generated test is bound to, kept as ARTIFACTS (doc §10; ADR 0032): written once under the name of
// their own digest, never through a link, never outside the room, and never read once their bytes stopped
// matching their name -- a frozen case version included, which is only ever the case it was frozen as.
import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { Refused } from "../src/errors.mjs";
import { canonicalJson, sha } from "../src/hash.mjs";
import { caseDigest } from "../src/dsl/digest.mjs";
import { freezeVersion } from "../src/qa/generation/version.mjs";
import { ARTIFACT_KINDS, createInvestigations, JOURNAL } from "../src/investigation/store.mjs";
import { PROGRESS_KINDS } from "../src/investigation/vocab.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = "/store/repo-1";
const ID = "inv-20261021-120000-abcd";
const refused = (re) => (e) => e instanceof Refused && re.test(e.message);

function room(opts = {}) {
  const io = fakeIo(opts);
  const store = createInvestigations(ROOT, io);
  store.create({ id: ID, objective: "x" });
  return { io, store, dir: store.dirOf(ID) };
}

const CASE = { id: "reminder-once", name: "one reminder per occurrence", seen: "src", steps: [{ do: "call", capability: "orbit.state.read", proves: "sql", input: { stateRef: "reminders" }, expect: "it.count === 1" }] };

test("the kinds of artifact are a table, and nothing else is kept", () => {
  assert.deepEqual(ARTIFACT_KINDS.map((k) => k.id), ["bindings", "obligations", "designs", "versions", "results", "assessments", "graphs", "catalogs"]);
  const t = room();
  assert.throws(() => t.store.putArtifact(ID, "secrets", {}), refused(/keeps no "secrets" artifact/));
  assert.throws(() => t.store.putArtifact(ID, "../evidence", {}), refused(/keeps no/));
});

test("written once, under the name of its own digest: the same document again is nothing", () => {
  const t = room();
  const a = t.store.putArtifact(ID, "designs", { b: 2, a: 1 });
  assert.equal(a.digest, sha(canonicalJson({ a: 1, b: 2 })));
  assert.equal(a.path, `artifacts/designs/${a.digest}.json`);
  const before = t.io.files.size;
  assert.deepEqual(t.store.putArtifact(ID, "designs", { a: 1, b: 2 }), a);
  assert.equal(t.io.files.size, before, "nothing new was written");
  assert.deepEqual(t.store.readArtifact(ID, "designs", a.digest), { a: 1, b: 2 });
});

test("other bytes where an artifact already is are refused, and the file is kept as it is", () => {
  const t = room();
  const digest = sha(canonicalJson({ a: 1 }));
  const file = join(t.dir, "artifacts", "designs", `${digest}.json`);
  t.io.files.set(file, "somebody else's bytes");
  assert.throws(() => t.store.putArtifact(ID, "designs", { a: 1 }), refused(/already holds other bytes — an artifact is written once/));
  assert.equal(t.io.files.get(file), "somebody else's bytes");
});

test("a hand-edited artifact is never read, and is kept", () => {
  const t = room();
  const { digest } = t.store.putArtifact(ID, "results", { outcome: "INCONCLUSIVE" });
  const file = join(t.dir, "artifacts", "results", `${digest}.json`);
  t.io.files.set(file, canonicalJson({ outcome: "SATISFIED" }));
  assert.throws(() => t.store.readArtifact(ID, "results", digest), refused(/no longer holds what its name says — it is kept as it is and never read/));
  assert.equal(t.io.files.get(file), canonicalJson({ outcome: "SATISFIED" }));
  assert.equal(t.store.readArtifact(ID, "results", "0".repeat(64)), null, "an artifact that was never written is absent, not an error");
});

test("nothing is read or written through a link, and no name leaves the room", () => {
  const t = room();
  const linked = room({ symlinks: [join(t.dir, "artifacts")] });
  assert.throws(() => linked.store.putArtifact(ID, "designs", { a: 1 }), refused(/is a link — nothing in an investigation is read or written through a link/));
  assert.throws(() => t.store.readArtifact(ID, "designs", "../../journal"), refused(/is not an artifact digest/));
  assert.throws(() => t.store.putVersion(ID, { path: "versions/../../journal.jsonl", case: {}, version: {} }), refused(/is not a frozen version's path/));
  assert.throws(() => t.store.putArtifact("../../etc", "designs", {}), /does not look like/);
  assert.throws(() => t.store.progressFile(ID, "../exe-1"), /does not look like/);
});

test("freezeVersion: the case as written under its own id, its digest the one a run records, the sidecar held to its definition", () => {
  const frozen = freezeVersion({ case: { ...CASE, _file: "/drafts/x.json" }, design: "tds-rem001", versionNumber: 1, engineVersion: "0.1.0", validatorVersion: "0.1.0" });
  assert.equal(frozen.version.caseDigest, caseDigest(CASE));
  assert.equal(frozen.path, `versions/${caseDigest(CASE).slice(0, 16)}/reminder-once.json`);
  assert.equal(frozen.id, `reminder-once@${caseDigest(CASE).slice(0, 16)}`);
  assert.ok(!("_file" in frozen.case), "the loader's own fields are not the case");
  assert.throws(() => freezeVersion({ case: { ...CASE, id: "../x" }, versionNumber: 1 }), refused(/cannot be frozen — its id names its file/));
  assert.throws(() => freezeVersion({ case: CASE, versionNumber: 0 }), refused(/version must be at least 1/));
  assert.throws(() => freezeVersion({ case: CASE, versionNumber: 1, dslDigest: "not-a-digest" }), refused(/dslDigest does not look like/));
});

test("a frozen version is written once and read only while it is still the case it was frozen as", () => {
  const t = room();
  const frozen = freezeVersion({ case: CASE, design: "tds-rem001", versionNumber: 1, engineVersion: "0.1.0" });
  const put = t.store.putVersion(ID, frozen);
  assert.equal(put.path, `artifacts/${frozen.path}`);
  assert.deepEqual(t.store.putVersion(ID, frozen), put, "the same version again is nothing");
  const read = t.store.readVersion(ID, frozen.path);
  assert.equal(caseDigest(read.case), frozen.version.caseDigest, "key order kept, so the digest is the run's");
  assert.throws(() => t.store.putVersion(ID, { ...frozen, case: { ...frozen.case, name: "loosened" } }), refused(/already holds other bytes/), "a stale writer cannot save over a frozen case");
  t.io.files.set(put.file, `${JSON.stringify({ ...CASE, steps: [] }, null, 2)}\n`);
  assert.throws(() => t.store.readVersion(ID, frozen.path), refused(/is no longer the case it was frozen as — it is kept as it is and never run/));
});

test("a corrupt frozen document is refused with a sentence and preserved, never a crash", () => {
  const t = room();
  const frozen = freezeVersion({ case: CASE, versionNumber: 1 });
  const { file } = t.store.putVersion(ID, frozen);
  t.io.files.set(file, "{ not json");
  assert.throws(() => t.store.readVersion(ID, frozen.path), refused(/is not readable JSON — it is kept as it is and never run/));
  assert.equal(t.io.files.get(file), "{ not json");
});

test("a running test's progress goes beside the journal, allow-listed, numbered and bounded -- the journal never moves", () => {
  const t = room();
  const journalBefore = t.io.read(join(t.dir, JOURNAL));
  const a = t.store.appendProgress(ID, "exe-1", "delivery.observed", { channel: "reminders", message: "m-1", attempt: 2, redelivered: true, payload: { secret: "x" }, body: "y" });
  const b = t.store.appendProgress(ID, "exe-1", "message.settled", { message: "m-1", outcome: "acknowledged", reason: "w".repeat(2000) });
  assert.deepEqual([a.seq, b.seq], [0, 1]);
  const [first, second] = t.store.readProgress(ID, "exe-1");
  assert.deepEqual(Object.keys(first).sort(), ["at", "attempt", "authority", "channel", "execution", "kind", "message", "redelivered", "seq", "v"]);
  assert.equal(first.authority, "observation", "progress is an observation, never evidence a rule counts");
  assert.ok(second.reason.length <= 240, "free text is bounded");
  assert.equal(t.io.read(join(t.dir, JOURNAL)), journalBefore, "the journal's position is untouched");
  assert.throws(() => t.store.appendProgress(ID, "exe-1", "verdict.passed", {}), refused(/says no "verdict.passed"/));
  assert.ok(!Object.keys(PROGRESS_KINDS).some((k) => /verdict|pass|satisf/i.test(k)), "no progress word is a verdict");
});
