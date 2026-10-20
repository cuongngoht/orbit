import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMIT, recall } from "../src/engineering/recall.mjs";
import { ROUTING, TIERS, routeOf } from "../src/engineering/vocab.mjs";

const fact = (over = {}) => ({ id: `eng-x-${Math.random().toString(16).slice(2, 8)}`, kind: "pattern", key: "repository", statement: "s", scope: ["src/Infrastructure"], confidence: "possible", strength: "observed", status: "fresh", ...over });

const tier = (f) => routeOf(f).tier;

test("the routing policy, row by row", () => {
  assert.equal(tier(fact({ strength: "enforced", confidence: "certain" })), "CONSTRAINT");
  assert.equal(tier(fact({ strength: "enforced", confidence: "possible" })), "CLAIMED_GATE");
  assert.equal(tier(fact({ strength: "adopted" })), "CONVENTION");
  assert.equal(tier(fact({ confidence: "certain" })), "CONTEXT");
  assert.equal(tier(fact()), "HINT", "possible + observed is a hint, never a rule");
  assert.equal(tier(fact({ confidence: "certain", status: "stale" })), "HINT", "a stale observation is not strong context");
  assert.equal(tier(fact({ strength: "suggested" })), "ADVICE");
  assert.equal(tier(fact({ strength: "enforced", confidence: "certain", status: "stale" })), "REVALIDATE", "binding + stale must be re-checked before anything else");
  assert.equal(ROUTING.at(-1).when({}), true);
});

test("only a gate or a person makes a fact binding", () => {
  assert.deepEqual(ROUTING.filter((r) => r.binding).map((r) => r.tier), ["CONSTRAINT", "CONVENTION"]);
});

test("a task sees what touches it, most binding first", () => {
  const facts = [fact({ key: "repository" }), fact({ key: "repository", strength: "adopted" }), fact({ key: "tenant-scope", kind: "data-isolation", scope: ["src/Data"], strength: "enforced", confidence: "certain" })];
  const rows = recall(facts, { asked: ["repository", "order"] });
  assert.deepEqual(rows.map((r) => r.route.tier), ["CONVENTION", "HINT"], "the unrelated constraint is not shown");
});

test("a hint needs a direct subject hit; being nearby is enough only for what binds", () => {
  const facts = [fact({ key: "logging", scope: ["src/Infrastructure"] }), fact({ key: "logging", scope: ["src/Infrastructure"], strength: "adopted" })];
  const rows = recall(facts, { asked: [], near: ["src/Infrastructure/Orders"] });
  assert.deepEqual(rows.map((r) => r.route.tier), ["CONVENTION"]);
});

test("with no task at all, only binding facts are worth printing", () => {
  const rows = recall([fact(), fact({ strength: "adopted" }), fact({ strength: "enforced", confidence: "certain" })]);
  assert.deepEqual(rows.map((r) => r.route.tier), ["CONSTRAINT", "CONVENTION"]);
});

test("recall is bounded, and never routes what nothing can grade", () => {
  const many = Array.from({ length: 20 }, () => fact({ strength: "adopted" }));
  assert.equal(recall(many, { asked: ["repository"] }).length, LIMIT);
  assert.equal(recall([fact({ strength: "nonsense" })], { asked: ["repository"] }).length, 0);
  assert.ok(TIERS.includes("UNROUTED"));
});

test("the statement is never what matches — only what the fact is about", () => {
  assert.equal(recall([fact({ key: "logging", statement: "every repository logs" })], { asked: ["repository"] }).length, 0);
});
