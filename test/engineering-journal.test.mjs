import assert from "node:assert/strict";
import { test } from "node:test";
import { join } from "node:path";
import { ingest } from "../src/engineering/ingest.mjs";
import { compared, replayed } from "../src/engineering/replay.mjs";
import { createEngineering } from "../src/engineering/store.mjs";
import { factId } from "../src/engineering/model.mjs";
import { fakeIo } from "./fakes/io.mjs";

// Spelled the way the store spells it -- with this platform's separators.
const JOURNAL = join("/store", "acme", "engineering", "observations", "laptop-a.jsonl");

const candidate = (over = {}) => ({ kind: "pattern", key: "repository", statement: "Persistence goes through repositories", scope: ["src/Application"], evidence: ["src/Application/IOrderRepository.cs"], source: "repository", strength: "observed", ...over });

function world() {
  const io = fakeIo();
  const source = { commit: () => "abc1234", fingerprints: (scopes) => Object.fromEntries(scopes.map((s) => [s, { hash: `h-${s}`, files: 1, dirty: 0 }])) };
  return { io, ctx: { eng: createEngineering("/store/acme", io), source, now: () => "2026-09-23T10:00:00.000Z" } };
}

const at = (host, t) => ({ seenBy: { host, at: t } });

test("every reconciliation leaves one journal line, appended and never rewritten", () => {
  const { ctx, io } = world();
  ingest(ctx, [candidate()], at("a", "2026-09-23T01:00:00Z"));
  const first = io.files.get(JOURNAL);
  ingest(ctx, [candidate()], at("b", "2026-09-23T02:00:00Z"));
  const second = io.files.get(JOURNAL);
  assert.ok(second.startsWith(first), "earlier lines are never touched");
  assert.deepEqual(ctx.eng.observations().map((l) => l.outcome), ["new", "confirm"]);
});

test("the journal replays to exactly the facts the store holds", () => {
  const { ctx } = world();
  ingest(ctx, [candidate()], at("a", "2026-09-23T01:00:00Z"));
  ingest(ctx, [candidate({ contradicts: factId(candidate()) })], at("c", "2026-09-23T02:00:00Z"));
  ingest(ctx, [candidate({ evidence: ["src/Application/IOrderRepository.cs", "src/Application/X.cs"] })], at("b", "2026-09-23T03:00:00Z"));
  ingest(ctx, [candidate({ strength: "adopted" })], { ...at("d", "2026-09-23T04:00:00Z"), human: true });
  assert.deepEqual(compared(ctx.eng.all(), ctx.eng.observations()).map((r) => r.state), ["same"]);
});

test("replay is deterministic: the same journal, the same facts", () => {
  const { ctx } = world();
  for (const h of ["a", "b", "a"]) ingest(ctx, [candidate()], at(h, "2026-09-23T01:00:00Z"));
  const lines = ctx.eng.observations();
  assert.deepEqual([...replayed(lines).values()], [...replayed(lines).values()]);
});

test("a fact written around the door is caught; one from before the journal is only noted", () => {
  const { ctx } = world();
  ingest(ctx, [candidate()], at("a", "2026-09-23T01:00:00Z"));
  const fact = ctx.eng.all()[0];
  ctx.eng.save({ ...fact, confidence: "certain", support: { ...fact.support, sessions: 5 } });
  ctx.eng.save({ ...candidate({ key: "old" }), id: factId(candidate({ key: "old" })), confidence: "possible" });
  const states = Object.fromEntries(compared(ctx.eng.all(), ctx.eng.observations()).map((r) => [r.id, r]));
  assert.equal(states[fact.id].state, "differs");
  assert.match(states[fact.id].say, /confidence.*support\.sessions/);
  assert.equal(states[factId(candidate({ key: "old" }))].state, "not-journaled");
});

test("a torn journal line costs that line, never the journal", () => {
  const { ctx, io } = world();
  ingest(ctx, [candidate()], at("a", "2026-09-23T01:00:00Z"));
  io.append(JOURNAL, "{ torn\n");
  assert.equal(ctx.eng.observations().length, 1);
});

test("the journal keeps the candidate scrubbed, and the session only as the host gave it hashed", () => {
  const { ctx } = world();
  ingest(ctx, [candidate({ because: "ask admin@acme.test, token=abc123secret" })], { seenBy: { host: "a", at: "2026-09-23T01:00:00Z", session: "claude:0123456789abcdef" } });
  const line = JSON.stringify(ctx.eng.observations());
  assert.doesNotMatch(line, /admin@acme\.test|abc123secret/);
  assert.match(line, /claude:0123456789abcdef/);
});
