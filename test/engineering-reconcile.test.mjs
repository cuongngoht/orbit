import assert from "node:assert/strict";
import { test } from "node:test";
import { factId } from "../src/engineering/model.mjs";
import { sessionMarks } from "../src/memory/session.mjs";
import { reconcile } from "../src/engineering/reconcile.mjs";

const existing = (over = {}) => ({
  id: "eng-pattern-abc123",
  kind: "pattern",
  key: "repository",
  statement: "Persistence access goes through repository abstractions",
  scope: ["src/Application"],
  evidence: ["src/Application/IOrderRepository.cs"],
  source: "repository",
  confidence: "possible",
  strength: "observed",
  status: "fresh",
  unknowns: [],
  support: { examples: 1, sessions: 1, against: 0, seen: sessionMarks({ host: "laptop-a", at: "2026-09-10T00:00:00.000Z" }), contested: [] },
  lastSeenBy: { host: "laptop-a", at: "2026-09-10T00:00:00.000Z" },
  ...over,
});

const candidate = (over = {}) => ({
  kind: "pattern",
  key: "repository",
  statement: "Persistence access goes through repository abstractions",
  scope: ["src/Application"],
  evidence: ["src/Application/IOrderRepository.cs"],
  source: "repository",
  confidence: "possible",
  strength: "observed",
  seenBy: { host: "laptop-b", at: "2026-09-20T00:00:00.000Z" },
  ...over,
});

test("no existing fact is a new one, stamped with one session's support", () => {
  const { outcome, fact } = reconcile(candidate(), null);
  assert.equal(outcome, "new");
  assert.equal(fact.support.examples, 1);
  assert.equal(fact.support.sessions, 1);
  assert.equal(fact.support.against, 0);
  assert.equal(fact.support.seen.length, 1, "the session is remembered as a hashed key");
  assert.equal(fact.confidence, "possible");
  assert.equal(fact.lastSeenBy.host, "laptop-b");
  assert.ok(!("seenBy" in fact), "the envelope field must not leak into the stored fact");
  assert.ok(!("contradicts" in fact));
});

test("identical evidence from a second independent session confirms and promotes confidence", () => {
  const { outcome, fact } = reconcile(candidate(), existing());
  assert.equal(outcome, "confirm");
  assert.equal(fact.confidence, "certain", "two independent sessions with no contradiction is certain");
  assert.equal(fact.support.sessions, 2);
});

test("the same session confirming itself again is not a second session", () => {
  const c = candidate({ seenBy: { host: "laptop-a", at: "2026-09-10T12:00:00.000Z" } });
  const { fact } = reconcile(c, existing());
  assert.equal(fact.support.sessions, 1, "a rerun inside one session must not count twice");
  assert.equal(fact.confidence, "possible", "one session's worth of evidence stays possible");
});

test("new evidence extends the fact and still counts as a second session", () => {
  const c = candidate({ evidence: ["src/Application/IOrderRepository.cs", "src/Application/ICustomerRepository.cs"] });
  const { outcome, fact } = reconcile(c, existing());
  assert.equal(outcome, "extend");
  assert.deepEqual([...fact.evidence].sort(), ["src/Application/ICustomerRepository.cs", "src/Application/IOrderRepository.cs"]);
  assert.equal(fact.support.sessions, 2);
  assert.equal(fact.confidence, "certain");
});

test("strength never moves here, whatever the candidate claims", () => {
  const c = candidate({ strength: "enforced" });
  const { fact } = reconcile(c, existing({ strength: "observed" }));
  assert.equal(fact.strength, "observed", "reconciliation is evidence bookkeeping, never a rewrite of what was decided");
});

test("a candidate naming a contradiction produces a finding and leaves every judgement untouched", () => {
  const c = candidate({ contradicts: "eng-pattern-abc123", statement: "Controllers access persistence directly", evidence: ["src/Web/OrderController.cs"], strength: "suggested" });
  const before = existing({ confidence: "certain", support: { ...existing().support, sessions: 2 } });
  const { outcome, fact, finding } = reconcile(c, before);
  assert.equal(outcome, "contradict");
  for (const k of ["statement", "scope", "evidence", "strength", "key", "kind"]) assert.deepEqual(fact[k], before[k], `${k} must not move`);
  assert.equal(fact.support.against, 1, "the contradicting session is counted");
  assert.equal(fact.confidence, "possible", "a contested fact is not certain, however many sessions support it");
  assert.equal(finding.kind, "engineering-drift");
  assert.equal(finding.factId, "eng-pattern-abc123");
  assert.match(finding.say, /contradicts eng-pattern-abc123/);
});

test("a contradiction against nothing existing is just a new fact — there is nothing to leave untouched", () => {
  const c = candidate({ contradicts: "eng-pattern-abc123" });
  assert.equal(reconcile(c, null).outcome, "new");
});

test("factId derives the same stable id a store lookup would use", () => {
  assert.equal(factId(candidate()), factId({ kind: "pattern", key: "repository" }));
});
