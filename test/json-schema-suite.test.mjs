// The JSON Schema subset (skills/orbit-api-test/schema.mjs) held to the official JSON-Schema-Test-Suite, draft 2020-12,
// vendored byte for byte (test/fixtures/json-schema-suite/VENDOR.json). Two promises:
//   1. Every case in a file for a keyword the validator ASSERTS agrees with the suite's `valid` -- or, where the case
//      needs something the validator declares as a gap, it is a gap (valid: null) and is named in GAPPED below.
//   2. Every case in a file for a keyword the validator does NOT implement is a gap: never a verdict, never a pass.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shaBytes } from "../src/hash.mjs";
import { ANNOTATION, ASSERTING, DIALECT, MAX_ERRORS, UNSUPPORTED, schemaDigest, validateSchema } from "../skills/orbit-api-test/schema.mjs";

const SUITE = join(import.meta.dirname, "fixtures", "json-schema-suite");
const VENDOR = JSON.parse(readFileSync(join(SUITE, "VENDOR.json"), "utf8"));
const groupsOf = (file) => JSON.parse(readFileSync(join(SUITE, file), "utf8"));
const suiteFiles = () => Object.keys(VENDOR.files).filter((f) => f.startsWith("draft2020-12/"));

// Files whose keyword the validator declares as unsupported: each of their cases must be a gap.
const UNSUPPORTED_FILES = ["anchor", "dynamicRef", "refRemote", "unevaluatedItems", "unevaluatedProperties", "vocabulary"].map((n) => `draft2020-12/${n}.json`);

// Groups inside SUPPORTED files that need what the validator declares as a gap. Every case in them is a gap, never a
// verdict; the list is exact, so a group that stops gapping (or starts) fails here rather than drifting silently.
const GAPPED = [
  { file: "draft2020-12/defs.json", group: "validate definition against metaschema", why: "a $ref to the 2020-12 metaschema, which is not bundled" },
  { file: "draft2020-12/not.json", group: "collect annotations inside a 'not', even if collection is disabled", why: "unevaluatedProperties needs annotation collection" },
  { file: "draft2020-12/ref.json", group: "remote ref, containing refs itself", why: "a $ref to the 2020-12 metaschema, which is not bundled" },
  { file: "draft2020-12/ref.json", group: "ref creates new scope when adjacent to keywords", why: "unevaluatedProperties needs annotation collection" },
  { file: "draft2020-12/ref.json", group: "order of evaluation: $id and $anchor and $ref", why: "a plain-name $ref fragment needs $anchor" },
  { file: "draft2020-12/ref.json", group: "URN base URI with URN and anchor ref", why: "a plain-name $ref fragment needs $anchor" },
];

const isGapped = (file, group) => GAPPED.some((g) => g.file === file && g.group === group.description);
const casesOf = (file) => groupsOf(file).flatMap((group) => group.tests.map((t) => ({ file, group, t })));
const supportedCases = () => suiteFiles().filter((f) => !UNSUPPORTED_FILES.includes(f)).flatMap(casesOf);

test("every vendored file is byte for byte what VENDOR.json pins", () => {
  assert.equal(VENDOR.commit, "0b4a7fa5e79c5e1ed60d5c034b951003bbba7fd4");
  for (const [file, sha] of Object.entries(VENDOR.files)) assert.equal(shaBytes(readFileSync(join(SUITE, file))), sha, file);
  assert.ok(Object.keys(VENDOR.files).includes(VENDOR.licenseFile), "the suite's licence travels with it");
});

test("every case of a supported keyword agrees with the suite, and a case needing a gap is a gap", () => {
  const verdicts = supportedCases().filter((c) => !isGapped(c.file, c.group));
  for (const { file, group, t } of verdicts) {
    const r = validateSchema(group.schema, t.data);
    assert.deepEqual([r.gaps, r.valid], [[], t.valid], `${file} | ${group.description} | ${t.description}`);
  }
  assert.ok(verdicts.length > 1000, `${verdicts.length} verdicts checked`);
});

test("every group the GAPPED table names exists, and each of its cases is a gap with no verdict", () => {
  for (const g of GAPPED) {
    const cases = casesOf(g.file).filter((c) => c.group.description === g.group);
    assert.ok(cases.length > 0, `${g.file} | ${g.group} is in the suite`);
    for (const { t, group } of cases) assert.deepEqual(gapOnly(validateSchema(group.schema, t.data)), true, `${g.group} | ${t.description}`);
  }
});

const gapOnly = (r) => r.gaps.length > 0 && r.valid === null && r.errors.length === 0;

test("every case of an unsupported keyword is a gap: never judged, never a pass", () => {
  const cases = UNSUPPORTED_FILES.flatMap(casesOf);
  for (const { file, group, t } of cases) assert.equal(gapOnly(validateSchema(group.schema, t.data)), true, `${file} | ${group.description} | ${t.description}`);
  assert.ok(cases.length > 100, `${cases.length} unsupported cases checked`);
});

test("the vocabulary is data, and the three tables never share a keyword", () => {
  const names = [ASSERTING, ANNOTATION, UNSUPPORTED].map((rows) => rows.map((r) => r.keyword));
  assert.equal(new Set(names.flat()).size, names.flat().length);
  assert.ok(names[0].includes("$ref") && names[1].includes("format") && names[2].includes("unevaluatedProperties"));
  assert.equal(validateSchema(true, 1).dialect, DIALECT);
});

test("a keyword nobody declared, another dialect, a remote $ref and a pattern that does not compile are gaps", () => {
  const cases = [
    [{ definitions: { a: { type: "string" } } }, "definitions"],
    [{ $schema: "http://json-schema.org/draft-07/schema#", type: "string" }, "$schema"],
    [{ $ref: "https://example.com/other.json" }, "$ref"],
    [{ pattern: "(" }, "pattern"],
    [{ patternProperties: { "[": { type: "string" } } }, "patternProperties"],
    [{ type: "text" }, "type"],
  ];
  for (const [schema, keyword] of cases) assert.deepEqual(validateSchema(schema, "x").gaps.map((g) => g.keyword), [keyword], JSON.stringify(schema));
  assert.equal(validateSchema({ "x-owner": "billing", type: "string" }, "x").valid, true, "an x- keyword is the author's own annotation");
});

test("format is an annotation: never asserted, and a request to assert it is a gap", () => {
  assert.equal(validateSchema({ format: "email" }, "not an email").valid, true);
  const asked = validateSchema({ format: "email" }, "not an email", { assertFormat: true });
  assert.deepEqual([asked.valid, asked.gaps.map((g) => g.keyword)], [null, ["format"]]);
  assert.equal(validateSchema({ type: "string" }, "x", { assertFormat: true }).valid, true, "no format, nothing to refuse");
});

test("errors are capped at twenty, every keyword is applied, and a valid instance carries none", () => {
  const r = validateSchema({ items: { type: "string" } }, Array.from({ length: 50 }, (_, i) => i));
  assert.deepEqual([r.valid, r.errors.length, r.gaps], [false, MAX_ERRORS, []]);
  assert.deepEqual(r.errors[0], { path: "/0", keyword: "type", message: "expected string, got integer" });
  assert.deepEqual(validateSchema({ type: "integer", minimum: 5, maximum: 1 }, 3).errors.map((e) => e.keyword), ["minimum", "maximum"]);
  assert.deepEqual(validateSchema({ anyOf: [{ type: "string" }, { type: "integer" }] }, 3).errors, []);
});

test("a failing branch says one thing about itself, not everything its subschemas said", () => {
  const r = validateSchema({ anyOf: [{ type: "string" }, { type: "boolean" }] }, 3);
  assert.deepEqual(r.errors, [{ path: "", keyword: "anyOf", message: "no subschema matches" }]);
  assert.deepEqual(validateSchema({ not: { type: "integer" } }, 3).errors.map((e) => e.keyword), ["not"]);
});

test("a hostile schema stops at a limit and is a gap, never a hang or a verdict", () => {
  const cycle = validateSchema({ $ref: "#" }, 1);
  assert.deepEqual([cycle.valid, cycle.gaps[0].keyword], [null, "limits"]);
  const level = (i) => (i === 0 ? { type: "string" } : { anyOf: [{ $ref: `#/$defs/l${i - 1}` }, { $ref: `#/$defs/l${i - 1}` }] });
  const wide = { $defs: Object.fromEntries(Array.from({ length: 31 }, (_, i) => [`l${i}`, level(i)])), $ref: "#/$defs/l30" };
  const work = validateSchema(wide, 1, { limits: { work: 5000 } });
  assert.deepEqual([work.valid, work.gaps[0].keyword], [null, "limits"]);
  const deep = (n) => (n === 0 ? { type: "string" } : { items: deep(n - 1) });
  assert.deepEqual(validateSchema(deep(40), "x", { limits: { depth: 16 } }).gaps.map((g) => g.keyword), ["limits"]);
});

test("an instance nested too deeply to walk is a limit too", () => {
  const nested = (n) => Array.from({ length: n }).reduce((inner) => [inner], 1);
  const r = validateSchema({ items: { $ref: "#" } }, nested(500));
  assert.deepEqual([r.valid, r.gaps[0].keyword], [null, "limits"]);
});

test("the digest is the schema's canonical sha256: key order does not move it, a changed value does", () => {
  const a = validateSchema({ type: "object", required: ["id"] }, {}).digest;
  assert.equal(a, validateSchema({ required: ["id"], type: "object" }, { id: 1 }).digest);
  assert.equal(a, schemaDigest({ required: ["id"], type: "object" }));
  assert.notEqual(a, schemaDigest({ type: "object", required: ["ref"] }));
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("an embedded $id is a resource a $ref may name; the same URI anywhere else is remote", () => {
  const schema = { $id: "https://example.test/root.json", $defs: { n: { $id: "num.json", type: "integer" } }, properties: { a: { $ref: "num.json" } } };
  assert.deepEqual([validateSchema(schema, { a: 1 }).valid, validateSchema(schema, { a: "x" }).valid], [true, false]);
  assert.equal(validateSchema({ properties: { a: { $ref: "https://example.test/num.json" } } }, { a: 1 }).gaps[0].keyword, "$ref");
  assert.equal(validateSchema({ $id: "https://example.test/x.json#frag" }, 1).gaps[0].keyword, "$id");
});
