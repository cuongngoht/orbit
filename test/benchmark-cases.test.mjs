// EVERY source case of every suite, held to what makes a case worth running -- with no container: the case's own probe
// run as a child over a tree of exactly the files it imports, its raw answers judged by the case's frozen spec and the
// harness judge. For each case:
//
//   - it loads under KINDS, its reference model passes its own self-test, and one seed always makes the same checks;
//   - the source as it is comes to the baseline the case declares (a known finding FAILs, everything else PASSes);
//   - every verifier control earns its verdict on the HIDDEN checks alone -- a fault that only a gate would notice is a
//     case whose checks do not discriminate;
//   - every variant still applies exactly (no FIXTURE_DRIFT), and applying it never writes the repository;
//   - a subject that loads but lacks what the case needs answers MISSING_EXPORT, and nothing passes.
//
// The same controls run in real containers, gates and all, with `node benchmark/run.mjs controls <case>`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { test } from "node:test";
import { frozen, HARNESS, subjectOf } from "../benchmark/lib/core/freeze.mjs";
import { mutatedEntries, mutationFile } from "../benchmark/lib/core/mutations.mjs";
import { casesOf, suitesIn } from "../benchmark/lib/core/suites.mjs";
import { sha, shaBytes } from "../src/hash.mjs";
import { closureOf, probed, ROOT } from "./benchmark-double.mjs";
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
