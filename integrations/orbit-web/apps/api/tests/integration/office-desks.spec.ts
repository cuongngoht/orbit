// GOVERNANCE → EMPLOYEE DESKS (ADR 0069), through the real API and a scripted sandbox provider: every employee's desk is
// listed -- of one in the office, and of one who left, which keeps it, with what it holds of the account's storage, read
// only, until its owner deletes the desk (office-desk-browse.spec.ts looks into one and cleans it up); then the sandbox
// goes DELETING, the provider removes it, and only once it is read back gone is it DELETED and the storage released. A
// provider that cannot remove it yet is tried again; only an archived employee's desk is deleted, against the version
// read; another account's is not found.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { DEFAULT_PRESETS, type EmployeeDeskList, type EmployeeDetail, type ResourceSummary, type RuntimeConnection } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { SandboxProvisioner } from "../../src/contexts/workforce/application/sandbox-provisioner.js";
import { FakeSandboxProvider } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });

function ok<T>(r: Reply): T {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as T;
}

describe("Governance → Employee desks: a desk kept after leaving, deleted by its owner", () => {
  let h: Harness;
  let b: Browser;
  let connection: RuntimeConnection;
  const sandbox = new FakeSandboxProvider();

  const hire = async (name: string): Promise<EmployeeDetail> => {
    const model = connection.catalog.models[0];
    assert.ok(model !== undefined);
    const made = ok<EmployeeDetail>(
      await b.send("POST", "/api/employees", {
        name,
        profile: { title: "Analyst", duties: "Reports.", instructions: "", skills: [], languages: ["en"], knowledge: [], execution: { runtime: "claude", connectionId: connection.id, model: model.id, effort: model.efforts[0] ?? null, webSearch: false, orbitPlugin: false }, handoffStandard: "", reportingRule: "", canDelegate: false, maxAssistants: 0, canHirePermanent: false },
        resources: DEFAULT_PRESETS[0]?.profile,
        skipProbation: true,
        skipReason: "a test employee",
      }),
    );
    return eventually(async () => ok<EmployeeDetail>(await b.get(`/api/employees/${made.id}`)), (d) => d.sandbox.state === "READY");
  };
  const desks = async (): Promise<EmployeeDeskList> => ok<EmployeeDeskList>(await b.get("/api/office/desks"));
  const committed = async (): Promise<number> => ok<ResourceSummary>(await b.get("/api/office/resources")).storage.committedMiB;

  before(async () => {
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]] });
    b = h.owner as Browser;
    connection = ((await b.get("/api/connections")).body as { connections: RuntimeConnection[] }).connections.find((x) => x.runtime === "claude" && x.auth === "connected") as RuntimeConnection;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Desks office" })).status, 200);
  });
  after(() => h.close());

  test("an employee who left keeps its desk, listed with what it holds; deleting it removes the sandbox, then releases the storage", async () => {
    const e = await hire("Leaving");
    const profile = DEFAULT_PRESETS[0]?.profile as { deskStorageMiB: number; cacheStorageMiB: number };
    const working = (await desks()).desks;
    assert.deepEqual(working.map((d) => [d.employeeId, d.employment, d.leftAt, d.canBrowse, d.canClean]), [[e.id, "active", null, true, true]], "an employee in the office: its desk is listed, to look into and clean up");
    const before = await committed();

    // Only an archived employee's desk is deleted.
    const early = await b.send("POST", `/api/employees/${e.id}/employment`, { command: "delete" }, ifMatch(e.version));
    assert.deepEqual([early.status, code(early)], [409, "invalid_transition"]);
    const archived = ok<EmployeeDetail>(await b.send("POST", `/api/employees/${e.id}/employment`, { command: "archive", reason: "the project ended" }, ifMatch(e.version)));
    const list = await desks();
    assert.equal(list.desks.length, 1);
    const d = list.desks[0];
    assert.ok(d !== undefined);
    assert.deepEqual([d.employeeId, d.name, d.employment, d.reason, d.deskMiB, d.cacheMiB, d.sandbox?.state, d.canBrowse, d.canClean], [e.id, "Leaving", "archived", "the project ended", profile.deskStorageMiB, 0, "ARCHIVED", true, false]);
    assert.equal(await committed(), before - profile.cacheStorageMiB, "an archive releases the cache, and keeps the desk");
    assert.equal(list.storage.committedMiB, await committed());

    // A provider that cannot remove it yet: DELETING, listed as such, the storage still committed -- tried again.
    sandbox.deleteGone = false;
    const stale = await b.send("POST", `/api/employees/${e.id}/employment`, { command: "delete" }, ifMatch(e.version));
    assert.equal(stale.status, 412, "the version read before the archive is stale");
    ok(await b.send("POST", `/api/employees/${e.id}/employment`, { command: "delete" }, ifMatch(archived.version)));
    await eventually(() => sandbox.deleted.length, (n) => n >= 1);
    const deleting = (await desks()).desks[0];
    assert.deepEqual([deleting?.employment, deleting?.sandbox?.state], ["deleted", "DELETING"]);
    assert.match(deleting?.sandbox?.reason ?? "", /still exist/);
    assert.equal(await committed(), before - profile.cacheStorageMiB, "nothing is released before the sandbox is gone");

    // The provider removes it: DELETED, the desk released, no longer listed.
    sandbox.deleteGone = true;
    await h.sql("UPDATE workforce.sandboxes SET updated_at = now() - interval '10 minutes' WHERE employee_id = $1", [e.id]);
    await h.app.get(SandboxProvisioner).sweep();
    await eventually(desks, (l) => l.desks.length === 0);
    assert.equal(await committed(), before - profile.cacheStorageMiB - profile.deskStorageMiB, "the desk's storage is released");
    assert.deepEqual([sandbox.deleted.at(-1)?.orbitId, sandbox.deleted.at(-1)?.employeeId], [h.accountId, e.id], "that employee's sandbox, of that account");
    const gone = ok<EmployeeDetail>(await b.get(`/api/employees/${e.id}`));
    assert.deepEqual([gone.employment, gone.sandbox.state], ["deleted", "DELETED"]);
    const roster = ok<{ employees: { id: string }[] }>(await b.get("/api/office/roster"));
    assert.equal(roster.employees.some((x) => x.id === e.id), false, "a deleted employee is not in the office");
    const recorded = await h.sql("SELECT data->>'command' AS command FROM audit_events WHERE account_id = $1 AND event_type = 'office.command' AND data->>'aggregateId' = $2 ORDER BY seq", [h.accountId, e.id]);
    assert.deepEqual(recorded.map((r) => r.command).filter((c) => c === "employee.archive" || c === "employee.delete"), ["employee.archive", "employee.delete"]);
  });

  test("another account's employee desk is neither listed nor deleted", async () => {
    const e = await hire("Mine");
    const archived = ok<EmployeeDetail>(await b.send("POST", `/api/employees/${e.id}/employment`, { command: "archive" }, ifMatch(e.version)));
    const bob = await h.as("bob");
    assert.deepEqual(ok<EmployeeDeskList>(await bob.get("/api/office/desks")).desks, []);
    const r = await bob.send("POST", `/api/employees/${e.id}/employment`, { command: "delete" }, ifMatch(archived.version));
    assert.equal(r.status, 404);
    assert.equal((await desks()).desks.some((d) => d.employeeId === e.id && d.employment === "archived"), true, "still held");
  });
});
