import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { CONFIDENCE, KINDS, KIND_NAMES, SOURCES, STATUS, claimableByObserver, routes, verifiedBy } from "../src/engineering/vocab.mjs";
import { CONFIDENCE as ARCH_CONFIDENCE, SOURCES as ARCH_SOURCES, STATUS as ARCH_STATUS } from "../src/architecture/vocab.mjs";
import { FACT_FIELDS, REQUIRED, STAMPED, allowedOn } from "../src/engineering/fields.mjs";
import { createEngineering, engineeringPaths } from "../src/engineering/store.mjs";
import { factFindings, factId, makeFact, verifiedAgainstSource } from "../src/engineering/model.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = "/store/acme";

const raw = (over = {}) => ({ kind: "pattern", key: "repository", statement: "Persistence access goes through repository abstractions", scope: ["src/Application"], evidence: ["src/Application/IOrderRepository.cs"], source: "repository", confidence: "certain", strength: "observed", ...over });

const store = () => {
  const io = fakeIo();
  return { io, eng: createEngineering(ROOT, io) };
};

test("a source is trusted only where its own row says so, and memory never is", () => {
  assert.equal(verifiedBy("repository"), true);
  assert.equal(verifiedBy("claude-memory"), false);
  assert.equal(verifiedBy("human-declared-memory"), false);
  assert.equal(verifiedBy("a source nobody declared"), false);
  const trusted = SOURCES.filter((s) => s.verified).map((s) => s.name);
  assert.ok(!trusted.includes("claude-memory"));
});

test("verifiedAgainstSource is computed from the row and cannot be set on a fact", () => {
  assert.equal(verifiedAgainstSource({ source: "repository" }), true);
  assert.equal(verifiedAgainstSource({ source: "claude-memory" }), false);
  assert.ok(!("verifiedAgainstSource" in FACT_FIELDS), "it must not be a field");
  const findings = factFindings(raw({ source: "claude-memory", verifiedAgainstSource: true }));
  assert.ok(findings.some((f) => /unknown field "verifiedAgainstSource"/.test(f)), findings.join(" · "));
});

test("a fact's id comes from what it is about, not from how it is worded", () => {
  const a = makeFact(raw());
  const b = makeFact(raw({ statement: "Completely different wording here" }));
  assert.equal(a.id, b.id);
  assert.equal(a.id, factId({ kind: "pattern", key: "repository" }));
  assert.notEqual(a.id, makeFact(raw({ key: "adapter" })).id);
  assert.match(a.id, /^eng-pattern-[0-9a-f]{8}$/);
});

test("the field table is what rejects a bad fact — no hand-written rule anywhere", () => {
  assert.deepEqual(factFindings(raw()), []);
  assert.ok(factFindings(raw({ scope: [] })).some((f) => /scope needs at least 1/.test(f)));
  assert.ok(factFindings(raw({ confidence: "quite sure" })).some((f) => /confidence must be/.test(f)));
  assert.ok(factFindings(raw({ strength: "mandatory" })).some((f) => /strength must be/.test(f)));
  assert.ok(factFindings({ kind: "pattern" }).some((f) => /no statement/.test(f)));
  for (const k of REQUIRED) assert.ok(k in FACT_FIELDS, `${k} is required but not declared`);
});

test("a misplaced field reads differently from an unknown one", () => {
  const misplaced = factFindings(raw({ kind: "convention", key: "naming", appliesWhen: ["x"] }));
  assert.ok(misplaced.some((f) => /appliesWhen belongs to a pattern fact, not to a convention one/.test(f)), misplaced.join(" · "));
  assert.ok(factFindings(raw({ nonsense: 1 })).some((f) => /unknown field "nonsense"/.test(f)));
  assert.deepEqual(factFindings(raw({ kind: "extension-point", key: "adapters", pattern: "one file per port" })), []);
});

// The gap a rushed first draft left open: a FIELD TABLE entry is not the same
// promise as "a candidate may set this". `support` is exactly how one
// dishonest submission could fake the two independent sessions
// reconcile.mjs requires for `certain`.
test("a candidate cannot stamp its own support, lastSeenBy or fingerprint", () => {
  for (const key of ["support", "lastSeenBy", "fingerprint"]) {
    assert.ok(STAMPED.includes(key), `${key} must be declared stamped`);
    const findings = factFindings(raw({ [key]: { examples: 99, sessions: 99 } }));
    assert.ok(findings.some((f) => f.includes(`"${key}" is stamped`)), `${key}: ${findings.join(" · ")}`);
  }
});

test("when, against what commit, and whether it still holds are stamped by the store", () => {
  const f = makeFact(raw(), { now: () => "2026-09-19T00:00:00.000Z", commit: "abc1234", fingerprint: "ff00", status: "fresh" });
  assert.equal(f.at, "2026-09-19T00:00:00.000Z");
  assert.equal(f.commit, "abc1234");
  assert.equal(f.status, "fresh");
  assert.deepEqual(f.unknowns, [], "always present, even empty");
  assert.ok(!("fingerprint" in makeFact(raw())), "an absent stamp is absent, never null");
});

test("prose on a fact is masked and its structural fields are not", () => {
  const f = makeFact(raw({ because: "the README says contact admin@acme.test for this" }), { fingerprint: "a".repeat(64), commit: "b".repeat(40) });
  assert.match(f.because, /\[upn\]/);
  assert.ok(!f.because.includes("admin@acme.test"));
  assert.equal(f.fingerprint, "a".repeat(64), "a fingerprint must survive scrubbing");
  assert.equal(f.commit, "b".repeat(40), "a commit must survive scrubbing");
});

test("facts and state never share a directory, and reading creates nothing", () => {
  const p = engineeringPaths(ROOT);
  assert.ok(!p.facts.startsWith(p.state) && !p.state.startsWith(p.facts));
  const { io, eng } = store();
  assert.deepEqual(eng.all(), []);
  assert.equal(eng.model().model, null);
  assert.match(eng.model().why, /nothing has analysed this project's engineering yet/);
  assert.equal(io.files.size, 0, "reading an untouched store wrote something");
});

test("an unreadable fact costs exactly that fact, and is never rewritten", () => {
  const { io, eng } = store();
  eng.save(makeFact(raw()));
  eng.save(makeFact(raw({ kind: "convention", key: "naming" })));
  const broken = join(engineeringPaths(ROOT).facts, "eng-convention-deadbeef.json");
  io.files.set(broken, "{ truncated");

  assert.equal(eng.all().length, 2, "the readable facts survive");
  assert.equal(io.files.get(broken), "{ truncated", "the broken file is left exactly as it was");
  assert.ok(io.notes.some((n) => n.kind === "unreadable-fact"));
});

test("malformed state is refused and stays unchanged", () => {
  const { io, eng } = store();
  io.files.set(engineeringPaths(ROOT).model, "{");
  assert.throws(() => eng.model(), /not a JSON object/);
  assert.throws(() => eng.setModel(eng.emptyModel("now")), /not a JSON object/);

  io.files.set(engineeringPaths(ROOT).model, JSON.stringify({ v: 99, scopes: {} }));
  assert.throws(() => eng.model(), /schema v99 and this engine reads v1/);
  assert.throws(() => eng.setModel(eng.emptyModel("now")), /schema v99/);
  assert.equal(io.files.get(engineeringPaths(ROOT).model), JSON.stringify({ v: 99, scopes: {} }), "left where it is");
});

test("the state file is written under a lock once there is a store to lock", () => {
  const { io, eng } = store();
  eng.setModel(eng.emptyModel("2026-09-19T00:00:00.000Z"));
  assert.equal(eng.model().model.v, 1);

  const contended = fakeIo({ mkdirFails: 1, backoff: [1] });
  contended.files.set(engineeringPaths(ROOT).model, io.files.get(engineeringPaths(ROOT).model));
  const second = createEngineering(ROOT, contended);
  second.setModel({ ...second.model().model, commit: "abc1234" });
  assert.equal(second.model().model.commit, "abc1234", "it retried past the held lock");
});

test("confidence, status and provenance are the same words architecture uses, never a second spelling", () => {
  assert.deepEqual(CONFIDENCE.map((c) => c.name), ARCH_CONFIDENCE.map((c) => c.name));
  assert.deepEqual(STATUS.map((s) => s.name), ARCH_STATUS.map((s) => s.name));
  assert.deepEqual(SOURCES.map((s) => s.name), ARCH_SOURCES.map((s) => s.name));
  assert.equal(routes("certain"), true);
  assert.equal(routes("possible"), false, "a heuristic may be printed, never acted on alone");
});

test("strength is the axis architecture facts do not have, and only observed/suggested are claimable by an observer", () => {
  assert.equal(claimableByObserver("observed"), true);
  assert.equal(claimableByObserver("suggested"), true);
  assert.equal(claimableByObserver("enforced"), false);
  assert.equal(claimableByObserver("adopted"), false);
  assert.equal(claimableByObserver("not-a-real-strength"), false, "the fallback for an unknown strength must not silently allow it");
});

test("every kind declares its own extra fields, and they are real fields", () => {
  for (const k of KINDS) {
    for (const f of k.fields ?? []) assert.ok(f in FACT_FIELDS, `${k.name} allows ${f}, which is not declared`);
    assert.ok(allowedOn(k.name).includes("statement"), `${k.name} lost a common field`);
    assert.ok(k.doc?.length > 10, `${k.name} does not say what it is`);
  }
  assert.equal(new Set(KIND_NAMES).size, KIND_NAMES.length, "a kind is declared twice");
});
