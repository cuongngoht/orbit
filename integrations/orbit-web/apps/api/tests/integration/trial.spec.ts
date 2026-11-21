// THE LOCALHOST-ONLY TRIAL (ORBIT_WEB_TRIAL=1): Orbit Web refuses to start in trial mode anywhere another machine could
// reach it -- and says which condition failed. Where it starts, it seeds the account `admin` / `123456` once (with what
// governance owes it), shows that login on the page while it is the password, records every start, never sets a changed
// password back, and answers no host name but loopback.
import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, describe, test } from "node:test";
import type { ApiErrorBody, AuthStatus, AuthUser } from "@orbit-web/contracts";
import { browserAt, startHarness, type Harness } from "../../src/testing/harness.js";

const TRIAL = { ORBIT_WEB_TRIAL: "1" };

// A request with a Host header of its own (a browser on another name, or a DNS rebinding).
const statusWithHost = (url: string, host: string): Promise<number> =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = request({ hostname: u.hostname, port: u.port, path: "/api/auth/status", headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });

describe("trial mode starts only where nobody else can reach it", () => {
  test("each condition refuses the start, and says which", async () => {
    const refused: [Record<string, string>, RegExp][] = [
      [{ ORBIT_WEB_ALLOWED_HOSTS: "orbit.example.com", ORBIT_WEB_ACCESS_TOKEN: "a-long-and-random-access-token" }, /ORBIT_WEB_ALLOWED_HOSTS names orbit\.example\.com/],
      [{ ORBIT_WEB_ACCESS_TOKEN: "a-long-and-random-access-token" }, /ORBIT_WEB_ACCESS_TOKEN is set/],
      [{ ORBIT_WEB_DEPLOYMENT: "governed", ORBIT_WEB_RUNNER: "127.0.0.1:7070", ORBIT_WEB_AGENT_NETWORKS: "172.30.0.0/24", ORBIT_WEB_AGENT_CONTROL_HOST: "orbit-web" }, /ORBIT_WEB_DEPLOYMENT is governed/],
      [{ ORBIT_WEB_PUBLIC_ORIGIN: "https://orbit.example.com" }, /ORBIT_WEB_PUBLIC_ORIGIN is set/],
      [{ ORBIT_WEB_COOKIE_SECURE: "1" }, /ORBIT_WEB_COOKIE_SECURE is set/],
    ];
    for (const [env, why] of refused) await assert.rejects(startHarness({ env: { ...TRIAL, ...env }, signIn: false }), (err: Error) => /ORBIT_WEB_TRIAL=1 refused/.test(err.message) && why.test(err.message), JSON.stringify(env));
  });
});

describe("the trial account", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ env: TRIAL, signIn: false })));
  after(() => h.close());

  test("is seeded at start -- admin / 123456, Orbit Admin -- with its audit chain and policy, and the page is told its login", async () => {
    const status = (await h.anonymous.get("/api/auth/status")).body as AuthStatus;
    assert.deepEqual([status.state, status.trial], ["signed_out", { enabled: true, username: "admin", password: "123456" }]);
    const [admin] = await h.sql("SELECT u.full_name, u.trial_waiver, u.must_change_password, a.kind FROM users u JOIN accounts a ON a.id = u.account_id WHERE u.username = 'admin'");
    assert.deepEqual(admin, { full_name: "Orbit Admin", trial_waiver: true, must_change_password: false, kind: "customer" });
    const accountId = String((await h.sql("SELECT account_id FROM users WHERE username = 'admin'"))[0]?.account_id);
    assert.deepEqual(await h.sql("SELECT data->>'provider' AS how FROM audit_events WHERE account_id = $1 AND event_type = 'account.created'", [accountId]), [{ how: "trial" }]);
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM policy_revisions WHERE account_id = $1 AND state = 'PUBLISHED'", [accountId]))[0]?.n, 1);
    const started = await h.sql("SELECT outcome, data->>'setting' AS setting FROM audit_events WHERE account_id = '00000000-0000-4000-8000-000000000001' AND data->>'setting' = 'identity.trial_mode'");
    assert.deepEqual(started, [{ outcome: "seeded", setting: "identity.trial_mode" }], "the start is in the deployment's record");
  });

  test("signs in with admin / 123456 -- the one password that skips the rules -- and only on loopback host names", async () => {
    const signedIn = (await h.anonymous.send("POST", "/api/auth/login", { username: "admin", password: "123456" })).body as AuthStatus;
    assert.equal(signedIn.state, "signed_in");
    assert.deepEqual([signedIn.user?.trialPassword, signedIn.user?.mustChangePassword], [true, false]);
    assert.equal(await statusWithHost(h.url, "orbit.example.com"), 421, "a host name beyond loopback is refused");
    assert.equal(await statusWithHost(h.url, "localhost"), 200);
    const setup = await browserAt(h.url).send("POST", "/api/auth/setup", { code: "0000-0000-0000-0000-0000-0000", username: "eve", password: "123456", fullName: "Eve", timezone: "UTC" });
    assert.equal(setup.status, 400, "the waiver is the seed's alone: no request gets it");
    assert.match((setup.body as ApiErrorBody).error.message, /password must be at least/);
  });

  test("a restart seeds nothing again, and never sets a changed password back", async () => {
    await h.close(true);
    h = await startHarness({ env: TRIAL, signIn: false, dataDir: h.dataDir, database: h.database });
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM users"))[0]?.n, 1, "once");
    const admin = await h.signIn("admin", "123456");
    const changed = await admin.send("POST", "/api/auth/password", { currentPassword: "123456", newPassword: "a much better passphrase" });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    assert.equal((changed.body as AuthUser).trialPassword, false, "changing it ends the waiver");
    assert.equal(((await h.anonymous.get("/api/auth/status")).body as AuthStatus).trial.password, null, "the page no longer shows a password that is not the account's");
    await h.close(true);
    h = await startHarness({ env: TRIAL, signIn: false, dataDir: h.dataDir, database: h.database });
    assert.equal((await h.anonymous.send("POST", "/api/auth/login", { username: "admin", password: "123456" })).status, 401, "not set back");
    assert.equal((await h.signIn("admin", "a much better passphrase")).status?.state, "signed_in");
    const starts = await h.sql("SELECT outcome FROM audit_events WHERE account_id = '00000000-0000-4000-8000-000000000001' AND data->>'setting' = 'identity.trial_mode' ORDER BY seq");
    assert.deepEqual(starts.map((r) => r.outcome), ["seeded", "started", "started"], "every start is recorded");
  });
});

describe("an installation that is not a trial", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ signIn: false })));
  after(() => h.close());

  test("seeds nothing and shows no trial login", async () => {
    const status = (await h.anonymous.get("/api/auth/status")).body as AuthStatus;
    assert.deepEqual([status.state, status.trial], ["setup_required", { enabled: false, username: null, password: null }]);
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM users"))[0]?.n, 0);
  });
});
