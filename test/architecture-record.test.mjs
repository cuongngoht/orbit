import assert from "node:assert/strict";
import { test } from "node:test";
import { judge, parseCandidates, trackedSet } from "../src/architecture/record.mjs";
import { FRESH, STALE, UNKNOWN, factState, measure, movedScopes, scopeState } from "../src/freshness.mjs";
import { fakeFrontend } from "./fakes/frontend.mjs";

const FILES = ["CLAUDE.md", "src/dsl/verbs.mjs", "src/run/step.mjs", "skills/a/SKILL.md", "skills/b/SKILL.md"];

const TRACKED = trackedSet(FILES);

const line = (over = {}) => JSON.stringify({ kind: "extension-point", key: "skills", statement: "Optional integrations live under skills/", scope: ["skills"], evidence: ["skills/a/SKILL.md"], source: "repository", confidence: "certain", ...over });

const of = (...lines) => judge(parseCandidates(lines.join("\n")), { tracked: TRACKED, stamps: { commit: "abc1234" } });

// A scope is usually a directory and `git ls-files` lists only files, so every
// directory holding a tracked file has to count as tracked too.
test("the tracked set carries the directories as well as the files", () => {
  assert.ok(TRACKED.has("src/dsl/verbs.mjs"));
  assert.ok(TRACKED.has("src/dsl"), "a directory holding a tracked file is tracked");
  assert.ok(TRACKED.has("src"));
  assert.ok(!TRACKED.has("src/nope"));
  assert.ok(!TRACKED.has("node_modules"), "untracked means invisible");
});

test("a well-formed candidate citing real files is accepted and stamped", () => {
  const v = of(line());
  assert.equal(v.refused, false);
  assert.equal(v.accepted.length, 1);
  assert.equal(v.accepted[0].commit, "abc1234");
  assert.match(v.accepted[0].id, /^arch-extension-point-/);
});

// The rule that stops a guess becoming a fact. A claim about a tree that cites a
// file the tree does not have is not a weak claim, it is a fabricated one.
test("a fact citing a file nothing tracks is refused, and says which file", () => {
  const v = of(line({ evidence: ["skills/invented/SKILL.md"] }));
  assert.equal(v.refused, true);
  assert.match(v.rejected[0].why, /evidence "skills\/invented\/SKILL.md" is not tracked here/);
  assert.deepEqual(v.accepted, [], "nothing is accepted from a refused batch");
});

test("a scope matching no tracked file is refused too", () => {
  assert.match(of(line({ scope: ["src/imaginary"] })).rejected[0].why, /scope "src\/imaginary" matches no tracked file/);
});

// Checked against the LISTING, not the filesystem: a gitignored build artefact
// exists on disk and is exactly what must not count as evidence.
test("evidence is checked against what git tracks, not against what is on disk", () => {
  const v = of(line({ evidence: ["node_modules/x/README.md"] }));
  assert.equal(v.refused, true);
  assert.match(v.rejected[0].why, /not tracked here/);
});

// One investigation produces one batch. Storing the readable half stores half an
// answer and tells nobody which half.
test("one bad candidate refuses the whole batch, and every rejection is listed", () => {
  const v = of(line(), line({ key: "second", evidence: ["nope.md"] }), line({ key: "third", scope: ["also/nope"] }));
  assert.equal(v.refused, true);
  assert.equal(v.rejected.length, 2, "both rejections are reported, not just the first");
  assert.deepEqual(v.accepted, []);
  assert.deepEqual(v.rejected.map((r) => r.i), [1, 2], "each names its own line");
});

test("a line that is not JSON is a rejection with its line number, not a crash", () => {
  const v = of(line(), "{ truncated");
  assert.equal(v.refused, true);
  assert.match(v.rejected[0].why, /line 2: not valid JSON/);
});

test("the field table still applies to a recorded candidate", () => {
  assert.match(of(line({ confidence: "very" })).rejected[0].why, /confidence must be/);
  assert.match(of(line({ kind: "module", providedBy: "x" })).rejected[0].why, /providedBy belongs to a capability fact/);
});

// The heart of "no repository scan": a fact is dated against its own scope, so a
// commit elsewhere leaves it alone. This is the assertion that proves it.
test("a scope that did not move stays fresh however far HEAD has travelled", () => {
  assert.deepEqual(scopeState({ hash: "aa", files: 3, dirty: 0 }, "aa"), { hash: "aa", state: FRESH, say: "3 file(s), unchanged" });
  assert.equal(scopeState({ hash: "bb", files: 3, dirty: 0 }, "aa").state, STALE);
  assert.match(scopeState({ hash: "bb", files: 3, dirty: 0 }, "aa").say, /re-read it/);
});

// Neither `fresh` nor `stale` can be shown when the index cannot see the edit.
test("uncommitted edits make a scope unknown — never fresh, and never stale", () => {
  const dirty = scopeState({ hash: "aa", files: 3, dirty: 2 }, "aa");
  assert.equal(dirty.state, UNKNOWN);
  assert.match(dirty.say, /2 uncommitted change\(s\)/);
  assert.equal(scopeState(null, "aa").state, UNKNOWN, "a gone scope is unknown, not unchanged");
  assert.equal(scopeState({ hash: "aa", files: 1, dirty: 0 }, undefined).state, UNKNOWN, "nothing to compare against");
});

// A fact is as fresh as its least fresh scope: one reference that moved is
// enough to owe a re-read.
test("a fact spanning several scopes takes the worst of them", () => {
  const scopes = { a: { state: FRESH }, b: { state: FRESH }, c: { state: STALE }, d: { state: UNKNOWN } };
  assert.equal(factState({ scope: ["a", "b"] }, scopes), FRESH);
  assert.equal(factState({ scope: ["a", "c"] }, scopes), STALE);
  assert.equal(factState({ scope: ["a", "d"] }, scopes), UNKNOWN);
  assert.equal(factState({ scope: ["c", "d"] }, scopes), STALE, "stale beats unknown — something demonstrably moved");
  assert.equal(factState({ scope: [] }, scopes), UNKNOWN);
});

test("a rescan covers what moved and what nothing can speak for — never everything", () => {
  const scopes = { a: { state: FRESH }, b: { state: STALE }, c: { state: UNKNOWN } };
  assert.deepEqual(movedScopes(scopes).sort(), ["b", "c"]);
  assert.deepEqual(movedScopes({ a: { state: FRESH } }), []);
});

// Every scope the facts name, measured once, and nothing else asked of the tree.
test("measuring asks the source port for each distinct scope exactly once", () => {
  const source = fakeFrontend({ fingerprints: { "src/dsl": { hash: "aa", files: 2, dirty: 0 } } });
  const facts = [{ scope: ["src/dsl"] }, { scope: ["src/dsl", "src/run"] }];
  const scopes = measure(facts, { scopes: { "src/dsl": { hash: "aa" } } }, source);

  assert.deepEqual(source.calls.scopes, ["src/dsl", "src/run"], "each distinct scope once, no repeats");
  assert.equal(scopes["src/dsl"].state, FRESH);
  assert.equal(scopes["src/run"].state, UNKNOWN, "a scope the tree cannot fingerprint is unknown");
  assert.equal(source.calls.files, 0, "measuring must not list the whole tree");
  assert.equal(source.calls.fingerprints, 1, "one call for every scope, not one per scope");
  assert.equal(source.calls.read, 0, "measuring must not read a single file");
});
