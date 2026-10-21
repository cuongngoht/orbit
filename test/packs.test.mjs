// The capability packs Orbit ships (ADR 0034): every catalog row is a directory with a manifest
// at the engine's own version, loadable by the same loader and contract as a project's own QC
// tool, registering only orbit.* ids, and inert until a project names it.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { loadExtensions } from "../src/extensions/index.mjs";
import { manifestFindings } from "../src/extensions/manifest.mjs";
import { qcToolPaths } from "../src/extensions/store.mjs";
import { engineVersion } from "../src/version.mjs";
import { fakeContext } from "./fakes/context.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = JSON.parse(readFileSync(join(ROOT, "catalog/packs.json"), "utf8"));

test("every pack the catalog lists is a directory with a valid manifest at the engine's version, active", () => {
  assert.ok(CATALOG.packs.length >= 1);
  for (const row of CATALOG.packs) {
    const file = join(ROOT, row.dir, "extension.json");
    assert.ok(existsSync(file), `${row.id}: ${row.dir}/extension.json`);
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    assert.deepEqual(manifestFindings(manifest, row.id), [], row.id);
    assert.equal(manifest.id, row.id);
    assert.equal(manifest.version, engineVersion(), `${row.id} ships with the engine it belongs to`);
    assert.equal(manifest.status, "active");
  }
});

test("a project that names every pack loads them all, and each registers only orbit.* ids as itself", async () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-packs-"));
  mkdirSync(qcToolPaths(store).root, { recursive: true });
  const ctx = { ...fakeContext(), store: () => store, config: { ...fakeContext().config, packs: CATALOG.packs.map((r) => r.id) } };
  const out = await loadExtensions(ctx, { pluginRoot: ROOT });
  assert.deepEqual(out.refused, []);
  for (const pack of out.loaded) {
    assert.equal(pack.from, `pack:${pack.id}`);
    for (const id of pack.capabilities) assert.ok(id.startsWith("orbit."), id);
    for (const id of pack.capabilities) assert.equal(ctx.capabilities.sourceOf(id), `pack:${pack.id}`);
  }
  const backend = out.loaded.find((p) => p.id === "orbit-backend-test");
  assert.deepEqual(backend.adapters, ["amqp.reference"]);
  assert.equal(ctx.adapters.get("amqp.reference").from, "pack:orbit-backend-test");
  assert.deepEqual(ctx.adapters.get("amqp.reference").undeclared, [], "every semantics field the reference adapter states is declared vocabulary");
  assert.ok(ctx.capabilities.has("orbit.messaging.publish") && ctx.capabilities.has("orbit.schedule.expect"));
  rmSync(store, { recursive: true, force: true });
});

test("a project that names no pack loads none of them", async () => {
  const store = mkdtempSync(join(tmpdir(), "orbit-packs-"));
  mkdirSync(qcToolPaths(store).root, { recursive: true });
  const ctx = { ...fakeContext(), store: () => store };
  const out = await loadExtensions(ctx, { pluginRoot: ROOT });
  assert.deepEqual(out.loaded, []);
  assert.equal(ctx.capabilities.has("orbit.http.read"), false);
  rmSync(store, { recursive: true, force: true });
});
