// Capability opportunities: a gap remembered, never a failure -- one per
// capability, moved by evidence (engine) or by a person, and surfaced by an
// ordered policy whose every answer says why.
import assert from "node:assert/strict";
import { test } from "node:test";
import { askedIn, decided, discovered, opportunityId, settle, TRANSITIONS } from "../src/knowledge/opportunities.mjs";
import { SURFACE, SURFACE_ROWS, surfaced } from "../src/knowledge/surface.mjs";
import { knowledgeWorld } from "./fakes/knowledge.mjs";

const RUN = { at: "2026-09-24T10:00:00.000Z", workflow: "orbit-develop", purpose: "development", seenBy: { host: "laptop-a", at: "2026-09-24T10:00:00.000Z" }, subjects: ["order.place"], context: {} };
const need = (over = {}) => ({ capability: "stock.view.read", proves: { subject: "order.place", consequence: "stock.reserved" }, context: {}, conditional: false, tier: "source", because: ["k-aaaaaaaaaaaa"], session: false, by: "vocabulary", ...over });
const gap = (needs = [need()]) => ({ capability: "stock.view.read", outcome: "gap", gap: true, remedy: "prepare", status: "unprovided", provider: null, needs });
const provided = { capability: "stock.view.read", outcome: "provided", gap: false, remedy: null, status: "selected", provider: { key: "capability:stock.view.read" }, needs: [need()] };

test("a gap becomes ONE candidate per capability, however many subjects need it", () => {
  const [doc] = discovered([], [gap([need(), need({ proves: { subject: "order.cancel", consequence: "stock.released" } })])], RUN);
  assert.deepEqual([doc.id, doc.state, doc.needs.length, doc.remedy], [opportunityId("stock.view.read"), "candidate", 2, "prepare"]);
  assert.deepEqual(discovered([doc], [gap()], RUN).map((d) => d.id), [doc.id], "rediscovering it merges, never duplicates");
});

test("a need resting on a host's hint never enters the store", () => {
  assert.deepEqual(discovered([], [gap([need({ session: true })])], RUN), []);
});

test("when a provider appears the opportunity is RESOLVED; when it goes, the gap is raised again", () => {
  const [doc] = discovered([], [gap()], RUN);
  const [resolved] = discovered([doc], [provided], RUN);
  assert.deepEqual([resolved.state, resolved.resolvedBy], ["resolved", "capability:stock.view.read"]);
  assert.equal(discovered([resolved], [gap()], RUN)[0].state, "candidate");
});

test("a run is authoritative only for what it examined: a partial run never stales another feature's opportunity", () => {
  const [doc] = discovered([], [gap()], RUN);
  assert.deepEqual(discovered([doc], [], { ...RUN, subjects: ["something.else"] }), [], "not examined, not touched");
  const [staled] = discovered([doc], [], RUN);
  assert.equal(staled.state, "stale", "examined, and it no longer derives the need");
});

test("a person's decisions are the only way to defer, accept, ignore or reopen -- and the engine's moves are not theirs", () => {
  const [doc] = discovered([], [gap()], RUN);
  const deferred = decided(doc, "defer", { ...RUN, reason: "not this sprint" });
  assert.deepEqual([deferred.state, deferred.decided.action, deferred.decided.reason], ["deferred", "defer", "not this sprint"]);
  assert.throws(() => decided(doc, "resolve", RUN), /not a decision a person makes/);
  assert.throws(() => decided({ ...doc, state: "resolved" }, "defer", RUN), /applies only to/);
  assert.ok(TRANSITIONS.every((t) => ["engine", "person"].includes(t.by)));
});

const world = (over = {}) => ({ purpose: "development", workflow: "orbit-develop", seenBy: RUN.seenBy, derived: new Map([["stock.view.read", [need()]]]), demanded: new Map(), ...over });
const opp = (over = {}) => ({ ...discovered([], [gap()], RUN)[0], ...over });

test("every surface row is reachable, the last always matches, and each says why", () => {
  const cases = {
    IGNORED: [opp({ state: "ignored" }), world()],
    RESOLVED: [opp({ state: "resolved" }), world()],
    STALE: [opp({ state: "stale" }), world()],
    ACCEPTED: [opp({ state: "accepted" }), world()],
    WEAK: [opp({ needs: [{ ...need(), tier: "host-memory" }] }), world()],
    ASKED_HERE: [askedIn(opp(), RUN), world()],
    DEMANDED: [opp(), world({ purpose: "verification" })],
    DEFERRED: [opp({ state: "deferred" }), world()],
    OFFERED: [opp({ state: "offered" }), world()],
    REQUESTED: [opp(), world({ demanded: new Map([["stock.view.read", 2]]) })],
    BINDING: [opp({ needs: [{ ...need(), tier: "adopted" }] }), world()],
    REUSABLE: [opp({ needs: [need(), { ...need(), subject: "order.cancel" }] }), world()],
    QUIET: [opp(), world()],
  };
  assert.deepEqual(Object.keys(cases), SURFACE_ROWS);
  for (const [row, [o, w]] of Object.entries(cases)) assert.equal(surfaced(o, w).row, row, row);
  for (const [, [o, w]] of Object.entries(cases)) assert.ok(surfaced(o, w).say.length > 10);
  assert.equal(SURFACE.at(-1).when(), true);
});

test("deferred means NOT NOW: quiet during development, asked again when a verification needs it", () => {
  const deferred = decided(opp(), "defer", RUN);
  assert.deepEqual([surfaced(deferred, world()).asks, surfaced(deferred, world({ purpose: "verification", workflow: "orbit-test-plan" })).asks], [false, true]);
});

test("never asked twice in one session and workflow; a second workflow may ask", () => {
  const asked = askedIn(opp(), { ...RUN, workflow: "orbit-test-plan" });
  assert.equal(asked.state, "offered");
  assert.equal(surfaced(asked, world({ purpose: "verification", workflow: "orbit-test-plan" })).row, "ASKED_HERE");
  assert.equal(surfaced(asked, world({ purpose: "verification", workflow: "orbit-test-suite" })).row, "DEMANDED");
  assert.equal(surfaced(asked, world({ purpose: "verification", workflow: "orbit-test-plan", seenBy: { host: "laptop-a", at: "2026-09-25T10:00:00.000Z" } })).row, "DEMANDED", "a new session is a new question");
});

test("settle is bounded: past the bound a NEW opportunity is refused and said, while a known one is always kept", () => {
  const ctx = knowledgeWorld();
  ctx.know.opportunities = () => Array.from({ length: 256 }, (_, i) => ({ id: `opp-${String(i).padStart(12, "0")}` }));
  const out = settle(ctx, [opp()]);
  assert.deepEqual([out.written, out.refused], [[], [opportunityId("stock.view.read")]]);
});
