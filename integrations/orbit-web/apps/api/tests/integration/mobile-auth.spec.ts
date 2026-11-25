// MOBILE AUTH (Level B): native login mints a 30-day refresh token (hashed in mobile_refresh_tokens) and a 30-second
// single-use exchange code (hashed in mobile_exchange_codes); the embedded WebView exchanges that code for the same
// HttpOnly SameSite=Strict session cookie and CSRF token every browser route uses. Refresh rotates tokens, detects
// token reuse and revokes the family, respects device binding, and revokes on logout, logout-all and password change.
import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import {
  INVALID_CREDENTIALS,
  MOBILE_EXCHANGE_INVALID,
  MOBILE_REFRESH_INVALID,
  MUTATION_HEADER,
  SIGN_IN_REQUIRED,
  TOO_MANY_ATTEMPTS,
  type AuthStatus,
  type MobileTokenGrant,
} from "@orbit-web/contracts";
import { SESSION_COOKIE } from "../../src/modules/auth/principals.js";
import { browserAt, startHarness, TEST_PASSWORD, type Harness, type Reply } from "../../src/testing/harness.js";

const codeOf = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

describe("mobile login, single-use WebView exchange, rotation and revocation", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ account: { connect: false } })));
  after(() => h.close());

  test("mobile login accepts username or verified email, refuses unverified email, and issues hashed refresh + 30s exchange code", async () => {
    const byUsername = await h.anonymous.send("POST", "/api/auth/mobile/login", {
      username: "OCTO",
      password: TEST_PASSWORD,
      deviceId: "ios-device-1",
      deviceName: "iPhone 16 Pro",
    });
    assert.equal(byUsername.status, 200, JSON.stringify(byUsername.body));
    const grant = byUsername.body as MobileTokenGrant;
    assert.equal(grant.user.username, "octo");
    assert.equal(grant.account.orbitId, h.accountId);
    assert.ok(grant.refreshToken.length >= 32);
    assert.ok(grant.exchangeCode.length >= 32);
    assert.equal(byUsername.headers.get("set-cookie"), null, "mobile login does not set browser cookies directly");
    const refreshRows = await h.sql("SELECT * FROM mobile_refresh_tokens WHERE user_id = $1", [h.userId]);
    const codeRows = await h.sql("SELECT * FROM mobile_exchange_codes WHERE user_id = $1", [h.userId]);
    assert.equal(JSON.stringify(refreshRows).includes(grant.refreshToken), false, "only refresh token hash is kept");
    assert.equal(JSON.stringify(codeRows).includes(grant.exchangeCode), false, "only exchange code hash is kept");

    const byEmail = await h.anonymous.send("POST", "/api/auth/mobile/login", {
      username: "OCTO@example.com",
      password: TEST_PASSWORD,
      deviceId: "ios-device-1",
    });
    assert.equal(byEmail.status, 200, "verified email signs in too");

    await h.account("unverified", { email: "unverified@example.com", connect: false });
    await h.sql("UPDATE users SET email_verified_at = NULL WHERE username = 'unverified'");
    const unverified = await h.anonymous.send("POST", "/api/auth/mobile/login", {
      username: "unverified@example.com",
      password: TEST_PASSWORD,
      deviceId: "ios-device-2",
    });
    assert.deepEqual([unverified.status, codeOf(unverified)], [401, INVALID_CREDENTIALS]);
  });

  test("mobile login requires X-Orbit-Web: 1 and enforces login throttling", async () => {
    const missingHeader = await fetch(`${h.url}/api/auth/mobile/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "octo", password: TEST_PASSWORD, deviceId: "ios-device-throttle" }),
    });
    assert.equal(missingHeader.status, 403);
    assert.equal(((await missingHeader.json()) as { error: { code: string } }).error.code, "missing_header");

    await h.account("throttled", { connect: false });
    const guesser = browserAt(h.url);
    for (let i = 0; i < 6; i += 1) {
      const r = await guesser.send("POST", "/api/auth/mobile/login", { username: "throttled", password: "wrong password", deviceId: "ios-device-throttle" });
      assert.deepEqual([r.status, codeOf(r)], [401, INVALID_CREDENTIALS]);
    }
    const held = await guesser.send("POST", "/api/auth/mobile/login", { username: "throttled", password: TEST_PASSWORD, deviceId: "ios-device-throttle" });
    assert.deepEqual([held.status, codeOf(held)], [429, TOO_MANY_ATTEMPTS]);
    assert.ok(Number(held.headers.get("retry-after")) > 0);
  });

  test("exchange code is single-use under concurrency, rejects expired codes, and grants a real HttpOnly session cookie with CSRF", async () => {
    const login = await h.anonymous.send("POST", "/api/auth/mobile/login", { username: "octo", password: TEST_PASSWORD, deviceId: "ios-device-exch" });
    assert.equal(login.status, 200);
    const grant = login.body as MobileTokenGrant;

    const jarA: Record<string, string> = {};
    const jarB: Record<string, string> = {};
    const [ra, rb] = await Promise.all([
      browserAt(h.url, jarA).send("POST", "/api/auth/mobile/exchange", { code: grant.exchangeCode }),
      browserAt(h.url, jarB).send("POST", "/api/auth/mobile/exchange", { code: grant.exchangeCode }),
    ]);
    assert.deepEqual([ra.status, rb.status].sort(), [200, 401], JSON.stringify([ra.body, rb.body]));
    const winnerReply = ra.status === 200 ? ra : rb;
    const loserReply = ra.status === 200 ? rb : ra;
    const winnerJar = ra.status === 200 ? jarA : jarB;

    assert.equal(codeOf(loserReply), MOBILE_EXCHANGE_INVALID);
    const cookie = winnerReply.headers.get("set-cookie") ?? "";
    for (const part of [/^orbit_web_session=[^;]+;/, /; Max-Age=604800/, /; Path=\/api/, /; HttpOnly/, /; SameSite=Strict/]) assert.match(cookie, part);
    assert.ok(winnerJar[SESSION_COOKIE]);

    const status = winnerReply.body as AuthStatus;
    assert.equal(status.state, "signed_in");
    assert.equal(status.user?.username, "octo");
    const webview = browserAt(h.url, winnerJar, status);
    assert.equal((await webview.get("/api/sessions")).status, 200);
    assert.equal((await webview.send("PATCH", "/api/settings", { theme: "dark" })).status, 200);
    const missingCsrf = await fetch(`${h.url}/api/settings`, {
      method: "PATCH",
      headers: { [MUTATION_HEADER]: "1", cookie: webview.cookie, "content-type": "application/json" },
      body: JSON.stringify({ theme: "light" }),
    });
    assert.equal(missingCsrf.status, 403, "exchanged cookie still requires CSRF token for writes");

    const login2 = await h.anonymous.send("POST", "/api/auth/mobile/login", { username: "octo", password: TEST_PASSWORD, deviceId: "ios-device-exp" });
    const grant2 = login2.body as MobileTokenGrant;
    await h.sql("UPDATE mobile_exchange_codes SET expires_at = now() - interval '1 second' WHERE user_id = $1 AND consumed_at IS NULL", [h.userId]);
    const expired = await browserAt(h.url).send("POST", "/api/auth/mobile/exchange", { code: grant2.exchangeCode });
    assert.deepEqual([expired.status, codeOf(expired)], [401, MOBILE_EXCHANGE_INVALID]);
  });

  test("refresh rotates tokens, detects reuse and revokes the whole family, and enforces device binding", async () => {
    const login = await h.anonymous.send("POST", "/api/auth/mobile/login", { username: "octo", password: TEST_PASSWORD, deviceId: "ios-device-rot" });
    const grant1 = login.body as MobileTokenGrant;

    const refresh1 = await h.anonymous.send("POST", "/api/auth/mobile/refresh", { refreshToken: grant1.refreshToken, deviceId: "ios-device-rot" });
    assert.equal(refresh1.status, 200, JSON.stringify(refresh1.body));
    const grant2 = refresh1.body as MobileTokenGrant;
    assert.notEqual(grant2.refreshToken, grant1.refreshToken);
    assert.notEqual(grant2.exchangeCode, grant1.exchangeCode);

    // Replaying the rotated token revokes the whole token family, invalidating grant2 and grant2's unconsumed code.
    const replay = await h.anonymous.send("POST", "/api/auth/mobile/refresh", { refreshToken: grant1.refreshToken, deviceId: "ios-device-rot" });
    assert.deepEqual([replay.status, codeOf(replay)], [401, MOBILE_REFRESH_INVALID]);
    const afterReplayRefresh = await h.anonymous.send("POST", "/api/auth/mobile/refresh", { refreshToken: grant2.refreshToken, deviceId: "ios-device-rot" });
    assert.deepEqual([afterReplayRefresh.status, codeOf(afterReplayRefresh)], [401, MOBILE_REFRESH_INVALID]);
    const afterReplayExchange = await browserAt(h.url).send("POST", "/api/auth/mobile/exchange", { code: grant2.exchangeCode });
    assert.deepEqual([afterReplayExchange.status, codeOf(afterReplayExchange)], [401, MOBILE_EXCHANGE_INVALID]);
    const audit = await h.sql("SELECT data->>'cause' AS cause FROM audit_events WHERE account_id = $1 AND event_type = 'authz.denied' AND data->>'route' = 'POST /api/auth/mobile/refresh'", [h.accountId]);
    assert.ok(audit.some((r) => r.cause === "refresh_token_reused"));

    // Device mismatch revokes the family too.
    const login2 = await h.anonymous.send("POST", "/api/auth/mobile/login", { username: "octo", password: TEST_PASSWORD, deviceId: "ios-device-a" });
    const grantA = login2.body as MobileTokenGrant;
    const mismatch = await h.anonymous.send("POST", "/api/auth/mobile/refresh", { refreshToken: grantA.refreshToken, deviceId: "ios-device-b" });
    assert.deepEqual([mismatch.status, codeOf(mismatch)], [401, MOBILE_REFRESH_INVALID]);
    const afterMismatch = await h.anonymous.send("POST", "/api/auth/mobile/refresh", { refreshToken: grantA.refreshToken, deviceId: "ios-device-a" });
    assert.deepEqual([afterMismatch.status, codeOf(afterMismatch)], [401, MOBILE_REFRESH_INVALID]);
  });

  test("mobile logout, logout-all, password change, and disabled user revoke mobile refresh tokens and codes", async () => {
    // 1. Mobile logout revokes family and ends current browser session cookie if presented.
    const l1 = await h.anonymous.send("POST", "/api/auth/mobile/login", { username: "octo", password: TEST_PASSWORD, deviceId: "ios-device-out" });
    const g1 = l1.body as MobileTokenGrant;
    const jar1: Record<string, string> = {};
    const ex1 = await browserAt(h.url, jar1).send("POST", "/api/auth/mobile/exchange", { code: g1.exchangeCode });
    assert.equal(ex1.status, 200);
    const webview1 = browserAt(h.url, jar1, ex1.body as AuthStatus);
    const out1 = await webview1.send("POST", "/api/auth/mobile/logout", { refreshToken: g1.refreshToken, deviceId: "ios-device-out" });
    assert.equal(out1.status, 200);
    assert.equal(codeOf(await webview1.get("/api/sessions")), SIGN_IN_REQUIRED);
    assert.deepEqual([codeOf(await h.anonymous.send("POST", "/api/auth/mobile/refresh", { refreshToken: g1.refreshToken, deviceId: "ios-device-out" }))], [MOBILE_REFRESH_INVALID]);

    // 2. Web logout-all revokes mobile refresh tokens and unconsumed exchange codes.
    const l2 = await h.anonymous.send("POST", "/api/auth/mobile/login", { username: "octo", password: TEST_PASSWORD, deviceId: "ios-device-all" });
    const g2 = l2.body as MobileTokenGrant;
    const b2 = await h.browser();
    assert.equal((await b2.send("POST", "/api/auth/logout-all")).status, 200);
    assert.equal(codeOf(await h.anonymous.send("POST", "/api/auth/mobile/refresh", { refreshToken: g2.refreshToken, deviceId: "ios-device-all" })), MOBILE_REFRESH_INVALID);
    assert.equal(codeOf(await browserAt(h.url).send("POST", "/api/auth/mobile/exchange", { code: g2.exchangeCode })), MOBILE_EXCHANGE_INVALID);

    // 3. Changing password revokes mobile refresh tokens too.
    const freshBrowser = await h.signIn("octo", TEST_PASSWORD);
    const l3 = await h.anonymous.send("POST", "/api/auth/mobile/login", { username: "octo", password: TEST_PASSWORD, deviceId: "ios-device-pw" });
    const g3 = l3.body as MobileTokenGrant;
    assert.equal((await freshBrowser.send("POST", "/api/auth/password", { currentPassword: TEST_PASSWORD, newPassword: "another mobile passphrase" })).status, 200);
    assert.equal(codeOf(await h.anonymous.send("POST", "/api/auth/mobile/refresh", { refreshToken: g3.refreshToken, deviceId: "ios-device-pw" })), MOBILE_REFRESH_INVALID);

    // 4. Disabled user cannot refresh or exchange.
    const l4 = await h.anonymous.send("POST", "/api/auth/mobile/login", { username: "octo", password: "another mobile passphrase", deviceId: "ios-device-dis" });
    const g4 = l4.body as MobileTokenGrant;
    await h.sql("UPDATE users SET disabled_at = now() WHERE id = $1", [h.userId]);
    assert.equal(codeOf(await h.anonymous.send("POST", "/api/auth/mobile/exchange", { code: g4.exchangeCode })), MOBILE_EXCHANGE_INVALID);
    assert.equal(codeOf(await h.anonymous.send("POST", "/api/auth/mobile/refresh", { refreshToken: g4.refreshToken, deviceId: "ios-device-dis" })), MOBILE_REFRESH_INVALID);
  });
});

describe("mobile auth in token mode (ORBIT_WEB_ACCESS_TOKEN)", () => {
  const token = "mobile-access-token-secret-12345";
  let h: Harness;
  before(async () => (h = await startHarness({ env: { ORBIT_WEB_ALLOWED_HOSTS: "orbit.internal", ORBIT_WEB_ACCESS_TOKEN: token }, account: { connect: false } })));
  after(() => h.close());

  test("mobile auth routes require the access token before issuing or exchanging mobile credentials", async () => {
    const noToken = await h.anonymous.send("POST", "/api/auth/mobile/login", { username: "octo", password: TEST_PASSWORD, deviceId: "ios-token-dev" });
    assert.deepEqual([noToken.status, codeOf(noToken)], [401, "access_token_required"]);

    const withBearer = await h.anonymous.send(
      "POST",
      "/api/auth/mobile/login",
      { username: "octo", password: TEST_PASSWORD, deviceId: "ios-token-dev" },
      { authorization: `Bearer ${token}` },
    );
    assert.equal(withBearer.status, 200, JSON.stringify(withBearer.body));
    const grant = withBearer.body as MobileTokenGrant;

    const jar: Record<string, string> = {};
    const browser = browserAt(h.url, jar);
    assert.equal((await browser.send("POST", "/api/access", { token })).status, 204);
    const exchanged = await browser.send("POST", "/api/auth/mobile/exchange", { code: grant.exchangeCode });
    assert.equal(exchanged.status, 200);
    assert.equal((exchanged.body as AuthStatus).state, "signed_in");
  });
});
