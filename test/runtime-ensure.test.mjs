// Memory first: the table, the state it derives, and the promise that an
// unchanged checkout is understood without reading a single file.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readersPrint } from "../src/runtime/discover/index.mjs";
import { DECISIONS, decide, stateOf } from "../src/runtime/ensure.mjs";
import { engineVersion } from "../src/version.mjs";
import { ensure, look } from "../src/runtime/understanding.mjs";
import { NODE_AND_DOTNET, UNKNOWN_STACK } from "./fakes/runtime.mjs";
import { fakeRuntime } from "./fakes/runtime-ctx.mjs";

const facts = (over = {}) => ({ readable: true, forced: false, model: { readers: "r", unknowns: [], inventory: [] }, modelWhy: null, count: 3, readers: "r", stale: [], dirty: [], added: [], removed: [], ...over });

test("every row of the table is reachable, the first match wins and the last always matches", () => {
  const cases = { BLOCKED_SOURCE: facts({ readable: false }), RESCAN: facts({ forced: true }), BOOTSTRAP: facts({ model: null, count: 0 }), UNREADABLE_STATE: facts({ model: null, modelWhy: "torn" }), READERS_CHANGED: facts({ readers: "other" }), EVIDENCE_CHANGED: facts({ stale: ["a"] }), CURRENT: facts() };
  for (const [name, f] of Object.entries(cases)) assert.equal(decide(f).name, name);
  assert.deepEqual(DECISIONS.map((d) => d.name), Object.keys(cases));
  assert.equal(DECISIONS.at(-1).when({}), true);
});

test("`writes` is a column, and --dry is the table with it flipped; every row says what it decided", () => {
  for (const row of DECISIONS) assert.equal(typeof row.say(facts({ stale: ["a"], added: ["b"], removed: ["c"] })), "string");
  assert.equal(decide(facts({ stale: ["a"] })).writes, true);
  assert.equal(decide(facts({ stale: ["a"] }), { dry: true }).writes, false);
  assert.equal(decide(facts()).writes, false);
  assert.match(decide(facts({ stale: ["a", "b"], added: ["c"] })).say, /2 evidence files changed, 1 evidence file appeared/);
});

test("the state is derived, and says what could not be settled rather than guessing", () => {
  const states = { NOT_DISCOVERED: facts({ model: null }), STALE: facts({ stale: ["a"] }), UNKNOWN: facts({ dirty: ["a"] }), PARTIAL: facts({ model: { readers: "r", unknowns: ["x"], gaps: ["x"] } }), CURRENT: facts({ model: { readers: "r", unknowns: ["a note"], gaps: [] } }) };
  for (const [name, f] of Object.entries(states)) assert.equal(stateOf(f), name);
  assert.equal(stateOf(facts({ readable: false })), "UNKNOWN");
  assert.equal(stateOf(facts({ added: ["a"] })), "STALE");
  assert.equal(stateOf(facts({ removed: ["a"] })), "STALE");
  assert.equal(stateOf(facts({ readers: "new" })), "STALE");
  assert.equal(stateOf(facts({ count: 0 })), "PARTIAL", "nothing to understand is not the same as understood");
});

test("the first look reads the evidence ONCE and remembers it; the second reads nothing at all", () => {
  const { ctx, source, store } = fakeRuntime(NODE_AND_DOTNET);
  const first = ensure(ctx);
  assert.deepEqual([first.decision.name, first.state, source.calls.read > 0], ["BOOTSTRAP", "CURRENT", true]);
  assert.ok(store.all().length > 10);
  const reads = source.calls.read;
  const second = ensure(ctx);
  assert.deepEqual([second.decision.name, second.state, second.read], ["CURRENT", "CURRENT", null]);
  assert.equal(source.calls.read, reads, "no file was read");
});

test("changing a SOURCE file moves nothing: the understanding of what a checkout needs does not go stale because somebody edited a class", () => {
  const { ctx, source } = fakeRuntime({ ...NODE_AND_DOTNET, "api/Controllers/CustomerService.cs": "class A {}" });
  ensure(ctx);
  source.write("api/Controllers/CustomerService.cs", "class A { int x; }");
  const reads = source.calls.read;
  assert.equal(ensure(ctx).decision.name, "CURRENT");
  assert.equal(source.calls.read, reads);
});

test("changing an EVIDENCE file reads the evidence again -- and only the evidence", () => {
  const { ctx, source, store } = fakeRuntime(NODE_AND_DOTNET);
  ensure(ctx);
  const edited = JSON.parse(NODE_AND_DOTNET["web/package.json"]);
  edited.engines.node = ">=24";
  source.write("web/package.json", JSON.stringify(edited));
  assert.equal(look(ctx).state, "STALE");
  const before = source.calls.paths.length;
  const again = ensure(ctx);
  assert.match(again.decision.say, /1 evidence file changed/);
  assert.ok(source.calls.paths.slice(before).every((p) => !p.endsWith(".cs")), "no source file was read");
  const node = store.all().find((f) => f.kind === "requirement" && f.requirement === "node");
  assert.equal(node.range, ">=24");
  assert.equal(look(ctx).state, "CURRENT", "a launch profile that was skipped is a note, not a gap");
});

test("an evidence file that APPEARS or goes away is noticed from the listing, with nothing read", () => {
  const { ctx, source } = fakeRuntime(NODE_AND_DOTNET);
  ensure(ctx);
  source.write("worker/Makefile", "run:\n\t./w\n");
  const stat = look(ctx);
  assert.deepEqual([stat.state, stat.added], ["STALE", ["worker/Makefile"]]);
  ensure(ctx);
  assert.equal(look(ctx).added.length, 0);
  source.remove("worker/Makefile");
  assert.deepEqual([look(ctx).state, look(ctx).removed], ["STALE", ["worker/Makefile"]]);
  ensure(ctx);
  assert.equal([...ctx.store.all()].some((f) => f.evidence.includes("worker/Makefile")), false, "what is no longer derived is removed");
});

test("evidence with uncommitted edits is UNKNOWN -- it cannot be called moved or not -- and is not a reason to read again", () => {
  const { ctx, source } = fakeRuntime(NODE_AND_DOTNET);
  ensure(ctx);
  source.state.dirty.add("web/package.json");
  const stat = look(ctx);
  assert.deepEqual([stat.state, stat.dirty], ["UNKNOWN", ["web/package.json"]]);
  const reads = source.calls.read;
  assert.equal(ensure(ctx).decision.name, "CURRENT");
  assert.equal(source.calls.read, reads);
});

test("--dry says what would be read and writes nothing; --rescan reads again regardless", () => {
  const { ctx, io } = fakeRuntime(UNKNOWN_STACK);
  const dry = ensure(ctx, { dry: true });
  assert.deepEqual([dry.decision.name, dry.decision.writes, io.files.size], ["BOOTSTRAP", false, 0]);
  assert.ok(dry.facts.length > 0, "the facts it WOULD record are shown");
  ensure(ctx);
  assert.equal(ensure(ctx, { rescan: true }).decision.name, "RESCAN");
});

test("no readable checkout is Blocked, never a failure of the product", () => {
  const { ctx } = fakeRuntime({}, { source: { files: () => null, commit: () => null, branch: () => null, read: () => null, fingerprints: () => null, search: () => null } });
  assert.throws(() => ensure(ctx), /no readable git checkout/);
});

test("a different engine or a different catalog reads again, so an upgrade needs no migration", () => {
  const { ctx } = fakeRuntime(NODE_AND_DOTNET);
  ensure(ctx);
  assert.equal(ensure({ ...ctx, catalog: { ...ctx.catalog, digest: "new-catalog" } }).decision.name, "READERS_CHANGED");
});

test("what reads a checkout includes the ENGINE's version: what an upgrade learned to read is read, without the evidence moving", () => {
  const { ctx } = fakeRuntime(NODE_AND_DOTNET);
  assert.notEqual(readersPrint(ctx, "1.7.6"), readersPrint(ctx, "1.7.7"));
  assert.equal(readersPrint(ctx, "1.7.6"), readersPrint(ctx, "1.7.6"));
  assert.equal(readersPrint(ctx), readersPrint(ctx, engineVersion()), "by default it is the engine that is running");
  ensure(ctx);
  ctx.store.setModel({ ...ctx.store.model().model, readers: readersPrint(ctx, "0.0.0") });
  assert.equal(ensure(ctx).decision.name, "READERS_CHANGED", "a model an older engine wrote is read again");
  assert.equal(ensure(ctx).decision.name, "CURRENT", "and once is enough");
});

test("a state file from another schema is refused and left unchanged", () => {
  const { ctx, io, store } = fakeRuntime(NODE_AND_DOTNET);
  ensure(ctx);
  const file = store.paths.model;
  io.write(file, JSON.stringify({ v: 99 }));
  assert.throws(() => ensure(ctx), /schema v99/);
  assert.equal(io.read(file), JSON.stringify({ v: 99 }));
});

test("every stored fact belongs to THIS checkout, is fresh, and carries the commit it was read at", () => {
  const { ctx, store } = fakeRuntime(NODE_AND_DOTNET);
  ensure(ctx);
  for (const f of store.all()) assert.deepEqual([f.checkout, f.status, f.commit], [ctx.checkout, "fresh", "abc1234"], f.key);
});

test("a manifest that cannot be read is a GAP, so the checkout is PARTIAL -- and a checkout with nothing to understand is too", () => {
  const broken = fakeRuntime({ ...NODE_AND_DOTNET, "web/package.json": "{ torn" });
  assert.equal(ensure(broken.ctx).state, "PARTIAL");
  assert.match(broken.store.model().model.gaps[0], /web\/package.json/);
  assert.equal(ensure(fakeRuntime({ "README.md": "# nothing" }).ctx).state, "PARTIAL");
});

// What a real run showed: `adopt` patched an evidence file, and CURRENT said every evidence file was
// "still where the last read left it" while `status` said UNKNOWN. Both true of the commit; only one
// sentence said what to DO.
test("CURRENT over evidence with uncommitted edits names them, and says committing them is what gets them read", () => {
  const row = DECISIONS.find((d) => d.name === "CURRENT");
  assert.equal(row.say({ count: 9, dirty: [".devcontainer/devcontainer.json"] }), "9 fact(s) from the last commit; 1 evidence file has uncommitted edits (.devcontainer/devcontainer.json) — what is read is what is committed, so commit it and the next look reads it");
  assert.equal(row.say({ count: 9, dirty: [] }), "9 fact(s), every evidence file still where the last read left it");
});
