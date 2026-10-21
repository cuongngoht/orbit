// What a composition file DECLARES, as system graph facts (ADR 0033; doc §4.2): a component per
// service -- one, however many files describe it -- what each starts after, the networks each is
// attached to; read with the YAML reader the composition root hands in, never run, and never read
// for what an image's name suggests. What it cannot know, it says, on every fact.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ANALYZERS } from "../src/architecture/analyzers/index.mjs";
import { topology } from "../src/architecture/analyzers/topology.mjs";
import { graphOf } from "../src/architecture/graph-view.mjs";
import { factFindings } from "../src/architecture/model.mjs";
import { parseYaml } from "../src/runtime/discover/yaml-lite.mjs";
import { mergeVocabulary } from "../src/topology/vocabulary.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE = join(ROOT, "test", "fixtures", "topology");
const VOCAB = mergeVocabulary([{ layer: "orbit", from: "catalog/topology.json", doc: JSON.parse(readFileSync(join(ROOT, "catalog/topology.json"), "utf8")) }]);

const TREE = {
  "deploy/compose.yaml": readFileSync(join(FIXTURE, "compose.yaml"), "utf8"),
  "deploy/compose.override.yaml": readFileSync(join(FIXTURE, "compose.override.yaml"), "utf8"),
  "src/api/Program.cs": "// the api",
  "README.md": "# demo",
};

function input(over = {}) {
  const reads = [];
  return { reads, files: Object.keys(TREE), read: (p) => (reads.push(p), TREE[p] ?? null), yaml: (t) => parseYaml(t), ...over };
}

const keys = (facts, kind) => facts.filter((f) => f.kind === kind).map((f) => f.key).sort();

test("it runs as an analyser of its own, reading declarations", () => {
  const row = ANALYZERS.find((a) => a.name === "topology");
  assert.equal(row.reads, "declarations");
  assert.equal(row.run, topology);
});

test("each service is ONE component however many files describe it, each depends_on an edge, each network a node it is attached to", () => {
  const { facts } = topology(input());
  assert.deepEqual(keys(facts, "node"), ["component:api", "component:broker", "component:cache", "component:db", "component:worker", "network:ops", "network:task"]);
  assert.deepEqual(keys(facts, "relation"), [
    "component:api attached-to network:task",
    "component:api depends-on component:broker",
    "component:api depends-on component:cache",
    "component:api depends-on component:db",
    "component:broker attached-to network:ops",
    "component:broker attached-to network:task",
    "component:worker attached-to network:task",
    "component:worker depends-on component:broker",
  ]);
  const api = facts.find((f) => f.key === "component:api");
  assert.deepEqual(api.evidence, ["deploy/compose.override.yaml", "deploy/compose.yaml"], "both files that describe it are its evidence");
  assert.deepEqual(api.scope, api.evidence);
});

test("an image is kept as what the file says, and nothing is inferred from its name", () => {
  const { facts } = topology(input());
  assert.deepEqual(facts.find((f) => f.key === "component:broker").attributes, { image: "rabbitmq:4" });
  assert.deepEqual(facts.find((f) => f.key === "component:worker").attributes, { built: true });
  assert.deepEqual([...new Set(facts.map((f) => f.nodeKind ?? f.relation))].sort(), ["attached-to", "component", "depends-on", "network"], "a broker's image makes no channel and no publishes-to");
});

test("every fact passes the field table and the graph rules, and says what it could not know", () => {
  const { facts } = topology(input());
  for (const f of facts) assert.deepEqual(factFindings(f, f.key), [], f.key);
  for (const f of facts) assert.ok(f.unknowns.length && f.unknowns.every((u) => u.length > 25), `${f.key} says too little about what it could not know`);
  assert.ok(facts.find((f) => f.key === "component:db").unknowns.some((u) => /which network it is on/.test(u)), "a service that names no network says so");
  assert.equal(facts.every((f) => f.confidence === "certain" && f.source === "repository"), true, "a declaration is certain about what it declares");
});

test("it reads only the composition files, and says what it skipped in them", () => {
  const i = input();
  const out = topology(i);
  assert.deepEqual(i.reads.sort(), ["deploy/compose.override.yaml", "deploy/compose.yaml"]);
  assert.ok(out.unknowns.some((u) => /deploy\/compose.override.yaml: an anchor, alias or tag was not resolved/.test(u)), out.unknowns.join("\n"));
});

test("the file's own words, depends-on and attached-to, derive nothing; a network is a boundary", () => {
  const g = graphOf(topology(input()).facts.map((f) => ({ ...f, id: `arch-${f.kind}-${f.key}` })), VOCAB);
  assert.equal(g.relations.every((r) => r.role === null && !r.declared), true);
  assert.equal(g.nodes.find((n) => n.key === "network:task").role, "boundary");
  assert.deepEqual(g.conflicts, []);
});

test("no composition file, or no reader handed in, is an unknown that names what to do -- never an empty answer", () => {
  assert.match(topology(input({ files: ["src/api/Program.cs"] })).unknowns[0], /no composition file .* is tracked/);
  const unread = topology(input({ yaml: undefined }));
  assert.deepEqual(unread.facts, []);
  assert.match(unread.unknowns[0], /deploy\/compose.override.yaml, deploy\/compose.yaml declare — no YAML reader was handed to this analysis/);
  assert.match(topology(input({ files: ["fe::compose.yml"], read: () => "services:\n  web:\n    image: x\n" })).facts[0].key, /^component:web$/, "a second root's composition file is read too");
});
