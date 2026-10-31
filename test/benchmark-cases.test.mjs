// EVERY source and engineering case of every suite, held to what makes a case worth running -- with no container: the
// case's own probe run as a child over a tree of exactly the files it imports (an engineering case: its fixture's
// target), its raw answers judged by the case's frozen spec and the harness judge. For each case:
//
//   - it loads under KINDS, its reference model passes its own self-test, and one seed always makes the same checks;
//   - the source as it is comes to the baseline the case declares (a known finding FAILs, everything else PASSes);
//   - every verifier control earns its verdict on the HIDDEN checks alone -- a fault that only a gate would notice is a
//     case whose checks do not discriminate;
//   - every variant still applies exactly (no FIXTURE_DRIFT), and applying it never writes the repository;
//   - a subject that loads but lacks what the case needs answers MISSING_EXPORT, and nothing passes;
//   - an engineering case's public tests (what its gates run) pass on the target as it is, and every scripted control
//     that must reach PASS leaves a tree that holds every hidden check and every public test, with a regression test
//     of its own that fails before it and passes after -- so its engine control CAN pass, and nothing else does.
//
// The same controls run in real containers, gates and all, with `node benchmark/run.mjs controls <case>`.
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { frozen, HARNESS, subjectOf } from "../benchmark/lib/core/freeze.mjs";
import { fixtureEntries, variantEntries } from "../benchmark/lib/core/context.mjs";
import { candidateEntries, candidateFile, mutatedEntries, mutationFile } from "../benchmark/lib/core/mutations.mjs";
import { casesOf, suitesIn } from "../benchmark/lib/core/suites.mjs";
import { sha, shaBytes } from "../src/hash.mjs";
import { closureOf, ownTest, probed, ROOT } from "./benchmark-double.mjs";
import { sealed } from "./home.mjs";

// Each suite loaded on its own: one that does not load is that suite's failing test, never every suite's.
const loaded = (p) => {
  try { return { suite: p.id, cases: casesOf(ROOT, p.id) }; }
  catch (e) { return { suite: p.id, error: e.message }; }
};

const suites = suitesIn(ROOT).map(loaded);

const sourceCases = suites.flatMap((x) => x.cases ?? []).filter((c) => c.kind === "source");

for (const x of suites.filter((y) => y.error)) test(`suite ${x.suite} loads`, () => assert.fail(x.error));

let subject = null;

const subjectNow = () => (subject ??= subjectOf(frozen(ROOT, "head", sealed()).entries, HARNESS).entries);

const applied = (entries, dir, rel) => ((r) => (assert.ok(r.ok, `${rel} applies exactly: ${JSON.stringify(r.drift)}`), r.entries))(mutatedEntries(entries, mutationFile(dir, rel)));

const variantOf = (c, name) => (c.variants[name]?.mutations ? applied(subjectNow(), c.dir, c.variants[name].mutations) : subjectNow());

const controlEntries = (c, k) => ((v) => (k.file ? applied(v, c.dir, k.file) : v))(variantOf(c, k.variant));

const verdictOf = (judged) => (judged.error || judged.checks.some((x) => !x.ok) ? "FAIL" : "PASS");

const failing = (judged) => [...new Set(judged.checks.filter((x) => !x.ok).map((x) => x.group))].join(", ") || judged.error?.code || "none";

const touched = (c) => [...new Set(Object.values(c.variants).filter((v) => v.mutations).flatMap((v) => mutationFile(c.dir, v.mutations).mutations.map((m) => m.file)))];

const onDisk = (rels) => rels.map((rel) => sha(readFileSync(join(ROOT, rel), "utf8")));

// The subject with every module the case needs emptied: it still loads, and lacks every export the case names.
const emptied = (c, entries) => entries.map((e) => (c.subject.paths.includes(e.rel) ? { ...e, bytes: Buffer.from("export {};\n"), digest: shaBytes(Buffer.from("export {};\n")) } : e));

test("there are source cases to hold, and every one names a baseline", () => {
  assert.ok(sourceCases.length >= 2, `${sourceCases.length} source cases`);
  assert.deepEqual(sourceCases.filter((c) => !["PASS", "FAIL"].includes(c.baseline)).map((c) => c.id), [], "a case says what the source as it is comes to, so a known finding is never news and a regression never hides");
});

for (const c of sourceCases) {
  test(`${c.id}: its checks hold to their own reference model, come to its declared baseline, and discriminate every control`, async (t) => {
    const spec = await import(pathToFileURL(join(c.dir, c.acceptance.spec)).href);
    const probe = (entries) => probed(t, c.dir, spec, closureOf(entries, c.subject.paths), { samples: c.acceptance.samples });
    assert.deepEqual(spec.selfTest(), [], "the reference model agrees with the table written by hand");
    assert.equal(JSON.stringify(spec.cases(11, c.acceptance.samples)), JSON.stringify(spec.cases(11, c.acceptance.samples)), "one seed, the same checks");
    assert.ok(spec.cases(11, c.acceptance.samples).every((k) => k.input && !("id" in k.input) && spec.GROUPS?.[k.group]), "every check has a declared group and an input that names no id of its own");
    const before = onDisk(touched(c));
    const real = probe(subjectNow());
    assert.equal(verdictOf(real), c.baseline, `the source as it is: failing ${failing(real)}`);
    for (const k of c.controls) assert.equal(verdictOf(probe(controlEntries(c, k))), k.expect, `control ${k.id} on the hidden checks alone`);
    for (const name of Object.keys(c.variants)) variantOf(c, name);
    assert.deepEqual(onDisk(touched(c)), before, "no variant or control ever writes the repository");
    assert.equal(probe(emptied(c, subjectNow())).error?.code, "MISSING_EXPORT", "a subject without what the case needs answers nothing");
  });
}

// ---- every ENGINEERING case: the same proof over its fixture's target, and what its scripted controls lean on ----------

const engineeringCases = suites.flatMap((x) => x.cases ?? []).filter((c) => c.kind === "engineering");

const fixtureBase = (c) => join("benchmark", "fixtures", c.fixture);

const fixtureFiles = (c) => readdirSync(join(ROOT, fixtureBase(c)), { recursive: true }).filter((rel) => statSync(join(ROOT, fixtureBase(c), rel)).isFile()).sort();

// The fixture as frozen entries carry it -- its files under benchmark/fixtures/<id>/ -- read from disk.
const fixtureOnDisk = (c) => fixtureFiles(c).map((rel) => ((bytes) => ({ rel: `${fixtureBase(c)}/${rel}`, mode: "file", bytes, digest: shaBytes(bytes) }))(readFileSync(join(ROOT, fixtureBase(c), rel))));

const targetOf = (c, name) => ((v) => (assert.ok(v.ok, `the ${name} variant applies exactly: ${JSON.stringify(v.drift)}`), v.entries))(variantEntries(c, name, fixtureEntries(c, fixtureOnDisk(c))));

const definedOver = (entries, dir, rel) => ((r) => (assert.ok(r.ok, `${rel} applies exactly: ${JSON.stringify(r.drift)}`), r.entries))(candidateEntries(entries, candidateFile(dir, rel)));

const engineeringControl = (c, k) => (k.file ? definedOver(targetOf(c, k.variant), c.dir, k.file) : targetOf(c, k.variant));

const gateRels = (c) => c.checks.gates.flatMap((g) => g.argv.filter((a) => a.startsWith("test/")));

const ownTestsOf = (c, r) => candidateFile(c.dir, r.candidate).files.map((f) => f.rel).filter((rel) => new RegExp(c.checks.agentTests.pattern).test(rel));

const fixtureDigests = (c) => fixtureFiles(c).map((rel) => sha(readFileSync(join(ROOT, fixtureBase(c), rel), "utf8")));

test("there are engineering cases, every one on a fixture, and each says whether its goal must change the target or be refused", () => {
  assert.ok(engineeringCases.length >= 8, `${engineeringCases.length} engineering cases`);
  assert.deepEqual(engineeringCases.filter((c) => c.baseline !== { change: "FAIL", blocked: "PASS" }[c.measures.expects]).map((c) => c.id), [], "a goal to change starts from a target that fails its checks; a goal to refuse, from one that holds them");
});

for (const c of engineeringCases) {
  test(`${c.id}: its checks hold to their own reference model over its fixture, come to its declared baseline, discriminate every control, and its scripted controls can earn what they expect`, async (t) => {
    const spec = await import(pathToFileURL(join(c.dir, c.acceptance.spec)).href);
    const probe = (entries) => probed(t, c.dir, spec, entries, { samples: c.acceptance.samples });
    const before = fixtureDigests(c);
    assert.deepEqual(spec.selfTest(), [], "the reference model agrees with the table written by hand");
    assert.equal(JSON.stringify(spec.cases(11, c.acceptance.samples)), JSON.stringify(spec.cases(11, c.acceptance.samples)), "one seed, the same checks");
    assert.ok(spec.cases(11, c.acceptance.samples).every((k) => k.input && !("id" in k.input) && spec.GROUPS?.[k.group]), "every check has a declared group and an input that names no id of its own");
    const real = probe(targetOf(c, "real"));
    assert.equal(verdictOf(real), c.baseline, `the target as it is: failing ${failing(real)}`);
    for (const k of c.controls) assert.equal(verdictOf(probe(engineeringControl(c, k))), k.expect, `control ${k.id} on the hidden checks alone`);
    assert.equal(ownTest(t, targetOf(c, "real"), gateRels(c)).exit, 0, "the public tests the gates run pass on the target as it is");
    for (const r of c.repairs) definedOver(targetOf(c, r.variant), c.dir, r.candidate);
    for (const r of c.repairs.filter((x) => x.expect === "PASS" && x.script !== "blocked")) {
      const after = definedOver(targetOf(c, r.variant), c.dir, r.candidate);
      const own = ownTestsOf(c, r);
      assert.equal(verdictOf(probe(after)), "PASS", `${r.id}: what it leaves holds every hidden check`);
      assert.equal(ownTest(t, after, gateRels(c)).exit, 0, `${r.id}: what it leaves passes every public test`);
      assert.ok(own.length > 0, `${r.id} brings a regression test of its own`);
      assert.notEqual(ownTest(t, [...targetOf(c, r.variant), ...after.filter((e) => own.includes(e.rel))], own).exit, 0, `${r.id}: its regression test fails on the target as it was`);
      assert.equal(ownTest(t, after, own).exit, 0, `${r.id}: its regression test passes on what it leaves`);
    }
    assert.equal(probe(emptied(c, targetOf(c, "real"))).error?.code, "MISSING_EXPORT", "a target without what the case needs answers nothing");
    assert.deepEqual(fixtureDigests(c), before, "no variant, control or definition ever writes the fixture");
  });
}
