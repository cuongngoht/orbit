import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ingest } from "../src/engineering/ingest.mjs";
import { createEngineering } from "../src/engineering/store.mjs";
import { factId } from "../src/engineering/model.mjs";
import { fakeIo } from "./fakes/io.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const candidate = (over = {}) => ({ kind: "pattern", key: "repository", statement: "Persistence access goes through repository abstractions", scope: ["src/Application"], evidence: ["src/Application/IOrderRepository.cs"], source: "repository", strength: "observed", ...over });

// A source port in memory: one hash per scope, and a scope can be made dirty.
const source = (dirty = {}) => ({ commit: () => "abc1234", fingerprints: (scopes) => Object.fromEntries(scopes.map((s) => [s, { hash: `h-${s}`, files: 2, dirty: dirty[s] ?? 0 }])) });

function world(opts = {}) {
  const io = fakeIo();
  return { io, ctx: { eng: createEngineering("/store/acme", io), source: opts.source ?? source(), now: () => "2026-09-23T10:00:00.000Z" } };
}

const session = (host, at) => ({ seenBy: { host, at } });

const only = (ctx) => ctx.eng.all()[0];

test("a first observation is possible, fresh, fingerprinted and dated — whatever it claimed", () => {
  const { ctx } = world();
  const [d] = ingest(ctx, [candidate()], session("a", "2026-09-23T01:00:00Z"));
  assert.equal(d.outcome, "new");
  const f = only(ctx);
  assert.equal(f.confidence, "possible");
  assert.equal(f.status, "fresh");
  assert.equal(f.commit, "abc1234");
  assert.match(f.fingerprint, /^[0-9a-f]{64}$/);
});

test("the same session again is not a second session; a second independent session makes it certain", () => {
  const { ctx } = world();
  ingest(ctx, [candidate()], session("a", "2026-09-23T01:00:00Z"));
  ingest(ctx, [candidate()], session("a", "2026-09-23T05:00:00Z"));
  assert.equal(only(ctx).support.sessions, 1);
  assert.equal(only(ctx).confidence, "possible");
  ingest(ctx, [candidate()], session("b", "2026-09-23T06:00:00Z"));
  assert.equal(only(ctx).confidence, "certain");
});

test("A, B, A is two sessions, never three", () => {
  const { ctx } = world();
  for (const h of ["a", "b", "a"]) ingest(ctx, [candidate()], session(h, "2026-09-23T01:00:00Z"));
  assert.equal(only(ctx).support.sessions, 2);
});

test("a contradiction is recorded, overwrites nothing, and stops a later promotion", () => {
  const { ctx } = world();
  ingest(ctx, [candidate()], session("a", "2026-09-23T01:00:00Z"));
  const id = only(ctx).id;
  const [d] = ingest(ctx, [candidate({ contradicts: id, statement: "Controllers query directly" })], session("c", "2026-09-23T02:00:00Z"));
  assert.equal(d.outcome, "contradict");
  assert.equal(only(ctx).statement, "Persistence access goes through repository abstractions");
  ingest(ctx, [candidate()], session("b", "2026-09-23T03:00:00Z"));
  assert.equal(only(ctx).confidence, "possible", "two supporting sessions, one against: contested, not certain");
  assert.ok(ctx.eng.findings().some((f) => f.kind === "engineering-drift" && f.factId === id));
});

test("an observer cannot demote what a person adopted, and a person moves strength only through adopt", () => {
  const { ctx } = world();
  ingest(ctx, [candidate({ strength: "adopted" })], { ...session("a", "2026-09-23T01:00:00Z"), human: true });
  ingest(ctx, [candidate({ strength: "observed" })], session("b", "2026-09-23T02:00:00Z"));
  assert.equal(only(ctx).strength, "adopted", "repetition never moves strength, in either direction");
  assert.equal(only(ctx).adoptedBy.host, "a");
  const [d] = ingest(ctx, [candidate({ strength: "suggested" })], { ...session("c", "2026-09-23T03:00:00Z"), human: true });
  assert.equal(d.outcome, "adopt");
  assert.equal(only(ctx).strength, "suggested");
});

test("a different wording for the same subject is kept as a finding, never swapped in", () => {
  const { ctx } = world();
  ingest(ctx, [candidate()], session("a", "2026-09-23T01:00:00Z"));
  ingest(ctx, [candidate({ statement: "Repositories wrap every query" })], session("b", "2026-09-23T02:00:00Z"));
  assert.equal(only(ctx).statement, "Persistence access goes through repository abstractions");
  assert.ok(ctx.eng.findings().some((f) => f.kind === "engineering-restated"));
});

test("unsupported stored support is refused and the existing record is unchanged", () => {
  const { ctx } = world();
  const record = { ...candidate(), id: factId(candidate()), confidence: "certain", status: "unknown", unknowns: [] };
  ctx.eng.save(record);
  assert.throws(() => ingest(ctx, [candidate()], session("b", "2026-09-23T02:00:00Z")), /Unsupported record support schema/);
  assert.deepEqual(only(ctx), record);
  assert.equal(ctx.eng.observations().length, 0);
});

test("a dirty scope records the fact as unknown, never as fresh", () => {
  const { ctx } = world({ source: source({ "src/Application": 1 }) });
  ingest(ctx, [candidate()], session("a", "2026-09-23T01:00:00Z"));
  assert.equal(only(ctx).status, "unknown");
});

test("the scope baseline freshness will compare against is kept in state, not on the fact", () => {
  const { ctx } = world();
  ingest(ctx, [candidate()], session("a", "2026-09-23T01:00:00Z"));
  assert.equal(ctx.eng.model().model.scopes["src/Application"].hash, "h-src/Application");
});

test("the prose only engineering kinds carry is masked on the way in, like the statement", () => {
  const { ctx } = world();
  ingest(ctx, [candidate({ appliesWhen: ["ask admin@acme.test first"], avoidWhen: ["token=abc123secret"] })], session("a", "2026-09-23T01:00:00Z"));
  assert.doesNotMatch(JSON.stringify(only(ctx)), /admin@acme\.test|abc123secret/);
});

// The side entrance test. Reconciliation is only a rule if nothing goes round
// it, so exactly one module under src/ and cli/ may save an engineering fact.
test("nothing but ingest saves an engineering fact", () => {
  const callers = files(join(ROOT, "src")).concat(files(join(ROOT, "cli"))).filter((f) => /\beng\.save\(/.test(readFileSync(f, "utf8")));
  assert.deepEqual(callers.map((f) => f.slice(ROOT.length + 1).split(sep).join("/")), ["src/engineering/ingest.mjs"]);
});

function files(dir) {
  return readdirSync(dir).flatMap((n) => (statSync(join(dir, n)).isDirectory() ? files(join(dir, n)) : n.endsWith(".mjs") ? [join(dir, n)] : []));
}
