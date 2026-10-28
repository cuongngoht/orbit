// A test writes only through a grant (ADR 0037): every MINT row refuses on its own, a grant
// covers exactly what it names, one use is spent before the effect and never twice, a person's
// destructive case still writes the way it always did, and the host holds the spends to what it
// minted.
import assert from "node:assert/strict";
import { test } from "node:test";
import { invokeCapability } from "../src/capability/invoke.mjs";
import { createCapabilityRegistry } from "../src/capability/registry.mjs";
import { Refused } from "../src/errors.mjs";
import { spendFindings } from "../src/run/envelope.mjs";
import { grantLedger } from "../src/run/grants.mjs";
import { GRANT_API, MINT, mintGrant } from "../src/runtime/sandbox/test-grants.mjs";
import { canonicalJson, sha } from "../src/hash.mjs";

const INPUT = { endpointRef: "backend", identityRef: "tenant-a-writer", method: "POST", path: "/invoices" };
const DIGEST = sha(canonicalJson(INPUT));
import { fakeTools } from "./fakes/tools.mjs";

const world = (over = {}) => ({
  task: "tsk-1",
  run: "run-1",
  attempt: 1,
  sandbox: { owner: { kind: "task", id: "tsk-1" }, tree: "tree-a", currentTree: "tree-a", isolated: true },
  mode: { id: "fixture-write", mutates: true },
  capability: { id: "orbit.http.write", version: "0.0.4", from: "pack:orbit-api-test", mutatingEffects: ["write"] },
  operation: { class: "write", selectors: { method: "POST", path: "/invoices" } },
  fixture: { namespace: "orbit-ab12", resources: ["backend"] },
  requested: { resources: ["backend"], indirect: ["notification-sink"], inputDigest: DIGEST },
  sinks: ["notification-sink"],
  design: { oracleRef: "bnd-abc123", designRef: "tds-abc123", operations: ["write"] },
  budget: { uses: 4 },
  policy: { revision: "p-1", allows: ["write"] },
  principal: "tenant-a-writer",
  nowMs: 1_000,
  ...over,
});

const breaks = {
  OWNED: { sandbox: { owner: { kind: "task", id: "tsk-other" }, tree: "tree-a", currentTree: "tree-a", isolated: true } },
  ISOLATED: { sandbox: { owner: { kind: "task", id: "tsk-1" }, tree: "tree-a", currentTree: "tree-a", isolated: false } },
  MODE: { mode: { id: "observe", mutates: false } },
  CAPABILITY: { capability: { id: "orbit.http.read", mutatingEffects: [] } },
  FIXTURE: { requested: { resources: ["someone-elses-db"], indirect: [], inputDigest: DIGEST } },
  INDIRECT: { requested: { resources: ["backend"], indirect: ["real-payment-gateway"], inputDigest: DIGEST } },
  DESIGN: { design: { operations: ["write"] } },
  INPUT: { requested: { resources: ["backend"], indirect: ["notification-sink"], inputDigest: null } },
  ALLOWLIST: { design: { oracleRef: "bnd-abc123", designRef: "tds-abc123", operations: ["read"] } },
  BUDGET: { budget: { uses: 0 } },
  TREE: { sandbox: { owner: { kind: "task", id: "tsk-1" }, tree: "tree-a", currentTree: "tree-b", isolated: true } },
  POLICY: { policy: { revision: "p-1", allows: ["publish"] } },
};

test("every MINT row refuses on its own, by its own id, and a world where all hold mints a grant", () => {
  assert.deepEqual(Object.keys(breaks), MINT.map((r) => r.id), "one break per row, in order");
  for (const [id, over] of Object.entries(breaks)) {
    const out = mintGrant(world(over));
    assert.equal(out.grant, null, id);
    assert.deepEqual(out.refused.map((r) => r.id), [id], `${id} alone: ${out.refused.map((r) => r.say).join(" · ")}`);
  }
  assert.deepEqual(mintGrant(world({ policy: { revision: "p-1", allows: [] } })).refused, [], "a policy that narrows nothing refuses nothing: the run's own fixture in a proven sandbox is autonomous (0.2.0)");
  const { grant } = mintGrant(world());
  assert.equal(grant.v, GRANT_API);
  assert.match(grant.id, /^grt-[0-9a-f]{16}$/);
  assert.deepEqual([grant.operation.class, grant.effects.scope, grant.bounds.maxUses, grant.expiresAtMs], ["write", "fixture", 1, 1_000 + 15 * 60 * 1000]);
});

test("a duplicate or a replay on purpose is a grant of its own, and a grant never allows more uses than the budget", () => {
  const dup = mintGrant(world({ bounds: { duplicateOf: "grt-first", maxUses: 2 } })).grant;
  assert.equal(dup.bounds.duplicateOf, "grt-first");
  assert.equal(dup.bounds.maxUses, 2);
  assert.equal(mintGrant(world({ budget: { uses: 1 }, bounds: { maxUses: 9 } })).grant.bounds.maxUses, 1);
  assert.notEqual(mintGrant(world()).grant.id, dup.id);
});

const writer = { id: "orbit.http.write", apiVersion: "orbit.capability/v1", doc: "writes", page: false, mutates: true, effects: ["write"], inputSchema: { endpointRef: { type: "string", bind: "endpoint", doc: "where" }, identityRef: { type: "string", bind: "identity", doc: "as whom" }, method: { type: "string", doc: "how" }, path: { type: "string", doc: "what" } }, invoke: (ext, input) => ({ wrote: input.path }) };

function setup(grants, now = () => 2_000) {
  const capabilities = createCapabilityRegistry();
  capabilities.register(writer, "pack:orbit-api-test");
  const records = [];
  const ctx = { capabilities, tools: fakeTools({}), now, binder: { resolve: (kind, ref) => ({ ok: true, value: { alias: ref } }) }, grants: grantLedger(grants, "run-1", now) };
  return { ctx, records, run: { c: { id: "generated-write" }, log: { record: (r) => records.push(r) } } };
}

const step = (input = INPUT) => ({ do: "call", capability: "orbit.http.write", input });

test("a write under a grant is made once; a second use of a one-use grant is refused -- a retry is never a duplicate", () => {
  const { grant } = mintGrant(world());
  const s = setup([grant]);
  assert.deepEqual(invokeCapability(s.ctx, s.run, step()), { wrote: "/invoices" });
  assert.deepEqual(s.records.filter((r) => r.kind === "grant").map((r) => [r.grant, r.use]), [[grant.id, 1]]);
  assert.throws(() => invokeCapability(s.ctx, s.run, step()), (e) => e instanceof Refused && /every use is spent/.test(e.message));
});

test("no grant, another run's grant, an expired one, another resource or another input: refused before anything is asked", () => {
  const { grant } = mintGrant(world());
  const cases = [
    [[], /no test grant was minted for this run/],
    [[{ ...grant, run: "run-2" }], /another run/],
    [[grant], /it expired/, () => grant.expiresAtMs + 1],
    [[{ ...grant, input: { digest: sha(canonicalJson({ ...INPUT, endpointRef: "someone-elses" })) } }], /a resource it would touch is not granted/, undefined, { ...INPUT, endpointRef: "someone-elses" }],
    [[{ ...grant, input: { digest: "0".repeat(64) } }], /the input differs/],
    [[grant], /the input differs/, undefined, { ...INPUT, path: "/other" }],
    [[{ ...grant, input: { digest: sha(canonicalJson({ ...INPUT, path: "/other" })) } }], /the operation differs/, undefined, { ...INPUT, path: "/other" }],
    [[{ ...grant, input: { digest: sha(canonicalJson({ ...INPUT, identityRef: "tenant-b-writer" })) } }], /another principal/, undefined, { ...INPUT, identityRef: "tenant-b-writer" }],
    [[{ ...grant, capability: { ...grant.capability, from: "pack:another" } }], /another provider/],
  ];
  for (const [grants, re, now, input] of cases) {
    const s = setup(grants, now);
    let asked = false;
    s.ctx.capabilities = createCapabilityRegistry();
    s.ctx.capabilities.register({ ...writer, invoke: () => { asked = true; return {}; } }, "pack:orbit-api-test");
    assert.throws(() => invokeCapability(s.ctx, s.run, step(input)), (e) => e instanceof Refused && re.test(e.message), String(re));
    assert.equal(asked, false, "nothing was asked of the product");
  }
});

test("a person's destructive case still writes the way it always did, and spends no grant", () => {
  const s = setup([]);
  s.run.c.destructive = true;
  assert.deepEqual(invokeCapability(s.ctx, s.run, step()), { wrote: "/invoices" });
  assert.equal(s.records.some((r) => r.kind === "grant"), false);
});

test("the host holds a worker's spends to what it minted: an unknown grant, another capability, one use too many", () => {
  const { grant } = mintGrant(world());
  const spend = (over = {}) => ({ kind: "grant", grant: grant.id, capability: "orbit.http.write", use: 1, ...over });
  assert.deepEqual(spendFindings([spend()], [grant]), []);
  assert.match(spendFindings([spend({ grant: "grt-forged" })], [grant]).join(), /was not minted/);
  assert.match(spendFindings([spend({ capability: "orbit.messaging.publish" })], [grant]).join(), /was not minted for orbit.messaging.publish/);
  assert.match(spendFindings([spend(), spend({ use: 2 })], [grant]).join(), /used 2 times and allows 1/);
});
