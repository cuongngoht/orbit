// THE INSTALLATION'S TERMINAL (src/cli/governance.ts): what whoever runs the control plane's container can do with
// governance when no page can. It makes no account and opens no session -- there is no owner to enrol and no password to
// reset. It says which account the runtime serves and whether each audit chain holds, finds a record changed behind the
// triggers' back, and ends an account's browser sessions, saying so on that account's own chain.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { SIGN_IN_REQUIRED, type AuditPage, type ChainVerification, type FindingList } from "@orbit-web/contracts";
import { startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const CLI = fileURLToPath(new URL("../../src/cli/governance.js", import.meta.url));

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

function ok<T>(r: Reply): T {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as T;
}

describe("the governance terminal", () => {
  let h: Harness;
  let again: Browser;
  // The terminal is given what the API is given to reach the database, and nothing else.
  const run = (...args: string[]) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, ...args], { env: { PATH: process.env.PATH, ORBIT_WEB_DATA_DIR: h.dataDir, ORBIT_WEB_DATABASE_URL: h.database.url }, encoding: "utf8" });

  before(async () => {
    h = await startHarness();
  });
  after(() => h.close());

  test("makes no account and opens no session: there is nobody to enrol and no password to reset", () => {
    const usage = run();
    assert.equal(usage.status, 1);
    assert.match(usage.stderr, /usage: governance\.js status \| verify-audit \| revoke-sessions/);
    for (const removed of ["init-owner", "reset-password", "issue-recovery"]) assert.equal(run(removed).status, 1, removed);
  });

  test("refuses a database it cannot use, and says why", () => {
    const missing = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, "status"], { env: { PATH: process.env.PATH, ORBIT_WEB_DATA_DIR: h.dataDir }, encoding: "utf8" });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /ORBIT_WEB_DATABASE_URL is required/);
  });

  test("status says which account the runtime serves, each account's open sessions, and whether each chain holds", () => {
    const s = run("status");
    assert.equal(s.status, 0, s.stderr);
    assert.match(s.stdout, new RegExp(`runtime: serving account ${h.accountId}`));
    assert.match(s.stdout, new RegExp(`account ${h.accountId}: octo@example\\.com, 1 open browser session\\(s\\)`));
    assert.match(s.stdout, new RegExp(`audit, account ${h.accountId}: \\d+ record\\(s\\), the chain holds`));
    assert.match(s.stdout, /audit, deployment: \d+ record\(s\), the chain holds/);
  });

  test("verify-audit holds on untouched chains -- an account's, or the deployment's -- and refuses what is not an account's id", () => {
    const all = run("verify-audit");
    assert.equal(all.status, 0, all.stderr);
    assert.match(all.stdout, new RegExp(`audit, account ${h.accountId}: \\d+ record\\(s\\), the chain holds`));
    assert.equal(run("verify-audit", `--account=${h.accountId}`).status, 0);
    const deployment = run("verify-audit", "--deployment");
    assert.equal(deployment.status, 0, deployment.stderr);
    assert.match(deployment.stdout, /audit, deployment:/);
    assert.equal(run("verify-audit", "--account=octo@example.com").status, 1);
  });

  test("revoke-sessions ends an account's browser sessions -- its owner signs in again with Claude -- and says so on the account's chain", async () => {
    assert.equal((await h.get("/api/governance/overview")).status, 200);
    const r = run("revoke-sessions", `--account=${h.accountId}`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`1 browser session\\(s\\) of account ${h.accountId} ended`));
    assert.equal(code(await h.get("/api/governance/overview")), SIGN_IN_REQUIRED);
    again = await h.browser();
    assert.equal(again.accountId, h.accountId, "the same identity, the same account");
    const events = ok<AuditPage>(await again.get("/api/governance/audit?type=auth.sessions.revoked")).events;
    assert.deepEqual(events.map((e) => [e.principalType, e.principalId, e.data.sessions, e.data.reason]), [["system", "installation-terminal", 1, "revoked_by_terminal"]]);
    const unknown = run("revoke-sessions", `--account=${randomUUID()}`);
    assert.equal(unknown.status, 3);
    assert.match(unknown.stderr, /no account/);
    assert.equal(run("revoke-sessions").status, 1, "an account or --all, said");
  });

  test("verify-audit finds a record changed behind the triggers' back -- and so does the owner's own check", async () => {
    const chain = `account:${h.accountId}`;
    await h.sql("ALTER TABLE governance.audit_events DISABLE TRIGGER audit_never_updated");
    try {
      await h.sql("UPDATE governance.audit_events SET outcome = 'tampered' WHERE chain_id = $1 AND seq = 2", [chain]);
    } finally {
      await h.sql("ALTER TABLE governance.audit_events ENABLE TRIGGER audit_never_updated");
    }
    const check = run("verify-audit", `--account=${h.accountId}`);
    assert.equal(check.status, 2);
    assert.match(check.stderr, /does NOT hold at record 2 \(HASH_MISMATCH/);
    assert.equal(run("status").status, 2);
    const v = ok<ChainVerification>(await again.send("POST", "/api/governance/audit/verify"));
    assert.deepEqual([v.ok, v.brokenAt, v.problem], [false, 2, "HASH_MISMATCH"]);
    const kinds = ok<FindingList>(await again.get("/api/governance/findings")).findings.map((f) => f.kind);
    assert.ok(kinds.includes("AUDIT_INTEGRITY_FAILURE"), kinds.join(","));
  });
});
