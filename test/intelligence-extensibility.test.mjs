import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createIntelligenceRegistry } from "../src/intelligence/registry.mjs";
import { builtinEcosystems } from "../src/ecosystems/builtin.mjs";
import { resolve } from "../src/intelligence/resolution/resolve.mjs";
import { maturityOf } from "../src/intelligence/technology/maturity.mjs";
import { ensured, world } from "./fakes/intelligence.mjs";

// THE PROOF that a new ecosystem is additive. Everything below is registered
// through the public registry API -- an adapter, a descriptor, an analyser --
// for an ecosystem this engine has never shipped. Nothing under src/ is
// touched to make it work, and the last test says so by reading src/.

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const fakeJava = {
  id: "fake-java",
  doc: "a pretend build file, for the extensibility proof",
  detects: (p) => p.endsWith("pom.xml"),
  parseManifest: (path, text) => ({ unit: true, runtime: "fake-jvm", targets: ["17"], dependencies: [...text.matchAll(/<dep>([^<]+)<\/dep>/g)].map((m) => ({ name: m[1], relationship: "direct" })) }),
};

const demoSdk = { id: "demo-sdk", category: "sdk", doc: "an invented SDK", matchers: [{ ecosystem: "fake-java", dependency: "com.example:demo" }], domains: ["demo-store"], aliases: ["demo"] };

const demoReader = {
  id: "fake-java.demo",
  ecosystem: "fake-java",
  doc: "reads DemoClient usage off pretend source",
  requires: ["demo-sdk"],
  extensions: [".fj"],
  triggers: ["DemoClient", "bind("],
  analyze: ({ text }) => ({ defines: [...text.matchAll(/class (\w+)/g)].map((m) => m[1]), usages: /\.records\(/.test(text) ? [{ technology: "demo-sdk", integration: "demo-store", operation: "records", confidence: "certain", signals: ["DemoClient", "records"] }] : [], wirings: [...text.matchAll(/bind\((\w+), (\w+)\)/g)].map((m) => ({ abstraction: m[1], implementation: m[2], lifetime: "singleton" })) }),
};

const FILES = {
  "pom.xml": "<deps><dep>com.example:demo</dep><dep>org.unknown:thing</dep></deps>",
  "src/store/RecordStore.fj": "class RecordStore { DemoClient c; list() { return c.records(); } }",
  "src/app/Wiring.fj": "bind(Store, RecordStore)",
};

function registry() {
  const r = createIntelligenceRegistry({ ecosystems: builtinEcosystems() });
  r.ecosystems.register(fakeJava, "a test");
  r.descriptors.register(demoSdk, "a test");
  r.analyzers.register(demoReader, "a test");
  return r;
}

test("a fake ecosystem's manifest is discovered, and every dependency kept — recognised or not", () => {
  const ctx = world(FILES, registry());
  ensured(ctx);
  const manifest = ctx.intel.all().find((f) => f.kind === "manifest");
  assert.equal(manifest.ecosystem, "fake-java");
  assert.deepEqual(manifest.dependencies.map((d) => d.name), ["com.example:demo", "org.unknown:thing"]);
  const eco = ctx.intel.all().find((f) => f.kind === "ecosystem");
  assert.deepEqual([eco.ecosystem, eco.units, eco.runtime, eco.targets], ["fake-java", 1, "fake-jvm", ["17"]]);
});

test("its descriptor normalises a dependency into a technology, and its analyser into usage", () => {
  const ctx = world(FILES, registry());
  ensured(ctx);
  const tech = ctx.intel.all().find((f) => f.kind === "technology");
  assert.deepEqual([tech.technology, tech.ecosystems, tech.packages], ["demo-sdk", ["fake-java"], ["com.example:demo"]]);
  const usage = ctx.intel.all().find((f) => f.kind === "usage");
  assert.deepEqual([usage.technology, usage.integration, usage.operation, usage.scope], ["demo-sdk", "demo-store", "records", ["src/store/RecordStore.fj"]]);
  const integration = ctx.intel.all().find((f) => f.kind === "integration");
  assert.deepEqual(integration.technologies, ["demo-sdk"]);
});

test("the maturity ladder climbs for it exactly as it would for any other", () => {
  const ctx = world(FILES, registry());
  ensured(ctx);
  const [ladder] = maturityOf(ctx.intel.all());
  const reached = Object.fromEntries(ladder.rungs.map((r) => [r.name, r.reached]));
  assert.deepEqual(reached, { declared: true, used: true, configured: true, "used-for": true, "architectural-pattern": false });
});

test("the resolver consumes it: build when no capability exists, reuse when one does", () => {
  const ctx = world(FILES, registry());
  ensured(ctx);
  const w = { facts: ctx.intel.all(), descriptors: ctx.registry.descriptors.list(), capabilities: [], conventions: [], snapshot: true };
  assert.deepEqual(pick(resolve("list demo-store records", w)), { decision: "build", technology: "demo-sdk" });
  const withCap = { ...w, capabilities: [{ id: "demo.records.list", doc: "d", from: "a test" }] };
  assert.deepEqual(pick(resolve("list demo-store records", withCap)), { decision: "reuse", technology: "demo-sdk", capability: "demo.records.list" });
});

const pick = (a) => ({ decision: a.decision, technology: a.technology, ...(a.capability ? { capability: a.capability } : {}) });

test("without its adapter the same tree is invisible — the core never guessed at it", () => {
  const ctx = world(FILES, createIntelligenceRegistry({ ecosystems: builtinEcosystems() }));
  ensured(ctx);
  assert.deepEqual(ctx.intel.all(), []);
});

test("zero core change: nothing under src/ knows the fake ecosystem, its SDK or its idiom", () => {
  const all = [];
  const walk = (dir) => readdirSync(dir, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(join(dir, e.name)) : all.push(join(dir, e.name))));
  walk(join(ROOT, "src"));
  for (const file of all) assert.doesNotMatch(readFileSync(file, "utf8"), /fake-java|demo-sdk|DemoClient|pom\.xml/, `${file} had to learn the fake ecosystem`);
});
