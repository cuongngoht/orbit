import assert from "node:assert/strict";
import { test } from "node:test";
import { DECISIONS, decide } from "../src/architecture/ensure.mjs";
import { capabilityTokens, covers, tokens, unanswered } from "../src/architecture/tokens.mjs";
import { canonicalClaim } from "../src/learn/fingerprint.mjs";
import { ensureFacts } from "../src/architecture/facts.mjs";
import { fakeFrontend } from "./fakes/frontend.mjs";

const facts = (over = {}) => ({ readable: true, model: { v: 1, scopes: {} }, modelWhy: null, count: 4, facts: [], asked: [], unanswered: [], moved: [], scopes: {}, ...over });

const cap = (over = {}) => ({ kind: "capability", key: "sql", capability: "sql", scope: ["ui-tests"], ...over });

// The property that makes a decision table safe to read at 2am: there is no
// input it has no answer for.
test("the last row always matches, so no input falls through", () => {
  assert.equal(DECISIONS.at(-1).when(facts()), true);
  assert.equal(DECISIONS.at(-1).name, "CURRENT");
  for (const d of DECISIONS) assert.equal(typeof d.scan, "string", `${d.name} does not say what it would read`);
  for (const d of DECISIONS) assert.equal(typeof d.writes, "boolean", `${d.name} does not say whether it writes`);
});

test("no snapshot bootstraps; a snapshot whose state cannot be read says so and keeps the file", () => {
  assert.equal(decide(facts({ model: null, count: 0, modelWhy: "nothing has scanned this project yet" })).name, "BOOTSTRAP");
  const torn = decide(facts({ model: null, count: 9, modelWhy: "schema v99" }));
  assert.equal(torn.name, "UNREADABLE_STATE");
  assert.match(torn.say, /left where it is/);
  assert.equal(torn.scan, "all");
});

// The whole point of the feature, as one assertion.
test("a current snapshot decides CURRENT and reads nothing", () => {
  const d = decide(facts());
  assert.equal(d.name, "CURRENT");
  assert.equal(d.scan, "none");
  assert.equal(d.writes, false);
  assert.match(d.say, /every scope still where the snapshot left it/);
});

test("no checkout is BLOCKED and stops, rather than scanning something it cannot date", () => {
  const d = decide(facts({ readable: false, model: null, count: 0 }));
  assert.equal(d.name, "BLOCKED_SOURCE");
  assert.equal(d.stops, true);
  assert.equal(d.scan, "none");
});

// Settled with the user: the caller asked a question, so answer it -- but the
// row has to say which stale scopes it walked past, or "done" overstates it.
test("a capability question beats a stale scope, and names what it skipped", () => {
  const d = decide(facts({ unanswered: ["graph"], moved: ["src/run"] }));
  assert.equal(d.name, "TARGETED");
  assert.equal(d.scan, "asked");
  assert.deepEqual(d.skipped, ["src/run"]);
  assert.match(d.say, /nothing recorded here speaks to graph/);
});

test("a moved scope with nothing asked re-reads only the scopes that moved", () => {
  const d = decide(facts({ moved: ["src/run", "src/dsl"] }));
  assert.equal(d.name, "INCREMENTAL");
  assert.equal(d.scan, "scopes");
  assert.match(d.say, /src\/run, src\/dsl — re-reading those and nothing else/);
  assert.deepEqual(d.skipped, [], "an incremental scan skips nothing, so it claims nothing");
});

// `writes` is a column, so --dry is the table with one column flipped rather
// than a branch in the caller that could disagree with it.
test("--dry flips the writes column on every row and nothing else", () => {
  for (const row of DECISIONS) {
    const f = facts({ model: null, count: 0, unanswered: ["x"], moved: ["y"], readable: row.name !== "BLOCKED_SOURCE" });
    assert.equal(decide(f, { dry: true }).writes, false, `${row.name} still writes under --dry`);
  }
  assert.equal(decide(facts({ model: null, count: 0 })).writes, true, "and it writes when not dry");
});

// A proper name is the signal. Nothing here knows what any of these products
// are, and a row naming one would be the engine learning a product.
test("a capability is found by its proper name, and an action verb is not one", () => {
  assert.deepEqual(capabilityTokens("verify the created file through Microsoft Graph"), ["microsoft", "graph"]);
  assert.deepEqual(capabilityTokens("create a file"), []);
  assert.deepEqual(capabilityTokens("Verify a file"), [], "a capitalised QA verb is grammar, not a capability");
  assert.deepEqual(capabilityTokens("read a row over SQL"), ["sql"], "an acronym counts");
  assert.deepEqual(capabilityTokens(""), []);
  assert.deepEqual(capabilityTokens("Microsoft Graph verification"), ["microsoft", "graph"], "first word included when it is a name");
});

test("--capability says it outright when a sentence carries no proper name", () => {
  const ctx = { arch: { model: () => ({ model: { v: 1, scopes: {} }, why: null }), all: () => [] }, source: fakeFrontend() };
  assert.deepEqual(ensureFacts(ctx, ["--for=create a file"]).asked, []);
  assert.deepEqual(ensureFacts(ctx, ["--capability=microsoft-graph"]).asked, ["microsoft-graph"]);
  assert.deepEqual(ensureFacts(ctx, ["--capability=a,b", "--for=through Graph"]).asked, ["a", "b", "graph"], "both, when both are given");
});

// A module that shares a word with the question is a coincidence. Letting it
// answer is how a token search starts sounding certain about what it never read.
test("only a capability fact may answer a capability question", () => {
  const ctx = { arch: { model: () => ({ model: { v: 1, scopes: {} }, why: null }), all: () => [{ kind: "module", key: "src/graph", scope: ["src/graph"] }] }, source: fakeFrontend() };
  assert.deepEqual(ensureFacts(ctx, ["--capability=graph"]).unanswered, ["graph"], "a module named graph must not answer for a graph capability");

  const withCap = { ...ctx, arch: { ...ctx.arch, all: () => [cap({ key: "graph", capability: "graph" })] } };
  assert.deepEqual(ensureFacts(withCap, ["--capability=graph"]).unanswered, [], "once recorded, the same question is answered");
});

test("a recorded capability answers by subject, never by the wording of its statement", () => {
  assert.equal(covers(cap({ capability: "microsoft-graph" }), ["graph"]), true);
  assert.equal(covers(cap({ capability: "sql", statement: "no graph integration is recorded" }), ["graph"]), false);
  assert.deepEqual(unanswered([cap({ capability: "sql" })], ["sql", "graph"]), ["graph"]);
});

// Two tokenisers in one engine is one too many unless they agree about what
// carries meaning. Enforced by test rather than by an import, the way
// test/query-dsl.test.mjs holds the digest to the tables.
test("tokenising drops the same empty words the lesson store already drops", () => {
  const sample = "the api is not a thing that was on the screen";
  const mine = tokens(sample);
  const theirs = canonicalClaim(sample).split(" ").filter(Boolean);
  for (const w of ["the", "is", "not", "a", "that", "was", "on"]) {
    assert.ok(!mine.includes(w), `tokens kept the empty word "${w}"`);
    assert.ok(!theirs.includes(w), `canonicalClaim kept "${w}" — the two have drifted`);
  }
  assert.ok(mine.includes("api") && mine.includes("screen"));
});

// Deciding must never be mistaken for scanning: it fingerprints what the facts
// already name, and that is all.
test("deciding lists no files and reads none — that is what a scan is", () => {
  const source = fakeFrontend({ fingerprints: { "src/dsl": { hash: "aa", files: 2, dirty: 0 } } });
  const ctx = { arch: { model: () => ({ model: { v: 1, scopes: { "src/dsl": { hash: "aa" } } }, why: null }), all: () => [{ kind: "module", key: "src/dsl", scope: ["src/dsl"] }] }, source };
  const f = ensureFacts(ctx, ["--for=create a file"]);

  assert.equal(decide(f).name, "CURRENT");
  assert.equal(source.calls.files, 0, "it listed the tree");
  assert.equal(source.calls.read, 0, "it read a file");
  assert.equal(source.calls.fingerprints, 1, "one call, however many scopes");
  assert.equal(source.calls.commit, 1, "one cheap check that there is a checkout at all");
});
