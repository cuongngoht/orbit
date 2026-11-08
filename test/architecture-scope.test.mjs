// A fact's SCOPE is the paths it is about, and freshness is measured over exactly those (src/architecture/fields.mjs):
// "which is why an unrelated commit leaves the fact alone". Every reader of a scope -- the fingerprint, the freshness
// check, an incremental scan's narrowing -- reads `.` as the WHOLE tree (src/frontend/index.mjs `under`). So a fact
// about the files at the root of a checkout must never be scoped `.`: a convention counting `*.json` across the tree
// named the root's own package.json by the folder it sits in, `.`, and from then on every commit anywhere moved it --
// the snapshot was keyed to HEAD for nearly every real project (a root package.json and four more JSON files anywhere
// are enough), and every look after a commit re-read the whole tree. Found by the benchmark's memory cases (0.5.0, B3).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { ANALYZERS } from "../src/architecture/analyzers/index.mjs";
import { CONVENTION_SCOPES } from "../src/architecture/analyzers/shape.mjs";
import { createArchitecture } from "../src/architecture/store.mjs";
import { ensure } from "../src/architecture/views/ensure.mjs";
import { createSourceTree } from "../src/frontend/composite.mjs";
import { realIo } from "../src/store/io.mjs";
import { sealed } from "./home.mjs";

const GIT_ENV = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@orbit.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@orbit.invalid" };

// A root manifest and four more beside it: five `*.json`, one of them at the root.
const TREE = { "package.json": JSON.stringify({ name: "demo" }), "README.md": "# demo\n", ...Object.fromEntries([0, 1, 2, 3].map((i) => [`packages/p${i}/package.json`, JSON.stringify({ name: `p${i}`, dependencies: { [`dep${i}`]: "1.0.0" } })])) };

const shape = ANALYZERS.find((a) => a.name === "shape");

test("a convention that counts a file at the root watches that file, never the whole tree", () => {
  const { facts } = shape.run({ files: Object.keys(TREE), read: () => "" });
  const json = facts.find((f) => f.kind === "convention" && f.key === "json");
  assert.ok(json, "five *.json make a convention");
  assert.ok(!json.scope.includes(".") && !json.scope.includes(""), `scoped to the whole tree: ${json.scope.join(", ")}`);
  assert.ok(json.scope.includes("package.json"), "the root's own file is what the fact is about");
  assert.ok(json.scope.includes("packages/p0"), "a nested file is still watched by its folder");
});

function repoOf(t, tree = TREE) {
  const base = mkdtempSync(join(tmpdir(), "orbit-arch-scope-"));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const repo = join(base, "repo");
  for (const [rel, text] of Object.entries(tree)) (mkdirSync(dirname(join(repo, rel)), { recursive: true }), writeFileSync(join(repo, rel), text));
  for (const a of [["init", "-q"], ["add", "-A"], ["commit", "-qm", "one"]]) git(repo, a);
  return { base, repo };
}

const ctxOf = ({ base, repo }) => ({ arch: createArchitecture(join(base, "store"), realIo({ host: "test", now: () => "2026-11-05T00:00:00.000Z" })), source: createSourceTree([repo]), config: { frontend: {} }, project: { layout: 2, root: repo, uiTests: join(repo, "ui-tests") }, now: () => "2026-11-05T00:00:00.000Z" });

const git = (repo, args) => execFileSync("git", args, { cwd: repo, env: sealed(GIT_ENV), stdio: "ignore" });

// One `architecture ensure`, its decision as the view says it first.
function looked(ctx) {
  const said = [];
  const log = console.log;
  console.log = (...a) => said.push(a.join(" "));
  try { ensure(ctx, []); } finally { console.log = log; }
  return /^ARCHITECTURE (\w+)/.exec(said[0] ?? "")?.[1] ?? null;
}

test("a commit that touches nothing any fact is about leaves the next look CURRENT, never a rescan", (t) => {
  const { base, repo } = repoOf(t);
  const ctx = { arch: createArchitecture(join(base, "store"), realIo({ host: "test", now: () => "2026-11-05T00:00:00.000Z" })), source: createSourceTree([repo]), config: { frontend: {} }, project: { layout: 2, root: repo, uiTests: join(repo, "ui-tests") }, now: () => "2026-11-05T00:00:00.000Z" };
  assert.deepEqual([looked(ctx), looked(ctx)], ["BOOTSTRAP", "CURRENT"]);
  mkdirSync(join(repo, "notes"));
  writeFileSync(join(repo, "notes", "today.txt"), "a note no fact is about\n");
  for (const a of [["add", "-A"], ["commit", "-qm", "a note"]]) git(repo, a);
  assert.equal(looked(ctx), "CURRENT", "the snapshot is keyed to each fact's own scope, never to HEAD");
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "demo", dependencies: { left: "1.0.0" } }));
  for (const a of [["commit", "-qam", "the root manifest"]]) git(repo, a);
  assert.equal(looked(ctx), "INCREMENTAL", "a change to the root's own file still moves what is about it");
});

// A convention is a count over the whole listing, and no scope short of the whole tree keeps a count current -- so it
// watches a BOUNDED sample of the folders holding what it counted. That bound was a silent `.slice(0, 8)` of the folders
// in name order (0.5.0 review of B3): on this repository the `*.mjs` convention, 1657 files in 259 folders, watched
// `acceptance/**` and `benchmark/**` and said nothing of the rest. It watches the folders holding the most, of exactly
// the files it counted, and says how many of how many.
const SPREAD = { ...Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`checks/c${i}.test.mjs`, ""])), ...Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`lib/m0${i}/one.mjs`, ""])), ...Object.fromEntries(["lib/m10", "lib/m11"].flatMap((d) => [0, 1, 2, 3].map((i) => [`${d}/f${i}.mjs`, ""]))) };

test("a convention watches the folders holding the most of what it counted, at most CONVENTION_SCOPES, and says how many of how many", () => {
  const { facts } = shape.run({ files: Object.keys(SPREAD), read: () => "" });
  const mjs = facts.find((f) => f.kind === "convention" && f.key === "mjs");
  assert.match(mjs.statement, /^18 tracked file\(s\) are named \*\.mjs$/);
  assert.equal(mjs.scope.length, CONVENTION_SCOPES, mjs.scope.join(", "));
  assert.ok(["lib/m10", "lib/m11"].every((d) => mjs.scope.includes(d)), `the folders holding the most are watched first: ${mjs.scope.join(", ")}`);
  assert.ok(!mjs.scope.includes("checks") && mjs.evidence.every((p) => !p.endsWith(".test.mjs")), "a *.test.mjs is not one of the files *.mjs counted");
  assert.ok(mjs.unknowns.some((u) => /watches 8 of the 12 folder\(s\) holding one: a file named so added, removed or renamed in any other folder leaves it as it was until a scan counts again/.test(u)), mjs.unknowns.join(" | "));
  const tests = facts.find((f) => f.kind === "convention" && f.key === "test.mjs");
  assert.deepEqual(tests.scope, ["checks"]);
  assert.ok(tests.unknowns.some((u) => /watches every one of the 1 folder\(s\) holding one/.test(u)), tests.unknowns.join(" | "));
});

const twelve = () => Object.fromEntries(Array.from({ length: 12 }, (_, d) => [0, 1, 2].map((i) => [`pkg/m${String(d).padStart(2, "0")}/f${i}.mjs`, `export const x = ${i};\n`])).flat());

const counted = (ctx, key) => ctx.arch.all().find((f) => f.kind === "convention" && f.key === key)?.statement ?? null;

// What an incremental look re-read came back as the WHOLE tree's count: an incremental scan narrows its input to the
// scopes that moved, and the shape analysis ran over that part too -- so one folder holding five `*.mjs` rewrote "40
// tracked file(s)" as "7". It reads no file, so it is handed the whole listing, and every scan counts again.
test("an incremental look over one folder never rewrites a count over the whole tree with that folder's", (t) => {
  const at = repoOf(t, twelve());
  const ctx = ctxOf(at);
  assert.deepEqual([looked(ctx), counted(ctx, "mjs")], ["BOOTSTRAP", "36 tracked file(s) are named *.mjs"]);
  for (const i of [3, 4, 5, 6]) writeFileSync(join(at.repo, "pkg/m01", `g${i}.mjs`), "export const y = 1;\n");
  for (const a of [["add", "-A"], ["commit", "-qm", "four more in one folder"]]) git(at.repo, a);
  assert.deepEqual([looked(ctx), counted(ctx, "mjs")], ["INCREMENTAL", "40 tracked file(s) are named *.mjs"], "the count over the tree, never pkg/m01's seven");
  assert.equal(looked(ctx), "CURRENT", "the scan recorded every scope it stamped");
  writeFileSync(join(at.repo, "pkg/m11", "late.mjs"), "export const z = 1;\n");
  for (const a of [["add", "-A"], ["commit", "-qm", "one in a folder the convention does not watch"]]) git(at.repo, a);
  assert.deepEqual([looked(ctx), counted(ctx, "mjs")], ["INCREMENTAL", "41 tracked file(s) are named *.mjs"], "a scan that runs for another fact counts it again");
});
