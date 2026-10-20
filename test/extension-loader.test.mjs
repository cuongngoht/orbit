// Every way an extension can fail to load, and the sentence each one earns.
//
// The rule under test throughout: nothing is silent and nothing is guessed. An
// extension that did not load says so with a reason a person can act on, and one
// that is broken takes only itself down -- because the alternative is a project
// with six working QC tools losing all of them to a seventh with a typo.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { loadExtensions, withExtensions } from "../src/extensions/index.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { manifestFindings } from "../src/extensions/manifest.mjs";
import { satisfies } from "../src/extensions/engine-range.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeProcess } from "./fakes/process.mjs";

const GOOD = {
  id: "acme-probe",
  version: "1.0.0",
  apiVersion: "orbit.extension/v2",
  status: "verified",
  capabilities: "./capabilities.mjs",
};

const CAPS = `export default [{ id: "acme.rows", apiVersion: "orbit.capability/v1", doc: "rows", inputSchema: { q: { type: "string", esc: "sql", doc: "a statement" } }, required: ["q"], invoke: (ext, input) => ({ asked: input.q }) }];`;

function room() {
  const root = mkdtempSync(join(tmpdir(), "orbit-load-"));
  mkdirSync(qcToolPaths(root).root, { recursive: true });
  return root;
}

function put(root, id, manifest, files = { "capabilities.mjs": CAPS }) {
  const dir = join(qcToolPaths(root).root, id);
  mkdirSync(dir, { recursive: true });
  if (manifest) writeFileSync(join(dir, "extension.json"), typeof manifest === "string" ? manifest : JSON.stringify(manifest));
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

const ctxOver = (root) => ({ ...fakeContext(), store: () => root, process: fakeProcess() });

const load = (root) => loadExtensions(ctxOver(root));

const why = (out, id) => out.refused.find((r) => r.id === id)?.why ?? "";

test("a well formed, verified extension loads and says what it brought", async () => {
  const root = room();
  put(root, "acme-probe", GOOD);
  const out = await load(root);
  assert.deepEqual(out.refused, []);
  assert.deepEqual(out.loaded.map((e) => e.id), ["acme-probe"]);
  assert.deepEqual(out.loaded[0].capabilities, ["acme.rows"]);
  rmSync(root, { recursive: true, force: true });
});

test("a draft is never loaded as trusted runtime, and the reason says to verify it", async () => {
  const root = room();
  put(root, "acme-probe", { ...GOOD, status: "draft" });
  const out = await load(root);
  assert.deepEqual(out.loaded, []);
  assert.match(why(out, "acme-probe"), /status is draft — only verified or active is loaded/);
  rmSync(root, { recursive: true, force: true });
});

test("an apiVersion this engine never published is REFUSED, and names the ones it serves", async () => {
  const root = room();
  put(root, "acme-probe", { ...GOOD, apiVersion: "orbit.extension/v9" });
  const out = await load(root);
  assert.deepEqual(out.loaded, []);
  assert.match(why(out, "acme-probe"), /apiVersion must be orbit\.extension\/v2/);
  rmSync(root, { recursive: true, force: true });
});

test("a malformed manifest is a sentence, and a torn one says which file", async () => {
  const root = room();
  put(root, "broken-json", "{ not json");
  put(root, "no-version", { id: "no-version", apiVersion: "orbit.extension/v2", status: "verified" });
  put(root, "stray-key", { ...GOOD, id: "stray-key", nonesuch: 1 });
  const out = await load(root);
  assert.deepEqual(out.loaded, []);
  assert.match(why(out, "broken-json"), /extension\.json is not readable JSON/);
  assert.match(why(out, "no-version"), /no version/);
  assert.match(why(out, "stray-key"), /unknown key "nonesuch"/);
  rmSync(root, { recursive: true, force: true });
});

// Refusing the SHAPE means the loader never has to resolve a hostile path to
// find out it was hostile.
test("a module path that could leave the extension's own directory is refused by shape", () => {
  const traversals = ["../../../etc/passwd.mjs", "/etc/passwd.mjs", "./../other/capabilities.mjs", "capabilities.mjs"];
  for (const p of traversals) {
    const found = manifestFindings({ ...GOOD, capabilities: p }, "x");
    assert.ok(found.some((f) => /must be a relative \.mjs path inside this extension/.test(f)), p);
  }
  assert.deepEqual(manifestFindings({ ...GOOD, capabilities: "./sub/capabilities.mjs" }, "x"), []);
});

test("a module the manifest NAMED and that is not there is refused, not shrugged off", async () => {
  const root = room();
  put(root, "acme-probe", GOOD, {});
  const out = await load(root);
  assert.deepEqual(out.loaded, []);
  assert.match(why(out, "acme-probe"), /capabilities module \.\/capabilities\.mjs could not be loaded/);
  rmSync(root, { recursive: true, force: true });
});

test("a verb an extension declares and cannot run is refused BEFORE anything of its registers", async () => {
  const root = room();
  put(root, "half-done", { ...GOOD, id: "half-done", dsl: "./dsl.mjs", capabilities: "./capabilities.mjs" }, {
    "capabilities.mjs": CAPS,
    "dsl.mjs": `export default { fields: { statement: { type: "string", esc: "sql", doc: "x" } }, verbs: [{ name: "probe", kind: "verdict", verdict: "always", proves: "sql", doc: "x", needs: ["statement"], fields: ["statement"] }] };`,
  });
  const ctx = ctxOver(root);
  const out = await loadExtensions(ctx);
  assert.match(why(out, "half-done"), /declares the verb\(s\) probe and ships no behaviour/);
  assert.ok(!ctx.dsl.has("probe"), "and its verb never reached the vocabulary");
  assert.ok(!ctx.capabilities.has("acme.rows"), "nor did its capability — it is refused whole, or not at all");
  rmSync(root, { recursive: true, force: true });
});

// The point of refusing one extension rather than the load.
test("one broken extension does not take a working one down with it", async () => {
  const root = room();
  put(root, "a-works", { ...GOOD, id: "a-works" });
  put(root, "b-broken", "{ not json");
  const ctx = ctxOver(root);
  const out = await loadExtensions(ctx);
  assert.deepEqual(out.loaded.map((e) => e.id), ["a-works"]);
  assert.deepEqual(out.refused.map((r) => r.id), ["b-broken"]);
  assert.ok(ctx.capabilities.has("acme.rows"));
  rmSync(root, { recursive: true, force: true });
});

test("two extensions claiming one capability id — the second is refused, never the winner", async () => {
  const root = room();
  put(root, "a-first", { ...GOOD, id: "a-first" });
  put(root, "b-second", { ...GOOD, id: "b-second" });
  const ctx = ctxOver(root);
  const out = await loadExtensions(ctx);
  assert.deepEqual(out.loaded.map((e) => e.id), ["a-first"], "sorted ids, so the winner is the same on every machine");
  assert.match(why(out, "b-second"), /already registered by a-first/);
  assert.equal(ctx.capabilities.sourceOf("acme.rows"), "a-first");
  rmSync(root, { recursive: true, force: true });
});

test("loading is deterministic — ids in sorted order, whatever the filesystem says", async () => {
  const root = room();
  for (const id of ["z-last", "a-first", "m-middle"]) put(root, id, { ...GOOD, id, capabilities: "./capabilities.mjs" }, { "capabilities.mjs": CAPS.replace("acme.rows", `acme.${id.replace("-", "")}`) });
  const out = await load(root);
  assert.deepEqual(out.loaded.map((e) => e.id), ["a-first", "m-middle", "z-last"]);
  rmSync(root, { recursive: true, force: true });
});

// A range this engine cannot READ must not be reported as unsatisfied: telling
// somebody their working extension does not run here, because their syntax was
// one we never published, sends them to rewrite the wrong thing.
test("the engine range is a documented subset, and says when it cannot tell", () => {
  assert.equal(satisfies("1.4.5", ">=1.4.5").ok, true);
  assert.equal(satisfies("1.4.5", ">=1.4.5 <3").ok, true);
  assert.equal(satisfies("3.0.0", ">=1.4.5 <3").ok, false);
  assert.equal(satisfies("1.4.4", ">=1.4.5").ok, false);
  assert.equal(satisfies("2", ">1").ok, true);
  assert.equal(satisfies("1.0.0-beta", "<1.0.0").ok, true, "a prerelease is below its release");
  assert.equal(satisfies("1.0.0", ">=1.0.0-beta").ok, true);
  const odd = satisfies("1.4.5", "^1.4.5");
  assert.equal(odd.tell, false, "caret is not a syntax this engine published");
  assert.match(odd.why, /cannot read/);
  assert.equal(satisfies(null, ">=1").tell, false);
});

test("an engine mismatch it CAN read stops the load and says both versions", async () => {
  const root = room();
  put(root, "acme-probe", { ...GOOD, engine: ">=99.0.0" });
  const out = await load(root);
  assert.match(why(out, "acme-probe"), /this engine is .*, and the extension was written for >=99\.0\.0/);
  rmSync(root, { recursive: true, force: true });
});

test("a range this engine cannot read does NOT stop the load", async () => {
  const root = room();
  put(root, "acme-probe", { ...GOOD, engine: "^1.0.0" });
  const out = await load(root);
  assert.deepEqual(out.loaded.map((e) => e.id), ["acme-probe"]);
  rmSync(root, { recursive: true, force: true });
});

test("withExtensions leaves a project with no store working, and says why nothing loaded", async () => {
  const ctx = { ...fakeContext(), store: () => { throw new Error("nowhere to write"); }, process: fakeProcess() };
  const whole = await withExtensions(ctx);
  assert.deepEqual(whole.extensions.loaded, []);
  assert.match(whole.extensions.room, /QC tools could not be read — nowhere to write/);
  assert.ok(whole.dsl.has("call"), "and the engine's own vocabulary is intact");
});

test("what a capability says it provides is held to the contract BEFORE anything of the extension registers", async () => {
  const root = room();
  const caps = `export default [
    { id: "acme.first", doc: "fine", provides: ["workitem.read"], invoke: () => ({}) },
    { id: "acme.second", doc: "not fine", provides: ["Not An Id"], invoke: () => ({}) },
  ];`;
  put(root, "acme-probe", GOOD, { "capabilities.mjs": caps });
  const ctx = ctxOver(root);
  const out = await loadExtensions(ctx);
  assert.match(why(out, "acme-probe"), /what it declares as provided does not hold/);
  assert.match(why(out, "acme-probe"), /so nothing of it was registered/);
  assert.deepEqual(ctx.capabilities.ids(), [], "the first, valid capability was not left behind");
  rmSync(root, { recursive: true, force: true });
});
