import assert from "node:assert/strict";
import { join } from "node:path";
import { test } from "node:test";
import { CONFIDENCE, KINDS, KIND_NAMES, SOURCES, STATUS, routes, verifiedBy } from "../src/architecture/vocab.mjs";
import { FACT_FIELDS, REQUIRED, allowedOn } from "../src/architecture/fields.mjs";
import { architecturePaths, createArchitecture } from "../src/architecture/store.mjs";
import { factFindings, factId, makeFact, verifiedAgainstSource } from "../src/architecture/model.mjs";
import { FRESHNESS } from "../src/qa/vocab.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = "/store/acme";

const raw = (over = {}) => ({ kind: "extension-point", key: "skills", statement: "Optional integrations live under skills/", scope: ["skills"], evidence: ["skills/a/SKILL.md"], source: "repository", confidence: "certain", ...over });

const store = () => {
  const io = fakeIo();
  return { io, arch: createArchitecture(ROOT, io) };
};

// The provenance rule has to hold when somebody adds a seventh source next year,
// so it is asserted against the TABLE rather than against today's names. A row
// with no `verified` column is not trusted by default -- it is not trusted.
test("a source is trusted only where its own row says so, and memory never is", () => {
  assert.equal(verifiedBy("repository"), true);
  assert.equal(verifiedBy("claude-memory"), false);
  assert.equal(verifiedBy("human-declared-memory"), false);
  assert.equal(verifiedBy("a source nobody declared"), false);
  const trusted = SOURCES.filter((s) => s.verified).map((s) => s.name);
  assert.ok(!trusted.includes("claude-memory"), "claude-memory must never appear in the verified set");
  for (const s of SOURCES) assert.equal(typeof s.verified, "boolean", `${s.name} declares no verified column`);
});

// The sharpest case: a candidate cannot claim to have been checked against the
// tree by writing a field, because there is no such field to write.
test("verifiedAgainstSource is computed from the row and cannot be set on a fact", () => {
  assert.equal(verifiedAgainstSource({ source: "repository" }), true);
  assert.equal(verifiedAgainstSource({ source: "claude-memory" }), false);
  assert.ok(!("verifiedAgainstSource" in FACT_FIELDS), "it must not be a field");
  const findings = factFindings(raw({ source: "claude-memory", verifiedAgainstSource: true }));
  assert.ok(findings.some((f) => /unknown field "verifiedAgainstSource"/.test(f)), findings.join(" · "));
});

// One subject, one fact. Re-deriving the same thing has to rewrite one file
// rather than leave two sentences saying it differently.
test("a fact's id comes from what it is about, not from how it is worded", () => {
  const a = makeFact(raw());
  const b = makeFact(raw({ statement: "Completely different wording here" }));
  assert.equal(a.id, b.id);
  assert.equal(a.id, factId({ kind: "extension-point", key: "skills" }));
  assert.notEqual(a.id, makeFact(raw({ key: "adapters" })).id);
  assert.match(a.id, /^arch-extension-point-[0-9a-f]{8}$/);
});

test("the field table is what rejects a bad fact — no hand-written rule anywhere", () => {
  assert.deepEqual(factFindings(raw()), []);
  assert.ok(factFindings(raw({ scope: [] })).some((f) => /scope needs at least 1/.test(f)));
  assert.ok(factFindings(raw({ confidence: "quite sure" })).some((f) => /confidence must be/.test(f)));
  assert.ok(factFindings({ kind: "module" }).some((f) => /no statement/.test(f)));
  assert.ok(factFindings("not an object").some((f) => /must be a JSON object/.test(f)));
  for (const k of REQUIRED) assert.ok(k in FACT_FIELDS, `${k} is required but not declared`);
});

// A field that exists on another kind is a misunderstanding about what this fact
// IS; a field nobody declared is a typo. Two different sentences.
test("a misplaced field reads differently from an unknown one", () => {
  const misplaced = factFindings(raw({ kind: "module", key: "src", providedBy: "x" }));
  assert.ok(misplaced.some((f) => /providedBy belongs to a capability fact, not to a module one/.test(f)), misplaced.join(" · "));
  assert.ok(factFindings(raw({ nonsense: 1 })).some((f) => /unknown field "nonsense"/.test(f)));
  assert.deepEqual(factFindings(raw({ kind: "capability", key: "sql", capability: "sql", providedBy: "a command", optional: true })), []);
});

// Stamped, not asked for. A candidate that supplies them is guessing.
test("when, against what commit, and whether it still holds are stamped by the store", () => {
  const f = makeFact(raw(), { now: () => "2026-09-19T00:00:00.000Z", commit: "abc1234", fingerprint: "ff00", status: "fresh" });
  assert.equal(f.at, "2026-09-19T00:00:00.000Z");
  assert.equal(f.commit, "abc1234");
  assert.equal(f.status, "fresh");
  assert.deepEqual(f.unknowns, [], "always present, even empty");
  assert.ok(!("fingerprint" in makeFact(raw())), "an absent stamp is absent, never null");
});

// The blob rule in src/scrub.mjs masks any long hex run, and a fact is mostly
// hex. Masking a fingerprint would leave nothing able to date the snapshot.
test("prose on a fact is masked and its structural fields are not", () => {
  const f = makeFact(raw({ because: "the README says contact admin@acme.test for this" }), { fingerprint: "a".repeat(64), commit: "b".repeat(40) });
  assert.match(f.because, /\[upn\]/);
  assert.ok(!f.because.includes("admin@acme.test"));
  assert.equal(f.fingerprint, "a".repeat(64), "a fingerprint must survive scrubbing");
  assert.equal(f.commit, "b".repeat(40), "a commit must survive scrubbing");
});

test("facts and state never share a directory, and reading creates nothing", () => {
  const p = architecturePaths(ROOT);
  assert.ok(!p.facts.startsWith(p.state) && !p.state.startsWith(p.facts));
  const { io, arch } = store();
  assert.deepEqual(arch.all(), []);
  assert.equal(arch.model().model, null);
  assert.match(arch.model().why, /nothing has scanned this project yet/);
  assert.equal(io.files.size, 0, "reading an untouched store wrote something");
});

// One torn byte must cost one fact, not the whole snapshot. That is the reason
// for a file per fact rather than one model.json.
test("an unreadable fact costs exactly that fact, and is never rewritten", () => {
  const { io, arch } = store();
  arch.save(makeFact(raw()));
  arch.save(makeFact(raw({ kind: "module", key: "src" })));
  const broken = join(architecturePaths(ROOT).facts, "arch-module-deadbeef.json");
  io.files.set(broken, "{ truncated");

  assert.equal(arch.all().length, 2, "the readable facts survive");
  assert.equal(io.files.get(broken), "{ truncated", "the broken file is left exactly as it was");
  assert.ok(io.notes.some((n) => n.kind === "unreadable-fact"));
});

// Recovered and REPORTED, never repaired and never silently trusted.
test("malformed state is refused and stays unchanged", () => {
  const { io, arch } = store();
  io.files.set(architecturePaths(ROOT).model, "{");
  assert.throws(() => arch.model(), /not a JSON object/);
  assert.throws(() => arch.setModel(arch.emptyModel("now")), /not a JSON object/);

  io.files.set(architecturePaths(ROOT).model, JSON.stringify({ v: 99, scopes: {} }));
  assert.throws(() => arch.model(), /schema v99 and this engine reads v1/);
  assert.throws(() => arch.setModel(arch.emptyModel("now")), /schema v99/);
  assert.equal(io.files.get(architecturePaths(ROOT).model), JSON.stringify({ v: 99, scopes: {} }), "left where it is");
});

// The first write has no store to race with; every write after it takes the lock,
// because the model is read-modify-write and two scans would lose one's scopes.
test("the state file is written under a lock once there is a store to lock", () => {
  const { io, arch } = store();
  arch.setModel(arch.emptyModel("2026-09-19T00:00:00.000Z"));
  assert.equal(arch.model().model.v, 1);

  const contended = fakeIo({ mkdirFails: 1, backoff: [1] });
  contended.files.set(architecturePaths(ROOT).model, io.files.get(architecturePaths(ROOT).model));
  const second = createArchitecture(ROOT, contended);
  second.setModel({ ...second.model().model, commit: "abc1234" });
  assert.equal(second.model().model.commit, "abc1234", "it retried past the held lock");
});

// A second vocabulary for a second subject is fine. The same subject getting two
// sets of words is not -- so the words themselves have to be the ones in use.
test("freshness and confidence reuse the words the rest of the engine already has", () => {
  assert.deepEqual(STATUS.map((s) => s.name), FRESHNESS.map((f) => f.name), "status must be the plan checker's freshness words");
  assert.deepEqual(CONFIDENCE.map((c) => c.name), ["certain", "possible", "unknown"], "the words src/qa/impact.mjs reasons with");
  assert.equal(routes("certain"), true);
  assert.equal(routes("possible"), false, "a heuristic may be printed, never acted on alone");
  assert.equal(routes("unknown"), false);
});

// Behaviour keyed on a kind is a COLUMN, so no caller anywhere spells the seven.
test("every kind declares its own extra fields, and they are real fields", () => {
  for (const k of KINDS) {
    for (const f of k.fields ?? []) assert.ok(f in FACT_FIELDS, `${k.name} allows ${f}, which is not declared`);
    assert.ok(allowedOn(k.name).includes("statement"), `${k.name} lost a common field`);
    assert.ok(k.doc?.length > 20, `${k.name} does not say what it is`);
  }
  assert.equal(new Set(KIND_NAMES).size, KIND_NAMES.length, "a kind is declared twice");
});
