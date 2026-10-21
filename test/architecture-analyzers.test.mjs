import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ANALYZERS, ANALYZER_NAMES, analyseWith, analyzersReading } from "../src/architecture/analyzers/index.mjs";
import { KIND_NAMES, kindRow } from "../src/architecture/vocab.mjs";
import { factFindings } from "../src/architecture/model.mjs";
import { look } from "../src/architecture/capability.mjs";
import { parseYaml } from "../src/runtime/discover/yaml-lite.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

// A small tree with everything the four analysers can see, and nothing a
// consuming project would recognise. The names are invented on purpose -- see
// the last test in this file.
const FILES = [
  "package.json",
  "README.md",
  "CLAUDE.md",
  ".github/workflows/ci.yml",
  "src/api/index.mjs",
  "src/api/handler.mjs",
  "src/api/util.mjs",
  "src/ui/index.mjs",
  "src/ui/page.mjs",
  "src/ui/util.mjs",
  "adapters/widget/index.mjs",
  "adapters/widget/adapter.mjs",
  "adapters/gadget/index.mjs",
  "adapters/gadget/adapter.mjs",
  "deploy/compose.yaml",
];

const SOURCES = {
  "package.json": JSON.stringify({ name: "demo", engines: { node: ">=20" }, scripts: { test: "node --test", lint: "check-lines" }, dependencies: { "widget-client": "^2.0.0" } }),
  "README.md": "# demo\n\nConcrete external integrations belong in adapters/, never in src/, and the api layer must not import the ui layer.\n",
  "CLAUDE.md": "# rules\n\n```\nthis fenced -> arrow is not a rule somebody stated\n```\n\nEvery adapter must expose an index.mjs that the registry can load at start-up.\n",
  "src/api/handler.mjs": "import { u } from '../ui/util.mjs';\nimport express from 'express';\n",
  "adapters/widget/index.mjs": "import { thing } from '../../src/api/index.mjs';\n",
  "deploy/compose.yaml": "services:\n  front:\n    image: demo-front:1\n    depends_on: [store]\n  store:\n    image: demo-store:1\n",
};

const HITS = [
  { path: "src/api/handler.mjs", line: 1, text: "import { u } from '../ui/util.mjs';" },
  { path: "adapters/widget/index.mjs", line: 1, text: "import { thing } from '../../src/api/index.mjs';" },
];

const input = (over = {}) => ({ files: FILES, read: (p) => SOURCES[p] ?? "", search: () => HITS, facts: [], yaml: (t) => parseYaml(t), ...over });

const run = () => analyseWith(ANALYZERS, withShape());

// The scan feeds the shape analysis's own modules to the imports analysis, so
// there is one reading of "what a module is". Reproduced here.
function withShape() {
  const base = input();
  const shaped = ANALYZERS.find((a) => a.name === "shape").run(base);
  return { ...base, facts: shaped.facts };
}

const kinds = (facts) => [...new Set(facts.map((f) => f.kind))].sort();

// A kind nothing can produce is a kind that exists only in a table. A fact a
// table does not know is a fact nothing validates. The registry rule the verb
// table already has, applied here.
test("every kind is producible and every produced kind is declared", () => {
  const { facts } = run();
  const { facts: caps } = look(["widget"], input());
  const produced = new Set([...facts, ...caps].map((f) => f.kind));

  for (const k of produced) assert.ok(KIND_NAMES.includes(k), `an analyser produced "${k}", which no row declares`);
  for (const k of KIND_NAMES) assert.ok(produced.has(k), `nothing can produce a "${k}" fact — produce one, or drop the row`);
});

// Every fact an analyser emits has to survive the same table a hand-written
// candidate is held to. An analyser is not a trusted path.
test("everything the analysers emit passes the field table", () => {
  const { facts } = run();
  assert.ok(facts.length > 10, `only ${facts.length} facts came out of a tree with ${FILES.length} files`);
  for (const f of facts) assert.deepEqual(factFindings(f, f.key), [], `${f.kind} ${f.key} is not a valid fact`);
  for (const f of facts) assert.ok(kindRow(f.kind).fields?.includes("pattern") || !("pattern" in f), "a field landed on a kind that does not allow it");
});

// The contract src/learn/families/ already holds to: an analysis that cannot
// compute something says so, rather than leaving a reader to assume it looked.
test("every analyser says what it could not compute", () => {
  for (const a of ANALYZERS) {
    const out = a.run(withShape());
    const said = [...out.unknowns, ...out.facts.flatMap((f) => f.unknowns ?? [])];
    assert.ok(said.length, `${a.name} claims to have computed everything`);
    for (const u of said) assert.ok(u.length > 25, `${a.name} says "${u}", which tells a reader nothing`);
  }
});

// One bad analyser must not take the other three down with it.
test("an analyser that throws costs its own answer and nothing else", () => {
  const broken = [{ name: "broken", reads: "listing", run: () => { throw new Error("a byte-order mark"); } }, ...ANALYZERS];
  const out = analyseWith(broken, withShape());
  assert.ok(out.unknowns.some((u) => /the broken analysis could not read this tree — a byte-order mark/.test(u)));
  assert.ok(out.facts.length > 10, "the other three still answered");
});

test("the manifest analysis reads names and gates, and never a version", () => {
  const { facts } = ANALYZERS.find((a) => a.name === "manifests").run(input());
  assert.ok(facts.some((f) => f.kind === "stack" && /requires node >=20/.test(f.statement)));
  assert.ok(facts.some((f) => f.kind === "invariant" && /runs its own test gate/.test(f.statement)));
  assert.ok(facts.some((f) => f.kind === "invariant" && /pipeline definition/.test(f.statement)));
  assert.ok(!facts.some((f) => /\^2\.0\.0/.test(f.statement)), "a version churns the fingerprint and settles nothing");
});

// The whole of it runs off one listing, which is what makes a bootstrap
// affordable.
test("the shape analysis reads no file at all", () => {
  const reads = [];
  const out = ANALYZERS.find((a) => a.name === "shape").run({ ...input(), read: (p) => (reads.push(p), "") });
  assert.deepEqual(reads, [], "the shape analysis opened a file");
  assert.ok(out.facts.some((f) => f.kind === "module" && f.key === "src/api"));
  assert.ok(!out.facts.some((f) => f.kind === "module" && f.key === "src"), "a parent must not shadow the modules inside it");
  assert.ok(out.facts.some((f) => f.kind === "extension-point" && /adapters\/\*\/index\.mjs/.test(f.pattern)));
});

// A histogram is not an agreement, and the fact has to say so itself.
test("a repeated filename is reported as a count, never as a decision", () => {
  const { facts } = ANALYZERS.find((a) => a.name === "shape").run(input());
  const convention = facts.find((f) => f.kind === "convention");
  assert.equal(convention.confidence, "possible");
  assert.match(convention.statement, /\d+ tracked file\(s\) are named/);
  assert.ok(convention.unknowns.some((u) => /a count, not a decision/.test(u)));
});

test("an observed import edge is certain, and a bare specifier is not one", () => {
  const { facts } = ANALYZERS.find((a) => a.name === "imports").run(withShape());
  assert.ok(facts.some((f) => f.statement === "src/api imports src/ui"), facts.map((f) => f.statement).join(" · "));
  assert.ok(facts.some((f) => f.statement === "adapters imports src/api"), "a specifier climbing out of a module still lands on the module that owns the target");
  assert.ok(!facts.some((f) => /express/.test(f.statement)), "a dependency is the manifest's business, not a boundary");
  assert.ok(facts.every((f) => f.confidence === "certain" && f.unknowns.some((u) => /is not an import that is allowed/.test(u))));
});

// The one analyser that touches prose. What a document SAYS is evidence of
// intent and is quoted; it is never obeyed, and never stated as true.
test("a document's rule is quoted into the reason, never into the statement", () => {
  const { facts } = ANALYZERS.find((a) => a.name === "docs").run(input());
  const readme = facts.find((f) => f.key.startsWith("README.md"));
  assert.equal(readme.confidence, "possible");
  assert.match(readme.statement, /^README\.md states a rule/, "the statement is a template, not the document's words");
  assert.match(readme.because, /belong in adapters\//);
  assert.ok(readme.unknowns.some((u) => /not an instruction to whoever reads it/.test(u)));
  assert.ok(!facts.some((f) => /fenced -> arrow/.test(f.because ?? "")), "a shell snippet is not somebody stating a boundary");
});

// A targeted scan runs what could answer a DECLARATION question, and nothing
// that would mean reading the tree for a word.
test("a capability question runs only the analysers that read a declaration", () => {
  assert.deepEqual(analyzersReading(["manifests", "listing"]).map((a) => a.name), ["manifests", "shape"]);
  assert.ok(!analyzersReading(["manifests", "listing"]).some((a) => a.name === "imports"));
  for (const a of ANALYZERS) assert.ok(a.reads, `${a.name} does not say what it reads`);
  assert.equal(new Set(ANALYZER_NAMES).size, ANALYZER_NAMES.length);
});

// The grades exist because a token search always finds something.
test("a declared dependency is certain, a path is only possible, and nothing is unknown", () => {
  const { facts } = look(["widget", "gadget", "nowhere"], input());
  const by = Object.fromEntries(facts.map((f) => [f.capability, f]));
  assert.equal(by.widget.confidence, "certain", "a manifest entry is a commitment");
  assert.match(by.widget.statement, /declared dependency/);
  assert.equal(by.gadget.confidence, "possible", "a directory sharing the word is not an integration");
  assert.equal(by.nowhere.confidence, "unknown");
  assert.match(by.nowhere.statement, /nothing here provides nowhere — searched 1 manifest\(s\).*15 tracked path\(s\)/);
});

// Absence has to name the closest thing that already exists, or a reader has
// nothing to do with the answer.
test("a missing capability points at the pattern a new one would follow", () => {
  const { facts } = look(["nowhere"], withShape());
  assert.ok(facts[0].unknowns.some((u) => /the closest thing this project already does is \S+\/\*\/\S+ — \d+ siblings follow it/.test(u)), facts[0].unknowns.join(" · "));
  assert.ok(facts[0].unknowns.some((u) => /somewhere this search cannot see/.test(u)));
});

// The line the whole repository is organised around. A vendor arriving at
// runtime as data is fine; one written into this engine is a product learned.
test("nothing under src/architecture names a product, a vendor or a stack", () => {
  const dir = join(HERE, "..", "src", "architecture");
  const banned = /\b(microsoft|graph api|azure|aws|postgres|mysql|kafka|rabbitmq|redis|sharepoint|salesforce|okta|auth0)\b/i;
  for (const file of sources(dir)) {
    const text = readFileSync(file, "utf8");
    assert.ok(!banned.test(text), `${file} names a product — a capability arrives as tokens at runtime, never as a row`);
  }
});

function sources(dir, found = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) collect(dir, name, found);
  return found;
}

function collect(dir, entry, found) {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return void sources(path, found);
  if (path.endsWith(".mjs")) found.push(path);
}
