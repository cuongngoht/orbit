import assert from "node:assert/strict";
import { test } from "node:test";
import { DECISIONS, decide } from "../src/engineering/ensure.mjs";
import { ensureFacts, restamped } from "../src/engineering/freshen.mjs";
import { ingest } from "../src/engineering/ingest.mjs";
import { createEngineering } from "../src/engineering/store.mjs";
import { fakeIo } from "./fakes/io.mjs";

// Facts DESCRIBED, not produced: the table is pure, so every row is reachable
// without a disk, a clock or a commit.
const described = (over = {}) => ({ readable: true, count: 3, asked: [], answered: [], moved: [], ...over });

test("every row is reachable, in order, and the last always matches", () => {
  assert.equal(decide(described({ readable: false })).name, "BLOCKED_SOURCE");
  assert.equal(decide(described({ count: 0 })).name, "EMPTY");
  assert.equal(decide(described({ asked: ["queue"], moved: ["src/a"] })).name, "TARGETED");
  assert.equal(decide(described({ moved: ["src/a"] })).name, "REVALIDATE");
  assert.equal(decide(described()).name, "CURRENT");
  assert.equal(DECISIONS.at(-1).when({}), true);
});

test("--dry is the same decision with restamping switched off", () => {
  for (const f of [described(), described({ moved: ["src/a"] })]) {
    assert.equal(decide(f).restamps, true);
    assert.equal(decide(f, { dry: true }).restamps, false);
    assert.equal(decide(f, { dry: true }).name, decide(f).name);
  }
});

test("a targeted decision says which moved scopes it walked past", () => {
  assert.deepEqual(decide(described({ asked: ["queue"], moved: ["src/a"] })).skipped, ["src/a"]);
});

// A source port whose tree can be edited between calls.
function tree(hashes) {
  const state = { hashes: { ...hashes }, dirty: {} };
  const source = { commit: () => "abc1234", fingerprints: (scopes) => Object.fromEntries(scopes.filter((s) => state.hashes[s]).map((s) => [s, { hash: state.hashes[s], files: 1, dirty: state.dirty[s] ?? 0 }])) };
  return { state, source };
}

function recorded(extra = {}) {
  const t = tree({ "src/Application": "h1", README: "r1", "test/gate.test.mjs": "g1" });
  const ctx = { eng: createEngineering("/store/acme", fakeIo()), source: t.source, now: () => "2026-09-23T10:00:00.000Z" };
  ingest(ctx, [{ kind: "pattern", key: "repository", statement: "Persistence goes through repositories", scope: ["src/Application"], evidence: ["src/Application/IOrderRepository.cs"], source: "repository", strength: "observed", ...extra }], { seenBy: { host: "a", at: "2026-09-23T01:00:00Z" }, human: true });
  return { ctx, t };
}

const settle = (ctx, args = []) => {
  const facts = ensureFacts(ctx, args);
  const decision = decide(facts, { dry: args.includes("--dry") });
  restamped(ctx, facts, decision);
  return { facts, decision, fact: ctx.eng.all()[0] };
};

test("an unrelated change leaves the fact fresh; a change in its own scope makes it stale", () => {
  const { ctx, t } = recorded();
  t.state.hashes.README = "r2";
  assert.equal(settle(ctx).fact.status, "fresh", "a README commit is not news about src/Application");
  t.state.hashes["src/Application"] = "h2";
  const after = settle(ctx);
  assert.equal(after.decision.name, "REVALIDATE");
  assert.equal(after.fact.status, "stale");
  assert.equal(after.fact.statement, "Persistence goes through repositories", "stale never rewrites a judgement");
});

test("uncommitted edits in the scope make it unknown, never fresh and never stale", () => {
  const { ctx, t } = recorded();
  t.state.dirty["src/Application"] = 2;
  assert.equal(settle(ctx).fact.status, "unknown");
});

test("an enforced fact goes stale when its GATE moves, and keeps its strength", () => {
  const { ctx, t } = recorded({ kind: "invariant", key: "no-raw-sql", strength: "enforced", source: "test-suite", enforcedBy: ["test/gate.test.mjs"] });
  t.state.hashes["test/gate.test.mjs"] = "g2";
  const { fact } = settle(ctx);
  assert.equal(fact.status, "stale");
  assert.equal(fact.strength, "enforced", "a moved gate is revalidated, never quietly demoted");
});

test("--dry measures and writes nothing", () => {
  const { ctx, t } = recorded();
  t.state.hashes["src/Application"] = "h2";
  const { facts, fact } = settle(ctx, ["--dry"]);
  assert.equal(facts.changes.length, 1);
  assert.equal(fact.status, "fresh", "nothing was restamped");
});

test("a task nothing recorded speaks to is TARGETED; one it does speak to is not", () => {
  const { ctx } = recorded();
  assert.equal(settle(ctx, ["--for=publish a message to the queue"]).decision.name, "TARGETED");
  assert.equal(settle(ctx, ["--for=add a repository for orders"]).decision.name, "CURRENT");
});
