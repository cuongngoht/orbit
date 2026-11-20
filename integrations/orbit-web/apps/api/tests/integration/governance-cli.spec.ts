// THE INSTALLATION'S TERMINAL: the offline door to governance (src/cli/governance.ts) -- the first owner without the
// log's code, an owner's password reset, and a check of the audit chain that finds a record changed behind the
// triggers' back.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import type { GovernanceState } from "@orbit-web/contracts";
import { ensureDataDirs } from "../../src/config/data-dirs.js";
import { dataDirs } from "../../src/config/config.js";
import { startHarness } from "../../src/testing/harness.js";

const CLI = fileURLToPath(new URL("../../src/cli/governance.js", import.meta.url));

describe("the governance terminal", () => {
  let dir: string;
  const run = (args: string[], input?: string) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, ...args], { env: { PATH: process.env.PATH, ORBIT_WEB_DATA_DIR: dir }, input, encoding: "utf8" });
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "orbit-web-cli-"));
    ensureDataDirs(dataDirs(dir));
  });
  after(() => rmSync(dir, { recursive: true, force: true }));

  test("enrols the first owner once, with the password on standard input only", () => {
    const short = run(["init-owner", "--username=root", "--organization=Acme"], "short");
    assert.notEqual(short.status, 0);
    const ok = run(["init-owner", "--username=root", "--organization=Acme"], "a long enough password\n");
    assert.equal(ok.status, 0, ok.stderr);
    const twice = run(["init-owner", "--username=other", "--organization=Acme"], "a long enough password\n");
    assert.equal(twice.status, 3);
    assert.match(twice.stderr, /already has an owner/);
    const status = run(["status"]);
    assert.match(status.stdout, /organization: Acme/);
    assert.match(status.stdout, /operator root: active, roles organization_owner/);
    assert.match(status.stdout, /the chain holds/);
  });

  test("the owner it enrolled signs in to the API; a reset password ends their sessions", async () => {
    const h = await startHarness({ dataDir: dir });
    try {
      assert.equal(h.bootstrapCode(), null, "an owner exists: no code is made");
      const root = await h.signIn("root", "a long enough password");
      assert.deepEqual(root.state.session?.operator.roles, ["organization_owner"]);
      const reset = run(["reset-password", "--username=root", "--owner"], "a brand new password\n");
      assert.equal(reset.status, 0, reset.stderr);
      assert.equal(((await root.get("/api/operator/state")).body as GovernanceState).session, null);
      assert.equal((await h.send("POST", "/api/operator/login", { username: "root", password: "a long enough password" })).status, 401);
      const again = await h.signIn("root", "a brand new password");
      const types = ((await again.get("/api/governance/audit?limit=50")).body as { events: { eventType: string; principalId: string }[] }).events.filter((e) => e.principalId === "installation-terminal").map((e) => e.eventType);
      for (const t of ["operator.recovery.issued", "operator.password.changed", "governance.initialized"]) assert.ok(types.includes(t), t);
    } finally {
      await h.close(true);
    }
  });

  test("verify-audit holds on an untouched record, and finds a record changed behind the triggers' back", () => {
    assert.equal(run(["verify-audit"]).status, 0);
    const db = new DatabaseSync(join(dir, "governance", "governance.db"));
    db.exec("DROP TRIGGER audit_never_updated");
    db.prepare("UPDATE audit_events SET outcome = 'tampered' WHERE seq = 2").run();
    db.close();
    const check = run(["verify-audit"]);
    assert.equal(check.status, 2);
    assert.match(check.stderr, /does NOT hold at record 2 \(HASH_MISMATCH/);
  });
});
