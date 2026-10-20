// The `knowledge` module is an ADDITIVE key of orbit.extension/v2: held to its
// contract by the same loader, before anything else of its extension registers
// -- and invisible to an extension that never declared it.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { createKnowledgeParts } from "../src/extensions/knowledge-parts.mjs";
import { loadExtensions, withExtensions } from "../src/extensions/index.mjs";
import { verifyTool } from "../src/extensions/lifecycle.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { realIo } from "../src/store/io.mjs";
import { fakeContext } from "./fakes/context.mjs";
import { fakeProcess } from "./fakes/process.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FROZEN = join(HERE, "fixtures", "extensions", "current-example");
const COMPANY = join(HERE, "fixtures", "knowledge", "company-knowledge");

test("the current capability extension loads and teaches knowledge nothing", async () => {
  const root = mkdtempSync(join(tmpdir(), "orbit-frozen-"));
  mkdirSync(qcToolPaths(root).root, { recursive: true });
  cpSync(FROZEN, join(qcToolPaths(root).root, "current-example"), { recursive: true });
  const ctx = await withExtensions({ ...fakeContext(), store: () => root, process: fakeProcess() });
  assert.deepEqual(ctx.extensions.refused, []);
  assert.deepEqual([ctx.extensions.loaded[0].relations, ctx.extensions.loaded[0].interpreters], [[], []]);
  assert.deepEqual(ctx.knowledge.relations(), []);
});

test("the builder's verification loads a knowledge module for real, and names what it is", async () => {
  const verdict = await verifyTool({ ...fakeContext(), process: fakeProcess() }, COMPANY, realIo());
  assert.equal(verdict.ok, true, JSON.stringify(verdict.findings));
  assert.deepEqual([verdict.loaded.relations.length, verdict.loaded.interpreters], [4, ["company-knowledge.unseen"]]);
});

test("a context with no knowledge registry is refused LOUDLY -- an optional call would skip the validation silently", async () => {
  await assert.rejects(() => loadExtensions({ store: () => "/nowhere" }), /needs a knowledge registry/);
});

test("the parts registry: two meanings for one relation are refused; the same meaning twice is one relation", () => {
  const parts = createKnowledgeParts();
  parts.register({ relations: [{ id: "x.causes", role: "consequence" }] }, "ext-a");
  const out = parts.offer([{ id: "x.causes", role: "consequence", doc: "same meaning, other words" }, { id: "x.causes", role: "observation" }, { id: "x.fresh" }, { id: "Bad Id" }, { id: "x.odd", role: "telepathy" }], "project a.json", "project");
  assert.deepEqual(out.loaded, ["x.causes", "x.fresh"]);
  assert.deepEqual(out.refused.map((r) => r.id), ["x.causes", "Bad Id", "x.odd"]);
  assert.equal(parts.relation("x.causes").from, "ext-a", "the extension, registered first, keeps its meaning");
  assert.deepEqual(parts.also().map((a) => a.id), ["x.causes"]);
});

test("an extension's module is all or nothing, and an interpreter must say what it understands and how it answers", () => {
  const parts = createKnowledgeParts();
  assert.throws(() => parts.register({ relations: [{ id: "ok.one" }], interpreters: [{ id: "bad", understands: [] }] }, "ext-b"), /cannot register what it teaches project knowledge/);
  assert.equal(parts.relation("ok.one"), null, "nothing of the refused module was kept");
  assert.equal(parts.check({ interpreters: [{ id: "ext.reader", doc: "d", understands: ["some.rel"], interpret: () => ({}) }] }).length, 0);
});
