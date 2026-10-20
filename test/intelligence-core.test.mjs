import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import * as intelVocab from "../src/intelligence/vocab.mjs";
import * as archVocab from "../src/architecture/vocab.mjs";
import * as engVocab from "../src/engineering/vocab.mjs";
import { KIND_FIELDS } from "../src/intelligence/fields.mjs";
import { factFindings, makeFact, verifiedAgainstSource } from "../src/intelligence/model.mjs";
import { createIntelligenceRegistry, registryPrint } from "../src/intelligence/registry.mjs";
import { specOf } from "../src/intelligence/technology/match.mjs";
import { scan } from "../src/intelligence/scan.mjs";
import { DECISIONS, decide } from "../src/intelligence/ensure.mjs";
import { builtinEcosystems } from "../src/ecosystems/builtin.mjs";
import { world } from "./fakes/intelligence.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- the words ----

test("provenance, certainty and freshness are the SAME words architecture and engineering use", () => {
  for (const table of ["SOURCES", "CONFIDENCE", "STATUS"]) {
    assert.deepEqual(intelVocab.names(intelVocab[table]), archVocab.names(archVocab[table]), `${table} drifted from architecture`);
    assert.deepEqual(intelVocab.names(intelVocab[table]), engVocab.names(engVocab[table]), `${table} drifted from engineering`);
  }
  for (const s of intelVocab.SOURCES) assert.equal(s.verified, archVocab.sourceRow(s.name).verified, `${s.name} is trusted differently here`);
});

test("every kind names a stage, and every extra field it lists is a real field", () => {
  for (const k of intelVocab.KINDS) {
    assert.ok(["manifests", "usage", "derived"].includes(k.stage), `${k.name} has no stage a scan can replace it by`);
    for (const f of k.fields) assert.ok(f in KIND_FIELDS, `${k.name} lists ${f}, which no row declares`);
  }
});

test("the maturity ladder is ordered lowest first and ends in a candidate, never a rule", () => {
  assert.deepEqual(intelVocab.MATURITY_NAMES, ["declared", "used", "configured", "used-for", "architectural-pattern"]);
  assert.match(intelVocab.MATURITY.at(-1).doc, /CANDIDATE/);
  assert.match(intelVocab.MATURITY.at(-1).doc, /never adopted, and never enforced/);
});

test("the field table is what rejects a bad fact", () => {
  const good = { kind: "technology", key: "demo-sdk", root: ".", technology: "demo-sdk", category: "sdk", statement: "s", scope: ["a"], evidence: ["a"], source: "package-manifest", confidence: "certain" };
  assert.deepEqual(factFindings(good), []);
  assert.match(factFindings({ ...good, confidence: "sure" }).join(), /confidence must be certain, possible or unknown/);
  assert.match(factFindings({ ...good, abstraction: "IX" }).join(), /abstraction belongs to a wiring fact, not to a technology one/);
  assert.match(factFindings({ ...good, bogus: 1 }).join(), /unknown field "bogus"/);
  assert.match(factFindings({ ...good, root: undefined }).join(), /no root/);
});

test("a fact's id comes from kind and key, and provenance is read off the table", () => {
  const a = makeFact({ kind: "usage", key: "x@src", statement: "one wording", source: "repository" }, { now: () => "t" });
  const b = makeFact({ kind: "usage", key: "x@src", statement: "another wording", source: "claude-memory" }, { now: () => "t" });
  assert.equal(a.id, b.id);
  assert.match(a.id, /^intel-usage-[0-9a-f]{8}$/);
  assert.equal(verifiedAgainstSource(a), true);
  assert.equal(verifiedAgainstSource(b), false);
});

test("prose on a fact is masked, and a package name is not", () => {
  const f = makeFact({ kind: "manifest", key: "a.proj", statement: "token: eyJabcdefghij.abc.def", signals: ["password=hunter2"], dependencies: [{ name: "Vendor.Package", relationship: "direct" }] }, {});
  assert.doesNotMatch(JSON.stringify(f.statement), /eyJabcdefghij/);
  assert.doesNotMatch(JSON.stringify(f.signals), /hunter2/);
  assert.equal(f.dependencies[0].name, "Vendor.Package");
});

// ---- the registries ----

const descriptor = (over = {}) => ({ id: "demo-sdk", category: "sdk", matchers: [{ ecosystem: "demo", dependency: "Demo.Sdk" }], ...over });

test("a descriptor is data held to its contract; a duplicate id is refused, never overwritten", () => {
  const reg = createIntelligenceRegistry();
  reg.descriptors.register(descriptor(), "core");
  assert.throws(() => reg.descriptors.register(descriptor(), "a project"), /already registered by core — two meanings for one id/);
  assert.throws(() => reg.descriptors.register(descriptor({ id: "Bad Id" })), /id does not look like/);
  assert.throws(() => reg.descriptors.register(descriptor({ matchers: [] })), /matchers needs at least 1/);
  assert.throws(() => reg.descriptors.register(descriptor({ id: "x", matchers: [{ ecosystem: "demo" }] })), /matcher 1: no dependency/);
  assert.throws(() => reg.descriptors.register(descriptor({ id: "y", matcher: [] })), /unknown key "matcher"/, "a typo in a data file is refused, not ignored");
});

test("offer records every refusal and never throws", () => {
  const reg = createIntelligenceRegistry();
  const out = reg.descriptors.offer([descriptor(), descriptor(), { id: "z" }, null], "a file");
  assert.deepEqual(out.loaded, ["demo-sdk"]);
  assert.equal(out.refused.length, 3);
  assert.ok(out.refused.every((r) => r.from === "a file" && r.why));
});

test("an analyser must say where it runs and what triggers it, and have analyze()", () => {
  const reg = createIntelligenceRegistry();
  const ok = { id: "demo.reader", ecosystem: "demo", doc: "d", extensions: [".dm"], triggers: ["Demo"], analyze: () => ({}) };
  reg.analyzers.register(ok);
  assert.throws(() => reg.analyzers.register({ ...ok, id: "reader" }), /id does not look like/, "an analyser id is namespaced");
  assert.throws(() => reg.analyzers.register({ ...ok, id: "demo.other", analyze: undefined }), /has no analyze\(\)/);
  assert.throws(() => reg.analyzers.register({ ...ok, id: "demo.third", triggers: [] }), /triggers needs at least 1/);
});

test("a matcher is a Specification: exact, case-insensitive, and a trailing * is a family", () => {
  const exact = specOf({ ecosystem: "demo", dependency: "Vendor.Sdk" });
  assert.equal(exact({ ecosystem: "demo", name: "vendor.sdk" }), true);
  assert.equal(exact({ ecosystem: "demo", name: "Vendor.Sdk.Extra" }), false);
  assert.equal(exact({ ecosystem: "other", name: "Vendor.Sdk" }), false, "a name means something only in its own ecosystem");
  const family = specOf({ ecosystem: "demo", dependency: "Vendor.Vault.*" });
  assert.equal(family({ ecosystem: "demo", name: "Vendor.Vault.Keys" }), true);
  assert.equal(family({ ecosystem: "demo", name: "Vendor.VaultX" }), false);
});

test("the registry's print changes when what it recognises changes, and only then", () => {
  const reg = createIntelligenceRegistry({ ecosystems: builtinEcosystems() });
  const before = registryPrint(reg);
  assert.equal(registryPrint(reg), before);
  reg.descriptors.register(descriptor());
  assert.notEqual(registryPrint(reg), before);
});

// ---- the decision table ----

const facts = (over = {}) => ({ readable: true, forced: false, model: { v: 1 }, modelWhy: null, count: 3, registryMoved: false, manifestsMoved: [], usageMoved: [], skipped: [], fresh: ["a"], ...over });

test("the decision table: the last row always matches, and every row says what it writes", () => {
  assert.equal(DECISIONS.at(-1).name, "CURRENT");
  assert.equal(DECISIONS.at(-1).when(facts()), true);
  for (const d of DECISIONS) assert.equal(typeof d.writes, "boolean", d.name);
  assert.equal(decide(facts()).plan.usage, "none");
  assert.equal(decide(facts()).plan.manifests, false);
});

test("--dry flips the writes column on every row and nothing else", () => {
  for (const over of [{ readable: false }, { forced: true }, { model: null, count: 0 }, { manifestsMoved: ["a.proj"] }, { usageMoved: ["src"] }, {}]) {
    const wet = decide(facts(over));
    const dry = decide(facts(over), { dry: true });
    assert.equal(dry.name, wet.name);
    assert.equal(dry.writes, false);
    assert.deepEqual(dry.plan, wet.plan);
  }
});

test("a moved manifest re-reads manifests and NO source unless source moved too", () => {
  const d = decide(facts({ manifestsMoved: ["src/A/A.proj"] }));
  assert.equal(d.name, "MANIFESTS");
  assert.deepEqual(d.plan, { manifests: true, usage: "none", scopes: [], fresh: ["a"], budget: undefined });
  assert.equal(decide(facts({ manifestsMoved: ["m"], usageMoved: ["src/B"] })).plan.usage, "scopes");
});

test("a moved source scope re-reads that scope and never the manifests", () => {
  const d = decide(facts({ usageMoved: ["src/B"] }));
  assert.equal(d.name, "INCREMENTAL");
  assert.equal(d.plan.manifests, false);
  assert.deepEqual(d.plan.scopes, ["src/B"]);
});

test("a changed recogniser reads everything again, with the new eyes", () => {
  assert.equal(decide(facts({ registryMoved: true, usageMoved: ["x"] })).name, "RECOGNISER_CHANGED");
});

// ---- nothing to scan ----

test("a tree nothing recognises is no fact and no read, and a non-checkout says so", () => {
  const ctx = world({ "README.md": "x", "src/a.txt": "y" }, createIntelligenceRegistry({ ecosystems: builtinEcosystems() }));
  const done = scan(ctx, { manifests: true, usage: "all", scopes: [], fresh: [] }, []);
  assert.deepEqual(done.facts, []);
  assert.equal(ctx.source.calls.read, 0);
  const gone = scan({ ...ctx, source: { ...ctx.source, files: () => null } }, { manifests: true, usage: "all" }, []);
  assert.match(gone.unknowns[0], /not a readable git checkout/);
});

// ---- the line the core never crosses ----

function sources(dir, found = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) (e.isDirectory() ? sources(join(dir, e.name), found) : e.name.endsWith(".mjs") && found.push(join(dir, e.name)));
  return found;
}

test("the core names no ecosystem, no manifest format, no idiom — only registrations do", () => {
  const banned = /\b(dotnet|\.net|csproj|nuget|msbuild|packagereference|packageversion|addscoped|addsingleton|graphserviceclient|clientcontext|package\.json|npm|maven|gradle|pom\.xml|java|python)\b/i;
  for (const file of sources(join(ROOT, "src", "intelligence"))) assert.ok(!banned.test(readFileSync(file, "utf8")), `${file} names an ecosystem or an idiom`);
});

test("the core names no product and no vendor", () => {
  const banned = /\b(microsoft|graph|azure|aws|postgres\w*|sql ?server|redis|kafka|rabbitmq|sharepoint|csom|onedrive|servicebus)\b/i;
  for (const file of sources(join(ROOT, "src", "intelligence"))) assert.ok(!banned.test(readFileSync(file, "utf8")), `${file} names a product`);
});
