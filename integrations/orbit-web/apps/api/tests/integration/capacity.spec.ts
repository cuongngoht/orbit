// WHAT THE HOST GIVES EMPLOYEES, READ AGAIN: at a person's Re-check (Settings → Compute & storage) and at every start,
// the sandbox provider is asked again, and every account authorization that comes from the capacity follows it -- a
// budget value that stood at the old authorization moves, one the owner lowered stays; an operator's own authorization
// (`governance.js budget set`) stays the operator's until `--from-capacity` gives it back. A provider that does not answer
// changes nothing.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import type { ResourceSummary } from "@orbit-web/contracts";
import { SANDBOX_PROVIDER } from "../../src/contexts/execution/application/sandbox.port.js";
import { FakeSandboxProvider } from "../../src/testing/fake-sandbox.js";
import { eventually, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const CLI = fileURLToPath(new URL("../../src/cli/governance.js", import.meta.url));
const ifMatch = (v: number) => ({ "if-match": `"${v}"` });
const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

function ok<T>(r: Reply): T {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as T;
}

// A 2-vCPU, 8 GiB host with a 10 GiB pool, and the same host resized to 4 vCPU, 16 GiB, with a 20 GiB pool.
const SMALL = { cpuMillis: 2000, memoryMiB: 7911, storageMiB: 10240 };
const LARGE = { cpuMillis: 4000, memoryMiB: 15947, storageMiB: 20480 };

describe("the host's capacity, read again", () => {
  let h: Harness;
  let b: Browser;
  const sandbox = new FakeSandboxProvider();
  const run = (...args: string[]) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, ...args], { env: { PATH: process.env.PATH, ORBIT_WEB_DATA_DIR: h.dataDir, ORBIT_WEB_DATABASE_URL: h.database.url }, encoding: "utf8" });
  const summary = async (): Promise<ResourceSummary> => ok<ResourceSummary>(await b.get("/api/office/resources"));

  before(async () => {
    sandbox.host = { ...SMALL };
    h = await startHarness({ overrides: [[SANDBOX_PROVIDER, sandbox]] });
    b = h.owner as Browser;
    assert.equal((await b.send("POST", "/api/office/setup", { name: "Capacity office" })).status, 200);
  });
  after(() => h.close());

  test("Re-check reads the resized host: the budget that stood at the authorization follows it, a value the owner lowered stays", async () => {
    const first = await summary();
    assert.equal(first.capacity.total.cpuMillis, SMALL.cpuMillis);
    assert.equal(first.budget.authorized.cpuMillis, first.capacity.usable.cpuMillis, "the first look authorizes the usable capacity");
    const lowered = ok<ResourceSummary>(await b.send("PATCH", "/api/office/resources/budget", { memoryMiB: 1024 }, ifMatch(first.budget.version)));
    assert.equal(lowered.budget.memoryMiB, 1024);

    sandbox.host = { ...LARGE };
    assert.equal((await summary()).capacity.total.cpuMillis, SMALL.cpuMillis, "nothing reads the host by itself between starts");
    const after = ok<ResourceSummary>(await b.send("POST", "/api/office/resources/capacity/check"));
    assert.equal(after.capacity.total.cpuMillis, LARGE.cpuMillis);
    assert.ok(after.capacity.usable.cpuMillis > first.capacity.usable.cpuMillis);
    assert.equal(after.budget.authorized.cpuMillis, after.capacity.usable.cpuMillis, "the authorization follows the capacity");
    assert.equal(after.budget.authorized.source, "capacity");
    assert.equal(after.budget.cpuMillis, after.capacity.usable.cpuMillis, "the CPU budget stood at the authorization: it follows");
    assert.equal(after.budget.perEmployee.cpuMillis, after.capacity.usable.cpuMillis);
    assert.equal(after.budget.perEmployee.deskStorageMiB, Math.floor(after.capacity.usable.storageMiB / 2), "a desk of at most half the pool");
    assert.equal(after.budget.memoryMiB, 1024, "the memory the owner lowered stays");
    const done = await h.sql("SELECT data->>'command' AS command FROM audit_events WHERE account_id = $1 AND event_type = 'office.command' AND data->>'command' = 'resources.capacity.check'", [h.accountId]);
    assert.equal(done.length, 1, "the Re-check is in the account's audit record");
  });

  test("a sandbox provider that does not answer changes nothing, and says so", async () => {
    const before = await summary();
    const probe = sandbox.probe.bind(sandbox);
    sandbox.probe = async () => {
      throw new Error("the allocator is restarting");
    };
    try {
      const r = await b.send("POST", "/api/office/resources/capacity/check");
      assert.deepEqual([r.status, code(r)], [422, "capacity_unreadable"]);
      assert.deepEqual((await summary()).capacity.total, before.capacity.total);
    } finally {
      sandbox.probe = probe;
    }
  });

  test("an operator's authorization (budget set) is the operator's: a Re-check leaves it; --from-capacity gives it back", async () => {
    const shown = run("budget", "show");
    assert.equal(shown.status, 0, shown.stderr);
    assert.match(shown.stdout, /follows the host's capacity/);
    assert.equal(run("budget", "set").status, 1, "an account (or --all) is named");
    assert.equal(run("budget", "set", `--account=${h.accountId}`).status, 1, "a number, or --from-capacity");
    assert.equal(run("budget", "set", `--account=${h.accountId}`, "--cpu=-1").status, 1);

    const set = run("budget", "set", `--account=${h.accountId}`, "--cpu=1", "--employee-cpu=1");
    assert.equal(set.status, 0, set.stderr);
    let r = await summary();
    assert.deepEqual([r.budget.authorized.cpuMillis, r.budget.authorized.perEmployee.cpuMillis, r.budget.authorized.source], [1000, 1000, "operator"]);
    assert.equal(r.budget.cpuMillis, 1000, "the CPU budget stood at the old authorization: it follows the operator's");
    assert.equal(r.budget.memoryMiB, 1024, "the owner's lowered memory stays");

    sandbox.host = { cpuMillis: 8000, memoryMiB: 32000, storageMiB: 20480 };
    r = ok<ResourceSummary>(await b.send("POST", "/api/office/resources/capacity/check"));
    assert.equal(r.capacity.total.cpuMillis, 8000);
    assert.equal(r.budget.authorized.cpuMillis, 1000, "the operator's authorization stays");

    const back = run("budget", "set", `--account=${h.accountId}`, "--from-capacity");
    assert.equal(back.status, 0, back.stderr);
    r = await summary();
    assert.deepEqual([r.budget.authorized.cpuMillis, r.budget.authorized.source], [r.capacity.usable.cpuMillis, "capacity"]);
    const recorded = await h.sql("SELECT data->>'value' AS value FROM audit_events WHERE account_id = $1 AND data->>'setting' = 'workforce.budget.authorization' ORDER BY seq", [h.accountId]);
    assert.deepEqual(
      recorded.map((x) => String(x.value).split(":")[0]),
      ["operator", "capacity"],
    );
  });

  test("at a start the host is read again, and the authorization that follows the capacity follows it", async () => {
    const before = await summary();
    sandbox.host = { ...LARGE, cpuMillis: 6000 };
    const dataDir = h.dataDir;
    const database = h.database;
    await h.close(true);
    h = await startHarness({ dataDir, database, overrides: [[SANDBOX_PROVIDER, sandbox]] });
    b = h.owner as Browser;
    const after = await eventually(summary, (s) => s.capacity.total.cpuMillis === 6000);
    assert.notEqual(after.capacity.checkedAt, before.capacity.checkedAt);
    assert.equal(after.budget.authorized.cpuMillis, after.capacity.usable.cpuMillis);
  });
});
