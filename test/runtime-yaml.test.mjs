// The tolerant YAML-subset reader: what container files, task runners and
// pipeline definitions are written in, read far enough to answer a few questions
// and never further than it can tell.
import { test } from "node:test";
import assert from "node:assert/strict";
import { parseYaml } from "../src/runtime/discover/yaml-lite.mjs";

const parse = (text) => parseYaml(text).value;

test("block mappings and sequences by indentation, with plain, quoted and typed scalars", () => {
  const got = parse(`
services:
  db:
    image: postgres:16
    ports:
      - "5432:5432"
      - 5433
    environment:
      DEBUG: true
      LABEL: 'it''s fine'
      EMPTY: null
`);
  assert.deepEqual(got, { services: { db: { image: "postgres:16", ports: ["5432:5432", 5433], environment: { DEBUG: true, LABEL: "it's fine", EMPTY: null } } } });
});

test("a sequence may sit at its key's own indent, as compose files write it", () => {
  const got = parse(`services:
  web:
    ports:
    - "80:80"
    - "443:443"
    image: nginx:1
`);
  assert.deepEqual(got, { services: { web: { ports: ["80:80", "443:443"], image: "nginx:1" } } });
});

test("a mapping inside a sequence item, its keys lined up under the first", () => {
  const got = parse(`jobs:
  build:
    steps:
      - name: Checkout
        uses: some/action@v4
      - run: make test
      - name: With
        with:
          node-version: 22
`);
  assert.deepEqual(got.jobs.build.steps, [{ name: "Checkout", uses: "some/action@v4" }, { run: "make test" }, { name: "With", with: { "node-version": 22 } }]);
});

test("flow collections, single and multi line, nested and quoted", () => {
  assert.deepEqual(parse("os: [ubuntu-latest, windows-latest]"), { os: ["ubuntu-latest", "windows-latest"] });
  assert.deepEqual(parse("matrix: { os: [a, b], node: 22 }"), { matrix: { os: ["a", "b"], node: 22 } });
  assert.deepEqual(parse(`ports: [ "80:80",\n  "443:443" ]`), { ports: ["80:80", "443:443"] });
  assert.deepEqual(parse(`cmd: ["CMD", "curl", "-f", "http://localhost:8080/health"]`), { cmd: ["CMD", "curl", "-f", "http://localhost:8080/health"] });
});

test("a version with a decimal point stays a STRING: 3.10 is not 3.1", () => {
  assert.deepEqual(parse("python-version: 3.10\nnode: 22\nlts: '20'"), { "python-version": "3.10", node: 22, lts: "20" });
});

test("comments are dropped, except inside quotes; blank lines and a leading document marker are nothing", () => {
  const got = parse(`---
# header
a: 1 # trailing
b: "x # not a comment"
c: 'y # nor this'

d:   # a key with a comment after it
  e: 2
`);
  assert.deepEqual(got, { a: 1, b: "x # not a comment", c: "y # nor this", d: { e: 2 } });
});

test("only the FIRST document of a stream is read", () => {
  assert.deepEqual(parse("a: 1\n---\nb: 2\n"), { a: 1 });
});

test("a block scalar is one string, read approximately, and says so", () => {
  const out = parseYaml(`run: |
  make build
  make test
next: 1
`);
  assert.deepEqual(out.value, { run: "make build\nmake test", next: 1 });
  assert.ok(out.notes.some((n) => /block scalar/.test(n)));
});

test("an anchor, alias or tag is kept raw and SAID, never resolved", () => {
  const out = parseYaml("base: &defaults\n  a: 1\nuse: *defaults\n");
  assert.equal(out.value.use, "*defaults");
  assert.ok(out.notes.some((n) => /anchor, alias or tag/.test(n)));
});

test("quoted keys may hold a colon, and a URL value is not mistaken for a key", () => {
  assert.deepEqual(parse(`"a:b": 1\nurl: http://localhost:8080/health`), { "a:b": 1, url: "http://localhost:8080/health" });
});

test("empty input, comments only and a bare scalar are answers, not throws", () => {
  assert.deepEqual(parseYaml(""), { value: null, notes: [] });
  assert.equal(parse("# only a comment\n"), null);
  assert.equal(parse("just text"), "just text");
  assert.doesNotThrow(() => parseYaml("a: [unclosed\nb: {"));
  assert.doesNotThrow(() => parseYaml("\t- tabs\n\t\t- everywhere"));
});

test("a Taskfile, a compose file and a workflow in one go", () => {
  const task = parse(`version: '3'\ntasks:\n  build:\n    cmds:\n      - go build ./...\n  test:\n    cmds: [go test ./...]\n`);
  assert.deepEqual(Object.keys(task.tasks), ["build", "test"]);
  const wf = parse(`on: push\njobs:\n  t:\n    runs-on: \${{ matrix.os }}\n    strategy:\n      matrix:\n        os: [ubuntu-latest, macos-latest]\n`);
  assert.deepEqual(wf.jobs.t.strategy.matrix.os, ["ubuntu-latest", "macos-latest"]);
  assert.equal(wf.jobs.t["runs-on"], "${{ matrix.os }}");
});
