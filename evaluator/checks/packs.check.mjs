// The task packs as data: complete, their hidden tests never a test file of this repository, every graded test file
// accounted for, their specs' own reference models true to their requests, and the converter's mutations exact.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { applied } from "../lib/tasks/convert.mjs";
import { loadPack, packIds, PACKS_DIR, startFiles } from "../lib/tasks/packs.mjs";

const walk = (p) => (statSync(p).isFile() ? [p] : readdirSync(p).flatMap((n) => walk(join(p, n))));

const DISCOVERED = /(^|\/)(test|[^/]*[.\-_]test|test-[^/]*)\.(mjs|cjs|js)$|(^|\/)test\//;

test("ten packs, from both fixtures, and the cases that are not packs listed with a reason", () => {
  const ids = packIds();
  assert.equal(ids.length, 10);
  assert.equal(ids.filter((id) => id.startsWith("orders-")).length, 6);
  assert.equal(ids.filter((id) => id.startsWith("lending-")).length, 4);
  const excluded = readFileSync(join(PACKS_DIR, "EXCLUDED.md"), "utf8");
  for (const c of ["ORBIT-E2E-007", "ORBIT-E2E-008", "ORBIT-HLD-005"]) assert.match(excluded, new RegExp(`\\| ${c} \\|`));
});

test("no file of a pack is one node --test would discover", () => {
  assert.deepEqual(walk(PACKS_DIR).map((f) => relative(PACKS_DIR, f)).filter((r) => DISCOVERED.test(r)), []);
});

for (const id of packIds()) {
  test(`${id}: complete, and every graded file accounted for`, () => {
    const p = loadPack(id);
    const start = startFiles(p).map((f) => f.rel);
    assert.ok(p.issue.trim().length > 100);
    assert.ok(p.f2p.length >= 1);
    for (const t of p.f2p) {
      assert.ok(existsSync(join(p.dir, "hidden", t.file)), t.file);
      assert.match(t.target, /^test\/[a-z0-9-]+\.test\.mjs$/);
      assert.ok(!start.includes(t.target), `${t.target} is hidden, so the start must not hold it`);
    }
    for (const rel of p.p2p) assert.ok(start.includes(rel), rel);
    assert.deepEqual(start.filter((r) => /^test\/.+\.test\.mjs$/.test(r)).sort(), [...p.p2p].sort());
    for (const name of Object.keys(p.controls)) assert.ok(readFileSync(join(p.dir, "controls", `${name}.patch`)).length > 0, name);
    assert.equal(p.controls.gold.expect, "RESOLVED");
    assert.equal(p.controls.regress.expect, "REGRESSED");
    assert.equal(p.controls.tamper.expect, "NOT_RESOLVED");
    assert.doesNotMatch(p.issue, /orbit/i);
  });

  test(`${id}: the hidden spec's reference model agrees with its request`, async () => {
    const spec = await import(pathToFileURL(join(PACKS_DIR, id, "hidden", "acceptance", "spec.mjs")).href);
    const meta = JSON.parse(readFileSync(join(PACKS_DIR, id, "hidden", "acceptance", "meta.json"), "utf8"));
    assert.deepEqual(spec.selfTest?.() ?? [], []);
    const cases = spec.cases(meta.seed, meta.samples);
    assert.ok(cases.length >= 20);
    assert.deepEqual(spec.cases(meta.seed, meta.samples), cases);
  });
}

test("a mutation applies only where it finds exactly what it says", () => {
  const files = [{ rel: "a", text: "x x y" }];
  assert.deepEqual(applied(files, { mutations: [{ id: "m", file: "a", find: "y", replace: "z", count: 1 }] }), [{ rel: "a", text: "x x z" }]);
  assert.throws(() => applied(files, { mutations: [{ id: "m", file: "a", find: "x", replace: "z", count: 1 }] }), /expected 1 match/);
  assert.throws(() => applied(files, { deletes: ["b"] }), /no such file/);
  assert.deepEqual(applied(files, { files: [{ rel: "b", lines: ["1"] }], deletes: ["a"] }), [{ rel: "b", text: "1\n" }]);
});
