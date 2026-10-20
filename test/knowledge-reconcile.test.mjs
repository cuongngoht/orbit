// Reconciliation and the ONE write door: engineering's discipline, over claims.
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { ingest, MAX_CLAIMS } from "../src/knowledge/ingest.mjs";
import { claimId } from "../src/knowledge/model.mjs";
import { reconcile } from "../src/knowledge/reconcile.mjs";
import { candidate, knowledgeWorld, seenBy } from "./fakes/knowledge.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const day = (d) => `2026-09-${d}T10:00:00.000Z`;

test("two independent sessions make a claim certain; the same session twice does not", () => {
  const ctx = knowledgeWorld();
  ingest(ctx, [candidate()], { seenBy: seenBy("laptop-a", day("20")) });
  ingest(ctx, [candidate()], { seenBy: seenBy("laptop-a", day("20")) });
  assert.equal(ctx.know.find(claimId(candidate())).confidence, "possible");
  ingest(ctx, [candidate()], { seenBy: seenBy("laptop-a", day("21")) });
  assert.deepEqual([ctx.know.find(claimId(candidate())).confidence, ctx.know.find(claimId(candidate())).support.sessions], ["certain", 2]);
});

test("a contradiction never overwrites: the claim stays, contested, and a person gets the finding", () => {
  const ctx = knowledgeWorld();
  ingest(ctx, [candidate()], { seenBy: seenBy("laptop-a", day("20")) });
  ingest(ctx, [candidate()], { seenBy: seenBy("laptop-b", day("20")) });
  const [d] = ingest(ctx, [{ ...candidate(), contradicts: claimId(candidate()) }], { seenBy: seenBy("laptop-c", day("21")) });
  const kept = ctx.know.find(claimId(candidate()));
  assert.deepEqual([d.outcome, kept.object, kept.confidence, kept.support.against], ["contradict", "group.created", "possible", 1]);
  assert.equal(ctx.know.findings().some((f) => f.kind === "knowledge-contradicted"), true);
});

test("contradicting a claim nobody recorded writes NOTHING -- falling through to `new` would store the very claim it calls false", () => {
  const ctx = knowledgeWorld();
  const [d] = ingest(ctx, [{ ...candidate(), contradicts: claimId(candidate()) }], { seenBy: seenBy() });
  assert.deepEqual([d.outcome, d.claim, ctx.know.all().length], ["unfounded", null, 0]);
});

test("strength moves only on an explicit human record, and is dated to it", () => {
  const ctx = knowledgeWorld();
  ingest(ctx, [candidate()], { seenBy: seenBy() });
  assert.equal(reconcile({ ...candidate({ strength: "adopted" }), seenBy: seenBy() }, ctx.know.find(claimId(candidate())), {}).claim.strength, "observed", "without --human, nothing moves");
  const [d] = ingest(ctx, [candidate({ strength: "adopted", source: "human-declared-memory" })], { human: true, seenBy: seenBy("laptop-a", day("22")) });
  assert.deepEqual([d.outcome, d.claim.strength, d.claim.adoptedBy.at], ["adopt", "adopted", day("22")]);
});

test("the batch is one lock, journaled BEFORE each save, and replaying the journal re-derives what the store holds", () => {
  const ctx = knowledgeWorld();
  ingest(ctx, [candidate(), candidate({ object: "audit.written", evidence: ["src/app/group.ts"] })], { seenBy: seenBy("laptop-a", day("20")) });
  ingest(ctx, [candidate()], { seenBy: seenBy("laptop-b", day("21")) });
  const lines = ctx.know.journalLines();
  assert.equal(lines.length, 3);
  const replayed = lines.reduce((m, l) => m.set(l.claimId, reconcile({ ...l.candidate, seenBy: l.seenBy }, m.get(l.claimId) ?? null, { human: l.human }).claim), new Map());
  for (const claim of ctx.know.all()) assert.deepEqual([replayed.get(claim.id).confidence, replayed.get(claim.id).support.sessions], [claim.confidence, claim.support.sessions], claim.id);
});

test("freshness is stamped from the scope at recording: clean is fresh, uncommitted edits are unknown", () => {
  const clean = knowledgeWorld();
  assert.equal(ingest(clean, [candidate()], { seenBy: seenBy() })[0].claim.status, "fresh");
  const dirty = knowledgeWorld({ source: undefined, files: { "src/app/workspace.ts": "x" } });
  dirty.source.state.dirty.add("src/app/workspace.ts");
  assert.equal(ingest(dirty, [candidate()], { seenBy: seenBy() })[0].claim.status, "unknown");
});

test("the room is bounded, and a batch past the bound writes nothing at all", () => {
  const ctx = knowledgeWorld();
  ctx.know.count = () => MAX_CLAIMS;
  assert.throws(() => ingest(ctx, [candidate()], { seenBy: seenBy() }), /would hold more than 4096 claims/);
  assert.equal(ctx.know.journalLines().length, 0);
});

test("prose is scrubbed on the way in, and identity is never masked", () => {
  const ctx = knowledgeWorld();
  const [d] = ingest(ctx, [candidate({ because: "password=hunter2 told me" })], { seenBy: seenBy() });
  assert.doesNotMatch(d.claim.because, /hunter2/);
  assert.equal(d.claim.subject, "workspace.create");
});

// The door is structural, not a promise: exactly one module saves a claim, and
// exactly one saves an opportunity.
test("only ingest calls know.save, and only the opportunities module calls know.saveOpportunity", () => {
  const files = [join(ROOT, "src"), join(ROOT, "cli")].flatMap((d) => readdirSync(d, { recursive: true }).filter((f) => String(f).endsWith(".mjs")).map((f) => join(d, String(f))));
  const callers = (re) => files.filter((f) => re.test(readFileSync(f, "utf8"))).map((f) => f.slice(ROOT.length + 1).replace(/\\/g, "/"));
  assert.deepEqual(callers(/\bknow\.save\(/), ["src/knowledge/ingest.mjs"]);
  assert.deepEqual(callers(/\bknow\.saveOpportunity\(/), ["src/knowledge/opportunities.mjs"]);
});
