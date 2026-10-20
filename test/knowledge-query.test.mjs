// Querying knowledge in a CONTEXT: coexisting answers, nesting, precedence by
// authority, ambiguity said out loud -- and the rivals settled at read time.
import assert from "node:assert/strict";
import { test } from "node:test";
import { ingest } from "../src/knowledge/ingest.mjs";
import { measured, query } from "../src/knowledge/query.mjs";
import { tokens } from "../src/tokens.mjs";
import { candidate, knowledgeWorld, seenBy } from "./fakes/knowledge.mjs";

// A relation the TEST teaches as data: one mechanism per context.
const MECHANISM = { id: "is-built-with", role: "implementation", cardinality: "one" };

const world = () => knowledgeWorld({ relations: [MECHANISM] });
const built = (object, context, over = {}) => candidate({ subject: "group.created", relation: "is-built-with", object, context, evidence: ["src/app/group.ts"], ...over });
const asked = (ctx, context, words = "group.created") => query(ctx.know.all(), { tokens: tokens(words), subjects: [], context, near: [] }, ctx.parts, measured(ctx, ctx.know.all()));
const answerOf = (ctx, context) => asked(ctx, context).answers.find((a) => a.relation.id === "is-built-with");

test("context A → X and context B → Y coexist: asked in A it is X, in B it is Y, and neither becomes a global rule", () => {
  const ctx = world();
  ingest(ctx, [built("mechanism.x", { site: "a" }), built("mechanism.y", { site: "b" })], { seenBy: seenBy() });
  assert.deepEqual([answerOf(ctx, { site: "a" }).status, answerOf(ctx, { site: "a" }).prevails.map((r) => r.claim.object)], ["known", ["mechanism.x"]]);
  assert.deepEqual(answerOf(ctx, { site: "b" }).prevails.map((r) => r.claim.object), ["mechanism.y"]);
  const nowhere = answerOf(ctx, {});
  assert.deepEqual([nowhere.status, nowhere.prevails.length, nowhere.conditional.map((r) => r.claim.object).sort()], ["unknown", 0, ["mechanism.x", "mechanism.y"]]);
  assert.deepEqual(nowhere.conditional[0].unmet, ["site"], "it says WHAT the answer depends on");
});

test("a narrower context overrides a global claim where it holds, and only there", () => {
  const ctx = world();
  ingest(ctx, [built("mechanism.global", {}), built("mechanism.local", { site: "a" })], { seenBy: seenBy() });
  assert.deepEqual(answerOf(ctx, { site: "a" }).prevails.map((r) => r.claim.object), ["mechanism.local"]);
  assert.deepEqual(answerOf(ctx, { site: "a" }).rivals.map((r) => r.claim.object), ["mechanism.global"], "the loser is listed, never rewritten");
  assert.deepEqual(answerOf(ctx, { site: "b" }).prevails.map((r) => r.claim.object), ["mechanism.global"]);
});

test("authority outranks specificity, and the outranked claim is shown as the conflict", () => {
  const ctx = world();
  ingest(ctx, [built("mechanism.decided", {}, { strength: "adopted", source: "human-declared-memory" })], { human: true, seenBy: seenBy() });
  ingest(ctx, [built("mechanism.seen", { site: "a" })], { seenBy: seenBy() });
  const a = answerOf(ctx, { site: "a" });
  assert.deepEqual([a.prevails[0].claim.object, a.prevails[0].tier, a.rivals[0].claim.object], ["mechanism.decided", "adopted", "mechanism.seen"]);
});

test("two answers of the same authority in the same context are AMBIGUOUS -- nothing picks a winner by counting", () => {
  const ctx = world();
  ingest(ctx, [built("mechanism.x", { site: "a" }), built("mechanism.y", { site: "a" })], { seenBy: seenBy() });
  ingest(ctx, [built("mechanism.x", { site: "a" })], { seenBy: seenBy("laptop-b") });
  const a = answerOf(ctx, { site: "a" });
  assert.deepEqual([a.status, a.prevails.length, a.rivals.map((r) => r.claim.object).sort()], ["ambiguous", 0, ["mechanism.x", "mechanism.y"]]);
});

test("a relation that does not compete keeps every object; one nobody declared is kept, answered and uninterpreted", () => {
  const ctx = world();
  ingest(ctx, [candidate({ object: "audit.written" }), candidate({ object: "mail.sent" }), candidate({ relation: "company-internal-link", object: "thing.else" })], { seenBy: seenBy() });
  const out = asked(ctx, {}, "workspace.create");
  const results = out.answers.find((a) => a.relation.id === "results-in");
  assert.deepEqual([results.status, results.prevails.map((r) => r.claim.object).sort()], ["many", ["audit.written", "mail.sent"]]);
  assert.deepEqual(out.uninterpreted, ["company-internal-link", "results-in"], "no vocabulary here gives either a role");
});

test("freshness is MEASURED for the answer: a scope that moved costs current-source authority, never the claim", () => {
  const ctx = world();
  ingest(ctx, [built("mechanism.x", {})], { seenBy: seenBy() });
  assert.equal(answerOf(ctx, {}).prevails[0].tier, "source");
  ctx.source.write("src/app/group.ts", "changed");
  const moved = answerOf(ctx, {});
  assert.deepEqual([moved.prevails[0].claim.object, moved.prevails[0].measured, moved.prevails[0].tier], ["mechanism.x", "stale", "inference"]);
  assert.equal(ctx.know.all()[0].status, "fresh", "reading never restamps");
});

test("with no task, only what binds is shown; with one, a hint needs a direct hit", () => {
  const ctx = world();
  ingest(ctx, [built("mechanism.x", {})], { seenBy: seenBy() });
  assert.equal(query(ctx.know.all(), { tokens: [], subjects: [], context: {}, near: [] }, ctx.parts).answers.length, 0);
  assert.equal(asked(ctx, {}, "something unrelated entirely").answers.length, 0);
});
