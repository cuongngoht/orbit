// The HTTP surface's guards: host allow-list (DNS rebinding), the CSRF header, the session's CSRF token and the origin,
// JSON bodies of a bounded size, input validation, and the access token mode -- where the token opens the door and a
// browser's own Claude sign-in is still what makes it somebody.
import assert from "node:assert/strict";
import { request } from "node:http";
import { after, before, describe, test } from "node:test";
import { CLAUDE_SIGN_IN_REQUIRED, CSRF_HEADER } from "@orbit-web/contracts";
import { browserAt, signInBrowser, startHarness, type Browser, type Harness, type Reply } from "../../src/testing/harness.js";

const errorCode = (r: Reply): string | undefined => (r.body as { error?: { code?: string } } | null)?.error?.code;

// fetch() will not send a Host header of our choosing; node:http will.
function rawGet(url: string, host: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(url, { headers: { host } }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    req.on("error", reject);
    req.end();
  });
}

describe("the default, loopback-only surface", () => {
  let h: Harness;
  before(async () => (h = await startHarness()));
  after(() => h.close());

  test("a page that re-binds its own name to this address is refused by Host", async () => {
    assert.equal(await rawGet(`${h.url}/api/health`, "attacker.example:3000"), 421);
    assert.equal(await rawGet(`${h.url}/api/health`, "localhost:3000"), 200);
    assert.equal(await rawGet(`${h.url}/api/health`, "[::1]:3000"), 200);
  });

  test("a change needs the Orbit Web header, this origin and a JSON body", async () => {
    const naked = await fetch(`${h.url}/api/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"theme":"dark"}' });
    assert.equal(naked.status, 403);
    assert.equal((await h.send("PATCH", "/api/settings", { theme: "dark" }, { origin: "https://attacker.example" })).status, 403);
    assert.equal((await h.send("PATCH", "/api/settings", { theme: "dark" }, { "sec-fetch-site": "cross-site" })).status, 403);
    const form = await fetch(`${h.url}/api/settings`, { method: "PATCH", headers: { "x-orbit-web": "1", "content-type": "text/plain" }, body: "theme=dark" });
    assert.equal(form.status, 415);
    assert.equal((await h.send("PATCH", "/api/settings", { theme: "dark" }, { origin: h.url })).status, 200);
  });

  test("a change also needs this browser session's own CSRF token: a signed-in cookie alone changes nothing", async () => {
    const wrong = await h.send("PATCH", "/api/settings", { theme: "light" }, { [CSRF_HEADER]: "0".repeat(64) });
    assert.equal(wrong.status, 403);
    assert.equal(errorCode(wrong), "csrf_invalid");
    const none = await fetch(`${h.url}/api/settings`, { method: "PATCH", headers: { "x-orbit-web": "1", "content-type": "application/json", cookie: h.cookie }, body: '{"theme":"light"}' });
    assert.equal(none.status, 403);
    assert.equal((await h.get("/api/settings")).status, 200, "reading needs no CSRF token");
  });

  test("bodies are bounded and validated; unknown fields are refused", async () => {
    assert.equal((await h.send("POST", "/api/sessions", { repository: { source: "github", id: "o/r" }, branch: "main", model: "sonnet", prompt: "x".repeat(300_000) })).status, 413);
    const bad = await fetch(`${h.url}/api/settings`, { method: "PATCH", headers: { "x-orbit-web": "1", "content-type": "application/json" }, body: "{not json" });
    assert.equal(bad.status, 400);
    assert.equal((await h.send("PATCH", "/api/settings", { theme: "dark", shell: "rm -rf /" })).status, 400);
    assert.equal((await h.get("/api/sessions/not-a-uuid")).status, 404);
    assert.equal((await h.get("/api/sessions/00000000-0000-4000-8000-000000000000/changes")).status, 404);
  });

  test("every response carries the content security policy and no framework banner", async () => {
    const r = await h.get("/api/health");
    assert.match(r.headers.get("content-security-policy") ?? "", /default-src 'self'; script-src 'self'/);
    assert.equal(r.headers.get("x-frame-options"), "DENY");
    assert.equal(r.headers.get("x-powered-by"), null);
  });

  test("on this machine alone there is no access link: nothing to give", async () => {
    assert.deepEqual((await h.get("/api/access/link")).body, { token: null });
  });

  test("the health check names no path, variable or account", async () => {
    const text = JSON.stringify((await h.get("/api/health")).body);
    assert.doesNotMatch(text, /\/data|\/tmp|HOME|token|octo/i);
  });
});

describe("token mode, for a host name beyond loopback", () => {
  let h: Harness;
  // A browser that traded the token for its cookie, then finished its own Claude sign-in.
  let owner: Browser;
  const token = "a-long-and-random-access-token";
  before(async () => {
    h = await startHarness({ env: { ORBIT_WEB_ALLOWED_HOSTS: "orbit.internal", ORBIT_WEB_ACCESS_TOKEN: token } });
    const jar: Record<string, string> = {};
    assert.equal((await browserAt(h.url, jar).send("POST", "/api/access", { token })).status, 204);
    owner = await signInBrowser(h.url, jar);
  });
  after(() => h.close());

  test("the API needs the token, then a browser's own sign-in; health stays open for the container's health check", async () => {
    assert.equal(errorCode(await h.anonymous.get("/api/setup/status")), "access_token_required");
    assert.equal((await h.anonymous.get("/api/health")).status, 200);
    const tokenOnly = await h.anonymous.get("/api/setup/status", { authorization: `Bearer ${token}` });
    assert.equal(tokenOnly.status, 401, "the token opens the door; it is nobody's sign-in");
    assert.equal(errorCode(tokenOnly), CLAUDE_SIGN_IN_REQUIRED);
    assert.equal((await owner.get("/api/setup/status")).status, 200);
  });

  test("the token is traded for an HttpOnly, SameSite=Strict cookie kept 30 days, so a browser is asked for it once", async () => {
    assert.equal((await h.anonymous.send("POST", "/api/access", { token: "wrong-token-of-enough-length" })).status, 401);
    const ok = await h.anonymous.send("POST", "/api/access", { token });
    assert.equal(ok.status, 204);
    const cookie = ok.headers.get("set-cookie") ?? "";
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Max-Age=2592000/, "not a session cookie: a browser restart or a redeploy asks for nothing again");
    const cookieOnly = await fetch(`${h.url}/api/settings`, { headers: { cookie: cookie.split(";")[0] as string } });
    assert.equal(cookieOnly.status, 401, "past the token, the browser signs in with Claude");
    assert.equal(((await cookieOnly.json()) as { error: { code: string } }).error.code, CLAUDE_SIGN_IN_REQUIRED);
    assert.equal((await owner.get("/api/settings")).status, 200);
  });

  test("the API is /api/ and nothing else: no other spelling of it -- case, repeated slashes -- gets past the token", async () => {
    for (const path of ["/API/sessions", "/Api/settings", "/API/access/link", "/api/ACCESS/link", "//api/sessions", "/aPi/setup/status"]) {
      const r = await h.anonymous.get(path);
      assert.notEqual(r.status, 200, path);
      assert.equal(JSON.stringify(r.body).includes(token), false, path);
    }
    const write = await fetch(`${h.url}/API/settings`, { method: "PATCH", headers: { "content-type": "application/json" }, body: '{"theme":"dark"}' });
    assert.notEqual(write.status, 200, "a change spelled otherwise needs the token and the header too");
  });

  test("the access link is given only to whoever is already in, never cached", async () => {
    assert.equal((await h.anonymous.get("/api/access/link")).status, 401);
    assert.equal((await h.anonymous.get("/api/access/link", { authorization: `Bearer ${token}` })).status, 401, "in means signed in, not only past the token");
    const r = await owner.get("/api/access/link");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { token });
    assert.equal(r.headers.get("cache-control"), "no-store");
  });
});
