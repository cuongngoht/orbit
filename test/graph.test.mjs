import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { describe, graphFindings, layersOf, loadGraph, route, surface, screenControls, screenEffects } from "../src/graph/index.mjs";
import { judge, parseCandidates } from "../src/graph/record-edge.mjs";
import { drifted, inside } from "../src/query/check.mjs";
import { UI_TESTS } from "./fakes/context.mjs";

const g = loadGraph(join(UI_TESTS, "graph"));

// A map written into a temp directory, so a broken one can be loaded on purpose.
function mapOf(files) {
  const dir = mkdtempSync(join(tmpdir(), "orbit-graph-"));
  for (const [name, value] of Object.entries(files)) writeFileSync(join(dir, name + ".json"), JSON.stringify(value));
  return loadGraph(dir);
}

// A Map keeps the LAST record with a given key, so two `home` screens collapsed
// into one and the map went on describing a url nobody navigates to.
test("a duplicate screen id or control key is a finding that names where both records are", () => {
  const dup = mapOf({
    screens: [{ id: "home", name: "H", url: "/a" }, { id: "home", name: "H", url: "/b" }],
    edges: [{ from: "home", via: "Go", selector: "x", opens: "none" }, { from: "home", via: "Go", selector: "y", opens: "none" }],
    effects: [],
  });
  assert.deepEqual(graphFindings(dup), ["duplicate screen id home: screens.json #1, #2", "duplicate control home/Go: edges.json #1, #2"]);
  assert.deepEqual(graphFindings(g), [], "the fixture map stays clean");
});

// `check` exists to name a broken map. Throwing out of the loader meant it could
// not even be asked -- one stray null aborted the whole command.
test("a map file of the wrong shape is reported, not thrown", () => {
  assert.deepEqual(graphFindings(mapOf({ screens: { nope: true }, edges: [], effects: [] })), ["screens.json must be an array of records"]);
  assert.deepEqual(graphFindings(mapOf({ screens: [], edges: [null], effects: [] })), ["edges.json #1 is not a record"]);
});

// The engine ships no stack vocabulary: one product's queue is another's
// nothing. It knows `sql` because it can go and verify that one itself.
test("layers are declared by the map, and an entry reads as the sentence the map wrote", () => {
  assert.deepEqual(layersOf(null).map((l) => l.key), ["sql"]);
  const [sql, queue] = layersOf(g.meta);
  assert.equal(describe(sql, { table: "Things", cols: ["a", "b"] }), "Things (a, b)");
  assert.equal(describe(sql, { table: "Things" }), "Things", "a segment whose field is absent disappears");
  assert.equal(describe(queue, { topic: "t", consumer: "c" }), "t -> c");
  assert.equal(describe({ key: "x" }, { any: 1 }), '{"any":1}', "no template: print the record, never a guess");
});

test("check holds every effect to the vocabulary meta.json declares", () => {
  const of = (effect) => graphFindings({ ...g, effects: [effect], rows: [] });
  const base = { on: "home/Add", backend: "app", src: "a:1", timing: "sync" };
  assert.deepEqual(of(base), []);
  assert.match(of({ ...base, timing: "eventually" })[0], /timing "eventually" is not declared/);
  assert.match(of({ ...base, timing: "deferred" })[0], /names nothing in the "queue" layer that finishes it/);
  assert.match(of({ ...base, layers: { blob: [{ src: "a:2" }] } })[0], /layer "blob", which graph\/meta.json does not declare/);
});

test("surface follows url-less nodes only; controls and effects follow the surface", () => {
  assert.deepEqual([...surface(g, "home")], ["home", "dlg-thing"]);
  assert.equal(screenControls(g, "home").length, 4);
  assert.equal(screenEffects(g, "home")[0].on, "dlg-thing/Save");
});

test("route finds the shortest click-path and null when there is none", () => {
  assert.deepEqual(route(g, "home", "dlg-thing").map((s) => s.e.via), ["Add"]);
  assert.equal(route(g, "dlg-thing", "home"), null);
});

test("record-edge judges candidates against the map", () => {
  const text = [
    '{"from":"home","via":"New","kind":"button","selector":"x","opens":"none","to":null,"seen":"src"}',
    '{"from":"home","via":"Add","kind":"button","selector":"x","opens":"none","to":null,"seen":"src"}',
    '{"from":"home","via":"Bad","kind":"button","selector":"UNKNOWN","opens":"none","to":null,"seen":"live"}',
    "not json",
  ].join("\n");
  const warnings = [];
  const { accepted, rejected } = judge(g, parseCandidates(text, (w) => warnings.push(w)));
  assert.deepEqual(accepted.map((e) => e.via), ["New"]);
  assert.deepEqual(rejected.map((r) => r.why), ["home/Add is already in the graph — correct it with a new record, do not re-add it", "selector is empty or UNKNOWN — a step cannot be driven from it"]);
  assert.equal(warnings.length, 1);
});

// The map is memory, and the whole point of stamping fe_commit on it is being
// able to say "this may have expired". An UNDATED map must stay silent rather
// than cry wolf: a warning nobody can act on trains people to ignore warnings.
test("a dated map knows when the frontend has moved past it, an undated one says nothing", () => {
  assert.equal(drifted("abc1234", "def5678"), true, "the frontend moved — say so");
  assert.equal(drifted("abc1234", "abc1234"), false, "same commit, nothing to report");
  assert.equal(drifted(null, "def5678"), false, "no fe_commit recorded: undated, not drifted");
  assert.equal(drifted("abc1234", null), false, "no readable checkout: unknown, not drifted");
  assert.equal(drifted(undefined, undefined), false);
});

// A sibling is not a child. `/repo-runs` shares a prefix with `/repo` and is a
// different directory, so a startsWith() test would have reported a path outside
// the checkout as inside it and sent somebody to fix a config that was right.
test("check can tell a path inside the checkout from one that merely starts like it", () => {
  assert.equal(inside(join("/repo"), join("/repo", "ui-tests", "runs")), true);
  assert.equal(inside(join("/repo"), join("/repo")), true, "the root itself is inside it");
  assert.equal(inside(join("/repo"), join("/repo-runs", "x")), false, "a sibling that shares a prefix is not a child");
  assert.equal(inside(join("/repo"), join("/home", "me", ".orbit", "runs")), false);
  assert.equal(inside(join("/repo"), ""), false, "nothing declared is not a reason to complain");
});
