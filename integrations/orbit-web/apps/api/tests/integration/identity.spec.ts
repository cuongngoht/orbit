// ORBIT'S OWN SIGN-IN, through the real API: a username and a password, independent of every AI CLI. A setup code makes
// the first administrator (of two browsers with one code, one gets it); the login counts every attempt first and slows
// a guesser down; each sign-in issues a new session (rotation); a session is valid by its user, lifetime and idle limit
// alone; sessions are listed and ended; a password is changed against the current one; a profile and the account are
// edited against the version the page read. Until a browser signs in, every route but the public ones answers 401.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";
import {
  CSRF_HEADER,
  INVALID_CREDENTIALS,
  MUTATION_HEADER,
  PRECONDITION_REQUIRED,
  SETUP_ALREADY_DONE,
  SETUP_CODE_INVALID,
  SIGN_IN_REQUIRED,
  STALE_VERSION,
  TOO_MANY_ATTEMPTS,
  type AuthAccount,
  type AuthStatus,
  type AuthUser,
  type SessionView,
} from "@orbit-web/contracts";
import { newSetupCode } from "../../src/modules/auth/setup-codes.js";
import { browserAt, startHarness, TEST_PASSWORD, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";
import { routesOf } from "../../src/testing/routes.js";

const code = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

const SYSTEM = "00000000-0000-4000-8000-000000000001";

// A code as the terminal writes it (cli/governance.ts owner setup-code).
async function plantCode(h: Harness, purpose: "first_admin" | "new_account" = "first_admin"): Promise<string> {
  const c = newSetupCode();
  await h.sql("INSERT INTO setup_codes (id, account_id, purpose, user_id, code_hash, created_at, expires_at) VALUES ($1, $2, $3, NULL, $4, now(), now() + interval '30 minutes')", [randomUUID(), SYSTEM, purpose, c.hash]);
  return c.code;
}

const SETUP = { username: "admin", password: "a long first password", fullName: "Ada Admin", timezone: "Asia/Ho_Chi_Minh" };

describe("the first administrator: one code, two browsers, one account", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ signIn: false })));
  after(() => h.close());

  test("before it, the status says setup is needed and every route but the public ones answers 401", async () => {
    const status = (await h.anonymous.get("/api/auth/status")).body as AuthStatus;
    assert.deepEqual([status.state, status.session, status.user, status.trial.enabled], ["setup_required", null, null, false]);
    assert.equal(status.setupCode, null, "no standing code unless the operator set one: the setup needs a printed code");
    const open = new Set([
      "GET /api/health",
      "POST /api/access",
      "GET /api/auth/status",
      "POST /api/auth/login",
      "POST /api/auth/mobile/login",
      "POST /api/auth/mobile/refresh",
      "POST /api/auth/mobile/exchange",
      "POST /api/auth/mobile/logout",
      "POST /api/auth/setup",
      "GET /api/shared/:token",
    ]);
    const routes = routesOf(h);
    assert.deepEqual(routes.filter((r) => r.open).map((r) => `${r.method} ${r.path}`).sort(), [...open].sort(), "nothing else is public");
    for (const r of routes.filter((x) => !x.open && !x.agent)) {
      const path = r.path.replace(/:[A-Za-z]+/g, "00000000-0000-4000-8000-000000000000");
      const reply = r.method === "GET" ? await h.anonymous.get(path) : await h.anonymous.send(r.method, path, {});
      assert.deepEqual([reply.status, code(reply)], [401, SIGN_IN_REQUIRED], `${r.method} ${r.path}`);
    }
  });

  test("the password rules hold at setup: twelve characters, not the username, no sequence, not a common one", async () => {
    const setupCode = await plantCode(h);
    for (const password of ["short", "admin-password-1", "123456789012", "aaaaaaaaaaaaaaa", "abcdefghijklmn", "passwordpassword"]) {
      const r = await h.anonymous.send("POST", "/api/auth/setup", { ...SETUP, code: setupCode, password });
      assert.equal(r.status, 400, password);
    }
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM setup_codes WHERE consumed_at IS NULL"))[0]?.n, 1, "a refused setup uses no code up");
  });

  test("of two browsers with the same code at once, exactly one makes the account", async () => {
    const setupCode = await plantCode(h);
    const a = browserAt(h.url);
    const b = browserAt(h.url);
    const [ra, rb] = await Promise.all([a.send("POST", "/api/auth/setup", { ...SETUP, code: setupCode }), b.send("POST", "/api/auth/setup", { ...SETUP, username: "other", code: setupCode })]);
    assert.deepEqual([ra.status, rb.status].sort(), [200, 400], JSON.stringify([ra.body, rb.body]));
    assert.equal(code(ra.status === 400 ? ra : rb), SETUP_CODE_INVALID);
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM accounts WHERE kind = 'customer'"))[0]?.n, 1);
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM users"))[0]?.n, 1);
    const winner = (ra.status === 200 ? ra : rb).body as AuthStatus;
    assert.equal(winner.state, "signed_in");
    assert.equal(winner.user?.emailVerified, false);
    assert.equal(winner.user?.shareAddress, `${winner.user?.username}@users.orbit.local`, "no verified email: shared with by username");
    const [made] = await h.sql("SELECT event_type, data->>'setting' AS setting FROM audit_events WHERE account_id = $1 AND event_type = 'settings.privileged.changed'", [winner.account?.orbitId ?? null]);
    assert.deepEqual(made, { event_type: "settings.privileged.changed", setting: "identity.setup_code.first_admin" }, "the code's use is in the account's audit record");
  });
});

// A test installation's operator sets ONE standing code (ORBIT_WEB_SETUP_CODE): the setup page shows it filled in, it
// survives every reset (it lives in the environment, not the database), and it makes the first administrator alone.
describe("a standing setup code: a test installation's first administrator, filled in on the page", () => {
  const STANDING = "ORBIT-TEST-SETUP-2026";
  let h: Harness;
  before(async () => (h = await startHarness({ signIn: false, env: { ORBIT_WEB_SETUP_CODE: STANDING } })));
  after(() => h.close());

  test("while nobody is set up, the status hands the page the standing code to fill in", async () => {
    const status = (await h.anonymous.get("/api/auth/status")).body as AuthStatus;
    assert.equal(status.state, "setup_required");
    assert.equal(status.setupCode, STANDING);
  });

  test("it makes the first administrator, uses up nothing, and the audit record says it was the standing code", async () => {
    const r = await browserAt(h.url).send("POST", "/api/auth/setup", { ...SETUP, code: "orbit test setup 2026" });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const made = r.body as AuthStatus;
    assert.equal(made.state, "signed_in");
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM setup_codes"))[0]?.n, 0, "nothing is stored or consumed");
    const [audit] = await h.sql("SELECT data->>'setting' AS setting, data->>'value' AS value FROM audit_events WHERE account_id = $1 AND event_type = 'settings.privileged.changed' AND data->>'setting' = 'identity.setup_code.first_admin'", [made.account?.orbitId ?? null]);
    assert.match(String(audit?.value), /standing/);
  });

  test("once an administrator exists, the page is given no code and the standing code makes nothing more", async () => {
    const status = (await h.anonymous.get("/api/auth/status")).body as AuthStatus;
    assert.equal(status.state, "signed_out");
    assert.equal(status.setupCode, null);
    const again = await browserAt(h.url).send("POST", "/api/auth/setup", { ...SETUP, username: "second", code: STANDING });
    assert.equal(again.status, 409);
    assert.equal(code(again), SETUP_ALREADY_DONE);
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM accounts WHERE kind = 'customer'"))[0]?.n, 1);
  });

  test("a printed one-time code still makes another account beside it", async () => {
    const printed = await plantCode(h, "new_account");
    const r = await browserAt(h.url).send("POST", "/api/auth/setup", { ...SETUP, username: "second", code: printed });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM accounts WHERE kind = 'customer'"))[0]?.n, 2);
  });
});

describe("signing in", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ account: { connect: false } })));
  after(() => h.close());

  test("a wrong password and an unknown user get the same answer, and neither says which part was wrong", async () => {
    const wrong = await h.anonymous.send("POST", "/api/auth/login", { username: "octo", password: "not the password at all" });
    const nobody = await h.anonymous.send("POST", "/api/auth/login", { username: "nobody", password: "not the password at all" });
    for (const r of [wrong, nobody]) assert.deepEqual([r.status, code(r)], [401, INVALID_CREDENTIALS]);
    assert.equal(JSON.stringify(wrong.body), JSON.stringify(nobody.body));
    assert.equal(wrong.headers.get("set-cookie"), null, "no session for a refused sign-in");
    const recorded = await h.sql("SELECT data->>'cause' AS cause FROM audit_events WHERE account_id = $1 AND event_type = 'authz.denied' AND data->>'route' = 'POST /api/auth/login'", [h.accountId]);
    assert.ok(recorded.some((r) => r.cause === "invalid_credentials"), "a refused sign-in of a user is in the user's account's record");
  });

  test("a sign-in is a change: it needs the mutation header, like every change", async () => {
    const r = await fetch(`${h.url}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "octo", password: TEST_PASSWORD }) });
    assert.equal(r.status, 403);
    assert.equal(((await r.json()) as { error: { code: string } }).error.code, "missing_header");
  });

  test("the session is an HttpOnly, SameSite=Strict cookie the server keeps the hash of, and it rotates at each sign-in", async () => {
    const jar: Record<string, string> = {};
    const first = browserAt(h.url, jar);
    const r = await first.send("POST", "/api/auth/login", { username: "OCTO", password: TEST_PASSWORD });
    assert.equal(r.status, 200, "usernames are compared in lower case");
    const cookie = r.headers.get("set-cookie") ?? "";
    for (const part of [/^orbit_web_session=[^;]+;/, /; Max-Age=604800/, /; Path=\/api/, /; HttpOnly/, /; SameSite=Strict/]) assert.match(cookie, part);
    assert.doesNotMatch(cookie, /; Secure/, "Secure only behind HTTPS (ORBIT_WEB_COOKIE_SECURE=1)");
    const token = jar.orbit_web_session as string;
    assert.equal(JSON.stringify(await h.sql("SELECT * FROM account_sessions")).includes(token), false, "only its hash is kept");
    const signedIn = browserAt(h.url, jar, r.body as AuthStatus);
    assert.equal((await signedIn.get("/api/sessions")).status, 200);
    const again = await browserAt(h.url, jar).send("POST", "/api/auth/login", { username: "octo", password: TEST_PASSWORD });
    assert.equal(again.status, 200);
    assert.notEqual(jar.orbit_web_session, token, "a new token");
    const stale = await fetch(`${h.url}/api/sessions`, { headers: { cookie: `orbit_web_session=${encodeURIComponent(token)}` } });
    assert.equal(stale.status, 401, "the session this browser held before is revoked");
  });

  test("a change without this session's CSRF token is refused", async () => {
    const b = await h.browser();
    const r = await fetch(`${h.url}/api/auth/profile`, { method: "PATCH", headers: { [MUTATION_HEADER]: "1", cookie: b.cookie, "content-type": "application/json" }, body: JSON.stringify({ fullName: "Mallory" }) });
    assert.equal(r.status, 403);
    const forged = await fetch(`${h.url}/api/auth/profile`, { method: "PATCH", headers: { [MUTATION_HEADER]: "1", [CSRF_HEADER]: "x".repeat(64), cookie: b.cookie, "content-type": "application/json" }, body: JSON.stringify({ fullName: "Mallory" }) });
    assert.equal(forged.status, 403);
  });

  test("a session lives by its user and its limits alone: an idle one, or one past its lifetime, is over", async () => {
    const idle = await h.browser();
    const ended = await h.browser();
    await h.sql("UPDATE account_sessions SET last_seen_at = now() - interval '25 hours' WHERE id = (SELECT id FROM account_sessions WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1 OFFSET 1)");
    await h.sql("UPDATE account_sessions SET expires_at = now() - interval '1 second' WHERE id = (SELECT id FROM account_sessions WHERE revoked_at IS NULL ORDER BY created_at DESC LIMIT 1)");
    assert.equal(code(await ended.get("/api/sessions")), SIGN_IN_REQUIRED);
    assert.equal(code(await idle.get("/api/sessions")), SIGN_IN_REQUIRED);
    const reasons = (await h.sql("SELECT revoked_reason FROM account_sessions WHERE revoked_reason IN ('idle', 'expired') ORDER BY revoked_reason")).map((r) => r.revoked_reason);
    assert.deepEqual(reasons, ["expired", "idle"]);
    assert.equal((await h.get("/api/sessions")).status, 200, "the others stay");
  });
});

describe("a guesser is slowed down, counted before any password is compared", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ account: { connect: false } })));
  after(() => h.close());

  const guess = (b: Browser, password = "not the password at all") => b.send("POST", "/api/auth/login", { username: "octo", password });

  test("five free attempts for a username; the sixth sets a wait, and until it passes even the right password waits", async () => {
    const b = browserAt(h.url);
    for (let i = 0; i < 6; i += 1) assert.equal(code(await guess(b)), INVALID_CREDENTIALS, `attempt ${i + 1}`);
    const held = await guess(b, TEST_PASSWORD);
    assert.deepEqual([held.status, code(held)], [429, TOO_MANY_ATTEMPTS]);
    assert.ok(Number(held.headers.get("retry-after")) > 0 && Number(held.headers.get("retry-after")) <= 30, "Retry-After says how long");
    assert.match(JSON.stringify(held.body), /Try again in \d+ seconds/);
    // The wait passed (the clock moved): the right password signs in, and the username's count starts again.
    await h.sql("UPDATE login_throttle SET blocked_until = now() - interval '1 second' WHERE key = 'user:octo'");
    assert.equal((await guess(b, TEST_PASSWORD)).status, 200);
    assert.equal((await h.sql("SELECT count(*)::int AS n FROM login_throttle WHERE key = 'user:octo'"))[0]?.n, 0);
    assert.deepEqual((await h.sql("SELECT DISTINCT account_id FROM login_throttle")).map((r) => r.account_id), [SYSTEM], "the throttle is the deployment's");
  });

  test("a burst at once is held to the same rule: no more than the free attempts and one more are ever compared", async () => {
    const b = browserAt(h.url);
    const replies = await Promise.all(Array.from({ length: 25 }, () => guess(b)));
    const compared = replies.filter((r) => code(r) === INVALID_CREDENTIALS).length;
    assert.ok(compared <= 6, `${compared} attempts were compared`);
    assert.equal(replies.filter((r) => code(r) === TOO_MANY_ATTEMPTS).length, 25 - compared);
    await h.sql("DELETE FROM login_throttle");
  });

  test("ten failures in a row lock the user for a while, whatever the throttle says", async () => {
    await h.sql("UPDATE users SET failed_attempts = 9 WHERE username = 'octo'");
    const b = browserAt(h.url);
    assert.equal(code(await guess(b)), INVALID_CREDENTIALS);
    const [locked] = await h.sql("SELECT failed_attempts, locked_until > now() + interval '14 minutes' AS long FROM users WHERE username = 'octo'");
    assert.deepEqual(locked, { failed_attempts: 10, long: true });
    await h.sql("DELETE FROM login_throttle");
    assert.equal(code(await guess(b, TEST_PASSWORD)), TOO_MANY_ATTEMPTS, "locked: the right password waits too");
    await h.sql("UPDATE users SET locked_until = now() - interval '1 second' WHERE username = 'octo'");
    assert.equal((await guess(b, TEST_PASSWORD)).status, 200);
    assert.deepEqual(await h.sql("SELECT failed_attempts, locked_until FROM users WHERE username = 'octo'"), [{ failed_attempts: 0, locked_until: null }], "a sign-in clears the count");
  });
});

describe("sessions, password, profile and the account", () => {
  let h: Harness;
  before(async () => (h = await startHarness({ account: { connect: false } })));
  after(() => h.close());

  test("the user's sessions are listed; another of them can be ended -- never another user's", async () => {
    const other = await h.browser();
    const list = (await h.get("/api/auth/sessions")).body as SessionView[];
    assert.ok(list.length >= 2);
    assert.equal(list.filter((s) => s.current).length, 1);
    const bob = await h.as("bob", { connect: false });
    const bobsSession = ((await bob.get("/api/auth/sessions")).body as SessionView[])[0] as SessionView;
    assert.equal((await h.send("DELETE", `/api/auth/sessions/${bobsSession.id}`)).status, 404, "another user's session is not found");
    assert.equal((await bob.get("/api/sessions")).status, 200);
    for (const s of list.filter((x) => !x.current)) assert.equal((await h.send("DELETE", `/api/auth/sessions/${s.id}`)).status, 204);
    assert.equal(code(await other.get("/api/sessions")), SIGN_IN_REQUIRED);
    assert.equal((await h.get("/api/sessions")).status, 200, "this one stays");
  });

  test("a password is changed against the current one, held to the rules; the user's other sessions end", async () => {
    const other = await h.browser();
    const wrong = await h.send("POST", "/api/auth/password", { currentPassword: "not my password", newPassword: "another long passphrase" });
    assert.deepEqual([wrong.status, code(wrong)], [403, INVALID_CREDENTIALS]);
    const weak = await h.send("POST", "/api/auth/password", { currentPassword: TEST_PASSWORD, newPassword: "octo-1234567890" });
    assert.equal(weak.status, 400);
    assert.match(JSON.stringify(weak.body), /must not contain the username/);
    const done = await h.send("POST", "/api/auth/password", { currentPassword: TEST_PASSWORD, newPassword: "another long passphrase" });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal((done.body as AuthUser).mustChangePassword, false);
    assert.equal(code(await other.get("/api/sessions")), SIGN_IN_REQUIRED, "the other browser signs in again");
    assert.equal((await h.get("/api/sessions")).status, 200, "this one stays");
    assert.equal((await h.anonymous.send("POST", "/api/auth/login", { username: "octo", password: TEST_PASSWORD })).status, 401);
    assert.equal((await h.signIn("octo", "another long passphrase")).status?.state, "signed_in");
  });

  test("the profile: a new email is unverified (and shares nothing) until verified; a stale version is refused", async () => {
    const before = ((await h.get("/api/auth/status")).body as AuthStatus).user as AuthUser;
    assert.deepEqual([before.email, before.emailVerified, before.shareAddress], ["octo@example.com", true, "octo@example.com"]);
    const changed = await h.send("PATCH", "/api/auth/profile", { fullName: "Octo the Cat", email: "octo@new.example" }, { "if-match": `"${before.version}"` });
    assert.equal(changed.status, 200, JSON.stringify(changed.body));
    const after = changed.body as AuthUser;
    assert.deepEqual([after.fullName, after.email, after.emailVerified, after.shareAddress], ["Octo the Cat", "octo@new.example", false, "octo@users.orbit.local"]);
    assert.equal(changed.headers.get("etag"), `"${after.version}"`);
    const stale = await h.send("PATCH", "/api/auth/profile", { fullName: "Too late" }, { "if-match": `"${before.version}"` });
    assert.deepEqual([stale.status, code(stale)], [412, STALE_VERSION]);
    assert.equal((await h.send("PATCH", "/api/auth/profile", {})).status, 400, "nothing to change");
  });

  test("the account: read with its version, changed only against it (428 without, 412 when stale)", async () => {
    const read = await h.get("/api/account");
    const account = read.body as AuthAccount;
    assert.equal(read.headers.get("etag"), `"${account.version}"`);
    assert.equal(account.orbitId, h.accountId);
    const none = await h.send("PATCH", "/api/account", { companyName: "Acme" });
    assert.deepEqual([none.status, code(none)], [428, PRECONDITION_REQUIRED]);
    const ok = await h.send("PATCH", "/api/account", { companyName: "Acme", timezone: "Asia/Ho_Chi_Minh", contactEmail: "billing@acme.example" }, { "if-match": `"${account.version}"` });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual([(ok.body as AuthAccount).companyName, (ok.body as AuthAccount).timezone, (ok.body as AuthAccount).version], ["Acme", "Asia/Ho_Chi_Minh", account.version + 1]);
    const stale = await h.send("PATCH", "/api/account", { companyName: "Other" }, { "if-match": `"${account.version}"` });
    assert.deepEqual([stale.status, code(stale)], [412, STALE_VERSION]);
    assert.equal((await h.send("PATCH", "/api/account", { timezone: "Mars/Olympus" }, { "if-match": `"${account.version + 1}"` })).status, 400);
    const bob = await h.as("bob", { connect: false });
    assert.equal(((await bob.get("/api/account")).body as AuthAccount).companyName, "", "another account's is its own");
  });

  test("signing out ends this browser's session; signing out everywhere ends every session of the user", async () => {
    // (The password changed above.)
    const a = await h.signIn("octo", "another long passphrase");
    const b = await h.signIn("octo", "another long passphrase");
    const out = await a.send("POST", "/api/auth/logout");
    assert.equal(out.status, 200);
    assert.equal((out.body as AuthStatus).state, "signed_out");
    assert.match(out.headers.get("set-cookie") ?? "", /orbit_web_session=;/);
    assert.equal(code(await a.get("/api/sessions")), SIGN_IN_REQUIRED);
    assert.equal((await b.get("/api/sessions")).status, 200);
    const stream = await b.stream("/api/events");
    assert.equal((await b.send("POST", "/api/auth/logout-all")).status, 200);
    await stream.ended;
    assert.equal(code(await h.get("/api/sessions")), SIGN_IN_REQUIRED, "every session of the user, this harness's own too");
    const reasons = (await h.sql("SELECT data->>'reason' AS reason FROM audit_events WHERE account_id = $1 AND event_type = 'auth.sessions.revoked' ORDER BY seq", [h.accountId])).map((r) => r.reason);
    assert.deepEqual(reasons, ["password_changed", "signed_out_everywhere"], "each ending of many sessions is one record, with why");
  });
});
