// JSONC read with positions and edited by splicing: every byte outside an edit
// is the byte that was there, and what cannot be edited without losing something
// is refused with a sentence.
import { test } from "node:test";
import assert from "node:assert/strict";
import { edit, get, parse, valueOf, verify } from "../src/runtime/jsonc.mjs";

const DEVCONTAINER = `// A dev container for the shop.
{
  "name": "shop", // shown in the status bar
  /* pinned: 20 is what CI runs */
  "features": {
    "ghcr.io/devcontainers/features/node:1": { "version": "20" },
    "ghcr.io/devcontainers/features/dotnet:2": {} // no version: the image default
  },
  "forwardPorts": [3000, 5000],
  "remoteEnv": { "A": "1" },
}
`;

test("parse reads comments, trailing commas and a BOM, and says where every value is", () => {
  const doc = parse(`﻿${DEVCONTAINER}`);
  assert.equal(doc.ok, true);
  assert.equal(doc.comments.length, 4);
  assert.deepEqual(doc.value.forwardPorts, [3000, 5000]);
  assert.equal(doc.value.features["ghcr.io/devcontainers/features/node:1"].version, "20");
  const node = get(doc.tree, ["features", "ghcr.io/devcontainers/features/node:1", "version"]);
  assert.equal(DEVCONTAINER.slice(node.start - 1, node.end - 1), '"20"');
  assert.deepEqual(valueOf(get(doc.tree, ["forwardPorts"])), [3000, 5000]);
  assert.equal(get(doc.tree, ["features", "nope"]), null);
});

test("what does not parse is a sentence with a place, never a throw", () => {
  const bad = (text) => parse(text).error;
  assert.match(bad('{ "a": "open'), /never closes/);
  assert.match(bad('{ "a": 1, "a": 2 }'), /"a" is there twice/);
  assert.match(bad('{ "a": 1 } /'), /stray "\/"/);
  assert.match(bad('{ "a": 1 } /* open'), /never closes/);
  assert.match(bad('{ "a": 1 } 2'), /more than one value/);
  assert.match(bad('{ "a": tru }'), /unexpected "t"/);
  assert.match(bad('{ "a" 1 }'), /expected ":"/);
  assert.match(bad('[1 2]'), /expected "," or "]"/);
  assert.match(bad(""), /ends where a value was expected/);
  assert.match(bad(`${"[".repeat(70)}${"]".repeat(70)}`), /nested more than 64/);
});

test("set replaces ONE value and leaves every other byte alone, comments and all", () => {
  const out = edit(DEVCONTAINER, [{ op: "set", path: ["features", "ghcr.io/devcontainers/features/node:1", "version"], value: "22" }]);
  assert.equal(out.ok, true);
  assert.equal(out.text, DEVCONTAINER.replace('"version": "20"', '"version": "22"'));
  assert.equal(verify(DEVCONTAINER, out.text, [{ op: "set", path: ["features", "ghcr.io/devcontainers/features/node:1", "version"], value: "22" }]).ok, true);
});

test("set refuses to replace a value that has a comment inside it", () => {
  const text = `{ "a": [1, /* keep */ 2] }`;
  const out = edit(text, [{ op: "set", path: ["a"], value: [] }]);
  assert.equal(out.ok, false);
  assert.match(out.reason, /has a comment inside it/);
});

test("insert into an object that already has a trailing comma keeps the trailing comma, one per line", () => {
  const out = edit(DEVCONTAINER, [{ op: "insert", path: [], key: "workspaceFolder", value: "/workspace" }]);
  assert.equal(out.ok, true);
  assert.ok(out.text.includes(`  "remoteEnv": { "A": "1" },\n  "workspaceFolder": "/workspace",\n}`), out.text);
  assert.equal(parse(out.text).value.workspaceFolder, "/workspace");
});

test("a member inserted after an INLINE last member that ends in a line comment goes on its own line, not into the comment", () => {
  const text = '{ "features": { "a": {} // note\n  } }\n';
  const edits = [{ op: "insert", path: ["features"], key: "b", value: { version: "1" } }];
  const out = edit(text, edits);
  assert.equal(out.ok, true);
  assert.deepEqual(parse(out.text).value, { features: { a: {}, b: { version: "1" } } }, "both members are really there");
  assert.match(out.text, /\/\/ note\n/, "the comment is untouched and ends its own line");
  assert.equal(verify(text, out.text, edits).ok, true);
  const appended = edit('{ "ports": [1 // one\n  ] }\n', [{ op: "append", path: ["ports"], value: 2 }]);
  assert.deepEqual(parse(appended.text).value, { ports: [1, 2] });
  const block = edit('{ "features": { "a": {} /* note */ } }\n', edits);
  assert.deepEqual(parse(block.text).value, { features: { a: {}, b: { version: "1" } } }, "a block comment is not the problem: it ends where it ends");
});

test("insert after a last member that has a line comment leaves the comment on ITS line", () => {
  const out = edit(DEVCONTAINER, [{ op: "insert", path: ["features"], key: "ghcr.io/devcontainers/features/python:1", value: { version: "3.13" } }]);
  assert.equal(out.ok, true);
  assert.ok(out.text.includes(`"ghcr.io/devcontainers/features/dotnet:2": {}, // no version: the image default\n    "ghcr.io/devcontainers/features/python:1": {\n      "version": "3.13"\n    }\n  },`), out.text);
  assert.equal(verify(DEVCONTAINER, out.text, [{ op: "insert", path: ["features"], key: "ghcr.io/devcontainers/features/python:1", value: { version: "3.13" } }]).ok, true);
});

test("a line comment after a trailing comma stays with the member it was written on", () => {
  const out = edit(`{\n  "a": 1, // note\n}\n`, [{ op: "insert", path: [], key: "b", value: 2 }]);
  assert.equal(out.text, `{\n  "a": 1, // note\n  "b": 2,\n}\n`);
});

test("insert into an object without a trailing comma adds the comma, and into an inline one stays inline", () => {
  const multi = edit(`{\n  "a": 1\n}\n`, [{ op: "insert", path: [], key: "b", value: 2 }]);
  assert.equal(multi.text, `{\n  "a": 1,\n  "b": 2\n}\n`);
  const inline = edit(`{ "a": 1 }`, [{ op: "insert", path: [], key: "b", value: 2 }]);
  assert.equal(inline.text, `{ "a": 1, "b": 2 }`);
});

test("an empty object is filled in the shape it was written in, and one with a comment is refused", () => {
  assert.equal(edit(`{ "o": {} }`, [{ op: "insert", path: ["o"], key: "k", value: 1 }]).text, `{ "o": {"k": 1} }`);
  assert.equal(edit(`{\n  "o": {\n  }\n}`, [{ op: "insert", path: ["o"], key: "k", value: 1 }]).text, `{\n  "o": {\n    "k": 1\n  }\n}`);
  const refused = edit(`{ "o": { /* why */ } }`, [{ op: "insert", path: ["o"], key: "k", value: 1 }]);
  assert.match(refused.reason, /has a comment inside/);
});

test("append adds one item, inline or one per line, keeping a trailing comma", () => {
  assert.equal(edit(`{ "p": [1, 2] }`, [{ op: "append", path: ["p"], value: 3 }]).text, `{ "p": [1, 2, 3] }`);
  assert.equal(edit(`{\n  "p": [\n    1,\n    2\n  ]\n}`, [{ op: "append", path: ["p"], value: 3 }]).text, `{\n  "p": [\n    1,\n    2,\n    3\n  ]\n}`);
  assert.equal(edit(`{\n  "p": [\n    1,\n  ]\n}`, [{ op: "append", path: ["p"], value: 2 }]).text, `{\n  "p": [\n    1,\n    2,\n  ]\n}`);
  assert.equal(edit(`{ "p": [] }`, [{ op: "append", path: ["p"], value: 1 }]).text, `{ "p": [1] }`);
});

test("a file indented with tabs gets tabs", () => {
  const out = edit(`{\n\t"a": {\n\t\t"x": 1\n\t}\n}`, [{ op: "insert", path: ["a"], key: "y", value: { z: 1 } }]);
  assert.equal(out.text, `{\n\t"a": {\n\t\t"x": 1,\n\t\t"y": {\n\t\t\t"z": 1\n\t\t}\n\t}\n}`);
  assert.equal(parse(out.text).ok, true);
});

test("several edits are applied one after another, each over what the last left", () => {
  const edits = [
    { op: "set", path: ["features", "ghcr.io/devcontainers/features/node:1", "version"], value: "22" },
    { op: "insert", path: ["features"], key: "ghcr.io/devcontainers/features/python:1", value: {} },
    { op: "append", path: ["forwardPorts"], value: 8080 },
  ];
  const out = edit(DEVCONTAINER, edits);
  assert.equal(out.ok, true);
  assert.deepEqual(parse(out.text).value.forwardPorts, [3000, 5000, 8080]);
  assert.equal(verify(DEVCONTAINER, out.text, edits).ok, true);
  assert.equal(parse(out.text).comments.length, 4, "every comment is still there");
});

test("a refused edit names why, and nothing is applied", () => {
  assert.match(edit(DEVCONTAINER, [{ op: "insert", path: ["features"], key: "ghcr.io/devcontainers/features/node:1", value: {} }]).reason, /already there/);
  assert.match(edit(DEVCONTAINER, [{ op: "insert", path: ["forwardPorts"], key: "x", value: 1 }]).reason, /is not an object/);
  assert.match(edit(DEVCONTAINER, [{ op: "append", path: ["name"], value: 1 }]).reason, /is not an array/);
  assert.match(edit(DEVCONTAINER, [{ op: "set", path: ["nowhere"], value: 1 }]).reason, /nothing at/);
  assert.match(edit(DEVCONTAINER, [{ op: "explode", path: [] }]).reason, /not an edit/);
  assert.match(edit("{ nope", [{ op: "set", path: [], value: 1 }]).reason, /does not parse/);
});

test("verify catches a lost comment, a wrong value, and text that no longer parses", () => {
  const edits = [{ op: "insert", path: [], key: "x", value: 1 }];
  const good = edit(DEVCONTAINER, edits).text;
  assert.equal(verify(DEVCONTAINER, good, edits).ok, true);
  assert.match(verify(DEVCONTAINER, good.replace("// shown in the status bar", ""), edits).why, /had 4 comment\(s\) and now has 3/);
  assert.match(verify(DEVCONTAINER, good.replace('"x": 1', '"x": 2'), edits).why, /does not hold what the edits describe/);
  assert.match(verify(DEVCONTAINER, "{ torn", edits).why, /edited text does not parse/);
  assert.match(verify("{ torn", good, edits).why, /original text does not parse/);
});
