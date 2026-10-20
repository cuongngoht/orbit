// Tenant isolation on fakes: a controlled tenant A / tenant B fixture, a
// correct product, and intentionally defective ones. Each identity is its own
// session directory with its own token claims -- the fake identity port reads
// the claims of whichever session the browser currently drives.
import { test } from "node:test";
import assert from "node:assert/strict";
import { analyse, modelOf, runMatrix } from "../src/investigation/index.mjs";
import { tenancyProblems } from "../src/investigation/tenancy.mjs";
import { TENANT_CLAIMS as CLAIMS, correctTenancy as correct, started, tenantContract as contract, tenantWorld } from "./autonomous-qa.harness.mjs";

const outcomes = (t) => { analyse(t.w); return modelOf(t.w.store.read(t.id)).findings.filter((f) => f.family === "security").map((f) => [f.say.split(":")[0], f.outcome]); };

const BASE_ROWS = [
  { identity: "tenantA", resource: "a-thing", operation: "read", expect: "allowed" },
  { identity: "tenantB", resource: "a-thing", operation: "read", expect: "denied", status: [403, 404] },
];

test("the contract is validated: a missing marker, an unknown identity and a write without writeProbes are refused", () => {
  assert.ok(tenancyProblems({ ...contract(BASE_ROWS), resources: { "a-thing": { tenant: "A", route: "/x" } } }).some((p) => /marker/.test(p)));
  assert.ok(tenancyProblems(contract([{ identity: "nobody", resource: "a-thing", operation: "read", expect: "denied" }])).some((p) => /does not declare/.test(p)));
  assert.ok(tenancyProblems(contract([{ identity: "tenantB", resource: "a-thing", operation: "update", expect: "denied" }])).some((p) => /writeProbes/.test(p)));
  assert.deepEqual(tenancyProblems(contract(BASE_ROWS)), []);
});

test("tenant B is correctly denied: the verification passes, through every channel, with a positive control", () => {
  const t = tenantWorld(BASE_ROWS, correct);
  const records = runMatrix(t.w);
  assert.deepEqual(records.map((r) => [r.identity, r.channel, r.state]), [["tenantA", "ui", "observed"], ["tenantA", "api", "observed"], ["tenantB", "ui", "observed"], ["tenantB", "api", "observed"]]);
  assert.ok(outcomes(t).every(([, o]) => o === "OBSERVED_EXPECTED_BEHAVIOR"));
  assert.ok(records.every((r) => !JSON.stringify(r).includes("tid-A")), "a raw tenant id is never kept, only the contract's name for it");
});

test("tenant B reads tenant A's protected data: a CONFIRMED security finding", () => {
  const leaky = (dir, path, method) => ({ status: 200, contains: true });
  const t = tenantWorld(BASE_ROWS, leaky);
  runMatrix(t.w);
  const leaked = outcomes(t).filter(([, o]) => o === "CONFIRMED_DEFECT");
  assert.equal(leaked.length, 2, "both the screen and the API showed the marker to tenant B");
  assert.ok(leaked.every(([say]) => say.startsWith("tenantB")));
});

test("leakage through search is its own finding", () => {
  const rows = [{ identity: "tenantA", resource: "a-thing", operation: "search", expect: "included" }, { identity: "tenantB", resource: "a-thing", operation: "search", expect: "excluded" }];
  const t = tenantWorld(rows, () => ({ status: 200, contains: true }));
  runMatrix(t.w);
  const f = modelOf(t.w.store.read(t.id));
  analyse(t.w);
  const confirmed = modelOf(t.w.store.read(t.id)).findings.filter((x) => x.outcome === "CONFIRMED_DEFECT");
  assert.equal(confirmed.length, 1);
  assert.match(confirmed[0].actual, /leakage through search/);
  assert.ok(f.security.length === 2);
});

test("tenant B's write is refused but the database changed: a CONFIRMED unauthorised modification", () => {
  const rows = [{ identity: "tenantB", resource: "a-thing", operation: "update", expect: "denied", status: [403, 404] }, { identity: "tenantA", resource: "a-thing", operation: "unchanged", expect: "unchanged" }];
  const sloppy = (dir, path, method, data) => { if (method === "PUT") data.name = "TC-probe"; return { status: 403, contains: false }; };
  const t = tenantWorld(rows, sloppy, { more: { writeProbes: true } });
  runMatrix(t.w);
  const confirmed = outcomes(t).filter(([, o]) => o === "CONFIRMED_DEFECT");
  assert.equal(confirmed.length, 2, "the refused write moved the data, and tenant A's record is no longer what it was");
});

test("a user who legitimately belongs to both tenants: the contract decides, not the tenant mismatch", () => {
  const rows = [{ identity: "both", resource: "a-thing", operation: "read", expect: "allowed" }];
  const t = tenantWorld(rows, correct);
  runMatrix(t.w);
  assert.deepEqual(outcomes(t).map(([, o]) => o), ["OBSERVED_EXPECTED_BEHAVIOR", "OBSERVED_EXPECTED_BEHAVIOR"]);
  const contradiction = tenantWorld([{ identity: "both", resource: "a-thing", operation: "read", expect: "denied" }], correct);
  runMatrix(contradiction.w);
  assert.deepEqual(outcomes(contradiction).map(([, o]) => o), ["REQUIRES_REQUIREMENT"]);
});

test("a denial proves nothing when the positive control fails: a probe that cannot authenticate is INCONCLUSIVE", () => {
  const unauthenticated = () => ({ status: 401, contains: false });
  const t = tenantWorld(BASE_ROWS, unauthenticated);
  runMatrix(t.w);
  const said = outcomes(t);
  assert.ok(said.every(([, o]) => o === "INCONCLUSIVE"), JSON.stringify(said));
});

test("a missing account, a session in the wrong tenant, and a contaminated session are BLOCKED, never findings about the product", () => {
  const noB = { ...CLAIMS, "/tmp/run-tenantB": undefined };
  const t = tenantWorld(BASE_ROWS, correct, { claims: noB });
  runMatrix(t.w);
  assert.ok(outcomes(t).some(([say, o]) => say.startsWith("tenantB") && o === "BLOCKED"));
  const wrongTenant = tenantWorld(BASE_ROWS, correct, { claims: { ...CLAIMS, "/tmp/run-tenantB": CLAIMS["/tmp/run-tenantA"] } });
  const recs = runMatrix(wrongTenant.w);
  assert.match(recs.find((r) => r.identity === "tenantB").why, /signed in to tenant A/);
  const shared = tenantWorld([...BASE_ROWS, { identity: "both", resource: "a-thing", operation: "read", expect: "allowed" }], correct, { claims: { ...CLAIMS, "/tmp/run-both": { ...CLAIMS["/tmp/run-both"], oid: "oid-b" } } });
  assert.match(runMatrix(shared.w).find((r) => r.identity === "both").why, /session contamination/);
});

test("no accepted security requirement: REQUIRES_REQUIREMENT, and nothing is probed", () => {
  const t = started({ mode: "security-test" });
  const recs = runMatrix(t.w);
  assert.equal(recs[0].state, "not-observed");
  assert.equal(t.browser.calls.length, 0);
  analyse(t.w);
  assert.equal(modelOf(t.w.store.read(t.id)).findings[0].outcome, "REQUIRES_REQUIREMENT");
});

test("the database is unavailable: whether a refused write landed is BLOCKED, not assumed", () => {
  const rows = [{ identity: "tenantB", resource: "a-thing", operation: "update", expect: "denied", status: [403] }];
  const t = tenantWorld(rows, correct, { db: false, more: { writeProbes: true } });
  runMatrix(t.w);
  assert.deepEqual(outcomes(t).map(([, o]) => o), ["BLOCKED"]);
});

test("security-test needs its approval: an environment without it refuses before any identity switch", () => {
  const t = tenantWorld(BASE_ROWS, correct);
  const w = { ...t.w, environment: { ...t.w.environment, modes: ["observe"] } };
  assert.throws(() => runMatrix(w), /security-test is not approved/);
  assert.equal(t.browser.calls.length, 0);
});
