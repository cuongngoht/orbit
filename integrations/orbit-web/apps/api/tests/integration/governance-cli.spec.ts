// THE INSTALLATION'S TERMINAL (src/cli/governance.ts): what whoever runs the control plane's container can do when no
// page can. It prints the ONE-TIME CODE that sets up the first administrator (or another account, or a user's new
// password) -- once, kept only as its hash --, ends browser sessions (an account's, a user's, everybody's), says what the
// database holds and whether each audit chain holds, and finds a record changed behind the triggers' back. Every change
// is said on the chain it concerns.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { after, before, describe, test } from "node:test";
import { SETUP_ALREADY_DONE, SETUP_CODE_INVALID, SIGN_IN_REQUIRED, type AuditPage, type AuthStatus, type ChainVerification, type FindingList } from "@orbit-web/contracts";
import { browserAt, startHarness, TEST_PASSWORD, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const CLI = fileURLToPath(new URL("../../src/cli/governance.js", import.meta.url));

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

function ok<T>(r: Reply): T {
  assert.ok(r.status === 200 || r.status === 201, `${r.status} ${JSON.stringify(r.body).slice(0, 400)}`);
  return r.body as T;
}

const SETUP = { username: "admin", password: "a long first password", fullName: "Ada Admin", companyName: "Acme", timezone: "Europe/Paris" };

// The code a terminal printed: the indented line of five groups.
const codeIn = (stdout: string): string => /^ {4}([0-9A-Z]{4}(?:-[0-9A-Z]{4}){5})$/m.exec(stdout)?.[1] ?? "";

describe("the first administrator, from a code printed in a terminal", () => {
  let h: Harness;
  const run = (...args: string[]) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, ...args], { env: { PATH: process.env.PATH, ORBIT_WEB_DATA_DIR: h.dataDir, ORBIT_WEB_DATABASE_URL: h.database.url }, encoding: "utf8" });

  before(async () => {
    h = await startHarness({ signIn: false });
  });
  after(() => h.close());

  test("a fresh installation asks for its first administrator; nobody can sign in yet", async () => {
    assert.equal(((await h.anonymous.get("/api/auth/status")).body as AuthStatus).state, "setup_required");
    assert.equal(code(await h.anonymous.send("POST", "/api/auth/login", { username: "admin", password: "anything at all" })), "setup_required");
    const s = run("status");
    assert.equal(s.status, 0, s.stderr);
    assert.match(s.stdout, /accounts: none yet -- set up the first administrator: governance\.js owner setup-code/);
  });

  test("owner setup-code prints the code once; kept only as its hash; it makes the account, and works once", async () => {
    const printed = run("owner", "setup-code");
    assert.equal(printed.status, 0, printed.stderr);
    const setupCode = codeIn(printed.stdout);
    assert.match(setupCode, /^[0-9A-Z]{4}(-[0-9A-Z]{4}){5}$/);
    assert.match(printed.stdout, /It works once, until .* \(30 minutes\)\. It is not shown again\./);
    const [row] = await h.sql("SELECT purpose, account_id, code_hash, expires_at - created_at AS lasts FROM setup_codes");
    assert.equal(row?.purpose, "first_admin");
    assert.equal(JSON.stringify(row).includes(setupCode), false, "never kept as it is");
    const wrong = await h.anonymous.send("POST", "/api/auth/setup", { ...SETUP, code: "0000-0000-0000-0000-0000-0000" });
    assert.deepEqual([wrong.status, code(wrong)], [400, SETUP_CODE_INVALID]);
    const browser = browserAt(h.url);
    const made = await browser.send("POST", "/api/auth/setup", { ...SETUP, code: setupCode.toLowerCase() });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const status = made.body as AuthStatus;
    assert.deepEqual([status.state, status.user?.username, status.user?.fullName, status.account?.companyName, status.account?.timezone], ["signed_in", "admin", "Ada Admin", "Acme", "Europe/Paris"]);
    assert.equal((await browser.get("/api/sessions")).status, 200, "the browser that set it up is signed in");
    const again = await h.anonymous.send("POST", "/api/auth/setup", { ...SETUP, username: "mallory", code: setupCode });
    assert.deepEqual([again.status, code(again)], [400, SETUP_CODE_INVALID], "a code works once");
    assert.equal(run("owner", "setup-code").status, 1, "a second first administrator is refused at the terminal");
    assert.match(run("owner", "setup-code").stderr, /an administrator is set up already/);
  });

  test("a first-administrator code used where an account exists makes nothing, and is not used up", async () => {
    const first = (await h.sql("SELECT count(*)::int AS n FROM accounts WHERE kind = 'customer'"))[0]?.n;
    // A code printed before the first account existed (the terminal refuses one now): planted as the terminal writes it.
    const plant = async (): Promise<string> => {
      const { newSetupCode } = await import("../../src/modules/auth/setup-codes.js");
      const c = newSetupCode();
      await h.sql("INSERT INTO setup_codes (id, account_id, purpose, user_id, code_hash, created_at, expires_at) VALUES ($1, '00000000-0000-4000-8000-000000000001', 'first_admin', NULL, $2, now(), now() + interval '30 minutes')", [randomUUID(), c.hash]);
      return c.code;
    };
    const r = await h.anonymous.send("POST", "/api/auth/setup", { ...SETUP, username: "late", code: await plant() });
    assert.deepEqual([r.status, code(r)], [409, SETUP_ALREADY_DONE]);
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM accounts WHERE kind = 'customer'"))[0]?.n, first);
    assert.equal((await h.sql("SELECT consumed_at FROM setup_codes WHERE purpose = 'first_admin' AND consumed_at IS NULL")).length, 1, "the refused setup used nothing up (its transaction rolled back)");
  });

  test("owner setup-code --purpose=new_account makes another account, with its own user", async () => {
    const printed = run("owner", "setup-code", "--purpose=new_account", "--minutes=5");
    assert.equal(printed.status, 0, printed.stderr);
    assert.match(printed.stdout, /\(5 minutes\)/);
    const made = await browserAt(h.url).send("POST", "/api/auth/setup", { ...SETUP, username: "bea", fullName: "Bea", companyName: "", code: codeIn(printed.stdout) });
    assert.equal(made.status, 200, JSON.stringify(made.body));
    const status = made.body as AuthStatus;
    const admin = (await h.sql("SELECT account_id FROM users WHERE username = 'admin'"))[0]?.account_id;
    assert.notEqual(status.account?.orbitId, admin, "an account of its own");
    assert.equal(status.account?.displayName, "Bea", "named by its first user when no company is given");
    for (const bad of [["owner", "setup-code", "--purpose=reset_password"], ["owner", "setup-code", "--minutes=0"], ["owner", "nothing"]]) assert.equal(run(...bad).status, 1, bad.join(" "));
  });

  test("owner reset-password prints a code for ONE user: it sets the password and ends every session of that user", async () => {
    const before = await h.signIn("admin", SETUP.password);
    const printed = run("owner", "reset-password", "--username=admin");
    assert.equal(printed.status, 0, printed.stderr);
    const resetCode = codeIn(printed.stdout);
    const forOther = await h.anonymous.send("POST", "/api/auth/setup", { code: resetCode, username: "bea", password: "another long password" });
    assert.deepEqual([forOther.status, code(forOther)], [400, SETUP_CODE_INVALID], "a reset code names its user: another username is refused, and nothing says why");
    const reset = await browserAt(h.url).send("POST", "/api/auth/setup", { code: resetCode, username: "admin", password: "a brand new password" });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal(code(await before.get("/api/sessions")), SIGN_IN_REQUIRED, "the sessions from before the reset ended");
    assert.equal((await h.anonymous.send("POST", "/api/auth/login", { username: "admin", password: SETUP.password })).status, 401, "the old password is gone");
    assert.equal((await h.signIn("admin", "a brand new password")).status?.state, "signed_in");
    assert.equal(run("owner", "reset-password", "--username=nobody").status, 3);
  });

  test("owner revoke-sessions ends one user's sessions, or everybody's, and says so on each account's chain", async () => {
    const admin = await h.signIn("admin", "a brand new password");
    const bea = await h.signIn("bea", SETUP.password);
    const one = run("owner", "revoke-sessions", "--username=admin");
    assert.equal(one.status, 0, one.stderr);
    assert.match(one.stdout, /browser session\(s\) of admin ended/);
    assert.equal(code(await admin.get("/api/sessions")), SIGN_IN_REQUIRED);
    assert.equal((await bea.get("/api/sessions")).status, 200, "another user's stay");
    const adminAgain = await h.signIn("admin", "a brand new password");
    const all = run("owner", "revoke-sessions");
    assert.equal(all.status, 0, all.stderr);
    assert.match(all.stdout, /browser session\(s\) ended; every user signs in again/);
    assert.equal(code(await bea.get("/api/sessions")), SIGN_IN_REQUIRED);
    assert.equal(code(await adminAgain.get("/api/sessions")), SIGN_IN_REQUIRED);
    // Each command that ended an account's sessions says so on that account's chain, as the installation's terminal.
    const byTerminal = async (b: Browser) => ok<AuditPage>(await b.get("/api/governance/audit?type=auth.sessions.revoked")).events.filter((e) => e.principalId === "installation-terminal");
    const onAdmin = await byTerminal(await h.signIn("admin", "a brand new password"));
    assert.ok(onAdmin.every((e) => e.principalType === "system" && e.data.reason === "revoked_by_terminal"), JSON.stringify(onAdmin));
    assert.equal(onAdmin.length, 2, "admin's account: the command for admin, and the one for everybody");
    assert.equal((await byTerminal(await h.signIn("bea", SETUP.password))).length, 1, "bea's account: the one for everybody");
  });
});

describe("the governance terminal", () => {
  let h: Harness;
  let again: Browser;
  // The terminal is given what the API is given to reach the database, and nothing else.
  const run = (...args: string[]) => spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, ...args], { env: { PATH: process.env.PATH, ORBIT_WEB_DATA_DIR: h.dataDir, ORBIT_WEB_DATABASE_URL: h.database.url }, encoding: "utf8" });

  before(async () => {
    h = await startHarness();
  });
  after(() => h.close());

  test("says what it does, and nothing else", () => {
    const usage = run();
    assert.equal(usage.status, 1);
    assert.match(usage.stderr, /usage: governance\.js status \| verify-audit \| revoke-sessions \| owner/);
    for (const removed of ["init-owner", "reset-password", "issue-recovery"]) assert.equal(run(removed).status, 1, removed);
  });

  test("refuses a database it cannot use, and says why", () => {
    const missing = spawnSync(process.execPath, ["--disable-warning=ExperimentalWarning", CLI, "status"], { env: { PATH: process.env.PATH, ORBIT_WEB_DATA_DIR: h.dataDir }, encoding: "utf8" });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /ORBIT_WEB_DATABASE_URL is required/);
  });

  test("status says each account, its users and open sessions, and whether each chain holds -- the deployment's too", () => {
    const s = run("status");
    assert.equal(s.status, 0, s.stderr);
    assert.match(s.stdout, new RegExp(`account ${h.accountId} "Octo Cat": octo \\(Octo Cat\\); 1 open browser session\\(s\\)`));
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

  test("revoke-sessions ends an account's browser sessions -- its users sign in again -- and says so on the account's chain", async () => {
    assert.equal((await h.get("/api/governance/overview")).status, 200);
    const r = run("revoke-sessions", `--account=${h.accountId}`);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`1 browser session\\(s\\) of account ${h.accountId} ended`));
    assert.equal(code(await h.get("/api/governance/overview")), SIGN_IN_REQUIRED);
    again = await h.signIn("octo", TEST_PASSWORD);
    assert.equal(again.accountId, h.accountId, "the same user, the same account");
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
